import http from 'http';
import https from 'https';
import path from 'path';
import fs from 'fs';
import { ApiHandler } from './api-handler';
import { WebSocketHandler } from './websocket';
import RcloneHandler from '../main/rclone';
import BackupScheduler from '../main/backup-scheduler';
import RcloneInstaller from '../main/rclone-installer';
import { UpdateManager } from '../main/update-manager';
import AppUpdater from '../main/app-updater';
import { getCertificateManager } from '../main/cert-manager';

interface WebServerOptions {
  port: number;
  distPath: string;
  rcloneHandler: RcloneHandler;
  backupScheduler: BackupScheduler;
  rcloneInstaller: RcloneInstaller;
  updateManager: UpdateManager;
  appUpdater: AppUpdater;
  allowExternal?: boolean; // If true, listen on 0.0.0.0 (all interfaces). If false, localhost only (127.0.0.1)
  useHttps?: boolean; // If true, use HTTPS instead of HTTP
  httpsPort?: number; // Port for HTTPS server (default: 3001)
  onBackupsChanged?: () => void; // Callback when active backups change
}

export class WebServer {
  private server: http.Server | https.Server | null = null;
  private port: number;
  private httpsPort: number;
  private distPath: string;
  private apiHandler: ApiHandler;
  private wsHandler: WebSocketHandler | null = null;
  private allowExternal: boolean;
  private useHttps: boolean;
  private onBackupsChanged?: () => void;

  constructor(options: WebServerOptions) {
    this.port = options.port;
    this.httpsPort = options.httpsPort ?? 3001;
    this.distPath = options.distPath;
    this.allowExternal = options.allowExternal ?? false;
    this.useHttps = options.useHttps ?? false;
    this.onBackupsChanged = options.onBackupsChanged;
    this.apiHandler = new ApiHandler({
      rcloneHandler: options.rcloneHandler,
      backupScheduler: options.backupScheduler,
      rcloneInstaller: options.rcloneInstaller,
      updateManager: options.updateManager,
      appUpdater: options.appUpdater,
    });
  }

  async start(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const requestHandler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
        try {
          await this.handleRequest(req, res);
        } catch (error) {
          console.error('[WebServer] Request error:', error);
          res.writeHead(500);
          res.end('Internal Server Error');
        }
      };

      // Create HTTPS server if enabled
      if (this.useHttps) {
        try {
          const certManager = getCertificateManager();
          const certs = await certManager.getCertificates();

          this.server = https.createServer(
            {
              key: certs.key,
              cert: certs.cert,
            },
            requestHandler
          );

          // Bind to hostname based on allowExternal setting
          const hostname = this.allowExternal ? '0.0.0.0' : '127.0.0.1';
          const port = this.port;

          this.server.listen(port, hostname, () => {
            const accessType = this.allowExternal ? '0.0.0.0 (external access enabled)' : '127.0.0.1 (localhost only)';
            console.log(`[WebServer] HTTPS server running at https://${accessType}:${port}`);
            console.log(`[WebServer] Certificate fingerprint: ${certs.fingerprint}`);

            // Initialize WebSocket server after HTTPS server starts
            if (this.server) {
              this.wsHandler = new WebSocketHandler(
                this.server,
                this.apiHandler['context'].rcloneInstaller,
                this.apiHandler['context'].backupScheduler,
                this.apiHandler['context'].appUpdater,
                this.onBackupsChanged
              );
              // Pass WebSocket handler to API handler for broadcasting
              this.apiHandler.setWebSocketHandler(this.wsHandler);
            }

            resolve();
          });

          this.server.on('error', (error) => {
            console.error('[WebServer] HTTPS server error:', error);
            reject(error);
          });
        } catch (error) {
          console.error('[WebServer] Failed to create HTTPS server:', error);
          reject(error);
        }
      } else {
        // Create HTTP server (fallback)
        this.server = http.createServer(requestHandler);

        // Bind to hostname based on allowExternal setting
        const hostname = this.allowExternal ? '0.0.0.0' : '127.0.0.1';

        this.server.listen(this.port, hostname, () => {
          const accessType = this.allowExternal ? '0.0.0.0 (external access enabled)' : '127.0.0.1 (localhost only)';
          console.log(`[WebServer] HTTP server running at http://${accessType}:${this.port}`);

          // Initialize WebSocket server after HTTP server starts
          if (this.server) {
            this.wsHandler = new WebSocketHandler(
              this.server,
              this.apiHandler['context'].rcloneInstaller,
              this.apiHandler['context'].backupScheduler,
              this.apiHandler['context'].appUpdater,
              this.onBackupsChanged
            );
            // Pass WebSocket handler to API handler for broadcasting
            this.apiHandler.setWebSocketHandler(this.wsHandler);
          }

          resolve();
        });

        this.server.on('error', (error) => {
          console.error('[WebServer] HTTP server error:', error);
          reject(error);
        });
      }
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close WebSocket server first
      if (this.wsHandler) {
        this.wsHandler.close();
        this.wsHandler = null;
      }

      // Then close HTTP server
      if (this.server) {
        this.server.close(() => {
          console.log('[WebServer] Server stopped');
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url || '/';

    // WebSocket upgrades are handled by WebSocketServer automatically
    // We don't need to do anything here for /ws path

    // API routes
    if (url.startsWith('/api/')) {
      await this.apiHandler.handle(req, res);
      return;
    }

    // In development mode, proxy to Vite dev server (but NOT /ws - that's handled by WebSocketServer)
    if (process.env.NODE_ENV === 'development') {
      await this.proxyToVite(req, res);
      return;
    }

    // Serve static files (production mode)
    let filePath = path.join(this.distPath, url === '/' ? 'index.html' : url);

    // If the path doesn't have an extension, try to serve index.html (for client-side routing)
    if (!path.extname(filePath)) {
      filePath = path.join(this.distPath, 'index.html');
    }

    try {
      const content = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath);
      const contentType = this.getContentType(ext);

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File not found, serve index.html for client-side routing
        try {
          const indexPath = path.join(this.distPath, 'index.html');
          const content = await fs.promises.readFile(indexPath);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(content);
        } catch {
          res.writeHead(404);
          res.end('Not Found');
        }
      } else {
        throw error;
      }
    }
  }

  private async proxyToVite(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url || '/';
    const viteUrl = `http://localhost:5173${url}`;

    try {
      const response = await fetch(viteUrl, {
        method: req.method,
        headers: req.headers as HeadersInit,
      });

      // Copy status and headers
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));

      // Stream response
      const buffer = await response.arrayBuffer();
      res.end(Buffer.from(buffer));
    } catch (error: any) {
      console.error('[WebServer] Proxy error:', error.message);
      res.writeHead(502);
      res.end('Bad Gateway - Vite dev server may not be running');
    }
  }

  private getContentType(ext: string): string {
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.eot': 'application/vnd.ms-fontobject',
    };
    return types[ext] || 'application/octet-stream';
  }

  getPort(): number {
    return this.port;
  }

  isHttps(): boolean {
    return this.useHttps;
  }

  getActiveBackups(): Array<{ jobId: string; jobName: string; percentage: number }> {
    if (!this.wsHandler) {
      return [];
    }
    return this.wsHandler.getActiveBackups();
  }

  async startBackup(jobId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.wsHandler) {
      return { success: false, error: 'WebSocket handler not initialized' };
    }
    return this.wsHandler.startBackupDirect(jobId);
  }
}

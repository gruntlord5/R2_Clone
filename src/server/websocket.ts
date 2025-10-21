import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import RcloneHandler from '../main/rclone';
import BackupScheduler from '../main/backup-scheduler';
import RcloneInstaller from '../main/rclone-installer';
import AppUpdater from '../main/app-updater';
import { getDatabase, type R2Bucket } from '../main/database';
import * as fs from 'node:fs';
import path from 'node:path';

export class WebSocketHandler {
  private wss: WebSocketServer;
  private clients: Map<WebSocket, { activeBackupId?: string }> = new Map();
  // Map to store active RcloneHandler instances per job ID (for concurrent backups)
  private activeHandlers: Map<string, {
    handler: RcloneHandler;
    backupRunId: number | null;
    filesTransferred: number;
    filesSkipped: number;
    totalSize: number;
    percentage: number;
  }> = new Map();
  private backupScheduler: BackupScheduler;
  private rcloneInstaller: RcloneInstaller;
  private appUpdater: AppUpdater;
  private onBackupsChangedCallback?: () => void;

  constructor(server: http.Server, rcloneInstaller: RcloneInstaller, backupScheduler: BackupScheduler, appUpdater: AppUpdater, onBackupsChanged?: () => void) {
    this.rcloneInstaller = rcloneInstaller;
    this.backupScheduler = backupScheduler;
    this.appUpdater = appUpdater;
    this.onBackupsChangedCallback = onBackupsChanged;
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.set(ws, {});

      // Handle incoming messages
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleClientMessage(ws, message);
        } catch (error: any) {
          console.error('[WebSocket] Message error:', error);
          this.sendToClient(ws, {
            type: 'error',
            data: { message: error.message }
          });
        }
      });

      ws.on('close', () => {
        const clientData = this.clients.get(ws);
        if (clientData?.activeBackupId) {
          const handlerData = this.activeHandlers.get(clientData.activeBackupId);
          if (handlerData) {
            handlerData.handler.stopBackup();
          }
        }
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('[WebSocket] Error:', error);
        this.clients.delete(ws);
      });

      // Send initial connection success
      this.sendToClient(ws, { type: 'connected', message: 'WebSocket connected' });
    });

    // NOTE: Per-backup rclone event listeners are now set up in handleBackupStart()
    // Each backup gets its own dedicated handler with its own event listeners

    // Forward scheduler events
    backupScheduler.on('started', (data) => {
      this.broadcast({ type: 'scheduler:backup-started', data });
    });

    backupScheduler.on('completed', (data) => {
      this.broadcast({ type: 'scheduler:backup-completed', data });
    });

    backupScheduler.on('error', (data) => {
      this.broadcast({ type: 'scheduler:backup-error', data });
    });

    backupScheduler.on('skipped', (data) => {
      this.broadcast({ type: 'scheduler:backup-skipped', data });
    });

    // Forward rclone installer events
    rcloneInstaller.on('status', (status) => {
      this.broadcast({ type: 'rclone:install-status', data: status });
    });

    rcloneInstaller.on('progress', (progress) => {
      this.broadcast({ type: 'rclone:install-progress', data: progress });
    });

    rcloneInstaller.on('error', (error) => {
      this.broadcast({ type: 'rclone:install-error', data: error });
    });

    rcloneInstaller.on('complete', (installedPath) => {
      this.broadcast({ type: 'rclone:install-complete', data: installedPath });
    });

    // Forward app updater events
    appUpdater.on('status', (status) => {
      this.broadcast({ type: 'app:update-status', data: status });
    });

    appUpdater.on('progress', (progress) => {
      this.broadcast({ type: 'app:update-progress', data: progress });
    });

    appUpdater.on('error', (error) => {
      this.broadcast({ type: 'app:update-error', data: error });
    });

    appUpdater.on('complete', (version) => {
      this.broadcast({ type: 'app:update-complete', data: version });
    });

    console.log('[WebSocket] Server initialized on /ws');
  }

  private async handleClientMessage(ws: WebSocket, message: any): Promise<void> {
    const { type, data } = message;

    switch (type) {
      case 'backup:start':
        await this.handleBackupStart(ws, data);
        break;

      case 'backup:stop':
        await this.handleBackupStop(ws, data);
        break;

      default:
        // Unknown message type - ignore
        break;
    }
  }

  private async handleBackupStart(ws: WebSocket, data: any): Promise<void> {
    const { sourcePath, jobId, jobName, bucketId } = data;
    const db = getDatabase();

    try {
      // Require jobId for tracking
      if (!jobId) {
        this.sendToClient(ws, {
          type: 'backup:start:response',
          data: { success: false, error: 'Job ID is required for backup operations' }
        });
        return;
      }

      // Check if this job already has an active backup
      if (this.activeHandlers.has(jobId)) {
        this.sendToClient(ws, {
          type: 'backup:start:response',
          data: { success: false, error: 'A backup is already running for this job' }
        });
        return;
      }

      const destinationPath = db.getSetting('backup_destination');
      if (!destinationPath) {
        this.sendToClient(ws, {
          type: 'backup:start:response',
          data: { success: false, error: 'No backup destination configured' }
        });
        return;
      }

      let bucket: R2Bucket | undefined;
      if (bucketId) {
        bucket = db.getBucket(bucketId);
      } else if (jobId) {
        const job = db.getBackupJob(jobId);
        if (job) bucket = db.getBucket(job.bucket_id);
      }

      if (!bucket) {
        this.sendToClient(ws, {
          type: 'backup:start:response',
          data: { success: false, error: 'No bucket configured' }
        });
        return;
      }

      // Create a new dedicated RcloneHandler for this backup
      const handler = new RcloneHandler(this.rcloneInstaller);

      handler.setConfig({
        accessKeyId: bucket.access_key_id,
        secretAccessKey: bucket.secret_access_key,
        endpoint: bucket.endpoint,
        bucketName: bucket.bucket_name,
        region: bucket.region || 'auto'
      });

      const safeName = (jobName || 'backup').replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);
      const timestamp = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').replace(/\..+/, '');
      const folderName = `${safeName}_${timestamp}`;
      const timestampedPath = path.join(destinationPath, folderName);

      fs.mkdirSync(timestampedPath, { recursive: true });

      let backupRunId: number | null = null;
      if (jobId) {
        backupRunId = db.createBackupRun({
          job_id: jobId,
          bucket_id: bucket.id!,
          status: 'running',
          started_at: new Date().toISOString(),
          completed_at: undefined,
          files_transferred: 0,
          files_skipped: 0,
          total_size: 0,
          backup_path: timestampedPath,
          error_message: undefined
        });
      }

      // Store handler and tracking data in activeHandlers Map
      this.activeHandlers.set(jobId, {
        handler,
        backupRunId,
        filesTransferred: 0,
        filesSkipped: 0,
        totalSize: 0,
        percentage: 0
      });

      // Helper function to cleanup handler from map
      const cleanupHandler = () => {
        this.activeHandlers.delete(jobId);
      };

      // Set up event listeners for this specific handler
      handler.on('progress', (progress) => {
        const handlerData = this.activeHandlers.get(jobId);
        if (handlerData) {
          handlerData.percentage = progress.percentage || 0;
          // Update tray when percentage changes
          if (this.onBackupsChangedCallback) {
            this.onBackupsChangedCallback();
          }
        }
        this.broadcast({ type: 'backup:progress', data: { ...progress, jobId } });
      });

      handler.on('file-transferred', (file) => {
        const handlerData = this.activeHandlers.get(jobId);
        if (handlerData) {
          handlerData.filesTransferred++;
          this.broadcast({ type: 'backup:file-transferred', data: { file, jobId } });
        }
      });

      handler.on('file-skipped', (file) => {
        const handlerData = this.activeHandlers.get(jobId);
        if (handlerData) {
          handlerData.filesSkipped++;
          this.broadcast({ type: 'backup:file-skipped', data: { file, jobId } });
        }
      });

      handler.on('nothing-to-transfer', () => {
        this.broadcast({ type: 'backup:nothing-to-transfer', data: { jobId } });
      });

      handler.on('complete', (data) => {
        const handlerData = this.activeHandlers.get(jobId);
        if (handlerData && handlerData.backupRunId) {
          const backupRun = db.getBackupRun(handlerData.backupRunId);

          // Calculate actual backup size from directory
          if (backupRun?.backup_path) {
            const actualSize = this.getDirectorySize(backupRun.backup_path);
            if (actualSize > 0) {
              handlerData.totalSize = actualSize;
            }
          }

          db.updateBackupRun(handlerData.backupRunId, {
            status: 'completed',
            completed_at: new Date().toISOString(),
            files_transferred: handlerData.filesTransferred,
            files_skipped: handlerData.filesSkipped,
            total_size: handlerData.totalSize
          });

          // Update lastRun for the job
          const job = db.getBackupJob(jobId);
          if (job) {
            db.updateBackupJob(jobId, { last_run: new Date().toISOString() });
          }
          // Enforce retention policy
          db.enforceRetentionPolicy(jobId);
        }

        this.broadcast({ type: 'backup:complete', data: { ...data, jobId } });
        cleanupHandler();

        // Notify about backups change
        if (this.onBackupsChangedCallback) {
          this.onBackupsChangedCallback();
        }
      });

      handler.on('error', (error) => {
        const handlerData = this.activeHandlers.get(jobId);
        if (handlerData && handlerData.backupRunId) {
          db.updateBackupRun(handlerData.backupRunId, {
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: error.message,
            files_transferred: handlerData.filesTransferred,
            files_skipped: handlerData.filesSkipped,
            total_size: handlerData.totalSize
          });
        }

        this.broadcast({ type: 'backup:error', data: { message: error.message, jobId } });
        cleanupHandler();

        // Notify about backups change
        if (this.onBackupsChangedCallback) {
          this.onBackupsChangedCallback();
        }
      });

      handler.on('stopped', () => {
        const handlerData = this.activeHandlers.get(jobId);
        if (handlerData && handlerData.backupRunId) {
          db.updateBackupRun(handlerData.backupRunId, {
            status: 'stopped',
            completed_at: new Date().toISOString(),
            files_transferred: handlerData.filesTransferred,
            files_skipped: handlerData.filesSkipped,
            total_size: handlerData.totalSize
          });
        }

        this.broadcast({ type: 'backup:stopped', data: { jobId } });
        cleanupHandler();

        // Notify about backups change
        if (this.onBackupsChangedCallback) {
          this.onBackupsChangedCallback();
        }
      });

      const clientData = this.clients.get(ws);
      if (clientData) {
        clientData.activeBackupId = jobId;
      }

      // Broadcast to all clients that backup has started
      this.broadcast({
        type: 'backup:started',
        data: { jobId, jobName, sourcePath }
      });

      // Notify about backups change
      if (this.onBackupsChangedCallback) {
        this.onBackupsChangedCallback();
      }

      await handler.startBackup(sourcePath, timestampedPath, false);

      this.sendToClient(ws, {
        type: 'backup:start:response',
        data: { success: true, actualPath: timestampedPath }
      });
    } catch (error: any) {
      this.sendToClient(ws, {
        type: 'backup:start:response',
        data: { success: false, error: error.message }
      });
    }
  }

  private async handleBackupStop(ws: WebSocket, data: any): Promise<void> {
    const { jobId } = data;

    try {
      // If jobId is provided, stop that specific backup
      if (jobId) {
        const handlerData = this.activeHandlers.get(jobId);
        if (handlerData) {
          handlerData.handler.stopBackup();
          this.sendToClient(ws, {
            type: 'backup:stop:response',
            data: { success: true }
          });
        } else {
          this.sendToClient(ws, {
            type: 'backup:stop:response',
            data: { success: false, error: `No active backup found for job ${jobId}` }
          });
        }
      } else {
        // Legacy: Stop all active backups if no jobId provided
        if (this.activeHandlers.size > 0) {
          for (const handlerData of this.activeHandlers.values()) {
            handlerData.handler.stopBackup();
          }
          this.sendToClient(ws, {
            type: 'backup:stop:response',
            data: { success: true }
          });
        } else {
          this.sendToClient(ws, {
            type: 'backup:stop:response',
            data: { success: false, error: 'No active backups to stop' }
          });
        }
      }

      const clientData = this.clients.get(ws);
      if (clientData) {
        clientData.activeBackupId = undefined;
      }
    } catch (error: any) {
      this.sendToClient(ws, {
        type: 'backup:stop:response',
        data: { success: false, error: error.message }
      });
    }
  }

  private sendToClient(client: WebSocket, message: any): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  broadcast(message: any): void {
    const payload = JSON.stringify(message);
    this.clients.forEach((client, ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    });
  }

  private getDirectorySize(dirPath: string): number {
    let size = 0;
    try {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            size += this.getDirectorySize(filePath);
          } else {
            size += stats.size;
          }
        } catch (err) {
          console.error(`[WebSocket] Failed to stat file ${filePath}:`, err);
        }
      }
    } catch (err) {
      console.error(`[WebSocket] Failed to read directory ${dirPath}:`, err);
    }
    return size;
  }

  getActiveBackups(): Array<{ jobId: string; jobName: string; percentage: number }> {
    const db = getDatabase();
    const activeBackups: Array<{ jobId: string; jobName: string; percentage: number }> = [];

    for (const [jobId, handlerData] of this.activeHandlers.entries()) {
      const job = db.getBackupJob(jobId);
      activeBackups.push({
        jobId,
        jobName: job?.name || `Job ${jobId}`,
        percentage: handlerData.percentage
      });
    }

    return activeBackups;
  }

  /**
   * Start a backup directly without requiring a WebSocket client
   * Used for tray menu triggers and other main process operations
   */
  public async startBackupDirect(jobId: string): Promise<{ success: boolean; error?: string }> {
    const db = getDatabase();

    try {
      // Check if this job already has an active backup
      if (this.activeHandlers.has(jobId)) {
        return { success: false, error: 'A backup is already running for this job' };
      }

      const job = db.getBackupJob(jobId);
      if (!job) {
        return { success: false, error: 'Job not found' };
      }

      const destinationPath = db.getSetting('backup_destination');
      if (!destinationPath) {
        return { success: false, error: 'No backup destination configured' };
      }

      const bucket = db.getBucket(job.bucket_id);
      if (!bucket) {
        return { success: false, error: 'No bucket configured' };
      }

      // Create a new dedicated RcloneHandler for this backup
      const handler = new RcloneHandler(this.rcloneInstaller);

      handler.setConfig({
        accessKeyId: bucket.access_key_id,
        secretAccessKey: bucket.secret_access_key,
        endpoint: bucket.endpoint,
        bucketName: bucket.bucket_name,
        region: bucket.region || 'auto'
      });

      const safeName = (job.name || 'backup').replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);
      const timestamp = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').replace(/\..+/, '');
      const folderName = `${safeName}_${timestamp}`;
      const timestampedPath = path.join(destinationPath, folderName);

      fs.mkdirSync(timestampedPath, { recursive: true });

      const backupRunId = db.createBackupRun({
        job_id: jobId,
        bucket_id: bucket.id!,
        status: 'running',
        started_at: new Date().toISOString(),
        completed_at: undefined,
        files_transferred: 0,
        files_skipped: 0,
        total_size: 0,
        backup_path: timestampedPath,
        error_message: undefined
      });

      // Store handler and tracking data in activeHandlers Map
      this.activeHandlers.set(jobId, {
        handler,
        backupRunId,
        filesTransferred: 0,
        filesSkipped: 0,
        totalSize: 0,
        percentage: 0
      });

      // Helper function to cleanup handler from map
      const cleanupHandler = () => {
        this.activeHandlers.delete(jobId);
      };

      // Set up event listeners for this specific handler
      handler.on('progress', (progress) => {
        const handlerData = this.activeHandlers.get(jobId);
        if (handlerData) {
          handlerData.percentage = progress.percentage || 0;
          // Update tray when percentage changes
          if (this.onBackupsChangedCallback) {
            this.onBackupsChangedCallback();
          }
        }
        this.broadcast({ type: 'backup:progress', data: { ...progress, jobId } });
      });

      handler.on('file-transferred', (file) => {
        const handlerData = this.activeHandlers.get(jobId);
        if (handlerData) {
          handlerData.filesTransferred++;
          this.broadcast({ type: 'backup:file-transferred', data: { file, jobId } });
        }
      });

      handler.on('file-skipped', (file) => {
        const handlerData = this.activeHandlers.get(jobId);
        if (handlerData) {
          handlerData.filesSkipped++;
          this.broadcast({ type: 'backup:file-skipped', data: { file, jobId } });
        }
      });

      handler.on('nothing-to-transfer', () => {
        this.broadcast({ type: 'backup:nothing-to-transfer', data: { jobId } });
      });

      handler.on('complete', (data) => {
        const handlerData = this.activeHandlers.get(jobId);
        if (handlerData && handlerData.backupRunId) {
          const backupRun = db.getBackupRun(handlerData.backupRunId);

          // Calculate actual backup size from directory
          if (backupRun?.backup_path) {
            const actualSize = this.getDirectorySize(backupRun.backup_path);
            if (actualSize > 0) {
              handlerData.totalSize = actualSize;
            }
          }

          db.updateBackupRun(handlerData.backupRunId, {
            status: 'completed',
            completed_at: new Date().toISOString(),
            files_transferred: handlerData.filesTransferred,
            files_skipped: handlerData.filesSkipped,
            total_size: handlerData.totalSize
          });

          // Update lastRun for the job
          const job = db.getBackupJob(jobId);
          if (job) {
            db.updateBackupJob(jobId, { last_run: new Date().toISOString() });
          }
          // Enforce retention policy
          db.enforceRetentionPolicy(jobId);
        }

        this.broadcast({ type: 'backup:complete', data: { ...data, jobId } });
        cleanupHandler();

        // Notify about backups change
        if (this.onBackupsChangedCallback) {
          this.onBackupsChangedCallback();
        }
      });

      handler.on('error', (error) => {
        const handlerData = this.activeHandlers.get(jobId);
        if (handlerData && handlerData.backupRunId) {
          db.updateBackupRun(handlerData.backupRunId, {
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: error.message,
            files_transferred: handlerData.filesTransferred,
            files_skipped: handlerData.filesSkipped,
            total_size: handlerData.totalSize
          });
        }

        this.broadcast({ type: 'backup:error', data: { message: error.message, jobId } });
        cleanupHandler();

        // Notify about backups change
        if (this.onBackupsChangedCallback) {
          this.onBackupsChangedCallback();
        }
      });

      handler.on('stopped', () => {
        const handlerData = this.activeHandlers.get(jobId);
        if (handlerData && handlerData.backupRunId) {
          db.updateBackupRun(handlerData.backupRunId, {
            status: 'stopped',
            completed_at: new Date().toISOString(),
            files_transferred: handlerData.filesTransferred,
            files_skipped: handlerData.filesSkipped,
            total_size: handlerData.totalSize
          });
        }

        this.broadcast({ type: 'backup:stopped', data: { jobId } });
        cleanupHandler();

        // Notify about backups change
        if (this.onBackupsChangedCallback) {
          this.onBackupsChangedCallback();
        }
      });

      // Broadcast to all clients that backup has started
      this.broadcast({
        type: 'backup:started',
        data: { jobId, jobName: job.name, sourcePath: job.source_path }
      });

      // Notify about backups change
      if (this.onBackupsChangedCallback) {
        this.onBackupsChangedCallback();
      }

      // Start the backup asynchronously (don't await)
      handler.startBackup(job.source_path, timestampedPath, false).catch((error) => {
        console.error('[WebSocket] Backup start error:', error);
      });

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  close(): void {
    this.clients.forEach((clientData, ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
    this.clients.clear();
    this.wss.close();
    console.log('[WebSocket] Server closed');
  }
}

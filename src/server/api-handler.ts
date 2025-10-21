import http from 'http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { getDatabase, type R2Bucket } from '../main/database';
import RcloneHandler from '../main/rclone';
import BackupScheduler from '../main/backup-scheduler';
import RcloneInstaller from '../main/rclone-installer';
import { UpdateManager } from '../main/update-manager';
import AppUpdater from '../main/app-updater';

interface ApiContext {
  rcloneHandler: RcloneHandler;
  backupScheduler: BackupScheduler;
  rcloneInstaller: RcloneInstaller;
  updateManager: UpdateManager;
  appUpdater: AppUpdater;
  wsHandler?: any; // WebSocketHandler for broadcasting events
}

export class ApiHandler {
  private context: ApiContext;

  constructor(context: ApiContext) {
    this.context = context;
  }

  // Called by WebServer after WebSocketHandler is created
  setWebSocketHandler(wsHandler: any) {
    this.context.wsHandler = wsHandler;
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url || '';
    const method = req.method || 'GET';

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      // Parse body for POST/PUT/DELETE requests
      let body: any = {};
      if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
        body = await this.parseBody(req);
      }

      // Route handling
      // Backup routes
      if (url === '/api/backup/jobs' && method === 'GET') {
        await this.getBackupJobs(res);
      } else if (url === '/api/backup/runs' && method === 'GET') {
        await this.getBackupRuns(res);
      } else if (url === '/api/backup/stats' && method === 'GET') {
        await this.getBackupStats(res);
      } else if (url === '/api/backup/start' && method === 'POST') {
        await this.startBackup(body, res);
      } else if (url === '/api/backup/stop' && method === 'POST') {
        await this.stopBackup(res);
      } else if (url.startsWith('/api/backup/job/') && method === 'GET') {
        const jobId = url.split('/').pop();
        await this.getBackupJob(jobId!, res);
      } else if (url === '/api/backup/save-job' && method === 'POST') {
        await this.saveBackupJob(body, res);
      } else if (url.startsWith('/api/backup/delete-job/') && method === 'DELETE') {
        const jobId = url.split('/').pop();
        await this.deleteBackupJob(jobId!, res);
      } else if (url.startsWith('/api/backup/delete-run/') && method === 'DELETE') {
        const parts = url.split('/');
        const id = parseInt(parts[parts.length - 1]);
        await this.deleteBackupRun(id, body.deleteFiles, res);
      } else if (url.startsWith('/api/backup/calculate-run-size/') && method === 'POST') {
        const parts = url.split('/');
        const id = parseInt(parts[parts.length - 1]);
        await this.calculateRunSize(id, res);
      } else if (url === '/api/backup/list-files' && method === 'POST') {
        await this.listFiles(body.path, body.bucketId, res);
      } else if (url === '/api/backup/list-directories' && method === 'POST') {
        await this.listDirectories(body.path, body.bucketId, res);
      } else if (url.startsWith('/api/backup/runs-by-job/') && method === 'GET') {
        const parts = url.split('?');
        const pathParts = parts[0].split('/');
        const jobId = pathParts[pathParts.length - 1];
        const searchParams = new URLSearchParams(parts[1] || '');
        const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined;
        await this.getRunsByJob(jobId, limit, res);
      } else if (url.startsWith('/api/backup/run-size/') && method === 'GET') {
        const jobId = url.split('/').pop();
        await this.getRunSize(jobId!, res);
      } else if (url === '/api/backup/directory-size' && method === 'GET') {
        await this.getDirectorySize(res);

      // Bucket routes
      } else if (url === '/api/buckets' && method === 'GET') {
        await this.getBuckets(res);
      } else if (url.startsWith('/api/bucket/') && method === 'GET') {
        const parts = url.split('/');
        const id = parseInt(parts[parts.length - 1]);
        await this.getBucket(id, res);
      } else if (url === '/api/bucket/create' && method === 'POST') {
        await this.createBucket(body, res);
      } else if (url.startsWith('/api/bucket/update/') && method === 'PUT') {
        const parts = url.split('/');
        const id = parseInt(parts[parts.length - 1]);
        await this.updateBucket(id, body, res);
      } else if (url.startsWith('/api/bucket/delete/') && method === 'DELETE') {
        const parts = url.split('/');
        const id = parseInt(parts[parts.length - 1]);
        await this.deleteBucket(id, res);
      } else if (url.startsWith('/api/bucket/test/') && method === 'POST') {
        const parts = url.split('/');
        const id = parseInt(parts[parts.length - 1]);
        await this.testBucketConnection(id, res);
      } else if (url === '/api/r2/test-connection' && method === 'POST') {
        await this.testConnection(res);

      // Settings routes
      } else if (url === '/api/settings' && method === 'GET') {
        await this.getSettings(res);
      } else if (url === '/api/settings' && method === 'PUT') {
        await this.updateSettings(body, res);
      } else if (url === '/api/settings/backup-destination' && method === 'GET') {
        await this.getBackupDestination(res);
      } else if (url === '/api/settings/backup-destination' && method === 'PUT') {
        await this.setBackupDestination(body.path, res);
      } else if (url === '/api/settings/rclone-path' && method === 'GET') {
        await this.getRclonePath(res);
      } else if (url === '/api/settings/rclone-path' && method === 'PUT') {
        await this.setRclonePath(body.path, res);
      } else if (url === '/api/settings/home-directory' && method === 'GET') {
        await this.getHomeDirectory(res);
      } else if (url === '/api/settings/special-paths' && method === 'GET') {
        await this.getSpecialPaths(res);
      } else if (url === '/api/settings/local-ip' && method === 'GET') {
        await this.getLocalIP(res);
      } else if (url === '/api/settings/last-seen-version' && method === 'GET') {
        await this.getLastSeenVersion(res);
      } else if (url === '/api/settings/last-seen-version' && method === 'PUT') {
        await this.setLastSeenVersion(body.version, res);
      } else if (url === '/api/settings/timezone' && method === 'GET') {
        await this.getTimezone(res);
      } else if (url === '/api/settings/timezone' && method === 'PUT') {
        await this.setTimezone(body.timezone, res);

      // System routes
      } else if (url === '/api/system/time' && method === 'GET') {
        await this.getSystemTime(res);
      } else if (url === '/api/system/cloudflare-time' && method === 'GET') {
        await this.getCloudflareTime(res);
      } else if (url === '/api/system/sync-time' && method === 'POST') {
        await this.syncSystemTime(res);

      // Rclone routes
      } else if (url === '/api/rclone/status' && method === 'GET') {
        await this.getRcloneStatus(res);
      } else if (url === '/api/rclone/install' && method === 'POST') {
        await this.installRclone(res);
      } else if (url === '/api/rclone/uninstall' && method === 'POST') {
        await this.uninstallRclone(res);

      // Scheduler routes
      } else if (url === '/api/scheduler/status' && method === 'GET') {
        await this.getSchedulerStatus(res);
      } else if (url.startsWith('/api/scheduler/next-run/') && method === 'GET') {
        const jobId = url.split('/').pop();
        await this.getNextRun(jobId!, res);
      } else if (url === '/api/scheduler/all-scheduled' && method === 'GET') {
        await this.getAllScheduled(res);
      } else if (url.startsWith('/api/scheduler/trigger/') && method === 'POST') {
        const jobId = url.split('/').pop();
        await this.triggerBackup(jobId!, res);

      // Web server routes
      } else if (url === '/api/webserver/status' && method === 'GET') {
        await this.getWebServerStatus(res);

      // App routes
      } else if (url === '/api/app/version' && method === 'GET') {
        await this.getAppVersion(res);
      } else if (url === '/api/app/status' && method === 'GET') {
        await this.getAppStatus(res);
      } else if (url === '/api/app/check-updates' && method === 'GET') {
        await this.checkForUpdates(res);
      } else if (url === '/api/app/install-update' && method === 'POST') {
        await this.installAppUpdate(body, res);
      } else if (url === '/api/app/restart' && method === 'POST') {
        await this.restartApp(res);
      } else if (url === '/api/system/root-directories' && method === 'GET') {
        await this.getRootDirectories(res);

      } else {
        this.sendError(res, 404, 'Not Found');
      }
    } catch (error: any) {
      console.error('[ApiHandler] Error:', error);
      this.sendError(res, 500, error.message);
    }
  }

  private async parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          // Handle empty body
          if (!body || body.trim() === '') {
            resolve({});
            return;
          }
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
      req.on('error', reject);
    });
  }

  private sendJson(res: http.ServerResponse, data: any, status: number = 200): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private sendError(res: http.ServerResponse, status: number, message: string): void {
    this.sendJson(res, { success: false, error: message }, status);
  }

  // API Methods (reusing logic from IPC handlers)

  private async getBackupJobs(res: http.ServerResponse): Promise<void> {
    const db = getDatabase();
    const jobsWithBuckets = db.getAllBackupJobsWithBuckets();

    const jobs = jobsWithBuckets.map(job => ({
      id: job.id,
      name: job.name,
      sourcePath: job.source_path,
      bucketId: job.bucket_id,
      schedule: job.schedule,
      scheduleMetadata: job.schedule_metadata ? JSON.parse(job.schedule_metadata) : undefined,
      retentionCount: job.retention_count,
      lastRun: job.last_run ? new Date(job.last_run) : undefined,
      bucket: job.bucket ? {
        id: job.bucket.id,
        name: job.bucket.name,
        bucketName: job.bucket.bucket_name,
        endpoint: job.bucket.endpoint,
        accessKeyId: job.bucket.access_key_id,
        // secretAccessKey intentionally omitted for security
        region: job.bucket.region,
      } : undefined
    }));

    this.sendJson(res, jobs);
  }

  private async getBackupRuns(res: http.ServerResponse): Promise<void> {
    const db = getDatabase();
    const query = 'SELECT br.*, bj.name as job_name, b.name as bucket_name FROM backup_runs br LEFT JOIN backup_jobs bj ON br.job_id = bj.id LEFT JOIN buckets b ON br.bucket_id = b.id ORDER BY br.started_at DESC';
    const stmt = db.db.prepare(query);
    const runs = stmt.all();

    this.sendJson(res, runs);
  }

  private async startBackup(body: any, res: http.ServerResponse): Promise<void> {
    const { sourcePath, destinationPath: providedDestinationPath, dryRun, jobId, jobName, bucketId } = body;
    const db = getDatabase();
    let backupRunId: number | undefined;

    // Get the global backup destination if not provided
    let destinationPath = providedDestinationPath;
    if (!destinationPath) {
      destinationPath = db.getSetting('backup_destination');
      if (!destinationPath) {
        this.sendError(res, 400, 'No backup destination configured. Please set it in Settings.');
        return;
      }
    }

    // Get bucket configuration for this job
    let bucket: R2Bucket | undefined;
    if (bucketId) {
      bucket = db.getBucket(bucketId);
    } else if (jobId) {
      // For backward compatibility, get bucket from job
      const job = db.getBackupJob(jobId);
      if (job) {
        bucket = db.getBucket(job.bucket_id);
      }
    }

    if (!bucket) {
      this.sendError(res, 400, 'No bucket configured for this backup job');
      return;
    }

    // Configure rclone with the specific bucket
    this.context.rcloneHandler.setConfig({
      accessKeyId: bucket.access_key_id,
      secretAccessKey: bucket.secret_access_key,
      endpoint: bucket.endpoint,
      bucketName: bucket.bucket_name,
      region: bucket.region || 'auto'
    });

    // NOTE: Don't call removeAllListeners() - WebSocketHandler needs those listeners!
    // Events flow: rcloneHandler -> WebSocketHandler -> WebSocket clients

    // Track transfer statistics
    let filesTransferred = 0;
    let filesSkipped = 0;
    let totalSize = 0;

    // Get job name if not provided
    let backupName = jobName;
    if (!backupName && jobId) {
      const job = db.getBackupJob(jobId);
      if (job) {
        backupName = job.name;
      }
    }

    // Sanitize the backup name for filesystem
    const safeName = backupName ?
      backupName.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50) :
      'backup';

    // Create timestamped folder for this backup run with job name
    const timestamp = new Date().toISOString()
      .replace(/T/, '_')
      .replace(/:/g, '-')
      .replace(/\..+/, ''); // Format: YYYY-MM-DD_HH-mm-ss

    const folderName = `${safeName}_${timestamp}`;
    const timestampedPath = path.join(destinationPath, folderName);

    // Create the directory
    try {
      fs.mkdirSync(timestampedPath, { recursive: true });
    } catch (error: any) {
      console.error('[Backup] Failed to create directory:', error);
      this.sendError(res, 500, `Failed to create backup directory: ${error.message}`);
      return;
    }

    // Now create the backup run record with the actual path
    if (jobId && !dryRun) {
      try {
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
      } catch (error: any) {
        console.error('[Backup] Failed to create backup run record:', error);
      }
    }

    // Note: WebSocket events are already forwarded in websocket.ts
    // We just need to set up local event handlers to track statistics

    this.context.rcloneHandler.on('error', (error) => {
      // Update backup run record with error
      if (backupRunId) {
        db.updateBackupRun(backupRunId, {
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: error.message,
          files_transferred: filesTransferred,
          files_skipped: filesSkipped,
          total_size: totalSize,
          backup_path: timestampedPath
        });
      }
    });

    this.context.rcloneHandler.on('complete', (data) => {
      // Update the lastRun field for this job
      if (jobId) {
        const job = db.getBackupJob(jobId);
        if (job) {
          db.updateBackupJob(jobId, { last_run: new Date().toISOString() });
        }
      }

      // Calculate actual backup size from the timestamped folder
      const getDirectorySize = (dirPath: string): number => {
        let size = 0;
        try {
          const files = fs.readdirSync(dirPath);
          for (const file of files) {
            const filePath = path.join(dirPath, file);
            try {
              const stats = fs.statSync(filePath);
              if (stats.isDirectory()) {
                size += getDirectorySize(filePath);
              } else {
                size += stats.size;
              }
            } catch (err) {
              console.error(`Failed to stat file ${filePath}:`, err);
            }
          }
        } catch (err) {
          console.error(`Failed to read directory ${dirPath}:`, err);
        }
        return size;
      };

      try {
        if (fs.existsSync(timestampedPath)) {
          const actualSize = getDirectorySize(timestampedPath);
          // Always use the actual directory size as it's more accurate
          if (actualSize > 0) {
            totalSize = actualSize;
          }
        }
      } catch (error: any) {
        console.error('[Backup] Failed to calculate backup size:', error);
      }

      // Update backup run record as completed
      if (backupRunId) {
        db.updateBackupRun(backupRunId, {
          status: 'completed',
          completed_at: new Date().toISOString(),
          files_transferred: filesTransferred,
          files_skipped: filesSkipped,
          total_size: totalSize,
          backup_path: timestampedPath
        });

        // Enforce retention policy after successful backup
        if (jobId) {
          db.enforceRetentionPolicy(jobId);
        }
      }
    });

    this.context.rcloneHandler.on('stopped', () => {
      // Update backup run record as stopped
      if (backupRunId) {
        db.updateBackupRun(backupRunId, {
          status: 'stopped',
          completed_at: new Date().toISOString(),
          files_transferred: filesTransferred,
          files_skipped: filesSkipped,
          total_size: totalSize
        });
      }
    });

    this.context.rcloneHandler.on('file-transferred', (file) => {
      filesTransferred++;
      if (file.size) {
        totalSize += file.size;
      }
    });

    this.context.rcloneHandler.on('file-skipped', (file) => {
      filesSkipped++;
    });

    // Use the timestamped path for the actual backup
    await this.context.rcloneHandler.startBackup(sourcePath, timestampedPath, dryRun);
    this.sendJson(res, { success: true, actualPath: timestampedPath });
  }

  private async stopBackup(res: http.ServerResponse): Promise<void> {
    this.context.rcloneHandler.stopBackup();
    this.sendJson(res, { success: true });
  }

  private async getBackupJob(jobId: string, res: http.ServerResponse): Promise<void> {
    const db = getDatabase();
    const job = db.getBackupJob(jobId);
    this.sendJson(res, job || null);
  }

  private async saveBackupJob(body: any, res: http.ServerResponse): Promise<void> {
    const db = getDatabase();
    const dbJob = {
      id: body.id,
      name: body.name,
      source_path: body.sourcePath,
      bucket_id: body.bucketId,
      schedule: body.schedule,
      schedule_metadata: body.scheduleMetadata ? JSON.stringify(body.scheduleMetadata) : undefined,
      retention_count: body.retentionCount,
      last_run: body.lastRun ? new Date(body.lastRun).toISOString() : undefined,
    };

    const existing = db.getBackupJob(body.id);
    if (existing) {
      db.updateBackupJob(body.id, dbJob);
    } else {
      db.createBackupJob(dbJob);
    }

    const fullJob = db.getBackupJob(body.id);
    if (fullJob) {
      this.context.backupScheduler.updateJob(fullJob);
    }

    this.sendJson(res, { success: true });
  }

  private async deleteBackupJob(jobId: string, res: http.ServerResponse): Promise<void> {
    const db = getDatabase();
    db.deleteBackupJob(jobId);
    this.context.backupScheduler.unscheduleJob(jobId);
    this.sendJson(res, { success: true });
  }

  private async getBuckets(res: http.ServerResponse): Promise<void> {
    const db = getDatabase();
    const buckets = db.getAllBuckets();

    const formatted = buckets.map(b => ({
      id: b.id,
      name: b.name,
      accessKeyId: b.access_key_id,
      // secretAccessKey intentionally omitted for security - not needed by frontend
      endpoint: b.endpoint,
      bucketName: b.bucket_name,
      region: b.region,
      createdAt: b.created_at,
      updatedAt: b.updated_at
    }));

    this.sendJson(res, formatted);
  }

  private async getSettings(res: http.ServerResponse): Promise<void> {
    const db = getDatabase();
    const settings = db.getAppSettings();
    this.sendJson(res, settings);
  }

  private async getBackupDestination(res: http.ServerResponse): Promise<void> {
    const db = getDatabase();
    const destination = db.getSetting('backup_destination');
    this.sendJson(res, { destination });
  }

  private async getRclonePath(res: http.ServerResponse): Promise<void> {
    const db = getDatabase();
    const path = db.getRclonePath();
    this.sendJson(res, path);
  }

  private async getBackupStats(res: http.ServerResponse): Promise<void> {
    const db = getDatabase();
    const stats = db.getBackupRunsStats();
    this.sendJson(res, stats);
  }

  private async getRcloneStatus(res: http.ServerResponse): Promise<void> {
    const status = this.context.rcloneInstaller.getInstallStatus();
    this.sendJson(res, {
      success: true,
      isInstalled: status.isInstalled,
      version: status.version,
    });
  }

  private async getSchedulerStatus(res: http.ServerResponse): Promise<void> {
    this.sendJson(res, {
      isRunning: this.context.backupScheduler.getIsRunning(),
      activeBackupId: this.context.backupScheduler.getActiveBackupId(),
    });
  }

  private async getNextRun(jobId: string, res: http.ServerResponse): Promise<void> {
    const nextRun = this.context.backupScheduler.getNextRun(jobId);
    this.sendJson(res, nextRun ? nextRun.toISOString() : null);
  }

  private async getAllScheduled(res: http.ServerResponse): Promise<void> {
    const scheduled = this.context.backupScheduler.getScheduledJobs();
    this.sendJson(res, scheduled);
  }

  private async triggerBackup(jobId: string, res: http.ServerResponse): Promise<void> {
    try {
      if (this.context.wsHandler) {
        const result = await this.context.wsHandler.startBackupDirect(jobId);
        this.sendJson(res, result);
      } else {
        this.sendError(res, 500, 'WebSocket handler not initialized');
      }
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async getWebServerStatus(res: http.ServerResponse): Promise<void> {
    const db = getDatabase();
    const enabled = db.getSetting('web_server_enabled') === 'true';
    const port = parseInt(db.getSetting('web_server_port') || '3000');

    this.sendJson(res, {
      enabled,
      port,
      running: true, // If this endpoint is being called, server is running!
    });
  }

  // Bucket CRUD operations

  private async getBucket(id: number, res: http.ServerResponse): Promise<void> {
    try {
      const db = getDatabase();
      const bucket = db.getBucket(id);
      if (!bucket) {
        this.sendError(res, 404, 'Bucket not found');
        return;
      }

      this.sendJson(res, {
        id: bucket.id,
        name: bucket.name,
        accessKeyId: bucket.access_key_id,
        // secretAccessKey intentionally omitted for security - not needed by frontend
        endpoint: bucket.endpoint,
        bucketName: bucket.bucket_name,
        region: bucket.region,
        createdAt: bucket.created_at,
        updatedAt: bucket.updated_at
      });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async createBucket(body: any, res: http.ServerResponse): Promise<void> {
    try {
      const db = getDatabase();
      const bucket = db.createBucket({
        name: body.name,
        access_key_id: body.accessKeyId,
        secret_access_key: body.secretAccessKey,
        endpoint: body.endpoint,
        bucket_name: body.bucketName,
        region: body.region,
      });

      this.sendJson(res, {
        success: true,
        data: {
          id: bucket.id,
          name: bucket.name,
          accessKeyId: bucket.access_key_id,
          // secretAccessKey intentionally omitted for security
          endpoint: bucket.endpoint,
          bucketName: bucket.bucket_name,
          region: bucket.region,
          createdAt: bucket.created_at,
          updatedAt: bucket.updated_at
        }
      });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async updateBucket(id: number, body: any, res: http.ServerResponse): Promise<void> {
    try {
      const db = getDatabase();
      const updateData: any = {};

      if (body.name !== undefined) updateData.name = body.name;
      if (body.accessKeyId !== undefined) updateData.access_key_id = body.accessKeyId;
      if (body.secretAccessKey !== undefined) updateData.secret_access_key = body.secretAccessKey;
      if (body.endpoint !== undefined) updateData.endpoint = body.endpoint;
      if (body.bucketName !== undefined) updateData.bucket_name = body.bucketName;
      if (body.region !== undefined) updateData.region = body.region;

      const success = db.updateBucket(id, updateData);
      this.sendJson(res, { success });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async deleteBucket(id: number, res: http.ServerResponse): Promise<void> {
    try {
      const db = getDatabase();
      const success = db.deleteBucket(id);
      this.sendJson(res, { success });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async testBucketConnection(id: number, res: http.ServerResponse): Promise<void> {
    try {
      const db = getDatabase();
      const bucket = db.getBucket(id);
      if (!bucket) {
        this.sendError(res, 404, 'Bucket not found');
        return;
      }

      // Configure rclone with the bucket to test
      this.context.rcloneHandler.setConfig({
        accessKeyId: bucket.access_key_id,
        secretAccessKey: bucket.secret_access_key,
        endpoint: bucket.endpoint,
        bucketName: bucket.bucket_name,
        region: bucket.region || 'auto'
      });

      await this.context.rcloneHandler.testConnection();
      this.sendJson(res, { success: true });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async testConnection(res: http.ServerResponse): Promise<void> {
    try {
      await this.context.rcloneHandler.testConnection();
      this.sendJson(res, { success: true });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  // Backup run operations

  private async deleteBackupRun(id: number, deleteFiles: boolean, res: http.ServerResponse): Promise<void> {
    const db = getDatabase();

    try {
      // Get the backup run details first
      let run = db.getBackupRun(id);
      if (!run) {
        this.sendError(res, 404, 'Backup run not found');
        return;
      }

      // Helper function to calculate directory size recursively
      const getDirectorySize = (dirPath: string): number => {
        let totalSize = 0;
        try {
          const files = fs.readdirSync(dirPath);
          for (const file of files) {
            const filePath = path.join(dirPath, file);
            try {
              const stats = fs.statSync(filePath);
              if (stats.isDirectory()) {
                totalSize += getDirectorySize(filePath);
              } else {
                totalSize += stats.size;
              }
            } catch (err) {
              console.error(`Failed to stat file ${filePath}:`, err);
            }
          }
        } catch (err) {
          console.error(`Failed to read directory ${dirPath}:`, err);
        }
        return totalSize;
      };

      // If the run has 0 size and backup_path exists, calculate actual size
      if (run.total_size === 0 && run.backup_path && fs.existsSync(run.backup_path)) {
        const actualSize = getDirectorySize(run.backup_path);
        if (actualSize > 0) {
          // Update the run with calculated size
          db.updateBackupRun(id, { total_size: actualSize });
          run.total_size = actualSize;
        }
      }

      // If deleteFiles is true, try to delete the actual backup files
      if (deleteFiles) {
        // Use the backup_path from the run which has the correct timestamped directory
        const backupPath = run.backup_path;
        if (backupPath) {
          try {
            // Check if directory exists before trying to delete
            if (fs.existsSync(backupPath)) {
              // Use fs.rmSync for recursive directory deletion
              fs.rmSync(backupPath, { recursive: true, force: true });
            }
          } catch (error: any) {
            console.error(`[Backup] Failed to delete backup files: ${error.message}`);
            // Continue with database deletion even if file deletion fails
          }
        }
      }

      // Delete from database
      const success = db.deleteBackupRun(id);

      // Broadcast to all clients that this run was deleted
      if (success && this.context.wsHandler) {
        this.context.wsHandler.broadcast({
          type: 'backup-run:deleted',
          data: { runId: id }
        });
      }

      this.sendJson(res, { success });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async calculateRunSize(id: number, res: http.ServerResponse): Promise<void> {
    const db = getDatabase();

    try {
      // Get the backup run details
      const run = db.getBackupRun(id);
      if (!run) {
        this.sendError(res, 404, 'Backup run not found');
        return;
      }

      // Helper function to calculate directory size recursively
      const getDirectorySize = (dirPath: string): number => {
        let totalSize = 0;
        try {
          const files = fs.readdirSync(dirPath);
          for (const file of files) {
            const filePath = path.join(dirPath, file);
            try {
              const stats = fs.statSync(filePath);
              if (stats.isDirectory()) {
                totalSize += getDirectorySize(filePath);
              } else {
                totalSize += stats.size;
              }
            } catch (err) {
              console.error(`Failed to stat file ${filePath}:`, err);
            }
          }
        } catch (err) {
          console.error(`Failed to read directory ${dirPath}:`, err);
        }
        return totalSize;
      };

      // Calculate actual size if backup_path exists
      if (run.backup_path && fs.existsSync(run.backup_path)) {
        const actualSize = getDirectorySize(run.backup_path);

        // Update the database with calculated size
        if (actualSize > 0) {
          db.updateBackupRun(id, { total_size: actualSize });
        }

        this.sendJson(res, { success: true, size: actualSize });
      } else {
        this.sendJson(res, { success: true, size: run.total_size || 0 });
      }
    } catch (error: any) {
      console.error('[Backup] Failed to calculate run size:', error);
      this.sendError(res, 500, error.message);
    }
  }

  // Settings operations

  private async updateSettings(body: any, res: http.ServerResponse): Promise<void> {
    try {
      const db = getDatabase();
      db.updateAppSettings(body);
      this.sendJson(res, { success: true });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async setBackupDestination(selectedPath: string, res: http.ServerResponse): Promise<void> {
    try {
      const db = getDatabase();

      // Only append R2Clone if the path doesn't already end with it
      let fullPath;
      if (selectedPath.endsWith('R2Clone') || selectedPath.endsWith('R2Clone/') || selectedPath.endsWith('R2Clone\\')) {
        fullPath = selectedPath.replace(/[/\\]+$/, ''); // Remove trailing slashes
      } else {
        fullPath = path.join(selectedPath, 'R2Clone');
      }

      db.setSetting('backup_destination', fullPath);
      this.sendJson(res, { success: true, path: fullPath });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async setRclonePath(rclonePath: string, res: http.ServerResponse): Promise<void> {
    try {
      const db = getDatabase();
      db.setRclonePath(rclonePath);
      this.sendJson(res, { success: true });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async getHomeDirectory(res: http.ServerResponse): Promise<void> {
    try {
      const { app } = require('electron');
      const homeDir = app.getPath('home');
      this.sendJson(res, { success: true, path: homeDir });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async getSpecialPaths(res: http.ServerResponse): Promise<void> {
    try {
      const { app } = require('electron');
      this.sendJson(res, {
        success: true,
        paths: {
          home: app.getPath('home'),
          desktop: app.getPath('desktop'),
          documents: app.getPath('documents'),
          downloads: app.getPath('downloads'),
        }
      });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private getLocalIPAddress(): string | null {
    const interfaces = os.networkInterfaces();

    // Iterate through network interfaces
    for (const name of Object.keys(interfaces)) {
      const nets = interfaces[name];
      if (!nets) continue;

      for (const net of nets) {
        // Skip internal (loopback) and non-IPv4 addresses
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }

    return null;
  }

  private async getLocalIP(res: http.ServerResponse): Promise<void> {
    try {
      const ip = this.getLocalIPAddress();
      this.sendJson(res, { success: true, ip });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async getLastSeenVersion(res: http.ServerResponse): Promise<void> {
    try {
      const db = getDatabase();
      const version = db.getLastSeenVersion();
      this.sendJson(res, { success: true, version });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async setLastSeenVersion(version: string, res: http.ServerResponse): Promise<void> {
    try {
      const db = getDatabase();
      db.setLastSeenVersion(version);
      this.sendJson(res, { success: true });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  // Rclone operations

  private async installRclone(res: http.ServerResponse): Promise<void> {
    try {
      // Note: Progress events are already forwarded via WebSocket
      // Don't remove listeners - WebSocket handler needs them to broadcast events
      await this.context.rcloneInstaller.install();
      this.sendJson(res, { success: true });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async uninstallRclone(res: http.ServerResponse): Promise<void> {
    try {
      await this.context.rcloneInstaller.uninstall();
      this.sendJson(res, { success: true });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  // File/directory listing operations

  private async listFiles(filePath: string, bucketId: number | undefined, res: http.ServerResponse): Promise<void> {
    try {
      const db = getDatabase();

      // Get bucket configuration if bucketId is provided
      if (bucketId) {
        const bucket = db.getBucket(bucketId);
        if (bucket) {
          // Configure rclone with the specific bucket
          this.context.rcloneHandler.setConfig({
            accessKeyId: bucket.access_key_id,
            secretAccessKey: bucket.secret_access_key,
            endpoint: bucket.endpoint,
            bucketName: bucket.bucket_name,
            region: bucket.region || 'auto'
          });
        }
      }

      const files = await this.context.rcloneHandler.listFiles(filePath);
      this.sendJson(res, { success: true, files });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async listDirectories(dirPath: string, bucketId: number | undefined, res: http.ServerResponse): Promise<void> {
    try {
      const db = getDatabase();

      // If bucketId is provided, list from R2/S3
      if (bucketId) {
        const bucket = db.getBucket(bucketId);
        if (bucket) {
          // Configure rclone with the specific bucket
          this.context.rcloneHandler.setConfig({
            accessKeyId: bucket.access_key_id,
            secretAccessKey: bucket.secret_access_key,
            endpoint: bucket.endpoint,
            bucketName: bucket.bucket_name,
            region: bucket.region || 'auto'
          });
        }
        const items = await this.context.rcloneHandler.listDirectories(dirPath);
        this.sendJson(res, { success: true, items });
      } else {
        // List from local filesystem
        try {
          const items: { name: string; type: 'file' | 'folder'; size?: number }[] = [];

          // Check if directory exists
          if (!fs.existsSync(dirPath)) {
            this.sendJson(res, { success: true, items: [] });
            return;
          }

          // Read directory contents
          const files = fs.readdirSync(dirPath);

          for (const file of files) {
            // Skip hidden files and system files
            if (file.startsWith('.')) continue;

            const filePath = path.join(dirPath, file);
            try {
              const stats = fs.statSync(filePath);
              items.push({
                name: file,
                type: stats.isDirectory() ? 'folder' : 'file',
                size: stats.isDirectory() ? undefined : stats.size
              });
            } catch (err) {
              console.error(`[Local List] Failed to stat ${filePath}:`, err);
            }
          }

          this.sendJson(res, { success: true, items });
        } catch (error: any) {
          console.error('[Local List] Error listing directory:', error);
          this.sendError(res, 500, error.message);
        }
      }
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  // App info

  private async getAppVersion(res: http.ServerResponse): Promise<void> {
    try {
      // In web mode, we can read from package.json
      const packageJsonPath = path.join(__dirname, '../../package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      this.sendJson(res, packageJson.version);
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async getAppStatus(res: http.ServerResponse): Promise<void> {
    try {
      this.sendJson(res, {
        isDocker: process.env.DOCKER === 'true'
      });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async checkForUpdates(res: http.ServerResponse): Promise<void> {
    try {
      const manifest = await this.context.updateManager.checkForUpdates();

      if (manifest) {
        // Update available
        this.sendJson(res, {
          success: true,
          updateAvailable: true,
          manifest,
          isDocker: process.env.DOCKER === 'true',
          canAutoUpdate: this.context.appUpdater.canAutoUpdate(),
        });
      } else {
        // No update available
        this.sendJson(res, {
          success: true,
          updateAvailable: false,
          isDocker: process.env.DOCKER === 'true',
          canAutoUpdate: this.context.appUpdater.canAutoUpdate(),
        });
      }
    } catch (error: any) {
      console.error('[ApiHandler] Error checking for updates:', error);
      this.sendJson(res, {
        success: false,
        error: error.message || 'Failed to check for updates',
      });
    }
  }

  private async installAppUpdate(body: any, res: http.ServerResponse): Promise<void> {
    try {
      if (!this.context.appUpdater.canAutoUpdate()) {
        this.sendError(res, 400, 'Auto-update is not available');
        return;
      }

      const { manifest } = body;
      if (!manifest) {
        this.sendError(res, 400, 'Manifest is required');
        return;
      }

      // Start installation asynchronously (progress events sent via WebSocket)
      this.context.appUpdater.installUpdate(manifest).catch(err => {
        console.error('[ApiHandler] Update installation failed:', err);
      });

      this.sendJson(res, { success: true });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async restartApp(res: http.ServerResponse): Promise<void> {
    try {
      if (!this.context.appUpdater.canAutoUpdate()) {
        this.sendError(res, 400, 'Restart is not available');
        return;
      }

      this.sendJson(res, { success: true });

      // Restart after a short delay to allow response to be sent
      setTimeout(() => {
        this.context.appUpdater.restart();
      }, 500);
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  // Root directory detection

  private async getRootDirectories(res: http.ServerResponse): Promise<void> {
    try {
      const os = require('os');
      const platform = os.platform();
      const homeDir = os.homedir();

      let roots: { path: string; name: string; type: string }[] = [];

      if (platform === 'darwin') {
        // macOS
        roots = [
          { path: homeDir, name: 'Home', type: 'home' },
          { path: '/Users', name: 'Users', type: 'system' },
          { path: '/Applications', name: 'Applications', type: 'system' },
          { path: '/Volumes', name: 'Volumes', type: 'system' },
        ];
      } else if (platform === 'linux') {
        // Linux
        roots = [
          { path: homeDir, name: 'Home', type: 'home' },
          { path: '/home', name: 'Home Directories', type: 'system' },
          { path: '/mnt', name: 'Mounted Drives', type: 'system' },
          { path: '/media', name: 'Media', type: 'system' },
        ];
      } else if (platform === 'win32') {
        // Windows - detect available drives
        const drives: { path: string; name: string; type: string }[] = [];

        // Check common drive letters
        for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
          const drivePath = `${letter}:\\`;
          try {
            if (fs.existsSync(drivePath)) {
              drives.push({
                path: drivePath,
                name: `${letter}: Drive`,
                type: 'drive'
              });
            }
          } catch (err) {
            // Skip inaccessible drives
          }
        }

        roots = [
          { path: homeDir, name: 'Home', type: 'home' },
          ...drives
        ];
      } else {
        // Fallback
        roots = [
          { path: homeDir, name: 'Home', type: 'home' },
          { path: '/', name: 'Root', type: 'system' },
        ];
      }

      // Filter out non-existent paths
      const validRoots = roots.filter(root => {
        try {
          return fs.existsSync(root.path);
        } catch {
          return false;
        }
      });

      this.sendJson(res, validRoots);
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  // Additional backup operations

  private async getRunsByJob(jobId: string, limit: number | undefined, res: http.ServerResponse): Promise<void> {
    try {
      const db = getDatabase();
      const query = limit
        ? 'SELECT br.*, bj.name as job_name, b.name as bucket_name FROM backup_runs br LEFT JOIN backup_jobs bj ON br.job_id = bj.id LEFT JOIN buckets b ON br.bucket_id = b.id WHERE br.job_id = ? ORDER BY br.started_at DESC LIMIT ?'
        : 'SELECT br.*, bj.name as job_name, b.name as bucket_name FROM backup_runs br LEFT JOIN backup_jobs bj ON br.job_id = bj.id LEFT JOIN buckets b ON br.bucket_id = b.id WHERE br.job_id = ? ORDER BY br.started_at DESC';

      const stmt = db.db.prepare(query);
      const runs = limit ? stmt.all(jobId, limit) : stmt.all(jobId);
      this.sendJson(res, runs);
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async getRunSize(jobId: string, res: http.ServerResponse): Promise<void> {
    try {
      const db = getDatabase();
      // Get the most recent completed backup run for this job
      const query = `
        SELECT total_size
        FROM backup_runs
        WHERE job_id = ? AND status = 'completed'
        ORDER BY completed_at DESC
        LIMIT 1
      `;
      const stmt = db.db.prepare(query);
      const run = stmt.get(jobId) as { total_size: number } | undefined;

      this.sendJson(res, run?.total_size || 0);
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async getDirectorySize(res: http.ServerResponse): Promise<void> {
    try {
      const db = getDatabase();
      const backupDestination = db.getSetting('backup_destination');

      if (!backupDestination || !fs.existsSync(backupDestination)) {
        this.sendJson(res, 0);
        return;
      }

      // Helper function to calculate directory size recursively
      const getDirectorySizeRecursive = (dirPath: string): number => {
        let totalSize = 0;
        try {
          const files = fs.readdirSync(dirPath);
          for (const file of files) {
            const filePath = path.join(dirPath, file);
            try {
              const stats = fs.statSync(filePath);
              if (stats.isDirectory()) {
                totalSize += getDirectorySizeRecursive(filePath);
              } else {
                totalSize += stats.size;
              }
            } catch (err) {
              console.error(`Failed to stat file ${filePath}:`, err);
            }
          }
        } catch (err) {
          console.error(`Failed to read directory ${dirPath}:`, err);
        }
        return totalSize;
      };

      const size = getDirectorySizeRecursive(backupDestination);
      this.sendJson(res, size);
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  // System time operations

  private async getSystemTime(res: http.ServerResponse): Promise<void> {
    try {
      this.sendJson(res, {
        success: true,
        time: new Date().toISOString()
      });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async getCloudflareTime(res: http.ServerResponse): Promise<void> {
    try {
      const https = require('https');

      https.get('https://r2clone.gruntmods.com', (response: any) => {
        // Read the Date header from the response
        const serverDateString = response.headers.date;
        if (serverDateString) {
          const serverTime = new Date(serverDateString);
          this.sendJson(res, { success: true, time: serverTime.toISOString() });
        } else {
          this.sendError(res, 500, 'No Date header in server response');
        }
      }).on('error', (error: any) => {
        this.sendError(res, 500, error.message);
      });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async getTimezone(res: http.ServerResponse): Promise<void> {
    try {
      const db = getDatabase();
      const timezone = db.getTimezone();
      this.sendJson(res, { success: true, timezone });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async setTimezone(timezone: string, res: http.ServerResponse): Promise<void> {
    try {
      const db = getDatabase();
      db.setTimezone(timezone);
      this.sendJson(res, { success: true });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }

  private async syncSystemTime(res: http.ServerResponse): Promise<void> {
    try {
      // Check if running in Docker
      const isDocker = process.env.DOCKER === 'true';

      if (!isDocker) {
        this.sendError(res, 403, 'Time sync only available in Docker mode');
        return;
      }

      // Fetch time from server
      const https = require('https');

      https.get('https://r2clone.gruntmods.com', (response: any) => {
        // Read the Date header from the response
        const serverDateString = response.headers.date;

        if (serverDateString) {
          const serverTime = new Date(serverDateString);

          // Format time for date command: "YYYY-MM-DD HH:MM:SS"
          const formattedTime = serverTime.toISOString().replace('T', ' ').substring(0, 19);

          // Execute date command to set system time
          const { execSync } = require('child_process');
          try {
            execSync(`date -s "${formattedTime}"`, { encoding: 'utf8' });
            this.sendJson(res, {
              success: true,
              message: 'System time synchronized successfully',
              newTime: serverTime.toISOString()
            });
          } catch (error: any) {
            this.sendError(res, 500, `Failed to set system time: ${error.message}`);
          }
        } else {
          this.sendError(res, 500, 'No Date header in server response');
        }
      }).on('error', (error: any) => {
        this.sendError(res, 500, error.message);
      });
    } catch (error: any) {
      this.sendError(res, 500, error.message);
    }
  }
}

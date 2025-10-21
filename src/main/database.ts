import Database from 'better-sqlite3';
import { app, safeStorage } from 'electron';
import path from 'path';

interface R2Bucket {
  id?: number;
  name: string;
  access_key_id: string;
  secret_access_key: string;
  endpoint: string;
  bucket_name: string;
  region?: string;
  created_at?: string;
  updated_at?: string;
}

interface BackupJob {
  id?: string;
  name: string;
  source_path: string;
  bucket_id: number;
  schedule?: string;
  schedule_metadata?: string;
  last_run?: string;
  retention_count?: number;
  created_at?: string;
  updated_at?: string;
}

interface BackupRun {
  id?: number;
  job_id: string;
  bucket_id: number;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  started_at: string;
  completed_at?: string;
  files_transferred?: number;
  files_skipped?: number;
  total_size?: number;
  backup_path?: string;
  error_message?: string;
  created_at?: string;
}

class DatabaseManager {
  private db: Database.Database;

  constructor() {
    // Check encryption availability before doing anything else
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('[Database] CRITICAL: Credential encryption is not available!');
      console.error('[Database] This system cannot securely store R2 credentials.');
      throw new Error(
        'Cannot initialize database: Credential encryption is unavailable. ' +
        'R2Clone requires secure credential storage to operate.'
      );
    }

    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'r2clone.db');

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initDatabase();
    this.addRetentionColumnIfNeeded();
  }

  private initDatabase() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS buckets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        access_key_id TEXT NOT NULL,
        secret_access_key TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        bucket_name TEXT NOT NULL,
        region TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS backup_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source_path TEXT NOT NULL,
        bucket_id INTEGER NOT NULL,
        schedule TEXT,
        schedule_metadata TEXT,
        last_run DATETIME,
        retention_count INTEGER DEFAULT 7,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (bucket_id) REFERENCES buckets(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS backup_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        bucket_id INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'stopped')),
        started_at DATETIME NOT NULL,
        completed_at DATETIME,
        files_transferred INTEGER DEFAULT 0,
        files_skipped INTEGER DEFAULT 0,
        total_size INTEGER DEFAULT 0,
        backup_path TEXT,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES backup_jobs(id) ON DELETE CASCADE,
        FOREIGN KEY (bucket_id) REFERENCES buckets(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_backup_runs_job_id ON backup_runs(job_id);
      CREATE INDEX IF NOT EXISTS idx_backup_runs_status ON backup_runs(status);
      CREATE INDEX IF NOT EXISTS idx_backup_runs_started_at ON backup_runs(started_at);

      CREATE TRIGGER IF NOT EXISTS update_buckets_timestamp 
      AFTER UPDATE ON buckets
      BEGIN
        UPDATE buckets SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS update_backup_jobs_timestamp 
      AFTER UPDATE ON backup_jobs
      BEGIN
        UPDATE backup_jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
      
      CREATE TRIGGER IF NOT EXISTS update_settings_timestamp 
      AFTER UPDATE ON settings
      BEGIN
        UPDATE settings SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
      END;
    `);

    // Add backup_path column if it doesn't exist (migration for existing databases)
    try {
      this.db.exec(`ALTER TABLE backup_runs ADD COLUMN backup_path TEXT`);
    } catch (error) {
      // Column already exists, ignore error
    }
    
    // Migrate from electron-store if it exists
    this.migrateFromElectronStore();
    
    // Set default backup destination if not exists
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const backupDest = stmt.get('backup_destination');
    if (!backupDest) {
      const homePath = app.getPath('home');
      const defaultPath = path.join(homePath, 'R2Clone');
      this.setSetting('backup_destination', defaultPath);
    }
  }

  private addRetentionColumnIfNeeded(): void {
    try {
      // Check if retention_count column exists
      const columns = this.db.prepare("PRAGMA table_info(backup_jobs)").all() as any[];
      const hasRetentionCount = columns.some((col: any) => col.name === 'retention_count');
      
      if (!hasRetentionCount) {
        console.log('[Database] Adding retention_count column to backup_jobs table');
        this.db.exec(`
          ALTER TABLE backup_jobs ADD COLUMN retention_count INTEGER DEFAULT 7
        `);
      }
    } catch (error) {
      console.log('[Database] retention_count column migration not needed or already exists');
    }
  }

  private migrateFromElectronStore(): void {
    try {
      // Try to load electron-store
      const ElectronStore = require('electron-store').default || require('electron-store');
      const store = new ElectronStore({ name: 'r2clone-config' });
      
      // Check if migration has already been done
      const migrationDone = this.getSetting('electron_store_migrated');
      if (migrationDone === 'true') {
        return;
      }
      
      // Migrate app settings
      const appSettings = store.get('appSettings');
      if (appSettings) {
        if (appSettings.theme) {
          this.setSetting('theme', appSettings.theme);
        }
        if (appSettings.notifications !== undefined) {
          this.setSetting('notifications', appSettings.notifications.toString());
        }
        if (appSettings.autoStart !== undefined) {
          this.setSetting('autoStart', appSettings.autoStart.toString());
        }
        console.log('[Database] Migrated app settings from electron-store');
      }
      
      // Migrate rclone path
      const rclonePath = store.get('rclonePath');
      if (rclonePath) {
        this.setSetting('rclone_path', rclonePath);
        console.log('[Database] Migrated rclone path from electron-store');
      }
      
      // Mark migration as complete
      this.setSetting('electron_store_migrated', 'true');
      console.log('[Database] electron-store migration completed');
      
      // Optional: Clear the old store to save space
      store.clear();
    } catch (error) {
      // electron-store not found or error reading it - that's OK, nothing to migrate
      console.log('[Database] No electron-store data to migrate');
    }
  }
  
  private encryptField(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'Credential encryption is not available on this system. ' +
        'Cannot store sensitive data without encryption.'
      );
    }
    return safeStorage.encryptString(value).toString('base64');
  }

  private decryptField(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'Credential encryption is not available on this system. ' +
        'Cannot decrypt stored credentials.'
      );
    }

    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'));
    } catch (error) {
      throw new Error(
        'Failed to decrypt credential. The data may be corrupted or ' +
        'encrypted with a different key.'
      );
    }
  }

  getAllBuckets(): R2Bucket[] {
    const stmt = this.db.prepare('SELECT * FROM buckets ORDER BY created_at DESC');
    const buckets = stmt.all() as R2Bucket[];
    
    return buckets.map(bucket => ({
      ...bucket,
      access_key_id: this.decryptField(bucket.access_key_id),
      secret_access_key: this.decryptField(bucket.secret_access_key)
    }));
  }

  getBucket(id: number): R2Bucket | undefined {
    const stmt = this.db.prepare('SELECT * FROM buckets WHERE id = ?');
    const bucket = stmt.get(id) as R2Bucket | undefined;
    
    if (bucket) {
      return {
        ...bucket,
        access_key_id: this.decryptField(bucket.access_key_id),
        secret_access_key: this.decryptField(bucket.secret_access_key)
      };
    }
    return undefined;
  }


  createBucket(bucket: Omit<R2Bucket, 'id' | 'created_at' | 'updated_at'>): R2Bucket {
    const encryptedBucket = {
      ...bucket,
      access_key_id: this.encryptField(bucket.access_key_id),
      secret_access_key: this.encryptField(bucket.secret_access_key)
    };

    const stmt = this.db.prepare(`
      INSERT INTO buckets (name, access_key_id, secret_access_key, endpoint, bucket_name, region)
      VALUES (@name, @access_key_id, @secret_access_key, @endpoint, @bucket_name, @region)
    `);
    
    const info = stmt.run(encryptedBucket);
    
    return this.getBucket(info.lastInsertRowid as number)!;
  }

  updateBucket(id: number, updates: Partial<Omit<R2Bucket, 'id' | 'created_at' | 'updated_at'>>): boolean {
    const current = this.getBucket(id);
    if (!current) return false;

    const updatedBucket = { ...current, ...updates };
    
    const encryptedBucket = {
      ...updatedBucket,
      access_key_id: this.encryptField(updatedBucket.access_key_id),
      secret_access_key: this.encryptField(updatedBucket.secret_access_key)
    };

    const stmt = this.db.prepare(`
      UPDATE buckets 
      SET name = @name, access_key_id = @access_key_id, secret_access_key = @secret_access_key,
          endpoint = @endpoint, bucket_name = @bucket_name, region = @region
      WHERE id = @id
    `);
    
    stmt.run({ ...encryptedBucket, id });
    
    return true;
  }

  deleteBucket(id: number): boolean {
    const stmt = this.db.prepare('DELETE FROM buckets WHERE id = ?');
    const info = stmt.run(id);
    return info.changes > 0;
  }


  getAllBackupJobs(): BackupJob[] {
    const stmt = this.db.prepare('SELECT * FROM backup_jobs ORDER BY created_at DESC');
    return stmt.all() as BackupJob[];
  }

  getAllBackupJobsWithBuckets(): (BackupJob & { bucket: R2Bucket | null })[] {
    const stmt = this.db.prepare(`
      SELECT
        bj.*,
        b.id as bucket_db_id,
        b.name as bucket_name,
        b.access_key_id as bucket_access_key_id,
        b.secret_access_key as bucket_secret_access_key,
        b.endpoint as bucket_endpoint,
        b.bucket_name as bucket_bucket_name,
        b.region as bucket_region,
        b.created_at as bucket_created_at,
        b.updated_at as bucket_updated_at
      FROM backup_jobs bj
      LEFT JOIN buckets b ON bj.bucket_id = b.id
      ORDER BY bj.created_at DESC
    `);

    const rows = stmt.all() as any[];

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      source_path: row.source_path,
      bucket_id: row.bucket_id,
      schedule: row.schedule,
      schedule_metadata: row.schedule_metadata,
      last_run: row.last_run,
      retention_count: row.retention_count,
      created_at: row.created_at,
      updated_at: row.updated_at,
      bucket: row.bucket_db_id ? {
        id: row.bucket_db_id,
        name: row.bucket_name,
        access_key_id: this.decryptField(row.bucket_access_key_id),
        secret_access_key: this.decryptField(row.bucket_secret_access_key),
        endpoint: row.bucket_endpoint,
        bucket_name: row.bucket_bucket_name,
        region: row.bucket_region,
        created_at: row.bucket_created_at,
        updated_at: row.bucket_updated_at
      } : null
    }));
  }

  getBackupJob(id: string): BackupJob | undefined {
    const stmt = this.db.prepare('SELECT * FROM backup_jobs WHERE id = ?');
    return stmt.get(id) as BackupJob | undefined;
  }

  createBackupJob(job: Omit<BackupJob, 'created_at' | 'updated_at'>): BackupJob {
    const stmt = this.db.prepare(`
      INSERT INTO backup_jobs (id, name, source_path, bucket_id, schedule, schedule_metadata, last_run, retention_count)
      VALUES (@id, @name, @source_path, @bucket_id, @schedule, @schedule_metadata, @last_run, @retention_count)
    `);
    
    // Default retention_count to 7 if not specified
    const jobWithDefaults = {
      ...job,
      retention_count: job.retention_count !== undefined ? job.retention_count : 7
    };
    
    stmt.run(jobWithDefaults);
    return this.getBackupJob(job.id!)!;
  }

  updateBackupJob(id: string, updates: Partial<Omit<BackupJob, 'id' | 'created_at' | 'updated_at'>>): boolean {
    const current = this.getBackupJob(id);
    if (!current) return false;

    const updatedJob = { ...current, ...updates };
    
    const stmt = this.db.prepare(`
      UPDATE backup_jobs 
      SET name = @name, source_path = @source_path,
          bucket_id = @bucket_id, schedule = @schedule, schedule_metadata = @schedule_metadata, 
          last_run = @last_run, retention_count = @retention_count
      WHERE id = @id
    `);
    
    stmt.run({ ...updatedJob, id });
    return true;
  }

  deleteBackupJob(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM backup_jobs WHERE id = ?');
    const info = stmt.run(id);
    return info.changes > 0;
  }

  // Backup runs methods
  createBackupRun(run: Omit<BackupRun, 'id' | 'created_at'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO backup_runs (job_id, bucket_id, status, started_at, completed_at, files_transferred, files_skipped, total_size, backup_path, error_message)
      VALUES (@job_id, @bucket_id, @status, @started_at, @completed_at, @files_transferred, @files_skipped, @total_size, @backup_path, @error_message)
    `);
    
    const info = stmt.run(run);
    return info.lastInsertRowid as number;
  }

  updateBackupRun(id: number, updates: Partial<Omit<BackupRun, 'id' | 'job_id' | 'bucket_id' | 'started_at' | 'created_at'>>): boolean {
    const fields = [];
    const values: any = { id };
    
    if (updates.status !== undefined) {
      fields.push('status = @status');
      values.status = updates.status;
    }
    if (updates.completed_at !== undefined) {
      fields.push('completed_at = @completed_at');
      values.completed_at = updates.completed_at;
    }
    if (updates.files_transferred !== undefined) {
      fields.push('files_transferred = @files_transferred');
      values.files_transferred = updates.files_transferred;
    }
    if (updates.files_skipped !== undefined) {
      fields.push('files_skipped = @files_skipped');
      values.files_skipped = updates.files_skipped;
    }
    if (updates.total_size !== undefined) {
      fields.push('total_size = @total_size');
      values.total_size = updates.total_size;
    }
    if (updates.backup_path !== undefined) {
      fields.push('backup_path = @backup_path');
      values.backup_path = updates.backup_path;
    }
    if (updates.error_message !== undefined) {
      fields.push('error_message = @error_message');
      values.error_message = updates.error_message;
    }
    
    if (fields.length === 0) return false;
    
    const stmt = this.db.prepare(`UPDATE backup_runs SET ${fields.join(', ')} WHERE id = @id`);
    const info = stmt.run(values);
    return info.changes > 0;
  }

  getBackupRun(id: number): BackupRun | undefined {
    const stmt = this.db.prepare('SELECT * FROM backup_runs WHERE id = ?');
    return stmt.get(id) as BackupRun | undefined;
  }

  getBackupRunsByJob(jobId: string, limit?: number): BackupRun[] {
    const query = limit 
      ? 'SELECT * FROM backup_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?'
      : 'SELECT * FROM backup_runs WHERE job_id = ? ORDER BY started_at DESC';
    
    const stmt = this.db.prepare(query);
    return limit ? stmt.all(jobId, limit) as BackupRun[] : stmt.all(jobId) as BackupRun[];
  }

  deleteBackupRun(id: number): boolean {
    const stmt = this.db.prepare('DELETE FROM backup_runs WHERE id = ?');
    const info = stmt.run(id);
    return info.changes > 0;
  }

  enforceRetentionPolicy(jobId: string): void {
    const fs = require('fs');
    const path = require('path');

    // Get the job to check retention settings
    const job = this.getBackupJob(jobId);
    if (!job || !job.retention_count || job.retention_count === -1) {
      // No retention policy or unlimited retention
      return;
    }

    // Get all completed backup runs for this job, sorted by date (newest first)
    const stmt = this.db.prepare(`
      SELECT * FROM backup_runs
      WHERE job_id = ? AND status = 'completed'
      ORDER BY started_at DESC
    `);
    const runs = stmt.all(jobId) as BackupRun[];

    // If we have more runs than the retention count, delete the oldest ones
    if (runs.length > job.retention_count) {
      const runsToDelete = runs.slice(job.retention_count);

      console.log(`[Database] Enforcing retention policy for job ${jobId}: keeping ${job.retention_count} backups, deleting ${runsToDelete.length}`);

      for (const run of runsToDelete) {
        // Delete the actual backup files if they exist
        if (run.backup_path) {
          try {
            if (fs.existsSync(run.backup_path)) {
              fs.rmSync(run.backup_path, { recursive: true, force: true });
              console.log(`[Database] Deleted backup files at: ${run.backup_path}`);
            }
          } catch (error: any) {
            console.error(`[Database] Failed to delete backup files at ${run.backup_path}: ${error.message}`);
          }
        }

        // Delete the database record
        this.deleteBackupRun(run.id!);
        console.log(`[Database] Deleted backup run record: ${run.id}`);
      }
    }
  }

  /**
   * Clean up stale backup runs that are stuck in "running" status
   * This can happen when the app crashes or is force-quit
   */
  cleanupStaleBackups(): void {
    try {
      // Find ALL backup runs with "running" status
      // On server start, any running backups are orphaned since rclone processes don't persist
      const stmt = this.db.prepare(`
        SELECT * FROM backup_runs
        WHERE status = 'running'
      `);
      const staleRuns = stmt.all() as BackupRun[];

      if (staleRuns.length > 0) {
        console.log(`[Database] Found ${staleRuns.length} orphaned running backup(s) to clean up`);

        const updateStmt = this.db.prepare(`
          UPDATE backup_runs
          SET status = 'stopped',
              completed_at = ?,
              error_message = 'Backup was interrupted (app closed or crashed)'
          WHERE id = ?
        `);

        for (const run of staleRuns) {
          const completedAt = new Date().toISOString();
          updateStmt.run(completedAt, run.id);
          console.log(`[Database] Marked backup run ${run.id} as stopped (started at ${run.started_at})`);
        }
      }
    } catch (error: any) {
      console.error('[Database] Failed to clean up stale backups:', error);
    }
  }

  getBackupRunsStats() {
    const totalRunsStmt = this.db.prepare('SELECT COUNT(*) as count FROM backup_runs');
    const successfulRunsStmt = this.db.prepare('SELECT COUNT(*) as count FROM backup_runs WHERE status = ?');
    const failedRunsStmt = this.db.prepare('SELECT COUNT(*) as count FROM backup_runs WHERE status = ?');
    const totalFilesStmt = this.db.prepare('SELECT SUM(files_transferred) as total FROM backup_runs WHERE status = ?');
    const totalSizeStmt = this.db.prepare('SELECT SUM(total_size) as total FROM backup_runs WHERE status = ?');
    
    const totalRuns = (totalRunsStmt.get() as any).count;
    const successfulRuns = (successfulRunsStmt.get('completed') as any).count;
    const failedRuns = (failedRunsStmt.get('failed') as any).count;
    const totalFiles = (totalFilesStmt.get('completed') as any).total || 0;
    const totalSize = (totalSizeStmt.get('completed') as any).total || 0;
    
    return {
      totalRuns,
      successfulRuns,
      failedRuns,
      totalFiles,
      totalSize
    };
  }
  
  // Settings methods
  getSetting(key: string): string | undefined {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const result = stmt.get(key) as { value: string } | undefined;
    return result?.value;
  }
  
  setSetting(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (@key, @value)
      ON CONFLICT(key) DO UPDATE SET value = @value
    `);
    stmt.run({ key, value });
  }
  
  // App settings methods
  getAppSettings() {
    return {
      theme: this.getSetting('theme') || 'system',
      notifications: this.getSetting('notifications') === 'true',
      autoStart: this.getSetting('autoStart') === 'true',
      maxConcurrentTransfers: parseInt(this.getSetting('maxConcurrentTransfers') || '20')
    };
  }
  
  updateAppSettings(settings: Partial<{ theme: string; notifications: boolean; autoStart: boolean; maxConcurrentTransfers: number }>): void {
    if (settings.theme !== undefined) {
      this.setSetting('theme', settings.theme);
    }
    if (settings.notifications !== undefined) {
      this.setSetting('notifications', settings.notifications.toString());
    }
    if (settings.autoStart !== undefined) {
      this.setSetting('autoStart', settings.autoStart.toString());
    }
    if (settings.maxConcurrentTransfers !== undefined) {
      this.setSetting('maxConcurrentTransfers', settings.maxConcurrentTransfers.toString());
    }
  }
  
  // Rclone path methods
  getRclonePath(): string {
    return this.getSetting('rclone_path') || 'rclone';
  }

  setRclonePath(path: string): void {
    this.setSetting('rclone_path', path);
  }

  // Last seen version methods
  getLastSeenVersion(): string | undefined {
    return this.getSetting('last_seen_version');
  }

  setLastSeenVersion(version: string): void {
    this.setSetting('last_seen_version', version);
  }

  // Timezone methods
  getTimezone(): string {
    return this.getSetting('timezone') || 'America/New_York';
  }

  setTimezone(timezone: string): void {
    this.setSetting('timezone', timezone);
  }

  // HTTPS settings methods
  getUseHttps(): boolean {
    const value = this.getSetting('use_https');
    // Default to true if not set
    return value === undefined ? true : value === 'true';
  }

  setUseHttps(enabled: boolean): void {
    this.setSetting('use_https', enabled.toString());
  }

  getHttpsPort(): number {
    const value = this.getSetting('https_port');
    return value ? parseInt(value, 10) : 3001;
  }

  setHttpsPort(port: number): void {
    this.setSetting('https_port', port.toString());
  }

  close() {
    this.db.close();
  }
}

let database: DatabaseManager | null = null;

export function initDatabase() {
  if (!database) {
    database = new DatabaseManager();
  }
  return database;
}

export function getDatabase(): DatabaseManager {
  if (!database) {
    throw new Error('Database not initialized');
  }
  return database;
}

export type { R2Bucket, BackupJob, BackupRun };
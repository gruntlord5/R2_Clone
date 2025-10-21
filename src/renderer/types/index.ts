export interface R2Config {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucketName: string;
  region?: string;
}

export interface R2Bucket {
  id?: number;
  name: string;
  accessKeyId: string;
  secretAccessKey?: string; // Optional - only present during creation, omitted in GET requests for security
  endpoint: string;
  bucketName: string;
  region?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BackupJob {
  id: string;
  name: string;
  sourcePath: string;
  bucketId: number;
  schedule?: 'hourly' | 'daily' | 'weekly';
  scheduleMetadata?: {
    weekday?: number; // 0-6 (Sunday-Saturday)
    hour?: number; // 0-23
    minute?: number; // 0-59
  };
  retentionCount?: number; // Number of backups to keep, -1 for unlimited
  lastRun?: Date;
  bucket?: R2Bucket; // Optional bucket information
}

export interface BackupRun {
  id?: number;
  job_id: string;
  job_name?: string;
  bucket_id: number;
  bucket_name?: string;
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

export interface RcloneProgress {
  percentage: number;
  speed: string;
  eta: string;
  transferred: string;
  totalSize?: string;
  errors: number;
  checks: number;
  transferring?: string;
}

export interface AppSettings {
  notifications: boolean;
  autoStart: boolean;
  theme: 'light' | 'dark' | 'system';
  maxConcurrentTransfers?: number;
}

export interface RcloneInstallProgress {
  stage: 'downloading' | 'extracting';
  progress: number;
}

declare global {
  interface Window {
    electronAPI: {
      versions: {
        electron: string;
        node: string;
        chrome: string;
      };
      r2: {
        testConnection: () => Promise<{ success: boolean; error?: string }>;
        getAllBuckets: () => Promise<R2Bucket[]>;
        getBucket: (id: number) => Promise<R2Bucket | undefined>;
        createBucket: (bucket: Omit<R2Bucket, 'id' | 'createdAt' | 'updatedAt'>) => Promise<{ success: boolean; data?: R2Bucket; error?: string }>;
        updateBucket: (id: number, updates: Partial<Omit<R2Bucket, 'id' | 'createdAt' | 'updatedAt'>>) => Promise<{ success: boolean; error?: string }>;
        deleteBucket: (id: number) => Promise<{ success: boolean; error?: string }>;
        testBucketConnection: (id: number) => Promise<{ success: boolean; error?: string }>;
      };
      backup: {
        getJobs: () => Promise<BackupJob[]>;
        getStats: () => Promise<any>;
        getDirectorySize: () => Promise<number>;
        getRunSize: (jobId: string) => Promise<number>;
        getRuns: (limit?: number) => Promise<BackupRun[]>;
        getRunsByJob: (jobId: string, limit?: number) => Promise<BackupRun[]>;
        deleteRun: (id: number, deleteFiles?: boolean) => Promise<{ success: boolean; error?: string }>;
        saveJob: (job: BackupJob) => Promise<{ success: boolean; error?: string }>;
        deleteJob: (id: string) => Promise<{ success: boolean; error?: string }>;
        start: (params: { sourcePath: string; destinationPath?: string; dryRun?: boolean; jobId?: string; jobName?: string; bucketId?: number }) => Promise<{ success: boolean; actualPath?: string; error?: string }>;
        stop: () => Promise<{ success: boolean }>;
        listFiles: (path: string, bucketId?: number) => Promise<{ success: boolean; files?: string[]; error?: string }>;
        listDirectories: (path: string, bucketId?: number) => Promise<{ success: boolean; items?: { name: string; type: 'file' | 'folder'; size?: number }[]; error?: string }>;
        onProgress: (callback: (progress: RcloneProgress) => void) => void;
        onLog: (callback: (log: string) => void) => void;
        onError: (callback: (error: string) => void) => void;
        onComplete: (callback: () => void) => void;
        onStopped: (callback: () => void) => void;
        onFileTransferred: (callback: (file: string) => void) => void;
        onFileSkipped: (callback: (file: string) => void) => void;
        onNothingToTransfer: (callback: () => void) => void;
        onUsingPath: (callback: (path: string) => void) => void;
        onStarted: (callback: (data: { jobId: string; jobName: string; sourcePath: string }) => void) => void;
        removeAllListeners: () => void;
      };
      dialog: {
        selectDirectory: () => Promise<{ canceled: boolean; filePaths?: string[] }>;
      };
      shell: {
        openPath: (path: string) => Promise<{ success: boolean; error?: string }>;
        showItemInFolder: (path: string) => Promise<{ success: boolean; error?: string }>;
      };
      settings: {
        get: () => Promise<AppSettings>;
        update: (settings: Partial<AppSettings>) => Promise<{ success: boolean; error?: string }>;
        getRclonePath: () => Promise<string>;
        setRclonePath: (path: string) => Promise<{ success: boolean; error?: string }>;
        getBackupDestination: () => Promise<string | undefined>;
        setBackupDestination: (path: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      };
      rclone: {
        checkInstalled: () => Promise<{ success: boolean; isInstalled?: boolean; version?: string | null; path?: string | null; error?: string }>;
        install: () => Promise<{ success: boolean; error?: string }>;
        uninstall: () => Promise<{ success: boolean; error?: string }>;
        onInstallStatus: (callback: (status: string) => void) => void;
        onInstallProgress: (callback: (progress: RcloneInstallProgress) => void) => void;
        onInstallError: (callback: (error: string) => void) => void;
        onInstallComplete: (callback: (path: string) => void) => void;
        removeInstallListeners: () => void;
      };
      scheduler: {
        getNextRun: (jobId: string) => Promise<string | null>;
        getAllScheduled: () => Promise<Array<{ jobId: string; nextRun: Date | null }>>;
        triggerBackup: (jobId: string) => Promise<{ success: boolean; error?: string }>;
        getStatus: () => Promise<{ isRunning: boolean; activeBackupId: string | null }>;
        onBackupStarted: (callback: (data: { jobId: string; jobName: string }) => void) => void;
        onBackupCompleted: (callback: (data: { jobId: string; filesTransferred: number; totalSize: number }) => void) => void;
        onBackupError: (callback: (data: { jobId: string; error: string }) => void) => void;
        onBackupSkipped: (callback: (data: { jobId: string; reason: string }) => void) => void;
        removeAllListeners: () => void;
      };
    };
  }
}
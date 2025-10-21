import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Expose version information
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
  
  // R2 Configuration
  r2: {
    testConnection: () => ipcRenderer.invoke('r2:test-connection'),
    getAllBuckets: () => ipcRenderer.invoke('r2:get-all-buckets'),
    getBucket: (id: number) => ipcRenderer.invoke('r2:get-bucket', id),
    createBucket: (bucket: any) => ipcRenderer.invoke('r2:create-bucket', bucket),
    updateBucket: (id: number, updates: any) => ipcRenderer.invoke('r2:update-bucket', id, updates),
    deleteBucket: (id: number) => ipcRenderer.invoke('r2:delete-bucket', id),
    testBucketConnection: (id: number) => ipcRenderer.invoke('r2:test-bucket-connection', id),
  },
  
  // Backup operations
  backup: {
    getJobs: () => ipcRenderer.invoke('backup:get-jobs'),
    getStats: () => ipcRenderer.invoke('backup:get-stats'),
    getDirectorySize: () => ipcRenderer.invoke('backup:get-directory-size'),
    getRunSize: (jobId: string) => ipcRenderer.invoke('backup:get-run-size', jobId),
    getRuns: (limit?: number) => ipcRenderer.invoke('backup:get-runs', limit),
    getRunsByJob: (jobId: string, limit?: number) => ipcRenderer.invoke('backup:get-runs-by-job', jobId, limit),
    deleteRun: (id: number, deleteFiles?: boolean) => ipcRenderer.invoke('backup:delete-run', id, deleteFiles),
    calculateRunSize: (id: number) => ipcRenderer.invoke('backup:calculate-run-size', id),
    saveJob: (job: any) => ipcRenderer.invoke('backup:save-job', job),
    deleteJob: (id: string) => ipcRenderer.invoke('backup:delete-job', id),
    // start/stop use WebSocket (provided by apiClient) - not IPC
    listFiles: (path: string, bucketId?: number) => ipcRenderer.invoke('backup:list-files', path, bucketId),
    listDirectories: (path: string, bucketId?: number) => ipcRenderer.invoke('backup:list-directories', path, bucketId),

    // Event listeners provided by api-client.ts via direct import
    // Preload does NOT expose these - renderer uses apiClient directly
  },
  
  // Dialog
  dialog: {
    selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),
  },
  
  // Shell operations
  shell: {
    openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path),
    showItemInFolder: (path: string) => ipcRenderer.invoke('shell:show-item-in-folder', path),
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  },
  
  // Settings
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (settings: any) => ipcRenderer.invoke('settings:update', settings),
    getRclonePath: () => ipcRenderer.invoke('settings:get-rclone-path'),
    setRclonePath: (path: string) => ipcRenderer.invoke('settings:set-rclone-path', path),
    getBackupDestination: () => ipcRenderer.invoke('settings:get-backup-destination'),
    setBackupDestination: (path: string) => ipcRenderer.invoke('settings:set-backup-destination', path),
    getHomeDirectory: () => ipcRenderer.invoke('settings:get-home-directory'),
    getSpecialPaths: () => ipcRenderer.invoke('settings:get-special-paths'),
    getLocalIP: () => ipcRenderer.invoke('settings:get-local-ip'),
    getHttps: () => ipcRenderer.invoke('settings:get-https'),
    setHttps: (useHttps: boolean, httpsPort: number) => ipcRenderer.invoke('settings:set-https', useHttps, httpsPort),
  },
  
  // Rclone Installation
  rclone: {
    checkInstalled: () => ipcRenderer.invoke('rclone:check-installed'),
    install: () => ipcRenderer.invoke('rclone:install'),
    uninstall: () => ipcRenderer.invoke('rclone:uninstall'),
    
    // Event listeners for installation
    onInstallStatus: (callback: (status: string) => void) => {
      ipcRenderer.on('rclone:install-status', (_, status) => callback(status));
    },
    onInstallProgress: (callback: (progress: any) => void) => {
      ipcRenderer.on('rclone:install-progress', (_, progress) => callback(progress));
    },
    onInstallError: (callback: (error: string) => void) => {
      ipcRenderer.on('rclone:install-error', (_, error) => callback(error));
    },
    onInstallComplete: (callback: (path: string) => void) => {
      ipcRenderer.on('rclone:install-complete', (_, path) => callback(path));
    },
    
    // Remove listeners
    removeInstallListeners: () => {
      ipcRenderer.removeAllListeners('rclone:install-status');
      ipcRenderer.removeAllListeners('rclone:install-progress');
      ipcRenderer.removeAllListeners('rclone:install-error');
      ipcRenderer.removeAllListeners('rclone:install-complete');
    }
  },
  
  // Scheduler operations
  scheduler: {
    getNextRun: (jobId: string) => ipcRenderer.invoke('scheduler:get-next-run', jobId),
    getAllScheduled: () => ipcRenderer.invoke('scheduler:get-all-scheduled'),
    triggerBackup: (jobId: string) => ipcRenderer.invoke('scheduler:trigger-backup', jobId),
    getStatus: () => ipcRenderer.invoke('scheduler:get-status'),

    // Event listeners provided by api-client.ts via direct import
    // Preload does NOT expose these - renderer uses apiClient directly
  },
  
  // App-level operations
  webserver: {
    start: (port: number) => ipcRenderer.invoke('webserver:start', port),
    stop: () => ipcRenderer.invoke('webserver:stop'),
    getStatus: () => ipcRenderer.invoke('webserver:status'),
  },

  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
    quit: () => ipcRenderer.invoke('app:quit'),

    onShowAbout: (callback: () => void) => {
      ipcRenderer.on('app:show-about', callback);
    },
    onNavigateTo: (callback: (path: string) => void) => {
      ipcRenderer.on('navigate-to', (_, path) => callback(path));
    },

    // Update event listeners
    onUpdateChecking: (callback: () => void) => {
      ipcRenderer.on('app:update-checking', callback);
    },
    onUpdateAvailable: (callback: (info: any) => void) => {
      ipcRenderer.on('app:update-available', (_, info) => callback(info));
    },
    onUpdateNotAvailable: (callback: (info: any) => void) => {
      ipcRenderer.on('app:update-not-available', (_, info) => callback(info));
    },
    onUpdateError: (callback: (error: string) => void) => {
      ipcRenderer.on('app:update-error', (_, error) => callback(error));
    },

    // Remove update listeners
    removeUpdateListeners: () => {
      ipcRenderer.removeAllListeners('app:update-checking');
      ipcRenderer.removeAllListeners('app:update-available');
      ipcRenderer.removeAllListeners('app:update-not-available');
      ipcRenderer.removeAllListeners('app:update-error');
    }
  }
});
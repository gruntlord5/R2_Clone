// API client that works in both Electron (IPC) and Browser (HTTP) modes

// Helper to check if running in real Electron mode
// Real Electron has versions.electron set by the preload script
// Browser polyfill does not set this property
export function isElectron(): boolean {
  return typeof window !== 'undefined' &&
    typeof (window as any).electronAPI?.versions?.electron !== 'undefined';
}

// Cache the web server port and HTTPS status for Electron mode
let cachedPort: number = 3000;
let cachedUseHttps: boolean = true;
let portCacheInitialized = false;

// Initialize port cache (called on app startup)
async function initializePortCache() {
  if (portCacheInitialized || !isElectron()) return;

  try {
    const status = await window.electronAPI.webserver.getStatus();
    cachedPort = status.port || 3000;
    cachedUseHttps = status.useHttps !== undefined ? status.useHttps : true;
    portCacheInitialized = true;
  } catch (error) {
    console.error('[API Client] Failed to get web server status, using defaults:', error);
    cachedPort = 3000;
    cachedUseHttps = true;
    portCacheInitialized = true;
  }
}

// Helper to get the API base URL
function getApiBaseUrl(): string {
  if (isElectron()) {
    // Electron mode: Use localhost with cached port and protocol
    const protocol = cachedUseHttps ? 'https' : 'http';
    return `${protocol}://localhost:${cachedPort}`;
  } else {
    // Browser mode: Use same host
    return '';
  }
}

// WebSocket connection - initialized lazily
let ws: WebSocket | null = null;
const wsListeners: Map<string, Set<Function>> = new Map();
let wsInitialized = false;
const reconnectCallbacks: Set<Function> = new Set();

// Initialize WebSocket - called explicitly after DOM is ready
export async function connectWebSocket() {
  if (wsInitialized) return;
  wsInitialized = true;

  if (typeof window === 'undefined') return;

  // Initialize port cache first if in Electron mode
  if (isElectron()) {
    await initializePortCache();
  }

  // Both Electron and Browser connect to the same WebSocket server
  // Electron connects to the web server's WebSocket endpoint
  let wsUrl: string;

  if (isElectron()) {
    // Electron mode: Connect to web server WebSocket with cached port and protocol
    const protocol = cachedUseHttps ? 'wss' : 'ws';
    wsUrl = `${protocol}://localhost:${cachedPort}/ws`;
  } else {
    // Browser mode: Connect to WebSocket on same host
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${protocol}//${window.location.host}/ws`;
  }

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    // Call reconnection callbacks (but not on initial connection)
    if (reconnectCallbacks.size > 0) {
      reconnectCallbacks.forEach(callback => {
        try {
          callback();
        } catch (error) {
          console.error('[API Client] Reconnection callback error:', error);
        }
      });
      reconnectCallbacks.clear();
    }
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      const listeners = wsListeners.get(message.type);
      if (listeners) {
        listeners.forEach(callback => callback(message.data));
      }
    } catch (error) {
      console.error('[API Client] WebSocket message error:', error);
    }
  };

  ws.onerror = (error) => {
    console.error('[API Client] WebSocket error:', error);
  };

  ws.onclose = () => {
    wsInitialized = false;
    // Attempt to reconnect after 3 seconds
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        connectWebSocket();
      }
    }, 3000);
  };
}

// Helper function to add event listeners
function addWebSocketListener(eventType: string, callback: Function) {
  if (!wsListeners.has(eventType)) {
    wsListeners.set(eventType, new Set());
  }
  wsListeners.get(eventType)!.add(callback);
}

// Export for direct use when needed
export { addWebSocketListener };

// Register a callback to be called when WebSocket reconnects (one-time use)
export function onWebSocketReconnect(callback: Function) {
  reconnectCallbacks.add(callback);
}

// Helper to send WebSocket message and wait for response
function sendWebSocketMessage(type: string, data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket not connected'));
      return;
    }

    const responseType = `${type}:response`;

    // Set up one-time listener for response
    const handleResponse = (responseData: any) => {
      const listeners = wsListeners.get(responseType);
      if (listeners) {
        listeners.delete(handleResponse);
      }
      resolve(responseData);
    };

    addWebSocketListener(responseType, handleResponse);

    // Send message
    ws.send(JSON.stringify({ type, data }));

    // Timeout after 30 seconds
    setTimeout(() => {
      const listeners = wsListeners.get(responseType);
      if (listeners?.has(handleResponse)) {
        listeners.delete(handleResponse);
        reject(new Error('WebSocket request timeout'));
      }
    }, 30000);
  });
}

// Unified API client
export const apiClient = {
  // Versions - undefined in browser mode, or will be set by real Electron API
  versions: undefined as any,

  backup: {
    async getJobs() {
      const response = await fetch(`${getApiBaseUrl()}/api/backup/jobs`);
      return response.json();
    },

    async getRuns(limit?: number) {
      const url = limit ? `${getApiBaseUrl()}/api/backup/runs?limit=${limit}` : `${getApiBaseUrl()}/api/backup/runs`;
      const response = await fetch(url);
      return response.json();
    },

    async start(params: any) {
      // Both Electron and Browser use WebSocket for start
      // This ensures all clients see the backup:started event
      return sendWebSocketMessage('backup:start', params);
    },

    async stop(jobId?: string) {
      // Both Electron and Browser use WebSocket for stop
      return sendWebSocketMessage('backup:stop', { jobId });
    },

    async saveJob(job: any) {
      const response = await fetch(`${getApiBaseUrl()}/api/backup/save-job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job),
      });
      return response.json();
    },

    async deleteJob(id: string) {
      const response = await fetch(`${getApiBaseUrl()}/api/backup/delete-job/${id}`, {
        method: 'DELETE',
      });
      return response.json();
    },

    async deleteRun(id: number, deleteFiles: boolean) {
      const response = await fetch(`${getApiBaseUrl()}/api/backup/delete-run/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteFiles }),
      });
      return response.json();
    },

    async getStats() {
      const response = await fetch(`${getApiBaseUrl()}/api/backup/stats`);
      return response.json();
    },

    async calculateRunSize(id: number) {
      const response = await fetch(`${getApiBaseUrl()}/api/backup/calculate-run-size/${id}`, {
        method: 'POST',
      });
      return response.json();
    },

    async getRunsByJob(jobId: string, limit?: number) {
      const url = limit
        ? `${getApiBaseUrl()}/api/backup/runs-by-job/${jobId}?limit=${limit}`
        : `${getApiBaseUrl()}/api/backup/runs-by-job/${jobId}`;
      const response = await fetch(url);
      return response.json();
    },

    async getRunSize(jobId: string) {
      const response = await fetch(`${getApiBaseUrl()}/api/backup/run-size/${jobId}`);
      return response.json();
    },

    async getDirectorySize() {
      const response = await fetch(`${getApiBaseUrl()}/api/backup/directory-size`);
      return response.json();
    },

    async listFiles(path: string, bucketId?: number) {
      const response = await fetch(`${getApiBaseUrl()}/api/backup/list-files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, bucketId }),
      });
      return response.json();
    },

    async listDirectories(path: string, bucketId?: number) {
      const response = await fetch(`${getApiBaseUrl()}/api/backup/list-directories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, bucketId }),
      });
      return response.json();
    },

    // Event listeners - ALL use WebSocket now (both Electron and Browser)
    onProgress(callback: (progress: any) => void) {
      addWebSocketListener('backup:progress', callback);
    },

    onFileTransferred(callback: (file: any) => void) {
      addWebSocketListener('backup:file-transferred', callback);
    },

    onFileSkipped(callback: (file: any) => void) {
      addWebSocketListener('backup:file-skipped', callback);
    },

    onComplete(callback: (data: any) => void) {
      addWebSocketListener('backup:complete', callback);
    },

    onError(callback: (error: string) => void) {
      addWebSocketListener('backup:error', callback);
    },

    onStopped(callback: () => void) {
      addWebSocketListener('backup:stopped', callback);
    },

    onNothingToTransfer(callback: () => void) {
      addWebSocketListener('backup:nothing-to-transfer', callback);
    },

    onUsingPath(callback: (path: string) => void) {
      addWebSocketListener('backup:using-path', callback);
    },

    onStarted(callback: (data: { jobId: string; jobName: string; sourcePath: string }) => void) {
      addWebSocketListener('backup:started', callback);
    },

    removeAllListeners() {
      wsListeners.clear();
    },
  },

  r2: {
    async getAllBuckets() {
      const response = await fetch(`${getApiBaseUrl()}/api/buckets`);
      return response.json();
    },

    async getBucket(id: number) {
      const response = await fetch(`${getApiBaseUrl()}/api/bucket/${id}`);
      return response.json();
    },

    async createBucket(bucketData: any) {
      const response = await fetch(`${getApiBaseUrl()}/api/bucket/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bucketData),
      });
      return response.json();
    },

    async updateBucket(id: number, updates: any) {
      const response = await fetch(`${getApiBaseUrl()}/api/bucket/update/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      return response.json();
    },

    async deleteBucket(id: number) {
      const response = await fetch(`${getApiBaseUrl()}/api/bucket/delete/${id}`, {
        method: 'DELETE',
      });
      return response.json();
    },

    async testBucketConnection(id: number) {
      const response = await fetch(`${getApiBaseUrl()}/api/bucket/test/${id}`, {
        method: 'POST',
      });
      return response.json();
    },
  },

  settings: {
    async get() {
      const response = await fetch(`${getApiBaseUrl()}/api/settings`);
      return response.json();
    },

    async update(settings: any) {
      const response = await fetch(`${getApiBaseUrl()}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      return response.json();
    },

    async getBackupDestination() {
      const response = await fetch(`${getApiBaseUrl()}/api/settings/backup-destination`);
      const data = await response.json();
      return data.destination;
    },

    async setBackupDestination(path: string) {
      const response = await fetch(`${getApiBaseUrl()}/api/settings/backup-destination`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      return response.json();
    },

    async getRclonePath() {
      const response = await fetch(`${getApiBaseUrl()}/api/settings/rclone-path`);
      return response.json();
    },

    async setRclonePath(path: string) {
      const response = await fetch(`${getApiBaseUrl()}/api/settings/rclone-path`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      return response.json();
    },

    async getHomeDirectory() {
      const response = await fetch(`${getApiBaseUrl()}/api/settings/home-directory`);
      return response.json();
    },

    async getSpecialPaths() {
      const response = await fetch(`${getApiBaseUrl()}/api/settings/special-paths`);
      return response.json();
    },

    async getLastSeenVersion() {
      const response = await fetch(`${getApiBaseUrl()}/api/settings/last-seen-version`);
      const data = await response.json();
      return data.version;
    },

    async setLastSeenVersion(version: string) {
      const response = await fetch(`${getApiBaseUrl()}/api/settings/last-seen-version`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      return response.json();
    },

    async getTimezone() {
      const response = await fetch(`${getApiBaseUrl()}/api/settings/timezone`);
      const data = await response.json();
      return data.timezone;
    },

    async setTimezone(timezone: string) {
      const response = await fetch(`${getApiBaseUrl()}/api/settings/timezone`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone }),
      });
      return response.json();
    },

    async getLocalIP() {
      if (isElectron()) {
        return window.electronAPI.settings.getLocalIP();
      }
      // Browser mode: fetch from API
      try {
        const response = await fetch(`${getApiBaseUrl()}/api/settings/local-ip`);
        const data = await response.json();
        return data.ip;
      } catch (error) {
        console.error('Failed to fetch local IP:', error);
        return null;
      }
    },
  },

  scheduler: {
    async getNextRun(jobId: string) {
      const response = await fetch(`${getApiBaseUrl()}/api/scheduler/next-run/${jobId}`);
      return response.json();
    },

    async getAllScheduled() {
      const response = await fetch(`${getApiBaseUrl()}/api/scheduler/all-scheduled`);
      return response.json();
    },

    async triggerBackup(jobId: string) {
      const response = await fetch(`${getApiBaseUrl()}/api/scheduler/trigger/${jobId}`, { method: 'POST' });
      return response.json();
    },

    async getStatus() {
      const response = await fetch(`${getApiBaseUrl()}/api/scheduler/status`);
      return response.json();
    },

    // Scheduler event listeners - ALL use WebSocket now (both Electron and Browser)
    onBackupStarted(callback: (data: any) => void) {
      addWebSocketListener('scheduler:backup-started', callback);
    },

    onBackupCompleted(callback: (data: any) => void) {
      addWebSocketListener('scheduler:backup-completed', callback);
    },

    onBackupError(callback: (data: any) => void) {
      addWebSocketListener('scheduler:backup-error', callback);
    },

    onBackupSkipped(callback: (data: any) => void) {
      addWebSocketListener('scheduler:backup-skipped', callback);
    },

    removeAllListeners() {
      // Listeners are shared with backup, cleared together
    },
  },

  // System methods (time, timezone, etc.)
  system: {
    async getSystemTime() {
      const response = await fetch(`${getApiBaseUrl()}/api/system/time`);
      const data = await response.json();
      return data.time;
    },

    async getCloudflareTime() {
      const response = await fetch(`${getApiBaseUrl()}/api/system/cloudflare-time`);
      const data = await response.json();
      return data.time;
    },

    async syncTime() {
      const response = await fetch(`${getApiBaseUrl()}/api/system/sync-time`, {
        method: 'POST',
      });
      return response.json();
    },
  },

  // App methods (version, updates, etc.)
  app: {
    async getVersion() {
      if (isElectron()) {
        return window.electronAPI.app.getVersion();
      }
      // Fetch version from API in browser mode
      try {
        const response = await fetch(`${getApiBaseUrl()}/api/app/version`);
        return response.json();
      } catch (error) {
        console.error('Failed to fetch version:', error);
        return 'Unknown';
      }
    },

    async getStatus() {
      // Always fetch from API (works for both Electron and browser)
      try {
        const response = await fetch(`${getApiBaseUrl()}/api/app/status`);
        return response.json();
      } catch (error) {
        console.error('Failed to fetch app status:', error);
        return { isDocker: false };
      }
    },

    async checkForUpdates() {
      if (isElectron()) {
        return window.electronAPI.app.checkForUpdates();
      }
      // Browser mode: Use API endpoint
      try {
        const response = await fetch(`${getApiBaseUrl()}/api/app/check-updates`);
        return response.json();
      } catch (error) {
        console.error('Failed to check for updates:', error);
        return { success: false, error: 'Failed to check for updates' };
      }
    },

    async downloadUpdate() {
      if (isElectron()) {
        return window.electronAPI.app.downloadUpdate();
      }
      return { success: false };
    },

    async installUpdate(manifest?: any) {
      if (isElectron()) {
        return window.electronAPI.app.installUpdate();
      }
      // Browser mode: Use API endpoint for Docker auto-update
      try {
        const response = await fetch(`${getApiBaseUrl()}/api/app/install-update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manifest }),
        });
        return response.json();
      } catch (error) {
        console.error('Failed to install update:', error);
        return { success: false, error: 'Failed to install update' };
      }
    },

    async restart() {
      // Only works in browser mode (Docker)
      try {
        const response = await fetch(`${getApiBaseUrl()}/api/app/restart`, {
          method: 'POST',
        });
        return response.json();
      } catch (error) {
        console.error('Failed to restart:', error);
        return { success: false, error: 'Failed to restart' };
      }
    },

    onShowAbout(callback: () => void) {
      if (isElectron()) {
        window.electronAPI.app.onShowAbout(callback);
      }
      // No-op in browser mode
    },

    onUpdateAvailable(callback: (info: any) => void) {
      if (isElectron()) {
        window.electronAPI.app.onUpdateAvailable(callback);
      }
    },

    onUpdateNotAvailable(callback: (info: any) => void) {
      if (isElectron()) {
        window.electronAPI.app.onUpdateNotAvailable(callback);
      }
    },

    onUpdateDownloaded(callback: (info: any) => void) {
      if (isElectron()) {
        window.electronAPI.app.onUpdateDownloaded(callback);
      }
    },

    onUpdateDownloadProgress(callback: (progress: any) => void) {
      if (isElectron()) {
        window.electronAPI.app.onUpdateDownloadProgress(callback);
      }
    },

    onUpdateError(callback: (error: string) => void) {
      if (isElectron()) {
        window.electronAPI.app.onUpdateError(callback);
      }
    },

    removeUpdateListeners() {
      if (isElectron()) {
        window.electronAPI.app.removeUpdateListeners();
      }
    },

    // Docker auto-update WebSocket events (browser mode only)
    onAppUpdateStatus(callback: (status: string) => void) {
      addWebSocketListener('app:update-status', callback);
    },

    onAppUpdateProgress(callback: (progress: any) => void) {
      addWebSocketListener('app:update-progress', callback);
    },

    onAppUpdateError(callback: (error: string) => void) {
      addWebSocketListener('app:update-error', callback);
    },

    onAppUpdateComplete(callback: (version: string) => void) {
      addWebSocketListener('app:update-complete', callback);
    },
  },

  // Dialog methods
  dialog: {
    async selectDirectory() {
      if (isElectron()) {
        return window.electronAPI.dialog.selectDirectory();
      }
      // In browser mode, can't use native dialogs
      return { canceled: true, filePaths: [] };
    },
  },

  // Shell methods
  shell: {
    async openPath(path: string) {
      if (isElectron()) {
        return window.electronAPI.shell.openPath(path);
      }
      return { success: false, error: 'Not available in web mode' };
    },

    async showItemInFolder(path: string) {
      if (isElectron()) {
        return window.electronAPI.shell.showItemInFolder(path);
      }
      return { success: false, error: 'Not available in web mode' };
    },
  },

  // Rclone methods
  rclone: {
    async checkInstalled() {
      const response = await fetch(`${getApiBaseUrl()}/api/rclone/status`);
      return response.json();
    },

    async install() {
      const response = await fetch(`${getApiBaseUrl()}/api/rclone/install`, { method: 'POST' });
      return response.json();
    },

    async uninstall() {
      const response = await fetch(`${getApiBaseUrl()}/api/rclone/uninstall`, { method: 'POST' });
      return response.json();
    },

    // All rclone installation events now use WebSocket (both Electron and Browser)
    onInstallStatus(callback: (status: string) => void) {
      addWebSocketListener('rclone:install-status', callback);
    },

    onInstallProgress(callback: (progress: any) => void) {
      addWebSocketListener('rclone:install-progress', callback);
    },

    onInstallError(callback: (error: string) => void) {
      addWebSocketListener('rclone:install-error', callback);
    },

    onInstallComplete(callback: (path: string) => void) {
      addWebSocketListener('rclone:install-complete', callback);
    },

    removeInstallListeners() {
      // Listeners are shared, cleared together with other WebSocket listeners
    },
  },

  // WebServer methods
  webserver: {
    async start(port: number) {
      const response = await fetch(`${getApiBaseUrl()}/api/webserver/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
      });
      return response.json();
    },

    async stop() {
      const response = await fetch(`${getApiBaseUrl()}/api/webserver/stop`, { method: 'POST' });
      return response.json();
    },

    async getStatus() {
      const response = await fetch(`${getApiBaseUrl()}/api/webserver/status`);
      return response.json();
    },
  },
};

// Function to update cached port (call after changing port in settings)
export async function updateCachedPort() {
  if (!isElectron()) return;

  portCacheInitialized = false; // Force re-initialization
  await initializePortCache();
}

// Export for easy replacement of window.electronAPI
export const electronAPI = apiClient;

// Auto-polyfill window.electronAPI if in browser mode
if (typeof window !== 'undefined' && !isElectron()) {
  // Browser mode - create polyfill
  // Real Electron API has versions.electron, polyfill doesn't set it
  (window as any).electronAPI = apiClient;
}

import { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage, Notification } from 'electron';
import path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import RcloneHandler from './rclone';
import RcloneInstaller from './rclone-installer';
import BackupScheduler from './backup-scheduler';
import { initDatabase, getDatabase, type R2Bucket, type BackupRun } from './database';
import { WebServer } from '../server';
import { UpdateManager } from './update-manager';
import AppUpdater from './app-updater';
import packageJson from '../../package.json';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Parse CLI arguments
const args = process.argv.slice(1);
const isHeadlessMode = args.includes('--headless');
const portIndex = args.indexOf('--port');
const cliPort = portIndex !== -1 && args[portIndex + 1]
  ? parseInt(args[portIndex + 1])
  : null;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 540,  // Minimum width to accommodate modal (max-w-md = 28rem = 448px + padding)
    minHeight: 768, // Minimum height to accommodate modal content
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Handle window close event
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();

      // Show notification on first minimize to tray
      const db = getDatabase();
      if (!db.getSetting('shown_tray_notification')) {
        new Notification({
          title: 'R2Clone is still running',
          body: 'The app has been minimized to the system tray. Scheduled backups will continue to run.',
        }).show();
        db.setSetting('shown_tray_notification', 'true');
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Update tray menu when window visibility changes
  mainWindow.on('show', () => {
    updateTrayMenu();
  });

  mainWindow.on('hide', () => {
    updateTrayMenu();
  });

  // Load the app - distinguish between development and production
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    // Open the DevTools automatically in development
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
// Create system tray
const createTray = () => {
  try {
    console.log('[Tray] Creating system tray icon...');
    
    // Create a simple 16x16 icon programmatically
    // Using a cloud icon drawn with pixels
    const size = 16;
    const buffer = Buffer.alloc(size * size * 4);
    
    // Simple cloud shape (white cloud on transparent background)
    const cloudPixels = [
      // Row-based pixel positions for a simple cloud shape
      [5,6,7,8,9,10],           // row 4
      [3,4,5,6,7,8,9,10,11,12], // row 5
      [2,3,4,5,6,7,8,9,10,11,12,13], // row 6
      [2,3,4,5,6,7,8,9,10,11,12,13], // row 7
      [2,3,4,5,6,7,8,9,10,11,12,13], // row 8
      [3,4,5,6,7,8,9,10,11,12], // row 9
      [4,5,6,7,8,9,10,11],      // row 10
    ];
    
    // Fill buffer with transparent pixels first
    for (let i = 0; i < buffer.length; i += 4) {
      buffer[i] = 0;     // R
      buffer[i + 1] = 0; // G
      buffer[i + 2] = 0; // B
      buffer[i + 3] = 0; // A (transparent)
    }
    
    // Draw cloud pixels
    cloudPixels.forEach((row, rowIndex) => {
      const y = rowIndex + 4; // Start from row 4
      row.forEach(x => {
        const index = (y * size + x) * 4;
        if (process.platform === 'darwin') {
          // For macOS template image: black pixels with full opacity
          buffer[index] = 0;       // R
          buffer[index + 1] = 0;   // G
          buffer[index + 2] = 0;   // B
          buffer[index + 3] = 255; // A (opaque)
        } else {
          // For other platforms: white cloud
          buffer[index] = 255;     // R
          buffer[index + 1] = 255; // G
          buffer[index + 2] = 255; // B
          buffer[index + 3] = 255; // A (opaque)
        }
      });
    });
    
    const icon = nativeImage.createFromBuffer(buffer, {
      width: size,
      height: size
    });
    
    // Set as template image on macOS for proper dark mode support
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true);
      console.log('[Tray] Set as template image for macOS');
    }
    
    tray = new Tray(icon);
    tray.setToolTip('R2Clone - Backup Scheduler');
    console.log('[Tray] System tray created successfully');
    
    // Update tray context menu
    updateTrayMenu();
  } catch (error) {
    console.error('[Tray] Failed to create system tray:', error);
  }
};

// Update tray menu with dynamic content
const updateTrayMenu = async () => {
  if (!tray) return;

  const db = getDatabase();
  const jobs = db.getAllBackupJobs();
  const schedulerStatus = backupScheduler.getIsRunning();
  const activeBackupId = backupScheduler.getActiveBackupId();

  // Get running backups from WebServer
  const runningBackups = webServer ? webServer.getActiveBackups() : [];

  // Build job submenu items
  const jobMenuItems = jobs.map(job => ({
    label: job.name,
    click: async () => {
      // Use WebSocket-based backup system for consistency with app UI
      if (webServer) {
        const result = await webServer.startBackup(job.id);
        if (!result.success) {
          console.error('[Tray] Failed to start backup:', result.error);
        }
      }
    }
  }));

  // Get next scheduled runs
  const scheduledJobs = backupScheduler.getScheduledJobs();
  const nextRuns = scheduledJobs
    .filter(s => s.nextRun)
    .sort((a, b) => (a.nextRun?.getTime() || 0) - (b.nextRun?.getTime() || 0))
    .slice(0, 3)
    .map(s => {
      const job = jobs.find(j => j.id === s.jobId);
      return {
        label: `${job?.name}: ${s.nextRun?.toLocaleString()}`,
        enabled: false
      };
    });

  // Build running backups submenu items
  const runningBackupsMenuItems = runningBackups.length > 0
    ? runningBackups.map(backup => ({
        label: `${backup.jobName} (${Math.round(backup.percentage)}%) - Click to view`,
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('navigate-to', '/backups?tab=history');
          } else {
            createWindow();
          }
        }
      }))
    : [{ label: 'No active backups', enabled: false }];

  // Build dynamic tooltip with running backup progress
  let tooltipText = 'R2Clone - Backup Scheduler';
  if (runningBackups.length > 0) {
    const backupSummaries = runningBackups
      .slice(0, 3) // Show up to 3 backups to avoid long tooltips
      .map(backup => `${backup.jobName} (${Math.round(backup.percentage)}%)`)
      .join(', ');
    tooltipText = `R2Clone - Running: ${backupSummaries}`;
    if (runningBackups.length > 3) {
      tooltipText += ` +${runningBackups.length - 3} more`;
    }
  }
  tray.setToolTip(tooltipText);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: mainWindow?.isVisible() ? 'Hide R2Clone' : 'Show R2Clone',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        } else {
          createWindow();
        }
      }
    },
    { type: 'separator' },
    {
      label: `Scheduler: ${schedulerStatus ? 'Running' : 'Stopped'}`,
      enabled: false
    },
    {
      label: activeBackupId ? `Active: ${jobs.find(j => j.id === activeBackupId)?.name || activeBackupId}` : 'No active backup',
      enabled: false
    },
    { type: 'separator' },
    {
      label: runningBackups.length > 0
        ? `Running Backups (${runningBackups.length}) - Click for details`
        : 'Running Backups',
      submenu: runningBackupsMenuItems
    },
    {
      label: 'Next Scheduled Runs',
      submenu: nextRuns.length > 0 ? nextRuns : [{ label: 'No scheduled runs', enabled: false }]
    },
    {
      label: 'Run Backup Now',
      submenu: jobMenuItems.length > 0 ? jobMenuItems : [{ label: 'No backup jobs', enabled: false }]
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('navigate-to', '/settings');
        } else {
          createWindow();
        }
      }
    },
    {
      label: 'About R2Clone',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('app:show-about');
        } else {
          createWindow();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit R2Clone',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
};

// Initialize update manager with version from package.json
const updateManager = new UpdateManager(packageJson.version);

// Set up update manager event handlers
updateManager.on('checking', () => {
  console.log('[UpdateManager] Checking for update...');
  BrowserWindow.getAllWindows().forEach(window => {
    window.webContents.send('app:update-checking');
  });
});

updateManager.on('available', (manifest) => {
  console.log('[UpdateManager] Update available:', manifest.version);
  BrowserWindow.getAllWindows().forEach(window => {
    window.webContents.send('app:update-available', manifest);
  });
});

updateManager.on('not-available', () => {
  console.log('[UpdateManager] No update available');
  BrowserWindow.getAllWindows().forEach(window => {
    window.webContents.send('app:update-not-available', {});
  });
});

updateManager.on('error', (message) => {
  console.error('[UpdateManager] Error:', message);
  BrowserWindow.getAllWindows().forEach(window => {
    window.webContents.send('app:update-error', message);
  });
});

// Handle certificate verification for self-signed localhost certificates
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  // Allow self-signed certificates for localhost
  if (url.startsWith('https://localhost:') || url.startsWith('https://127.0.0.1:')) {
    event.preventDefault();
    callback(true); // Trust the certificate
    console.log('[Main] Trusted self-signed certificate (cert-error):', url);
  } else {
    // For all other URLs, use default certificate verification
    callback(false);
  }
});

app.whenReady().then(async () => {
  // Configure session to accept self-signed localhost certificates
  // This is needed for fetch/WebSocket requests, not just browser navigation
  const { session } = require('electron');
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    try {
      // request.hostname is the hostname of the server
      const hostname = request.hostname;

      // Trust localhost and 127.0.0.1
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
        callback(0); // 0 = accept certificate
        console.log('[Main] Certificate verified for localhost:', hostname);
      } else {
        callback(-2); // -2 = use default verification
      }
    } catch (error) {
      console.error('[Main] Certificate verification error:', error);
      callback(-2); // Use default verification on error
    }
  });
  // Create application menu for macOS with custom About
  if (process.platform === 'darwin') {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: app.getName(),
        submenu: [
          {
            label: 'About R2Clone',
            click: () => {
              // Send IPC message to renderer to open about dialog
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('app:show-about');
              }
            }
          },
          { type: 'separator' },
          {
            label: 'Settings',
            accelerator: 'Command+,',
            click: () => {
              if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
                mainWindow.webContents.send('navigate-to', '/settings');
              }
            }
          },
          { type: 'separator' },
          {
            label: 'Hide R2Clone',
            accelerator: 'Command+H',
            role: 'hide'
          },
          {
            label: 'Hide Others',
            accelerator: 'Command+Shift+H',
            role: 'hideOthers'
          },
          {
            label: 'Show All',
            role: 'unhide'
          },
          { type: 'separator' },
          {
            label: 'Quit R2Clone',
            accelerator: 'Command+Q',
            click: () => {
              isQuitting = true;
              app.quit();
            }
          }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { label: 'Undo', accelerator: 'Command+Z', role: 'undo' },
          { label: 'Redo', accelerator: 'Shift+Command+Z', role: 'redo' },
          { type: 'separator' },
          { label: 'Cut', accelerator: 'Command+X', role: 'cut' },
          { label: 'Copy', accelerator: 'Command+C', role: 'copy' },
          { label: 'Paste', accelerator: 'Command+V', role: 'paste' },
          { label: 'Select All', accelerator: 'Command+A', role: 'selectAll' }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { label: 'Minimize', accelerator: 'Command+M', role: 'minimize' },
          { label: 'Close', accelerator: 'Command+W', role: 'close' },
          { type: 'separator' },
          { label: 'Bring All to Front', role: 'front' }
        ]
      }
    ];
    
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  } else {
    // Remove the default menu on Windows/Linux
    Menu.setApplicationMenu(null);
  }
  
  // Initialize database
  const db = initDatabase();

  // Clean up any stale backup runs that are stuck in "running" status
  db.cleanupStaleBackups();

  // Apply auto-start setting (Electron only, not in headless mode)
  if (!isHeadlessMode) {
    const appSettings = db.getAppSettings();
    app.setLoginItemSettings({
      openAtLogin: appSettings.autoStart,
      openAsHidden: false
    });
    console.log(`[App] Login item settings applied: openAtLogin=${appSettings.autoStart}`);
  }

  // Initialize rclone installer (check status once on startup)
  await rcloneInstaller.initialize();

  // Auto-install rclone in Docker if not present
  if (process.env.DOCKER === 'true') {
    const rcloneStatus = rcloneInstaller.getInstallStatus();
    if (!rcloneStatus.isInstalled) {
      console.log('[Docker] Rclone not found, installing automatically...');
      try {
        await rcloneInstaller.install();
        console.log('[Docker] Rclone installed successfully');
      } catch (error: any) {
        console.error('[Docker] Failed to install rclone:', error.message);
        // Continue anyway - user will see error in UI
      }
    }
  }

  // Initialize backup scheduler
  await backupScheduler.initialize();

  // Determine web server port (priority: CLI flag > saved setting > default)
  const savedPort = parseInt(db.getSetting('web_server_port') || '3000');
  const webServerPort = cliPort || savedPort;

  // Start web server
  // Always start in Electron mode for API functionality
  // web_server_enabled now controls external network access (localhost only vs 0.0.0.0)
  const webServerEnabled = db.getSetting('web_server_enabled') === 'true';
  const allowExternal = isHeadlessMode || webServerEnabled;
  const useHttps = db.getUseHttps();
  const httpsPort = db.getHttpsPort();

  try {
    webServer = new WebServer({
      port: webServerPort,
      httpsPort,
      distPath: path.join(__dirname, '../renderer'),
      rcloneHandler: readOnlyHandler,  // Use read-only handler for API operations
      backupScheduler,
      rcloneInstaller,
      updateManager,
      appUpdater,
      allowExternal,
      useHttps,
      onBackupsChanged: isHeadlessMode ? undefined : updateTrayMenu,
    });
    await webServer.start();

    // Connect BackupScheduler to WebSocket-based backup system
    backupScheduler.setStartBackupFunction((jobId) => webServer!.startBackup(jobId));

    if (isHeadlessMode) {
      console.log(`\n🚀 R2Clone running in HEADLESS mode`);
      const protocol = useHttps ? 'https' : 'http';
      console.log(`📡 Web server: ${protocol}://localhost:${webServerPort}`);
      console.log(`📅 Backup scheduler: ${backupScheduler.getScheduledJobs().length} jobs scheduled`);
      console.log(`\nPress Ctrl+C to stop\n`);
    } else {
      const accessType = allowExternal ? 'all interfaces (0.0.0.0)' : 'localhost only';
      console.log(`[Main] Web server started on port ${webServerPort} (${accessType})`);
    }
  } catch (error) {
    console.error('[Main] Failed to start web server:', error);
    if (isHeadlessMode) {
      console.error('Cannot start in headless mode without web server. Exiting.');
      app.quit();
      return;
    }
    // In GUI mode, show error but continue - app will have limited functionality
    console.error('[Main] Continuing in GUI mode with limited functionality');
  }

  // Only create GUI elements in non-headless mode
  if (!isHeadlessMode) {
    // Create system tray
    createTray();

    createWindow();

    // Check for updates after a short delay (only in production)
    if (process.env.NODE_ENV !== 'development') {
      setTimeout(() => {
        updateManager.checkForUpdates().catch(err => {
          console.error('[UpdateManager] Failed to check for updates:', err);
        });
      }, 2000);
    }
  }

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Don't quit when all windows are closed - keep running in tray
app.on('window-all-closed', () => {
  // On macOS, keep the app running even without windows
  // On other platforms, keep running in system tray
  // App will only quit when explicitly requested via tray menu
});

// IPC Handlers
const rcloneInstaller = new RcloneInstaller();
// Singleton handler for read-only operations (test connection, list files)
const readOnlyHandler = new RcloneHandler(rcloneInstaller);
const backupScheduler = new BackupScheduler(rcloneInstaller);
const appUpdater = new AppUpdater();
let webServer: WebServer | null = null;

// Legacy r2 configuration handlers removed - use bucket management APIs instead

ipcMain.handle('r2:test-connection', async () => {
  try {
    await readOnlyHandler.testConnection();
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// New bucket management handlers
ipcMain.handle('r2:get-all-buckets', async () => {
  try {
    const db = getDatabase();
    const buckets = db.getAllBuckets();
    // Convert snake_case to camelCase for frontend
    return buckets.map(b => ({
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
  } catch (error: any) {
    console.error('Failed to get buckets:', error);
    return [];
  }
});

ipcMain.handle('r2:get-bucket', async (_, id: number) => {
  try {
    const db = getDatabase();
    const bucket = db.getBucket(id);
    if (!bucket) return undefined;

    return {
      id: bucket.id,
      name: bucket.name,
      accessKeyId: bucket.access_key_id,
      // secretAccessKey intentionally omitted for security - not needed by frontend
      endpoint: bucket.endpoint,
      bucketName: bucket.bucket_name,
      region: bucket.region,
      createdAt: bucket.created_at,
      updatedAt: bucket.updated_at
    };
  } catch (error: any) {
    console.error('Failed to get bucket:', error);
    return undefined;
  }
});


ipcMain.handle('r2:create-bucket', async (_, bucketData) => {
  try {
    const db = getDatabase();

    let secretAccessKey = bucketData.secretAccessKey;

    // If no secret provided, try to copy from existing bucket with same access key
    if (!secretAccessKey) {
      const allBuckets = db.getAllBuckets();
      const existingBucket = allBuckets.find(b => b.access_key_id === bucketData.accessKeyId);

      if (existingBucket) {
        // Reuse the secret from the existing bucket with this access key
        secretAccessKey = existingBucket.secret_access_key;
      } else {
        // No existing bucket found with this access key, secret is required
        return { success: false, error: 'Secret Access Key is required for new credentials' };
      }
    }

    const bucket = db.createBucket({
      name: bucketData.name,
      access_key_id: bucketData.accessKeyId,
      secret_access_key: secretAccessKey,
      endpoint: bucketData.endpoint,
      bucket_name: bucketData.bucketName,
      region: bucketData.region,
    });

    return {
      success: true,
      data: {
        id: bucket.id,
        name: bucket.name,
        accessKeyId: bucket.access_key_id,
        // secretAccessKey intentionally omitted for security - not needed by frontend
        endpoint: bucket.endpoint,
        bucketName: bucket.bucket_name,
        region: bucket.region,
          createdAt: bucket.created_at,
        updatedAt: bucket.updated_at
      }
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('r2:update-bucket', async (_, id: number, updates) => {
  try {
    const db = getDatabase();
    const updateData: any = {};
    
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.accessKeyId !== undefined) updateData.access_key_id = updates.accessKeyId;
    if (updates.secretAccessKey !== undefined) updateData.secret_access_key = updates.secretAccessKey;
    if (updates.endpoint !== undefined) updateData.endpoint = updates.endpoint;
    if (updates.bucketName !== undefined) updateData.bucket_name = updates.bucketName;
    if (updates.region !== undefined) updateData.region = updates.region;
    
    const success = db.updateBucket(id, updateData);
    return { success };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('r2:delete-bucket', async (_, id: number) => {
  try {
    const db = getDatabase();
    const success = db.deleteBucket(id);
    return { success };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});


ipcMain.handle('r2:test-bucket-connection', async (_, id: number) => {
  try {
    const db = getDatabase();
    const bucket = db.getBucket(id);
    if (!bucket) {
      return { success: false, error: 'Bucket not found' };
    }
    
    // Configure rclone with the bucket to test
    readOnlyHandler.setConfig({
      accessKeyId: bucket.access_key_id,
      secretAccessKey: bucket.secret_access_key,
      endpoint: bucket.endpoint,
      bucketName: bucket.bucket_name,
      region: bucket.region || 'auto'
    });

    await readOnlyHandler.testConnection();
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Backup Jobs
ipcMain.handle('backup:get-jobs', async () => {
  const db = getDatabase();
  // Use optimized JOIN query to avoid N+1 problem
  const jobsWithBuckets = db.getAllBackupJobsWithBuckets();

  // Convert database format to frontend format
  return jobsWithBuckets.map(job => ({
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
});

// Get backup run statistics
ipcMain.handle('backup:get-stats', async () => {
  const db = getDatabase();
  return db.getBackupRunsStats();
});

// Get all backup runs
ipcMain.handle('backup:get-runs', async (_, limit?: number) => {
  const db = getDatabase();
  const query = limit 
    ? 'SELECT br.*, bj.name as job_name, b.name as bucket_name FROM backup_runs br LEFT JOIN backup_jobs bj ON br.job_id = bj.id LEFT JOIN buckets b ON br.bucket_id = b.id ORDER BY br.started_at DESC LIMIT ?'
    : 'SELECT br.*, bj.name as job_name, b.name as bucket_name FROM backup_runs br LEFT JOIN backup_jobs bj ON br.job_id = bj.id LEFT JOIN buckets b ON br.bucket_id = b.id ORDER BY br.started_at DESC';
  
  const stmt = db.db.prepare(query);
  const runs = limit ? stmt.all(limit) : stmt.all();
  
  // Helper function to recursively calculate directory size
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
  
  // Calculate and update sizes for runs that don't have them
  for (const run of runs) {
    if ((!run.total_size || run.total_size === 0) && run.backup_path && run.status === 'completed') {
      try {
        if (fs.existsSync(run.backup_path)) {
          const calculatedSize = getDirectorySize(run.backup_path);
          if (calculatedSize > 0) {
            // Update the database with the calculated size
            db.updateBackupRun(run.id, { total_size: calculatedSize });
            // Update the run object to return the correct size
            run.total_size = calculatedSize;
            console.log(`[Backup] Calculated and saved size for run ${run.id}: ${calculatedSize} bytes`);
          }
        }
      } catch (error) {
        console.error(`Failed to calculate size for backup run ${run.id}:`, error);
      }
    }
  }
  
  return runs;
});

// Get backup runs by job
ipcMain.handle('backup:get-runs-by-job', async (_, jobId: string, limit?: number) => {
  const db = getDatabase();
  return db.getBackupRunsByJob(jobId, limit);
});

// Helper function to calculate directory size recursively
function getDirectorySize(dirPath: string): number {
  let totalSize = 0;
  
  try {
    const files = fs.readdirSync(dirPath);
    
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        totalSize += getDirectorySize(filePath);
      } else {
        totalSize += stats.size;
      }
    }
  } catch (error) {
    console.error(`[Backup] Error calculating size for ${dirPath}:`, error);
  }
  
  return totalSize;
}

// Delete backup run
ipcMain.handle('backup:delete-run', async (_, id: number, deleteFiles: boolean = false) => {
  const db = getDatabase();
  
  try {
    // Get the backup run details first
    let run = db.getBackupRun(id);
    if (!run) {
      return { success: false, error: 'Backup run not found' };
    }
    
    // If the run has 0 size and backup_path exists, calculate actual size
    if (run.total_size === 0 && run.backup_path && fs.existsSync(run.backup_path)) {
      const actualSize = getDirectorySize(run.backup_path);
      if (actualSize > 0) {
        // Update the run with calculated size
        db.updateBackupRun(id, { total_size: actualSize });
        run.total_size = actualSize;
        console.log(`[Backup] Calculated size for backup run ${id}: ${actualSize} bytes`);
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
            console.log(`[Backup] Deleted backup files at: ${backupPath}`);
          } else {
            console.log(`[Backup] Backup path does not exist: ${backupPath}`);
          }
        } catch (error: any) {
          console.error(`[Backup] Failed to delete backup files: ${error.message}`);
          // Continue with database deletion even if file deletion fails
        }
      } else {
        console.log(`[Backup] No backup_path stored for run ${id}`);
      }
    }
    
    // Delete from database
    const success = db.deleteBackupRun(id);
    return { success };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Calculate and update backup run size
ipcMain.handle('backup:calculate-run-size', async (_, id: number) => {
  const db = getDatabase();
  
  try {
    // Get the backup run details
    const run = db.getBackupRun(id);
    if (!run) {
      return { success: false, error: 'Backup run not found' };
    }
    
    // Calculate actual size if backup_path exists
    if (run.backup_path && fs.existsSync(run.backup_path)) {
      const actualSize = getDirectorySize(run.backup_path);
      
      // Update the database with calculated size
      if (actualSize > 0) {
        db.updateBackupRun(id, { total_size: actualSize });
        console.log(`[Backup] Calculated size for backup run ${id}: ${actualSize} bytes`);
      }
      
      return { success: true, size: actualSize };
    }
    
    return { success: true, size: run.total_size || 0 };
  } catch (error: any) {
    console.error('[Backup] Failed to calculate run size:', error);
    return { success: false, error: error.message };
  }
});

// Get backup run directory size
ipcMain.handle('backup:get-run-size', async (_, jobId: string) => {
  const db = getDatabase();
  const backupDestination = db.getSetting('backup_destination');
  
  if (!backupDestination) {
    return 0;
  }
  
  const job = db.getBackupJob(jobId);
  if (!job) {
    return 0;
  }
  
  const backupPath = path.join(backupDestination, job.name);
  
  // Helper function to recursively calculate directory size
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
  
  try {
    if (fs.existsSync(backupPath)) {
      return getDirectorySize(backupPath);
    }
    return 0;
  } catch (error) {
    console.error(`Failed to calculate backup size for ${jobId}:`, error);
    return 0;
  }
});

// Get backup directory size
ipcMain.handle('backup:get-directory-size', async () => {
  const db = getDatabase();
  const backupDestination = db.getSetting('backup_destination');
  
  if (!backupDestination) {
    return 0;
  }
  
  // Helper function to recursively calculate directory size
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
          console.error(`Error getting stats for ${filePath}:`, err);
        }
      }
    } catch (err) {
      console.error(`Error reading directory ${dirPath}:`, err);
    }
    
    return totalSize;
  };
  
  try {
    const sizeInBytes = getDirectorySize(backupDestination);
    return sizeInBytes;
  } catch (error) {
    console.error('Failed to calculate directory size:', error);
    return 0;
  }
});

ipcMain.handle('backup:save-job', async (_, job) => {
  try {
    const db = getDatabase();
    const dbJob = {
      id: job.id,
      name: job.name,
      source_path: job.sourcePath,
      bucket_id: job.bucketId,
      schedule: job.schedule,
      schedule_metadata: job.scheduleMetadata ? JSON.stringify(job.scheduleMetadata) : undefined,
      retention_count: job.retentionCount,
      last_run: job.lastRun ? new Date(job.lastRun).toISOString() : undefined,
    };
    
    // Check if job exists
    const existing = db.getBackupJob(job.id);
    if (existing) {
      db.updateBackupJob(job.id, dbJob);
    } else {
      db.createBackupJob(dbJob);
    }
    
    // Update scheduler with new/updated job
    const fullJob = db.getBackupJob(job.id);
    if (fullJob) {
      backupScheduler.updateJob(fullJob);
    }

    // Update tray menu to reflect new/updated schedule
    updateTrayMenu();

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('backup:delete-job', async (_, id) => {
  try {
    const db = getDatabase();
    db.deleteBackupJob(id);

    // Remove from scheduler
    backupScheduler.unscheduleJob(id);

    // Update tray menu to remove deleted job from scheduled runs
    updateTrayMenu();

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// NOTE: backup:start and backup:stop handlers removed - all backups use WebSocket
// See src/server/websocket.ts handleBackupStart() for the actual implementation

ipcMain.handle('backup:list-files', async (_, path, bucketId) => {
  try {
    const db = getDatabase();
    
    // Get bucket configuration if bucketId is provided
    if (bucketId) {
      const bucket = db.getBucket(bucketId);
      if (bucket) {
        // Configure rclone with the specific bucket
        readOnlyHandler.setConfig({
          accessKeyId: bucket.access_key_id,
          secretAccessKey: bucket.secret_access_key,
          endpoint: bucket.endpoint,
          bucketName: bucket.bucket_name,
          region: bucket.region || 'auto'
        });
      }
    }

    const files = await readOnlyHandler.listFiles(path);
    return { success: true, files };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('backup:list-directories', async (_, dirPath, bucketId) => {
  try {
    const db = getDatabase();
    
    // If bucketId is provided, list from R2/S3
    if (bucketId) {
      const bucket = db.getBucket(bucketId);
      if (bucket) {
        // Configure rclone with the specific bucket
        readOnlyHandler.setConfig({
          accessKeyId: bucket.access_key_id,
          secretAccessKey: bucket.secret_access_key,
          endpoint: bucket.endpoint,
          bucketName: bucket.bucket_name,
          region: bucket.region || 'auto'
        });
      }
      const items = await readOnlyHandler.listDirectories(dirPath);
      return { success: true, items };
    } else {
      // List from local filesystem
      try {
        const items: { name: string; type: 'file' | 'folder'; size?: number }[] = [];
        
        // Check if directory exists
        if (!fs.existsSync(dirPath)) {
          console.log('[Local List] Directory does not exist:', dirPath);
          return { success: true, items: [] };
        }
        
        // Read directory contents
        const files = fs.readdirSync(dirPath);
        console.log('[Local List] Found', files.length, 'items in:', dirPath);
        
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
        
        console.log('[Local List] Returning', items.length, 'items');
        return { success: true, items };
      } catch (error: any) {
        console.error('[Local List] Error listing directory:', error);
        return { success: false, error: error.message };
      }
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// File Dialog
ipcMain.handle('dialog:select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  
  return result;
});

// Shell operations
ipcMain.handle('shell:open-path', async (_, path) => {
  try {
    await shell.openPath(path);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('shell:show-item-in-folder', async (_, path) => {
  try {
    shell.showItemInFolder(path);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('shell:open-external', async (_, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Settings
ipcMain.handle('settings:get', async () => {
  const db = getDatabase();
  return db.getAppSettings();
});

ipcMain.handle('settings:update', async (_, settings) => {
  try {
    const db = getDatabase();
    db.updateAppSettings(settings);

    // Apply auto-start setting immediately if changed (Electron only)
    if (settings.autoStart !== undefined && !isHeadlessMode) {
      app.setLoginItemSettings({
        openAtLogin: settings.autoStart,
        openAsHidden: false
      });
      console.log(`[App] Login item settings updated: openAtLogin=${settings.autoStart}`);
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('settings:get-rclone-path', async () => {
  const db = getDatabase();
  return db.getRclonePath();
});

ipcMain.handle('settings:set-rclone-path', async (_, path) => {
  try {
    const db = getDatabase();
    db.setRclonePath(path);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Backup destination settings
ipcMain.handle('settings:get-backup-destination', async () => {
  const db = getDatabase();
  return db.getSetting('backup_destination');
});

ipcMain.handle('settings:set-backup-destination', async (_, selectedPath) => {
  const db = getDatabase();

  // Only append R2Clone if the path doesn't already end with it
  let fullPath;
  if (selectedPath.endsWith('R2Clone') || selectedPath.endsWith('R2Clone/') || selectedPath.endsWith('R2Clone\\')) {
    fullPath = selectedPath.replace(/[/\\]+$/, ''); // Remove trailing slashes
  } else {
    fullPath = path.join(selectedPath, 'R2Clone');
  }

  db.setSetting('backup_destination', fullPath);
  return { success: true, path: fullPath };
});

// Helper function to get local IP address
function getLocalIPAddress(): string | null {
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

ipcMain.handle('settings:get-local-ip', async () => {
  return getLocalIPAddress();
});

ipcMain.handle('settings:get-home-directory', async () => {
  try {
    const homeDir = app.getPath('home');
    return { success: true, path: homeDir };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('settings:get-special-paths', async () => {
  try {
    return {
      success: true,
      paths: {
        home: app.getPath('home'),
        desktop: app.getPath('desktop'),
        documents: app.getPath('documents'),
        downloads: app.getPath('downloads'),
      }
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// HTTPS settings
ipcMain.handle('settings:get-https', async () => {
  try {
    const db = getDatabase();
    return {
      success: true,
      useHttps: db.getUseHttps(),
      httpsPort: db.getHttpsPort(),
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('settings:set-https', async (_, useHttps: boolean, httpsPort: number) => {
  try {
    const db = getDatabase();
    db.setUseHttps(useHttps);
    db.setHttpsPort(httpsPort);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Rclone Installation
ipcMain.handle('rclone:check-installed', async () => {
  try {
    // Use cached status (instant - no execSync calls!)
    const status = rcloneInstaller.getInstallStatus();
    return { success: true, ...status };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rclone:install', async () => {
  try {
    // Events are now forwarded via WebSocket (see websocket.ts)
    // No need to use event.sender.send() anymore

    // Set up complete handler to update database
    const completeHandler = (installedPath: string) => {
      const db = getDatabase();
      db.setRclonePath(installedPath);
      rcloneInstaller.off('complete', completeHandler);
    };

    rcloneInstaller.on('complete', completeHandler);

    await rcloneInstaller.install();
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rclone:uninstall', async () => {
  try {
    await rcloneInstaller.uninstall();
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// Auto-update IPC handlers
ipcMain.handle('app:check-for-updates', async () => {
  try {
    const manifest = await updateManager.checkForUpdates();
    if (manifest) {
      return { success: true, updateInfo: manifest };
    }
    return { success: true, updateInfo: null };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('app:get-version', async () => {
  return app.getVersion();
});

ipcMain.handle('app:quit', async () => {
  isQuitting = true;
  app.quit();
  return { success: true };
});

// Web server IPC handlers
ipcMain.handle('webserver:start', async (_, port: number) => {
  try {
    if (webServer) {
      await webServer.stop();
    }

    const db = getDatabase();
    const useHttps = db.getUseHttps();
    const httpsPort = db.getHttpsPort();

    webServer = new WebServer({
      port,
      httpsPort,
      distPath: path.join(__dirname, '../renderer'),
      rcloneHandler,
      backupScheduler,
      rcloneInstaller,
      updateManager,
      appUpdater,
      allowExternal: true, // When manually started, allow external access
      useHttps,
      onBackupsChanged: isHeadlessMode ? undefined : updateTrayMenu,
    });

    await webServer.start();

    db.setSetting('web_server_enabled', 'true');
    db.setSetting('web_server_port', port.toString());

    return { success: true, port };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('webserver:stop', async () => {
  try {
    const db = getDatabase();
    const currentPort = parseInt(db.getSetting('web_server_port') || '3000');

    // Don't actually stop the server, just disable external access
    // Restart it with localhost-only binding
    if (webServer) {
      await webServer.stop();
    }

    const useHttps = db.getUseHttps();
    const httpsPort = db.getHttpsPort();

    webServer = new WebServer({
      port: currentPort,
      httpsPort,
      distPath: path.join(__dirname, '../renderer'),
      rcloneHandler,
      backupScheduler,
      rcloneInstaller,
      updateManager,
      appUpdater,
      allowExternal: false, // Localhost only
      useHttps,
      onBackupsChanged: isHeadlessMode ? undefined : updateTrayMenu,
    });

    await webServer.start();

    db.setSetting('web_server_enabled', 'false');

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('webserver:status', async () => {
  const db = getDatabase();
  const enabled = db.getSetting('web_server_enabled') === 'true';
  const httpPort = parseInt(db.getSetting('web_server_port') || '3000');
  const useHttps = db.getUseHttps();
  const httpsPort = db.getHttpsPort();

  // Both HTTP and HTTPS now use the same port
  const port = httpPort;

  return {
    enabled,
    port,
    useHttps,
    httpPort,
    httpsPort,
    running: webServer !== null,
  };
});

// Scheduler IPC handlers
ipcMain.handle('scheduler:get-next-run', async (_, jobId: string) => {
  const nextRun = backupScheduler.getNextRun(jobId);
  return nextRun ? nextRun.toISOString() : null;
});

ipcMain.handle('scheduler:get-all-scheduled', async () => {
  return backupScheduler.getScheduledJobs();
});

ipcMain.handle('scheduler:trigger-backup', async (_, jobId: string) => {
  try {
    if (webServer) {
      return await webServer.startBackup(jobId);
    } else {
      return { success: false, error: 'Web server not initialized' };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('scheduler:get-status', async () => {
  return {
    isRunning: backupScheduler.getIsRunning(),
    activeBackupId: backupScheduler.getActiveBackupId()
  };
});

// Listen to scheduler events and forward to renderer
backupScheduler.on('started', (data) => {
  // Update tray menu (GUI mode only)
  if (!isHeadlessMode) {
    updateTrayMenu();

    // Show notification
    new Notification({
      title: 'Backup Started',
      body: `Scheduled backup "${data.jobName}" has started.`
    }).show();
  } else {
    // Console logging for headless mode
    console.log(`[Scheduler] ✨ Backup started: ${data.jobName}`);
  }

  // Forward to renderer
  BrowserWindow.getAllWindows().forEach(window => {
    window.webContents.send('scheduler:backup-started', data);
  });
});

backupScheduler.on('completed', (data) => {
  // Update tray menu (GUI mode only)
  if (!isHeadlessMode) {
    updateTrayMenu();

    // Show notification
    new Notification({
      title: 'Backup Completed',
      body: `Backup completed successfully. ${data.filesTransferred} files transferred.`
    }).show();
  } else {
    // Console logging for headless mode
    console.log(`[Scheduler] ✅ Backup completed: ${data.filesTransferred} files transferred`);
  }

  // Forward to renderer
  BrowserWindow.getAllWindows().forEach(window => {
    window.webContents.send('scheduler:backup-completed', data);
  });
});

backupScheduler.on('error', (data) => {
  // Update tray menu (GUI mode only)
  if (!isHeadlessMode) {
    updateTrayMenu();

    // Show notification
    new Notification({
      title: 'Backup Failed',
      body: `Backup failed: ${data.error}`
    }).show();
  } else {
    // Console logging for headless mode
    console.error(`[Scheduler] ❌ Backup failed: ${data.error}`);
  }

  // Forward to renderer
  BrowserWindow.getAllWindows().forEach(window => {
    window.webContents.send('scheduler:backup-error', data);
  });
});

backupScheduler.on('skipped', (data) => {
  // Update tray menu (GUI mode only)
  if (!isHeadlessMode) {
    updateTrayMenu();
  }

  // Forward to renderer
  BrowserWindow.getAllWindows().forEach(window => {
    window.webContents.send('scheduler:backup-skipped', data);
  });
});

// Graceful shutdown handlers (for headless mode)
const gracefulShutdown = async (signal: string) => {
  console.log(`\n[Main] Received ${signal}, shutting down gracefully...`);

  try {
    // Stop web server
    if (webServer) {
      await webServer.stop();
      console.log('[Main] Web server stopped');
    }

    // Stop scheduler
    backupScheduler.stop();
    console.log('[Main] Backup scheduler stopped');

    // Close database
    const db = getDatabase();
    db.close();
    console.log('[Main] Database closed');

    console.log('[Main] Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('[Main] Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
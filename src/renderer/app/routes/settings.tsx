import { useState, useEffect, useMemo, useRef } from 'react';
import { useLoaderData, useSearchParams, useBlocker } from 'react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Button } from '~/components/ui/button';
import { Label } from '~/components/ui/label';
import { Input } from '~/components/ui/input';
import { Switch } from '~/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '~/components/ui/tabs';
import { Slider } from '~/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Bell, Rocket, Cloud, TestTube, Terminal, CheckCircle, CircleCheckIcon, XCircle, Loader2, Download, Package, AlertCircle, Settings2, Sun, Moon, Monitor, Plus, Edit2, Trash2, FolderOpen, Server, Copy, RefreshCw, TriangleAlert } from 'lucide-react';
import type { R2Config, R2Bucket, AppSettings, RcloneInstallProgress } from '~/types';
import BucketConfigDialog from '~/components/BucketConfigDialog';
import DeleteBackupRunDialog from '~/components/DeleteBackupRunDialog';
import LocalDirectoryPicker from '~/components/LocalDirectoryPicker';
import { updateCachedPort, apiClient, isElectron } from '~/lib/api-client';
import { toast } from 'sonner';


// Loader function to fetch all settings data before rendering
export async function loader() {
  try {
    const [settings, buckets, rcloneStatus, rclonePath, backupDestination, webServerStatus] = await Promise.all([
      window.electronAPI.settings.get(),
      window.electronAPI.r2.getAllBuckets(),
      window.electronAPI.rclone.checkInstalled(),
      window.electronAPI.settings.getRclonePath(),
      window.electronAPI.settings.getBackupDestination(),
      window.electronAPI.webserver.getStatus()
    ]);

    return {
      appSettings: settings || {
        theme: 'system',
        autoStart: false,
        notifications: true,
        maxConcurrentTransfers: 20,
      },
      buckets: buckets || [],
      rcloneInstalled: rcloneStatus?.isInstalled ?? null,
      rcloneVersion: rcloneStatus?.version ?? null,
      rclonePath: rclonePath || 'rclone',
      backupDestination: backupDestination || null,
      webServerStatus: webServerStatus || { enabled: false, port: 3000, running: false }
    };
  } catch (error) {
    console.error('Failed to load settings:', error);
    // Return defaults on error
    return {
      appSettings: {
        theme: 'system',
        autoStart: false,
        notifications: true,
        maxConcurrentTransfers: 20,
      },
      buckets: [],
      rcloneInstalled: null,
      rcloneVersion: null,
      rclonePath: 'rclone',
      backupDestination: null,
      webServerStatus: { enabled: false, port: 3000, running: false }
    };
  }
}

export default function Settings() {
  const loaderData = useLoaderData() as Awaited<ReturnType<typeof loader>>;
  const [searchParams] = useSearchParams();

  // Validate tab parameter - fallback to 'r2' if invalid
  const requestedTab = searchParams.get('tab') || 'r2';
  const validTabs = ['r2', 'preferences'];
  // Add 'server' tab only in Electron mode
  if (typeof window.electronAPI?.versions?.electron !== 'undefined') {
    validTabs.push('server');
  }
  const defaultTab = validTabs.includes(requestedTab) ? requestedTab : 'r2';

  // Separate theme state (applies immediately, doesn't need save button)
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark' | 'system'>(loaderData.appSettings.theme);

  const [appSettings, setAppSettings] = useState<AppSettings>(loaderData.appSettings);
  const [originalAppSettings, setOriginalAppSettings] = useState<AppSettings>(loaderData.appSettings);
  const [buckets, setBuckets] = useState<R2Bucket[]>(loaderData.buckets);
  const [rclonePath, setRclonePath] = useState(loaderData.rclonePath);
  const [backupDestination, setBackupDestination] = useState<string | null>(loaderData.backupDestination);
  const [originalBackupDestination, setOriginalBackupDestination] = useState<string | null>(loaderData.backupDestination);
  const [isSaving, setIsSaving] = useState(false);
  const [bucketDialogOpen, setBucketDialogOpen] = useState(false);
  const [editingBucket, setEditingBucket] = useState<R2Bucket | undefined>();
  const [bucketInitialData, setBucketInitialData] = useState<Partial<Omit<R2Bucket, 'id' | 'createdAt' | 'updatedAt'>> | undefined>();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [bucketToDelete, setBucketToDelete] = useState<R2Bucket | null>(null);
  const [testConnectionDialogOpen, setTestConnectionDialogOpen] = useState(false);
  const [testConnectionResult, setTestConnectionResult] = useState<{status: 'testing' | 'success' | 'error', message: string} | null>(null);
  const [testingBucket, setTestingBucket] = useState<R2Bucket | null>(null);

  // Rclone installation state
  const [rcloneInstalled, setRcloneInstalled] = useState<boolean | null>(loaderData.rcloneInstalled);
  const [rcloneVersion, setRcloneVersion] = useState<string | null>(loaderData.rcloneVersion);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installStatus, setInstallStatus] = useState('');
  const [installProgress, setInstallProgress] = useState<RcloneInstallProgress | null>(null);

  // Web server state (pending changes)
  const [webServerEnabled, setWebServerEnabled] = useState(loaderData.webServerStatus.enabled);
  const [webServerPort, setWebServerPort] = useState(loaderData.webServerStatus.port);
  const [webServerRunning, setWebServerRunning] = useState(loaderData.webServerStatus.running);
  const [useHttps, setUseHttps] = useState(loaderData.webServerStatus.useHttps !== undefined ? loaderData.webServerStatus.useHttps : true);
  const [httpsPort, setHttpsPort] = useState(loaderData.webServerStatus.httpsPort || 3001);
  const [localIPAddress, setLocalIPAddress] = useState<string | null>(null);

  // Web server saved state (what's currently applied)
  const [savedWebServerEnabled, setSavedWebServerEnabled] = useState(loaderData.webServerStatus.enabled);
  const [savedWebServerPort, setSavedWebServerPort] = useState(loaderData.webServerStatus.port);
  const [savedUseHttps, setSavedUseHttps] = useState(loaderData.webServerStatus.useHttps !== undefined ? loaderData.webServerStatus.useHttps : true);
  const [savedHttpsPort, setSavedHttpsPort] = useState(loaderData.webServerStatus.httpsPort || 3001);

  // Local directory picker state
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);

  // Docker mode state
  const [isDockerMode, setIsDockerMode] = useState(false);
  const [dockerLocationDialogOpen, setDockerLocationDialogOpen] = useState(false);

  // System Time state
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [selectedTimezone, setSelectedTimezone] = useState<string>('America/New_York');
  const [timeDrift, setTimeDrift] = useState<number | null>(null);
  const [syncingTime, setSyncingTime] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSuccess, setSyncSuccess] = useState<string | null>(null);

  // Counter to force icon remount for shake animation
  const [shakeKey, setShakeKey] = useState(0);

  // Detect if there are pending changes (excluding theme)
  const hasPendingChanges = useMemo(() => {
    // Check if app settings changed (excluding theme since it applies immediately)
    const { theme: _currentTheme, ...currentSettings } = appSettings;
    const { theme: _originalTheme, ...originalSettings } = originalAppSettings;
    const settingsChanged = JSON.stringify(currentSettings) !== JSON.stringify(originalSettings);

    // Check if server settings changed
    const serverSettingsChanged =
      webServerEnabled !== savedWebServerEnabled ||
      webServerPort !== savedWebServerPort ||
      useHttps !== savedUseHttps ||
      httpsPort !== savedHttpsPort;

    // Check if backup destination changed
    const backupDestinationChanged = backupDestination !== originalBackupDestination;

    return settingsChanged || serverSettingsChanged || backupDestinationChanged;
  }, [appSettings, originalAppSettings, webServerEnabled, savedWebServerEnabled, webServerPort, savedWebServerPort, useHttps, savedUseHttps, httpsPort, savedHttpsPort, backupDestination, originalBackupDestination]);

  // Block navigation when there are unsaved changes
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasPendingChanges && currentLocation.pathname !== nextLocation.pathname
  );

  // Trigger shake animation when navigation is blocked
  useEffect(() => {
    if (blocker.state === 'blocked') {
      // Reset the blocker to keep user on page
      blocker.reset();

      // Increment key to force icon remount
      const currentShakeKey = Date.now();
      setShakeKey(currentShakeKey);

      // Update toast with shake animation (same ID keeps it in place)
      toast.warning(<UnsavedChangesToast withShake={true} shakeKey={currentShakeKey} />, {
        id: 'unsaved-changes',
        duration: Infinity,
        closeButton: false,
        icon: <TriangleAlert key={currentShakeKey} className="animate-shake" />,
        classNames: {
          toast: '!bg-yellow-50 !text-yellow-900 !border-yellow-200 dark:!bg-yellow-50 dark:!text-yellow-900 dark:!border-yellow-200',
          icon: '!text-yellow-600 dark:!text-yellow-600',
        },
      });

      // After animation completes, update back to regular toast
      setTimeout(() => {
        toast.warning(<UnsavedChangesToast withShake={false} />, {
          id: 'unsaved-changes',
          duration: Infinity,
          closeButton: false,
          icon: <TriangleAlert />,
          classNames: {
            toast: '!bg-yellow-50 !text-yellow-900 !border-yellow-200 dark:!bg-yellow-50 dark:!text-yellow-900 dark:!border-yellow-200',
            icon: '!text-yellow-600 dark:!text-yellow-600',
          },
        });
      }, 500);
    }
  }, [blocker]);

  // Prevent browser tab/window close when there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasPendingChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasPendingChanges]);

  useEffect(() => {
    // Check if running in Docker mode (only relevant for browser clients)
    if (!isElectron()) {
      apiClient.app.getStatus().then((status) => {
        setIsDockerMode(status.isDocker);
      });
    }

    // Set up installation event listeners
    window.electronAPI.rclone.onInstallStatus(setInstallStatus);
    window.electronAPI.rclone.onInstallProgress(setInstallProgress);
    window.electronAPI.rclone.onInstallError((error) => {
      setInstallStatus(`Error: ${error}`);
      setIsInstalling(false);
    });
    window.electronAPI.rclone.onInstallComplete((path) => {
      setRclonePath(path);
      setIsInstalling(false);
      checkRcloneInstallation();
    });


    return () => {
      window.electronAPI.rclone.removeInstallListeners();
    };
  }, []);

  // Update clock every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Load timezone on mount
  useEffect(() => {
    const loadTimezone = async () => {
      try {
        const tz = await apiClient.settings.getTimezone();
        setSelectedTimezone(tz);
      } catch (error) {
        console.error('Failed to load timezone:', error);
      }
    };

    loadTimezone();
  }, []);

  // Check time drift on mount
  useEffect(() => {
    const checkTimeDrift = async () => {
      try {
        const [systemTime, cloudflareTime] = await Promise.all([
          apiClient.system.getSystemTime(),
          apiClient.system.getCloudflareTime(),
        ]);

        const systemDate = new Date(systemTime);
        const cloudflareDate = new Date(cloudflareTime);
        const driftMs = systemDate.getTime() - cloudflareDate.getTime();

        setTimeDrift(driftMs);
      } catch (error) {
        console.error('Failed to check time drift:', error);
      }
    };

    checkTimeDrift();
  }, []);

  // Fetch local IP address on mount
  useEffect(() => {
    const fetchLocalIP = async () => {
      try {
        const ip = await apiClient.settings.getLocalIP();
        setLocalIPAddress(ip);
      } catch (error) {
        console.error('Failed to fetch local IP:', error);
      }
    };

    fetchLocalIP();
  }, []);

  // Keep theme in sync when changed externally (e.g., from nav toggle)
  useEffect(() => {
    const syncTheme = async () => {
      try {
        const settings = await window.electronAPI.settings.get();
        if (settings?.theme && settings.theme !== currentTheme) {
          setCurrentTheme(settings.theme);
        }
      } catch (error) {
        console.error('Failed to sync theme:', error);
      }
    };

    // Check for theme changes periodically while on settings page
    const interval = setInterval(syncTheme, 1000);
    return () => clearInterval(interval);
  }, [currentTheme]);

  // Toast content component with optional shake animation
  const UnsavedChangesToast = ({ withShake, shakeKey }: { withShake: boolean; shakeKey?: number }) => {
    return (
      <div key={shakeKey} className={`flex items-center justify-between w-full gap-4 ${withShake ? 'animate-shake' : ''}`}>
        <span>You have unsaved changes</span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              handleDiscard();
            }}
            disabled={isSaving}
            className="dark:!bg-white dark:!text-black dark:!border-gray-300 dark:hover:!bg-gray-100"
          >
            Discard
          </Button>
          <Button
            size="sm"
            onClick={() => {
              handleSave();
            }}
            disabled={isSaving}
            className="dark:!bg-black dark:!text-white dark:hover:!bg-gray-900"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </Button>
        </div>
      </div>
    );
  };

  // Show/hide toast based on pending changes
  useEffect(() => {
    if (hasPendingChanges) {
      toast.warning(<UnsavedChangesToast withShake={false} />, {
        id: 'unsaved-changes',
        duration: Infinity,
        closeButton: false,
        classNames: {
          toast: '!bg-yellow-50 !text-yellow-900 !border-yellow-200 dark:!bg-yellow-50 dark:!text-yellow-900 dark:!border-yellow-200',
          icon: '!text-yellow-600 dark:!text-yellow-600',
        },
      });
    } else {
      toast.dismiss('unsaved-changes');
    }
  }, [hasPendingChanges, isSaving]);

  const checkRcloneInstallation = async () => {
    try {
      const result = await window.electronAPI.rclone.checkInstalled();
      console.log('Rclone check result:', result);
      if (result.success && result.isInstalled !== undefined) {
        setRcloneInstalled(result.isInstalled);
        setRcloneVersion(result.version || null);
        if (result.path) {
          setRclonePath(result.path);
        }
      }
    } catch (error) {
      console.error('Failed to check rclone installation:', error);
    }
  };
  
  const handleInstallRclone = async () => {
    setIsInstalling(true);
    setInstallStatus('Starting installation...');
    setInstallProgress(null);
    
    try {
      await window.electronAPI.rclone.install();
    } catch (error: any) {
      setInstallStatus(`Installation failed: ${error.message}`);
      setIsInstalling(false);
    }
  };
  


  const loadBuckets = async () => {
    const freshBuckets = await window.electronAPI.r2.getAllBuckets();
    setBuckets(freshBuckets);
  };

  const handleCreateBucket = async (bucketData: Omit<R2Bucket, 'id' | 'createdAt' | 'updatedAt'>) => {
    const result = await window.electronAPI.r2.createBucket(bucketData);
    if (result.success) {
      await loadBuckets();
      toast.success('Bucket created successfully!');
    }
  };

  const handleUpdateBucket = async (bucketData: Omit<R2Bucket, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (!editingBucket?.id) return;

    const result = await window.electronAPI.r2.updateBucket(editingBucket.id, bucketData);
    if (result.success) {
      await loadBuckets();
      toast.success('Bucket updated successfully!');
    }
  };

  const handleDeleteBucket = async (bucket: R2Bucket) => {
    setBucketToDelete(bucket);
    setDeleteDialogOpen(true);
  };

  const handleDuplicateBucket = (bucket: R2Bucket) => {
    // Pre-fill credentials but leave name/bucketName empty
    // Note: secretAccessKey is not returned from API for security, will show placeholder in dialog
    setBucketInitialData({
      accessKeyId: bucket.accessKeyId,
      secretAccessKey: bucket.secretAccessKey, // Will be undefined, dialog shows placeholder
      endpoint: bucket.endpoint,
      region: bucket.region,
    });
    setEditingBucket(undefined); // Trigger "Add New Bucket" mode
    setBucketDialogOpen(true);
  };


  const handleTestBucketConnection = async (bucket: R2Bucket) => {
    setTestingBucket(bucket);
    setTestConnectionDialogOpen(true);
    setTestConnectionResult({ status: 'testing', message: 'Testing connection...' });

    try {
      const result = await window.electronAPI.r2.testBucketConnection(bucket.id!);

      if (result.success) {
        setTestConnectionResult({ status: 'success', message: 'Your R2 bucket is properly configured.' });
      } else {
        setTestConnectionResult({ status: 'error', message: result.error || 'Connection failed' });
      }
    } catch (error: any) {
      setTestConnectionResult({ status: 'error', message: error.message || 'Connection test failed' });
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Save app settings (theme is already saved immediately)
      const settingsToSave = { ...appSettings, theme: currentTheme };
      await window.electronAPI.settings.update(settingsToSave);

      // Save HTTPS settings if they changed (Electron only)
      if (isElectron() && (useHttps !== savedUseHttps || httpsPort !== savedHttpsPort)) {
        console.log('[Settings] Saving HTTPS settings...');
        await window.electronAPI.settings.setHttps(useHttps, httpsPort);
        setSavedUseHttps(useHttps);
        setSavedHttpsPort(httpsPort);
      }

      // Apply web server settings if they changed (Electron only)
      if (isElectron() && (webServerEnabled !== savedWebServerEnabled || webServerPort !== savedWebServerPort || useHttps !== savedUseHttps || httpsPort !== savedHttpsPort)) {
        console.log('[Settings] Applying web server changes...');

        // Stop current server first if running
        if (webServerRunning) {
          await window.electronAPI.webserver.stop();
          setWebServerRunning(false);
        }

        // Start server with new settings if enabled
        if (webServerEnabled) {
          const result = await window.electronAPI.webserver.start(webServerPort);
          if (result.success) {
            setWebServerRunning(true);
            await updateCachedPort();
            console.log(`[Settings] Server started on port ${webServerPort}`);
          } else {
            console.error('[Settings] Failed to start server:', result.error);
            setWebServerRunning(false);
          }
        }

        // Update saved state to match what was applied
        setSavedWebServerEnabled(webServerEnabled);
        setSavedWebServerPort(webServerPort);
      }

      // Save backup destination if changed
      if (backupDestination !== originalBackupDestination && backupDestination) {
        const result = await apiClient.settings.setBackupDestination(backupDestination);
        if (result.success) {
          // Update both states to the path returned by backend (which has R2Clone appended)
          setBackupDestination(result.path);
          setOriginalBackupDestination(result.path);
        } else {
          throw new Error('Failed to save backup location');
        }
      }

      // Update original state to mark as saved (sync theme to match current)
      setOriginalAppSettings({ ...appSettings, theme: currentTheme });

      toast.success('Settings saved successfully!');
    } catch (error: any) {
      toast.error('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = () => {
    // Reset app settings to original
    setAppSettings(originalAppSettings);

    // Reset web server settings to saved state
    setWebServerEnabled(savedWebServerEnabled);
    setWebServerPort(savedWebServerPort);
    setUseHttps(savedUseHttps);
    setHttpsPort(savedHttpsPort);

    // Reset backup destination to original
    setBackupDestination(originalBackupDestination);

    // Theme doesn't need to be reset since it's always in sync with current state
  };

  const handleThemeChange = async (theme: 'light' | 'dark' | 'system') => {
    // Update local state
    setCurrentTheme(theme);

    // Apply theme to DOM immediately
    const root = document.documentElement;
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
    } else {
      root.classList.toggle('dark', theme === 'dark');
    }

    // Save to backend immediately
    try {
      const settings = await window.electronAPI.settings.get();
      await window.electronAPI.settings.update({ ...settings, theme });
    } catch (error) {
      console.error('Failed to save theme:', error);
    }
  };

  const handleTimezoneChange = async (timezone: string) => {
    try {
      await apiClient.settings.setTimezone(timezone);
      setSelectedTimezone(timezone);
    } catch (error) {
      console.error('Failed to save timezone:', error);
    }
  };

  const handleSyncTime = async () => {
    setSyncingTime(true);
    setSyncError(null);
    setSyncSuccess(null);

    try {
      const result = await apiClient.system.syncTime();

      if (result.success) {
        setSyncSuccess('Time synchronized successfully');
        setTimeDrift(0);

        // Clear success message after 5 seconds
        setTimeout(() => setSyncSuccess(null), 5000);
      } else {
        setSyncError(result.error || 'Failed to sync time');
      }
    } catch (error: any) {
      setSyncError(error.message || 'Failed to sync time');
    } finally {
      setSyncingTime(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-[#1a1a1a] pb-4">
        <h1 className="text-3xl font-bold tracking-tight mb-4 text-foreground">Settings</h1>
      </div>
        
      <Tabs defaultValue={defaultTab} className="flex-1">
        <div className="flex items-center justify-between mb-6">
          <TabsList className={`grid w-full ${typeof window.electronAPI?.versions?.electron !== 'undefined' ? 'max-w-md grid-cols-3' : 'max-w-sm grid-cols-2'}`}>
            <TabsTrigger value="r2" className="gap-2">
              <Cloud className="h-4 w-4" />
              R2 Storage
            </TabsTrigger>
            <TabsTrigger value="preferences" className="gap-2">
              <Settings2 className="h-4 w-4" />
              Preferences
            </TabsTrigger>
            {typeof window.electronAPI?.versions?.electron !== 'undefined' && (
              <TabsTrigger value="server" className="gap-2">
                <Server className="h-4 w-4" />
                Server
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="r2" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>R2 Buckets</CardTitle>
                  <CardDescription>
                    Manage your Cloudflare R2 bucket configurations
                  </CardDescription>
                </div>
                <Button onClick={() => {
                  setEditingBucket(undefined);
                  setBucketInitialData(undefined);
                  setBucketDialogOpen(true);
                }} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add Bucket
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {buckets.length === 0 ? (
                <div className="text-center py-12">
                  <Cloud className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No buckets configured</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Add your first R2 bucket to get started with backups
                  </p>
                  <Button onClick={() => {
                    setEditingBucket(undefined);
                    setBucketInitialData(undefined);
                    setBucketDialogOpen(true);
                  }} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Add Your First Bucket
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {buckets.map((bucket) => (
                    <div key={bucket.id} className="p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1 flex-wrap">
                            <h4 className="font-medium">{bucket.name}</h4>
                          </div>
                          <div className="text-sm text-muted-foreground space-y-0.5">
                            <div className="truncate">Bucket: {bucket.bucketName}</div>
                            <div className="truncate">Endpoint: {bucket.endpoint}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleTestBucketConnection(bucket)}
                          >
                            Test Connection
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingBucket(bucket);
                              setBucketInitialData(undefined);
                              setBucketDialogOpen(true);
                            }}
                            title="Edit bucket"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDuplicateBucket(bucket)}
                            title="Duplicate bucket"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDeleteBucket(bucket)}
                            className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                            title="Delete bucket"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <BucketConfigDialog
            open={bucketDialogOpen}
            onOpenChange={setBucketDialogOpen}
            bucket={editingBucket}
            initialData={bucketInitialData}
            onSave={editingBucket ? handleUpdateBucket : handleCreateBucket}
          />
        </TabsContent>

        <TabsContent value="preferences">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Left Column */}
            <div className="space-y-4">
              {/* Rclone Configuration - Compact */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Terminal className="h-4 w-4" />
                    Rclone Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Status and Install Section */}
                  <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                    <div className="flex items-center gap-3">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <span className="text-sm font-medium">Status:</span>
                        {rcloneInstalled === null ? (
                          <span className="text-sm text-muted-foreground ml-2">Checking...</span>
                        ) : rcloneInstalled ? (
                          <span className="text-sm text-green-600 dark:text-green-400 ml-2">
                            Installed {rcloneVersion && `(v${rcloneVersion})`}
                          </span>
                        ) : (
                          <span className="text-sm text-yellow-600 dark:text-yellow-400 ml-2">Not Installed</span>
                        )}
                      </div>
                    </div>
                    
                    {!rcloneInstalled && !isInstalling && (
                      <Button 
                        onClick={handleInstallRclone}
                        size="sm"
                        variant="outline"
                      >
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                        Install
                      </Button>
                    )}
                  </div>
                  
                  {/* Installation Progress */}
                  {isInstalling && (
                    <div className="p-3 rounded-lg border space-y-2">
                      <div className="text-sm text-muted-foreground">{installStatus}</div>
                      {installProgress && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="capitalize">{installProgress.stage}</span>
                            <span>{installProgress.progress}%</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-1.5">
                            <div
                              className="bg-primary rounded-full h-1.5 transition-all duration-300"
                              style={{ width: `${installProgress.progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Transfer Settings Section */}
                  <div className="space-y-3 pt-3 border-t">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="concurrent-transfers" className="text-sm font-medium">Concurrent Transfers</Label>
                        <span className="text-sm font-medium text-muted-foreground">{appSettings.maxConcurrentTransfers || 20}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Number of simultaneous file transfers. More transfers will make downloads faster but will be more CPU and network intensive.
                      </p>
                    </div>
                    <Slider
                      id="concurrent-transfers"
                      min={1}
                      max={64}
                      step={1}
                      value={[appSettings.maxConcurrentTransfers || 20]}
                      onValueChange={(values) => setAppSettings({...appSettings, maxConcurrentTransfers: values[0]})}
                      className="w-full"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FolderOpen className="h-4 w-4" />
                    Backup Location
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex flex-col gap-2">
                      <div className="px-3 py-1.5 h-8 text-sm bg-muted rounded-md flex items-center overflow-hidden">
                        <span className={`truncate ${backupDestination ? '' : 'text-muted-foreground'}`}>
                          {backupDestination || 'Not set'}
                        </span>
                      </div>
                      <Button
                        onClick={() => {
                          if (isDockerMode) {
                            setDockerLocationDialogOpen(true);
                          } else {
                            setDirectoryPickerOpen(true);
                          }
                        }}
                        size="sm"
                        variant="outline"
                        className="w-full"
                      >
                        <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                        Choose Location
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Backups are stored in a folder called "R2Clone" at this location
                    </p>
                  </div>
                </CardContent>
              </Card>

            </div>

            {/* Right Column */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">General Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Appearance Section */}
                  <div className="space-y-3 pb-3 border-b">
                    <Label className="text-sm font-medium">Appearance</Label>
                    <div className="flex gap-2">
                      <Button
                        variant={currentTheme === 'light' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleThemeChange('light')}
                        className="flex-1 h-8 text-xs justify-center"
                      >
                        <Sun className="h-3.5 w-3.5 mr-2" />
                        Light
                      </Button>
                      <Button
                        variant={currentTheme === 'dark' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleThemeChange('dark')}
                        className="flex-1 h-8 text-xs justify-center"
                      >
                        <Moon className="h-3.5 w-3.5 mr-2" />
                        Dark
                      </Button>
                      <Button
                        variant={currentTheme === 'system' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleThemeChange('system')}
                        className="flex-1 h-8 text-xs justify-center"
                      >
                        <Monitor className="h-3.5 w-3.5 mr-2" />
                        System
                      </Button>
                    </div>
                  </div>

                  {/* Startup Section - Electron only */}
                  {isElectron() ? (
                    <div className="flex items-center justify-between pb-3 border-b">
                      <div className="space-y-0.5">
                        <Label htmlFor="autostart" className="text-sm font-medium">Launch at startup</Label>
                        <p className="text-xs text-muted-foreground">
                          Start app when computer boots
                        </p>
                      </div>
                      <Switch
                        id="autostart"
                        checked={appSettings.autoStart}
                        onCheckedChange={(checked) => setAppSettings({...appSettings, autoStart: checked})}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between pb-3 border-b opacity-60">
                      <div className="space-y-0.5">
                        <Label htmlFor="autostart-disabled" className="text-sm font-medium">Launch at startup</Label>
                        <p className="text-xs text-muted-foreground">
                          Docker manages application startup automatically
                        </p>
                      </div>
                      <Switch
                        id="autostart-disabled"
                        checked={true}
                        disabled={true}
                      />
                    </div>
                  )}

                  {/* Notifications Section */}
                  <div className="flex items-center justify-between pb-3 border-b">
                    <div className="space-y-0.5">
                      <Label htmlFor="notifications" className="text-sm font-medium">Enable notifications</Label>
                      <p className="text-xs text-muted-foreground">
                        Receive alerts and updates
                      </p>
                    </div>
                    <Switch
                      id="notifications"
                      checked={appSettings.notifications}
                      onCheckedChange={(checked) => setAppSettings({...appSettings, notifications: checked})}
                    />
                  </div>

                  {/* System Time Section */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">System Time</Label>

                    {/* Current Time Display */}
                    <div className="space-y-2">
                      <div className="text-sm font-mono">
                        {currentTime.toLocaleString('en-US', {
                          timeZone: selectedTimezone,
                          dateStyle: 'medium',
                          timeStyle: 'medium',
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Timezone: {selectedTimezone}
                      </p>
                    </div>

                    {/* Time Drift Warning */}
                    {timeDrift !== null && Math.abs(timeDrift) > 60000 && (
                      <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                              Time Drift Detected
                            </p>
                            <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                              System time is {Math.abs(timeDrift / 1000).toFixed(0)} seconds {timeDrift > 0 ? 'ahead' : 'behind'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Timezone Selector */}
                    <div className="space-y-2">
                      <Select value={selectedTimezone} onValueChange={handleTimezoneChange}>
                        <SelectTrigger id="timezone" className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="America/New_York">Eastern (US)</SelectItem>
                          <SelectItem value="America/Chicago">Central (US)</SelectItem>
                          <SelectItem value="America/Denver">Mountain (US)</SelectItem>
                          <SelectItem value="America/Los_Angeles">Pacific (US)</SelectItem>
                          <SelectItem value="America/Anchorage">Alaska (US)</SelectItem>
                          <SelectItem value="Pacific/Honolulu">Hawaii (US)</SelectItem>
                          <SelectItem value="Europe/London">London (UK)</SelectItem>
                          <SelectItem value="Europe/Paris">Paris (FR)</SelectItem>
                          <SelectItem value="Europe/Berlin">Berlin (DE)</SelectItem>
                          <SelectItem value="Asia/Tokyo">Tokyo (JP)</SelectItem>
                          <SelectItem value="Asia/Shanghai">Shanghai (CN)</SelectItem>
                          <SelectItem value="Asia/Dubai">Dubai (AE)</SelectItem>
                          <SelectItem value="Australia/Sydney">Sydney (AU)</SelectItem>
                          <SelectItem value="UTC">UTC</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        This affects how times are displayed in the application
                      </p>
                    </div>

                    {/* Sync Time Button (Docker only) */}
                    {isDockerMode && (
                      <div className="space-y-2">
                        <Button
                          onClick={handleSyncTime}
                          disabled={syncingTime}
                          size="sm"
                          className="w-full h-9"
                        >
                          {syncingTime ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Syncing...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="h-4 w-4 mr-2" />
                              Sync with Time Server
                            </>
                          )}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          Synchronize system time with time server
                        </p>

                        {/* Success Message */}
                        {syncSuccess && (
                          <div className="p-2 rounded-md bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-sm">
                            {syncSuccess}
                          </div>
                        )}

                        {/* Error Message */}
                        {syncError && (
                          <div className="p-2 rounded-md bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
                            {syncError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Server Tab - Only show in Electron mode */}
        {typeof window.electronAPI?.versions?.electron !== 'undefined' && (
          <TabsContent value="server">
            <Card>
              <CardHeader>
                <CardTitle>Web Server</CardTitle>
                <CardDescription>
                  The web server allows you to access R2Clone from a web browser on the same network. This is useful for headless systems or when you want to manage backups remotely from another device on your network.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Enable HTTPS Toggle */}
                <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                  <div className="flex flex-col gap-1">
                    <Label className="text-sm font-medium">Use HTTPS</Label>
                    <p className="text-xs text-muted-foreground">
                      {useHttps
                        ? 'Encrypted connection using self-signed certificate'
                        : 'Unencrypted HTTP connection'}
                    </p>
                  </div>
                  <Switch
                    checked={useHttps}
                    onCheckedChange={(checked) => setUseHttps(checked)}
                  />
                </div>

                {/* HTTPS Port Configuration */}
                {useHttps && (
                  <div className="space-y-2">
                    <Label htmlFor="https-port" className="text-sm font-medium">
                      HTTPS Port
                    </Label>
                    <Input
                      id="https-port"
                      type="number"
                      min="1024"
                      max="65535"
                      value={httpsPort}
                      onChange={(e) => setHttpsPort(parseInt(e.target.value) || 3001)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Port for HTTPS server (default: 3001)
                    </p>
                  </div>
                )}

                {/* HTTP Port Configuration (only shown when HTTPS is disabled) */}
                {!useHttps && (
                  <div className="space-y-2">
                    <Label htmlFor="web-server-port" className="text-sm font-medium">
                      HTTP Port
                    </Label>
                    <Input
                      id="web-server-port"
                      type="number"
                      min="1024"
                      max="65535"
                      value={webServerPort}
                      onChange={(e) => setWebServerPort(parseInt(e.target.value) || 3000)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Port for HTTP server (default: 3000)
                    </p>
                  </div>
                )}

                {/* Enable/Disable Toggle */}
                <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                  <div className="flex flex-col gap-1">
                    <Label className="text-sm font-medium">Allow External Access</Label>
                    <p className="text-xs text-muted-foreground">
                      {webServerRunning
                        ? `External access enabled (${localIPAddress || '0.0.0.0'})`
                        : 'Localhost only (127.0.0.1)'}
                    </p>
                  </div>
                  <Switch
                    checked={webServerEnabled}
                    onCheckedChange={(checked) => setWebServerEnabled(checked)}
                  />
                </div>

                {/* Access URL */}
                <div className="p-4 rounded-lg border bg-muted/30 space-y-2">
                  <p className="text-sm font-medium">Access URL</p>
                  <div className="flex items-center gap-2">
                    <code className="text-sm bg-background px-3 py-2 rounded flex-1">
                      {(() => {
                        const protocol = savedUseHttps ? 'https' : 'http';
                        const port = savedUseHttps ? savedHttpsPort : savedWebServerPort;
                        return webServerRunning && localIPAddress
                          ? `${protocol}://${localIPAddress}:${port}`
                          : `${protocol}://localhost:${port}`;
                      })()}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const protocol = savedUseHttps ? 'https' : 'http';
                        const port = savedUseHttps ? savedHttpsPort : savedWebServerPort;
                        const url = webServerRunning && localIPAddress
                          ? `${protocol}://${localIPAddress}:${port}`
                          : `${protocol}://localhost:${port}`;
                        navigator.clipboard.writeText(url);
                        toast('URL copied to clipboard', {
                          icon: <CircleCheckIcon className="size-4" />,
                        });
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {webServerRunning && localIPAddress
                      ? `Access from any device on your network using ${localIPAddress}`
                      : savedUseHttps
                      ? 'Access the app from any browser on this machine (localhost). Browser may warn about self-signed certificate.'
                      : 'Access the app from any browser on this machine only (localhost)'}
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
      
      {/* Delete Bucket Dialog */}
      <DeleteBackupRunDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) {
            setBucketToDelete(null);
          }
        }}
        bucket={bucketToDelete}
        onDelete={async () => {
          if (bucketToDelete?.id) {
            const result = await window.electronAPI.r2.deleteBucket(bucketToDelete.id);
            if (result.success) {
              await loadBuckets();
              toast.success('Bucket deleted successfully!');
              setBucketToDelete(null);
            } else {
              toast.error(result.error || 'Failed to delete bucket');
              throw new Error(result.error || 'Failed to delete bucket');
            }
          }
        }}
      />

      <LocalDirectoryPicker
        open={directoryPickerOpen}
        onOpenChange={setDirectoryPickerOpen}
        currentPath={backupDestination || ''}
        onSelect={(selectedPath) => {
          setBackupDestination(selectedPath);
        }}
      />

      {/* Docker Location Dialog */}
      <Dialog open={dockerLocationDialogOpen} onOpenChange={setDockerLocationDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cannot Change Location in Docker</DialogTitle>
            <DialogDescription>
              The backup location in Docker is configured during initial setup. To change it, run the setup script again: <code className="px-1 py-0.5 bg-muted rounded text-sm">curl -fsSL https://cdn.r2clone.gruntmods.com/build-docker.sh | bash</code>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setDockerLocationDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Connection Dialog */}
      <Dialog open={testConnectionDialogOpen} onOpenChange={setTestConnectionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{testingBucket?.name} Connection Test</DialogTitle>
          </DialogHeader>

          {testConnectionResult && (
            <div className="py-4">
              {testConnectionResult.status === 'testing' && (
                <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                  <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-spin" />
                  <span className="text-sm text-blue-900 dark:text-blue-100">{testConnectionResult.message}</span>
                </div>
              )}

              {testConnectionResult.status === 'success' && (
                <div className="flex items-start gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-900 dark:text-green-100 mb-1">Connection successful!</p>
                    <p className="text-sm text-green-700 dark:text-green-300">{testConnectionResult.message}</p>
                  </div>
                </div>
              )}

              {testConnectionResult.status === 'error' && (
                <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-red-900 dark:text-red-100 mb-1">Connection Failed</p>
                    <p className="text-sm text-red-700 dark:text-red-300">{testConnectionResult.message}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              onClick={() => setTestConnectionDialogOpen(false)}
              disabled={testConnectionResult?.status === 'testing'}
            >
              {testConnectionResult?.status === 'testing' ? 'Testing...' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
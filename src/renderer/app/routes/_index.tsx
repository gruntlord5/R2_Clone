import { useState, useEffect } from 'react';
import { Link, useLoaderData } from 'react-router';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import {
  Cloud,
  HardDrive,
  Activity,
  Calendar,
  PlayCircle,
  Settings,
  FolderOpen,
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  TrendingUp,
  Plus,
  Terminal,
  X
} from 'lucide-react';
import type { BackupJob, R2Config } from '~/types';
import { apiClient } from '~/lib/api-client';

// Loader to fetch all dashboard data before rendering
export async function clientLoader() {
  try {
    // Check if rclone is installed first
    const rcloneCheck = await window.electronAPI.rclone.checkInstalled();
    
    // Initialize default values
    let isConfigured = false;
    let r2Config: R2Config | undefined = undefined;
    let backupJobs: BackupJob[] = [];
    let stats = {
      totalBackups: 0,
      activeBackups: 0,
      lastBackupTime: null as Date | null,
      totalSize: '0 GB',
      directorySize: '0 GB',
    };
    
    // Only load data if rclone is installed
    if (rcloneCheck.isInstalled) {
      // Fetch all data in parallel
      const [allBuckets, jobs, backupStats] = await Promise.all([
        window.electronAPI.r2.getAllBuckets(),
        window.electronAPI.backup.getJobs(),
        window.electronAPI.backup.getStats()
      ]);
      
      // App is configured if there are any buckets
      isConfigured = allBuckets && allBuckets.length > 0;
      
      // Set first bucket as default for backward compatibility with R2Config type
      if (allBuckets && allBuckets.length > 0) {
        const firstBucket = allBuckets[0];
        r2Config = {
          accessKeyId: firstBucket.accessKeyId,
          secretAccessKey: firstBucket.secretAccessKey || '', // secretAccessKey not returned from API for security
          endpoint: firstBucket.endpoint,
          bucketName: firstBucket.bucketName,
          region: firstBucket.region
        };
      }
      
      backupJobs = jobs;

      // Calculate stats
      const lastRun = jobs
        .filter(j => j.lastRun)
        .sort((a, b) => new Date(b.lastRun!).getTime() - new Date(a.lastRun!).getTime())[0];

      // Format total size from database (already aggregated from all backup runs)
      const totalSizeGB = backupStats.totalSize ? (backupStats.totalSize / (1024 * 1024 * 1024)).toFixed(2) : '0';

      stats = {
        totalBackups: backupStats.totalRuns || 0,
        activeBackups: jobs.length,
        lastBackupTime: lastRun?.lastRun ? new Date(lastRun.lastRun) : null,
        totalSize: `${totalSizeGB} GB`,
        directorySize: `${totalSizeGB} GB`, // Use same value from database instead of filesystem scan
      };
    }
    
    return {
      isRcloneInstalled: rcloneCheck.isInstalled,
      isConfigured,
      r2Config,
      backupJobs,
      stats
    };
  } catch (error) {
    console.error('Failed to load dashboard data:', error);
    // Return default values on error
    return {
      isRcloneInstalled: true,
      isConfigured: false,
      r2Config: undefined,
      backupJobs: [],
      stats: {
        totalBackups: 0,
        activeBackups: 0,
        lastBackupTime: null,
        totalSize: '0 GB',
        directorySize: '0 GB',
      }
    };
  }
}

export default function Index() {
  const loaderData = useLoaderData<typeof clientLoader>();
  const { isRcloneInstalled, isConfigured, r2Config, backupJobs, stats } = loaderData;
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const [updatedVersion, setUpdatedVersion] = useState<string>('');
  const [bannerType, setBannerType] = useState<'welcome' | 'update'>('welcome');

  useEffect(() => {
    // Check if app was recently updated or is first run
    const checkVersion = async () => {
      try {
        const currentVersion = await apiClient.app.getVersion();
        const lastSeenVersion = await apiClient.settings.getLastSeenVersion();

        // If no last seen version, this is first run - show welcome banner
        if (!lastSeenVersion) {
          setUpdatedVersion(currentVersion);
          setBannerType('welcome');
          setShowUpdateBanner(true);

          // Save the current version so we can detect updates later
          await apiClient.settings.setLastSeenVersion(currentVersion);
        }
        // If versions differ, show the update banner
        else if (lastSeenVersion !== currentVersion) {
          setUpdatedVersion(currentVersion);
          setBannerType('update');
          setShowUpdateBanner(true);

          // Save the current version so banner won't show again
          await apiClient.settings.setLastSeenVersion(currentVersion);
        }
      } catch (error) {
        console.error('Failed to check version:', error);
      }
    };

    checkVersion();
  }, []);

  const handleDismissBanner = () => {
    setShowUpdateBanner(false);
  };

  const formatLastBackup = (date: Date | null) => {
    if (!date) return 'Never';
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return 'Less than an hour ago';
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  const getNextBackupTime = () => {
    if (backupJobs.length === 0) return 'No backups configured';
    // This is simplified - in a real app, you'd calculate based on schedule
    return 'In 2 hours';
  };

  const formatSchedule = (job: BackupJob) => {
    if (!job.schedule) return 'Manual';
    
    switch (job.schedule) {
      case 'hourly':
        return 'Every hour';
      case 'daily':
        if (job.scheduleMetadata?.hour !== undefined) {
          const hour = job.scheduleMetadata.hour;
          const minute = job.scheduleMetadata.minute || 0;
          const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
          const ampm = hour < 12 ? 'AM' : 'PM';
          const minuteStr = minute.toString().padStart(2, '0');
          return `Daily at ${hour12}:${minuteStr} ${ampm}`;
        }
        return 'Daily';
      case 'weekly':
        if (job.scheduleMetadata?.weekday !== undefined && job.scheduleMetadata?.hour !== undefined) {
          const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const day = days[job.scheduleMetadata.weekday];
          const hour = job.scheduleMetadata.hour;
          const minute = job.scheduleMetadata.minute || 0;
          const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
          const ampm = hour < 12 ? 'AM' : 'PM';
          const minuteStr = minute.toString().padStart(2, '0');
          return `Weekly on ${day} at ${hour12}:${minuteStr} ${ampm}`;
        }
        return 'Weekly';
      default:
        return 'Manual';
    }
  };

  const getNextRunTime = (job: BackupJob): Date | null => {
    if (!job.schedule) return null;
    
    const now = new Date();
    
    switch (job.schedule) {
      case 'hourly': {
        const next = new Date(now);
        next.setHours(now.getHours() + 1);
        next.setMinutes(0);
        next.setSeconds(0);
        next.setMilliseconds(0);
        return next;
      }
      
      case 'daily': {
        if (job.scheduleMetadata?.hour !== undefined) {
          const next = new Date(now);
          next.setHours(job.scheduleMetadata.hour);
          next.setMinutes(job.scheduleMetadata.minute || 0);
          next.setSeconds(0);
          next.setMilliseconds(0);
          
          // If the time has already passed today, schedule for tomorrow
          if (next <= now) {
            next.setDate(next.getDate() + 1);
          }
          return next;
        }
        return null;
      }
      
      case 'weekly': {
        if (job.scheduleMetadata?.weekday !== undefined && job.scheduleMetadata?.hour !== undefined) {
          const targetWeekday = job.scheduleMetadata.weekday;
          const targetHour = job.scheduleMetadata.hour;
          const targetMinute = job.scheduleMetadata.minute || 0;
          
          const next = new Date(now);
          next.setHours(targetHour);
          next.setMinutes(targetMinute);
          next.setSeconds(0);
          next.setMilliseconds(0);
          
          // Calculate days until target weekday
          const currentWeekday = now.getDay();
          let daysUntilTarget = targetWeekday - currentWeekday;
          
          // If target day is today but time has passed, or if target day is in the past this week
          if (daysUntilTarget < 0 || (daysUntilTarget === 0 && next <= now)) {
            daysUntilTarget += 7;
          }
          
          next.setDate(next.getDate() + daysUntilTarget);
          return next;
        }
        return null;
      }
      
      default:
        return null;
    }
  };

  const formatNextRun = (job: BackupJob): string => {
    const nextRun = getNextRunTime(job);
    if (!nextRun) return job.schedule ? 'Schedule not configured' : 'Manual trigger only';
    
    const now = new Date();
    const diffMs = nextRun.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    // Format time
    const hour = nextRun.getHours();
    const minute = nextRun.getMinutes();
    const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const ampm = hour < 12 ? 'AM' : 'PM';
    const minuteStr = minute.toString().padStart(2, '0');
    const timeStr = `${hour12}:${minuteStr} ${ampm}`;
    
    // If within the next hour, show minutes
    if (diffMins < 60) {
      return `In ${diffMins} minute${diffMins !== 1 ? 's' : ''}`;
    }
    
    // If today, show "Today at X:XX PM"
    if (nextRun.toDateString() === now.toDateString()) {
      return `Today at ${timeStr}`;
    }
    
    // If tomorrow, show "Tomorrow at X:XX PM"
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (nextRun.toDateString() === tomorrow.toDateString()) {
      return `Tomorrow at ${timeStr}`;
    }
    
    // If within a week, show day name
    if (diffDays <= 7) {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return `${days[nextRun.getDay()]} at ${timeStr}`;
    }
    
    // Otherwise show date
    return nextRun.toLocaleDateString() + ' at ' + timeStr;
  };

  // Check if rclone is installed first
  if (!isRcloneInstalled) {
    return (
      <div className="space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Welcome to <span style={{ color: '#f6821f' }}>R2Clone</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Secure and automated backups to Cloudflare R2 storage using rclone
          </p>
        </div>

        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
              <CardTitle>Rclone Installation Required</CardTitle>
            </div>
            <CardDescription>
              Rclone is the engine that powers R2Clone's backup functionality
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm">What is rclone?</p>
              <p className="text-sm text-muted-foreground">
                Rclone is a command-line program that manages files on cloud storage. 
                R2Clone uses it to sync your files with Cloudflare R2.
              </p>
              <p className="text-sm mt-3">To get started:</p>
              <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                <li>Go to Settings and click on the Rclone tab</li>
                <li>Click "Install Rclone" to automatically download and install it</li>
                <li>Once installed, you can configure your R2 credentials</li>
              </ol>
            </div>
            <div className="flex justify-center pt-2">
              <Link to="/settings?tab=preferences">
                <Button size="lg" className="gap-2">
                  <Terminal className="h-4 w-4" />
                  Install Rclone
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Then check R2 configuration
  if (!isConfigured) {
    return (
      <div className="space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Welcome to <span style={{ color: '#f6821f' }}>R2Clone</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Secure and automated backups to Cloudflare R2 storage using rclone
          </p>
        </div>

        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
              <CardTitle>Configuration Required</CardTitle>
            </div>
            <CardDescription>
              You need to configure your R2 credentials before you can start backing up
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm">To get started:</p>
              <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                <li>Go to your Cloudflare dashboard and create R2 API tokens</li>
                <li>Create a bucket for your backups</li>
                <li>Configure your credentials in Settings</li>
                <li>Create your first backup job</li>
              </ol>
            </div>
            <div className="flex justify-center pt-2">
              <Link to="/settings">
                <Button size="lg" className="gap-2">
                  <Settings className="h-4 w-4" />
                  Configure R2 Settings
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome/Update Banner */}
      {showUpdateBanner && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-green-900 dark:text-green-100">
                {bannerType === 'welcome'
                  ? `Welcome to R2Clone v${updatedVersion}`
                  : `Successfully updated to v${updatedVersion}`
                }
              </h3>
              <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                {bannerType === 'welcome'
                  ? 'Thank you for installing R2Clone. Are you ready to start backing up?'
                  : 'R2Clone has been updated and is ready to use.'
                }
              </p>
            </div>
            <button
              onClick={handleDismissBanner}
              className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 p-1 rounded-md hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Home</h1>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Backups</CardTitle>
          <Database className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.totalBackups}</div>
          <p className="text-xs text-muted-foreground">
            {stats.directorySize} used
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Upcoming Backup Tasks</CardTitle>
            <Clock className="h-5 w-5 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          {backupJobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No backup jobs configured yet</p>
              <Link to="/backups">
                <Button variant="outline" size="sm" className="mt-3">
                  Create First Backup
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {backupJobs
                .sort((a, b) => {
                  // Sort by next run time
                  const aNext = getNextRunTime(a);
                  const bNext = getNextRunTime(b);
                  
                  // Jobs with schedules come first
                  if (aNext && !bNext) return -1;
                  if (!aNext && bNext) return 1;
                  
                  // Both have next run times, sort by soonest
                  if (aNext && bNext) {
                    return aNext.getTime() - bNext.getTime();
                  }
                  
                  // Finally, sort by name
                  return a.name.localeCompare(b.name);
                })
                .slice(0, 5)
                .map((job) => (
                <div key={job.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/20">
                      <FolderOpen className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <p className="font-medium">{job.name}</p>
                      <div className="text-sm text-muted-foreground space-y-0.5">
                        <div>Schedule: {formatSchedule(job)}</div>
                        {job.lastRun && (
                          <div>Last run: {formatLastBackup(new Date(job.lastRun))}</div>
                        )}
                        {job.schedule && (
                          <div>Next run: {formatNextRun(job)}</div>
                        )}
                      </div>
                    </div>
                  </div>
                  <Link to="/backups">
                    <Button variant="ghost" size="sm">
                      View
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
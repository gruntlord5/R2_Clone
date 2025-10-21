import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { apiClient, addWebSocketListener, isElectron } from '~/lib/api-client';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '~/components/ui/tabs';
import BackupJobDialog from '~/components/BackupJobDialog';
import BackupCard from '~/components/BackupCard';
import DeleteBackupRunDialog from '~/components/DeleteBackupRunDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import {
  FolderOpen,
  Calendar,
  PlayCircle,
  Pause,
  Square,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Loader2,
  FileCheck,
  Download,
  Cloud,
  AlertCircle,
  Edit2,
  Plus,
  Briefcase,
  History,
  Activity,
  HardDrive,
  ArrowRight,
  FolderPlus,
  CalendarDays
} from 'lucide-react';
import type { BackupJob, BackupRun, RcloneProgress } from '~/types';

interface BackupState {
  isRunning: boolean;
  progress: RcloneProgress | null;
  transferredFiles: string[];
  skippedFiles: string[];
  statusMessage: string;
  nothingToTransfer: boolean;
  actualPath?: string;
}

export default function BackupsIndex() {
  const [searchParams] = useSearchParams();
  const [backupJobs, setBackupJobs] = useState<BackupJob[]>([]);
  const [backupRuns, setBackupRuns] = useState<BackupRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [backupStates, setBackupStates] = useState<Record<string, BackupState>>({});
  const [editingJob, setEditingJob] = useState<BackupJob | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [backupDestination, setBackupDestination] = useState<string>('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [runToDelete, setRunToDelete] = useState<BackupRun | null>(null);
  const [jobToDelete, setJobToDelete] = useState<BackupJob | null>(null);
  const [cancelledBackupJob, setCancelledBackupJob] = useState<BackupJob | null>(null);
  const [nextRunTimes, setNextRunTimes] = useState<Record<string, string | null>>({});
  const [schedulerStatus, setSchedulerStatus] = useState<{ isRunning: boolean; activeBackupId: string | null }>({ isRunning: false, activeBackupId: null });
  const [currentTab, setCurrentTab] = useState(searchParams.get('tab') || 'jobs');
  const [featureNotAvailableDialogOpen, setFeatureNotAvailableDialogOpen] = useState(false);
  const [isDockerMode, setIsDockerMode] = useState(false);
  const [stopConfirmDialogOpen, setStopConfirmDialogOpen] = useState(false);
  const [jobToStop, setJobToStop] = useState<string | null>(null);

  useEffect(() => {
    loadBackupJobs();
    loadBackupRuns();
    loadBackupDestination();
    loadSchedulerStatus();

    // Check if running in Docker mode (only relevant for browser clients)
    if (!isElectron()) {
      apiClient.app.getStatus().then((status) => {
        setIsDockerMode(status.isDocker);
      });
    }

    // Set up event listeners for all backup events
    // Listen for backup started event (broadcasted to all clients)
    apiClient.backup.onStarted?.((data: { jobId: string; jobName: string; sourcePath: string }) => {
      setBackupStates(prev => ({
        ...prev,
        [data.jobId]: {
          isRunning: true,
          progress: null,
          transferredFiles: [],
          skippedFiles: [],
          statusMessage: 'Initializing backup...',
          nothingToTransfer: false
        }
      }));
      // Switch to history tab to show progress
      setCurrentTab('history');
      // Reload backup runs to show the new running backup
      setTimeout(() => loadBackupRuns(), 500);
    });

    apiClient.backup.onProgress((data) => {
      // Progress events now include jobId
      const { jobId, ...progress } = data;
      if (jobId) {
        setBackupStates(prev => ({
          ...prev,
          [jobId]: {
            ...prev[jobId],
            progress
          }
        }));
      } else {
        console.warn('[Backups] Progress event missing jobId:', data);
      }
    });
    
    apiClient.backup.onFileTransferred((data) => {
      const { jobId, file } = data;
      if (jobId) {
        setBackupStates(prev => ({
          ...prev,
          [jobId]: {
            ...prev[jobId],
            transferredFiles: [...(prev[jobId]?.transferredFiles || []), file]
          }
        }));
      }
    });
    
    // Listen for skipped files
    apiClient.backup.onFileSkipped?.((data) => {
      const { jobId, file } = data;
      if (jobId) {
        setBackupStates(prev => ({
          ...prev,
          [jobId]: {
            ...prev[jobId],
            skippedFiles: [...(prev[jobId]?.skippedFiles || []), file]
          }
        }));
      }
    });
    
    // Listen for "nothing to transfer" event
    apiClient.backup.onNothingToTransfer?.((data) => {
      const jobId = data?.jobId;
      if (jobId) {
        setBackupStates(prev => ({
          ...prev,
          [jobId]: {
            ...prev[jobId],
            nothingToTransfer: true
          }
        }));
      }
    });
    
    // Listen for the actual path being used
    apiClient.backup.onUsingPath?.((path) => {
      setBackupStates(prev => {
        const runningJobId = Object.keys(prev).find(id => prev[id].isRunning);
        if (runningJobId) {
          return {
            ...prev,
            [runningJobId]: {
              ...prev[runningJobId],
              actualPath: path
            }
          };
        }
        return prev;
      });
    });
    
    apiClient.backup.onComplete((data) => {
      const jobId = data?.jobId;
      if (jobId) {
        // Reload backup jobs to get updated lastRun and backup runs
        loadBackupJobs();
        loadBackupRuns();

        setBackupStates(prev => ({
          ...prev,
          [jobId]: {
            ...prev[jobId],
            isRunning: false
          }
        }));
      }
    });
    
    apiClient.backup.onError((data) => {
      const jobId = data?.jobId;
      if (jobId) {
        setBackupStates(prev => ({
          ...prev,
          [jobId]: {
            ...prev[jobId],
            isRunning: false
          }
        }));
      }
    });

    apiClient.backup.onStopped(async (data) => {
      const jobId = data?.jobId;
      if (jobId) {
        // Update state first
        setBackupStates(prev => ({
          ...prev,
          [jobId]: {
            ...prev[jobId],
            isRunning: false
          }
        }));

        // Reload backup runs to update history
        await loadBackupRuns();

        // Only auto-delete if THIS client initiated the stop
        const stoppedByThisClient = (window as any).__stoppedByThisClient as Set<string>;
        if (stoppedByThisClient?.has(jobId)) {
          stoppedByThisClient.delete(jobId); // Remove so we don't process again

          // Wait a moment for database to be fully updated
          setTimeout(async () => {
            const runs = await apiClient.backup.getRuns();
            const cancelledRun = runs.find(r =>
              r.job_id === jobId &&
              r.status === 'stopped'
            );

            if (cancelledRun?.id) {
              // Automatically delete the backup run and its files
              try {
                const result = await apiClient.backup.deleteRun(cancelledRun.id, true);
                if (result.success) {
                  // Reload the runs list to reflect the deletion
                  await loadBackupRuns();
                } else {
                  console.error('[Backups] Failed to delete stopped backup:', result.error);
                }
              } catch (error) {
                console.error('[Backups] Error deleting stopped backup:', error);
              }
            }
          }, 500);
        }
      } else {
        console.warn('[Backups] Stopped event missing jobId:', data);
      }
    });

    // Set up scheduler event listeners
    apiClient.scheduler.onBackupStarted((data) => {
      // Update the backup state for the job
      setBackupStates(prev => ({
        ...prev,
        [data.jobId]: {
          isRunning: true,
          progress: null,
          transferredFiles: [],
          skippedFiles: [],
          statusMessage: '',
          nothingToTransfer: false
        }
      }));
      setSchedulerStatus(prev => ({ ...prev, activeBackupId: data.jobId }));
    });

    apiClient.scheduler.onBackupCompleted((data) => {
      setBackupStates(prev => ({
        ...prev,
        [data.jobId]: {
          ...prev[data.jobId],
          isRunning: false
        }
      }));
      setSchedulerStatus(prev => ({ ...prev, activeBackupId: null }));
      // Reload to get updated lastRun times
      loadBackupJobs();
      loadBackupRuns();
      loadNextRunTimes();
    });

    apiClient.scheduler.onBackupError((data) => {
      console.error('Scheduled backup error:', data);
      setBackupStates(prev => ({
        ...prev,
        [data.jobId]: {
          ...prev[data.jobId],
          isRunning: false
        }
      }));
      setSchedulerStatus(prev => ({ ...prev, activeBackupId: null }));
    });

    apiClient.scheduler.onBackupSkipped((data) => {
      // Skipped backup - no action needed
    });

    // Listen for backup run deletions
    addWebSocketListener('backup-run:deleted', (data: { runId: number }) => {
      // Remove from local state
      setBackupRuns(prev => prev.filter(r => r.id !== data.runId));
    });

    // Don't clean up listeners - they're global and shared across all component instances
    // Cleaning them up causes issues with React StrictMode and multiple windows
  }, []);

  const loadSchedulerStatus = async () => {
    try {
      const status = await window.electronAPI.scheduler.getStatus();
      setSchedulerStatus(status);
    } catch (error) {
      console.error('Failed to load scheduler status:', error);
    }
  };

  const loadNextRunTimes = async () => {
    try {
      const scheduled = await window.electronAPI.scheduler.getAllScheduled();
      const times: Record<string, string | null> = {};
      scheduled.forEach(item => {
        times[item.jobId] = item.nextRun ? new Date(item.nextRun).toISOString() : null;
      });
      setNextRunTimes(times);
    } catch (error) {
      console.error('Failed to load next run times:', error);
    }
  };

  const loadBackupJobs = async () => {
    try {
      const jobs = await window.electronAPI.backup.getJobs();
      setBackupJobs(jobs);
      
      // Load next run times for scheduled jobs
      loadNextRunTimes();
      
      // Initialize backup states for each job
      const initialStates: Record<string, BackupState> = {};
      jobs.forEach(job => {
        if (!backupStates[job.id]) {
          initialStates[job.id] = {
            isRunning: false,
            progress: null,
            transferredFiles: [],
            skippedFiles: [],
            statusMessage: '',
            nothingToTransfer: false,
            actualPath: undefined
          };
        }
      });
      setBackupStates(prev => ({ ...prev, ...initialStates }));
    } catch (error) {
      console.error('Failed to load backup jobs:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const loadBackupRuns = async () => {
    try {
      const runs = await window.electronAPI.backup.getRuns();
      setBackupRuns(runs);
    } catch (error) {
      console.error('Failed to load backup runs:', error);
    }
  };
  
  const loadBackupDestination = async () => {
    try {
      const destination = await window.electronAPI.settings.getBackupDestination();
      if (destination) {
        setBackupDestination(destination);
      }
    } catch (error) {
      console.error('Failed to load backup destination:', error);
    }
  };

  const handleDeleteJob = async (job: BackupJob) => {
    setJobToDelete(job);
    setDeleteDialogOpen(true);
  };


  const handleRunBackup = async (job: BackupJob) => {
    // Reset state for this job
    setBackupStates(prev => ({
      ...prev,
      [job.id]: {
        isRunning: true,
        progress: null,
        transferredFiles: [],
        skippedFiles: [],
        statusMessage: '',
        nothingToTransfer: false,
        actualPath: undefined
      }
    }));

    await apiClient.backup.start({
      sourcePath: job.sourcePath,
      dryRun: false,
      jobId: job.id,
      jobName: job.name,
      bucketId: job.bucketId
    });

    // Switch to history tab to show progress
    setCurrentTab('history');

    // Reload backup runs after a delay to show the new running backup
    // (gives main process time to create the backup_run record in database)
    setTimeout(() => {
      loadBackupRuns();
    }, 500);
  };

  const handleStopBackup = async (jobId: string) => {
    // Show confirmation dialog
    setJobToStop(jobId);
    setStopConfirmDialogOpen(true);
  };

  const handleConfirmStop = async () => {
    if (!jobToStop) return;

    // Mark that THIS client initiated the stop
    const stoppedByThisClient = new Set<string>();
    stoppedByThisClient.add(jobToStop);

    await apiClient.backup.stop(jobToStop);

    // Wait for onStopped event, then show dialog
    // The onStopped handler will check if this client initiated the stop
    (window as any).__stoppedByThisClient = stoppedByThisClient;

    // Close dialog and reset state
    setStopConfirmDialogOpen(false);
    setJobToStop(null);
  };


  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  };

  const formatDuration = (start: string, end?: string) => {
    if (!end) return 'Running...';
    const duration = new Date(end).getTime() - new Date(start).getTime();
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Tabs 
        defaultValue={searchParams.get('tab') || 'jobs'} 
        value={currentTab}
        className="flex-1"
        onValueChange={(value) => {
          setCurrentTab(value);
          // Reload backup runs when switching to history tab to ensure latest data
          if (value === 'history') {
            loadBackupRuns();
          }
        }}
      >
        {/* Combined Header with Title and Tabs */}
        <div className="sticky top-0 z-10 bg-white dark:bg-[#1a1a1a] pb-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Backups</h1>
            <div className="flex items-center gap-3">
              <div className="w-[120px]">
                {backupJobs.length > 0 && currentTab === 'jobs' && (
                  <Button 
                    onClick={() => {
                      setEditingJob(undefined);
                      setDialogOpen(true);
                    }}
                    className="gap-2"
                    size="default"
                  >
                    <Plus className="h-4 w-4" />
                    New Task
                  </Button>
                )}
              </div>
              <TabsList className="">
                <TabsTrigger value="jobs" className="gap-2">
                  <CalendarDays className="h-4 w-4" />
                  Tasks {backupJobs.length > 0 && `(${backupJobs.length})`}
                </TabsTrigger>
                <TabsTrigger value="history" className="gap-2">
                  <History className="h-4 w-4" />
                  History {backupRuns.length > 0 && `(${backupRuns.length})`}
                </TabsTrigger>
              </TabsList>
            </div>
          </div>
        </div>

        <TabsContent value="jobs" className="space-y-6 mt-0">
          {backupJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="relative">
                <FolderPlus className="h-20 w-20 text-muted-foreground/30" />
                <div className="absolute -bottom-1 -right-1 h-8 w-8 bg-blue-500 rounded-full flex items-center justify-center">
                  <Plus className="h-5 w-5 text-white" />
                </div>
              </div>
              <h3 className="mt-6 text-xl font-semibold text-foreground">No backup tasks yet</h3>
              <p className="mt-2 text-sm text-muted-foreground max-w-sm text-center">
                Create your first backup task to start protecting your data
              </p>
              <BackupJobDialog 
                onSuccess={() => {
                  loadBackupJobs();
                  loadBackupRuns();
                }}
                trigger={
                  <Button size="lg" className="gap-2 mt-6">
                    <Plus className="h-5 w-5" />
                    Create First Backup
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                {backupJobs.map((job) => {
                  const state = backupStates[job.id] || {
                    isRunning: false,
                    progress: null,
                    transferredFiles: [],
                    skippedFiles: [],
                    statusMessage: '',
                    nothingToTransfer: false
                  };

                  return (
                    <BackupCard
                      key={job.id}
                      job={job}
                      state={state}
                      nextRunTime={nextRunTimes[job.id]}
                      backupDestination={backupDestination}
                      onRun={() => handleRunBackup(job)}
                      onStop={() => handleStopBackup(job.id)}
                      onEdit={() => {
                        setEditingJob(job);
                        setDialogOpen(true);
                      }}
                      onDelete={() => handleDeleteJob(job)}
                    />
                  );
                })}
              </div>
            </>
          )}
          
          {/* Backup Job Dialog for Create/Edit */}
          <BackupJobDialog 
            job={editingJob}
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            onSuccess={() => {
              loadBackupJobs();
              loadBackupRuns();
              setDialogOpen(false);
              setEditingJob(undefined);
            }}
          />
        </TabsContent>

        <TabsContent value="history" className="space-y-6 mt-0">
          {backupRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="relative">
                <History className="h-20 w-20 text-muted-foreground/30" />
                <div className="absolute -bottom-1 -right-1 h-8 w-8 bg-gray-400 rounded-full flex items-center justify-center">
                  <Clock className="h-5 w-5 text-white" />
                </div>
              </div>
              <h3 className="mt-6 text-xl font-semibold text-foreground">No backup history</h3>
              <p className="mt-2 text-sm text-muted-foreground max-w-sm text-center">
                Your backup history will appear here after running your first backup
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {backupRuns
                .sort((a, b) => {
                  // Running backups always at top
                  if (a.status === 'running' && b.status !== 'running') return -1;
                  if (a.status !== 'running' && b.status === 'running') return 1;
                  // Then by start time (newest first)
                  return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
                })
                .map((run) => (
                <Card key={run.id} className="hover:shadow-md transition-all duration-200">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        {/* Status indicator */}
                        <div className="flex items-center">
                          {run.status === 'completed' && (
                            <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-950/30 flex items-center justify-center">
                              <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                            </div>
                          )}
                          {run.status === 'failed' && (
                            <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center">
                              <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                            </div>
                          )}
                          {run.status === 'running' && (
                            <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-950/30 flex items-center justify-center">
                              <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-spin" />
                            </div>
                          )}
                          {run.status === 'stopped' && (
                            <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center">
                              <Pause className="h-5 w-5 text-red-600 dark:text-red-400" />
                            </div>
                          )}
                        </div>
                        
                        <div>
                          <h4 className="font-semibold text-base">{run.job_name || 'Unknown Job'}</h4>
                          <p className="text-sm text-muted-foreground">
                            {new Date(run.started_at).toLocaleDateString()} at {new Date(run.started_at).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {run.status === 'running' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleStopBackup(run.job_id)}
                            className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                            title="Stop backup"
                          >
                            <Square className="h-4 w-4" />
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                const backupPath = run.backup_path ||
                                  (backupDestination && run.job_name ? `${backupDestination}/${run.job_name}` : null);
                                if (backupPath) {
                                  const result = await window.electronAPI.shell.openPath(backupPath);
                                  if (!result.success) {
                                    setFeatureNotAvailableDialogOpen(true);
                                  }
                                }
                              }}
                              disabled={!run.backup_path && (!backupDestination || !run.job_name)}
                              title="View backup files"
                            >
                              <FolderOpen className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                // If backup has no data (0 bytes), delete directly without dialog
                                if (!run.total_size || run.total_size === 0) {
                                  try {
                                    const result = await apiClient.backup.deleteRun(run.id, false);
                                    if (result.success) {
                                      loadBackupRuns();
                                    }
                                  } catch (error) {
                                    console.error('Failed to delete backup run:', error);
                                  }
                                } else {
                                  setRunToDelete(run);
                                  setDeleteDialogOpen(true);
                                }
                              }}
                              className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                              title="Delete backup run"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    
                    {/* Progress bar for running backups */}
                    {run.status === 'running' && (() => {
                      const job = backupJobs.find(j => j.id === run.job_id);
                      const state = job ? backupStates[job.id] : null;
                      const progress = state?.progress;

                      return progress ? (
                        <div className="mt-3 mb-4 space-y-2">
                          {/* Progress bar */}
                          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                            <div
                              className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                              style={{ width: `${progress.percentage}%` }}
                            />
                          </div>

                          {/* Progress stats */}
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{progress.transferred} / {progress.totalSize || '?'}</span>
                            <span>{progress.percentage}%</span>
                          </div>

                          {/* Speed and ETA */}
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{progress.speed}</span>
                            <span>ETA: {progress.eta}</span>
                          </div>

                          {/* Current file */}
                          {progress.transferring && (
                            <p className="text-xs text-muted-foreground break-words">
                              Transferring: {progress.transferring}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="mt-3 mb-4 text-xs text-muted-foreground">
                          Initializing backup...
                        </div>
                      );
                    })()}

                    {/* Stats grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-muted-foreground text-xs">Duration</p>
                          <p className="font-medium">{formatDuration(run.started_at, run.completed_at)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <FileCheck className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-muted-foreground text-xs">Files</p>
                          <p className="font-medium">
                            {run.status === 'running' ? (() => {
                              const job = backupJobs.find(j => j.id === run.job_id);
                              const state = job ? backupStates[job.id] : null;
                              return state ?
                                `${state.transferredFiles.length} transferred, ${state.skippedFiles.length} skipped` :
                                'Starting...';
                            })() : (
                              `${run.files_transferred || 0}${run.files_skipped ? ` (+${run.files_skipped})` : ''}`
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <HardDrive className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-muted-foreground text-xs">Size</p>
                          <p className="font-medium">
                            {run.status === 'running' ? (() => {
                              const job = backupJobs.find(j => j.id === run.job_id);
                              const state = job ? backupStates[job.id] : null;
                              return state?.progress?.transferred || 'Starting...';
                            })() : (
                              formatFileSize(run.total_size)
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Cloud className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-muted-foreground text-xs">Bucket</p>
                          <p className="font-medium break-words">{run.bucket_name || 'Unknown'}</p>
                        </div>
                      </div>
                    </div>
                    
                    {run.error_message && (
                      <div className="mt-3 p-2 bg-red-50 dark:bg-red-950/30 rounded-md text-sm">
                        <span className="text-red-700 dark:text-red-400">{run.error_message}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
      
      {/* Delete Backup Dialog - Used for both jobs and runs */}
      <DeleteBackupRunDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) {
            setRunToDelete(null);
            setJobToDelete(null);
            setCancelledBackupJob(null);
          }
        }}
        backupRun={runToDelete}
        backupJob={jobToDelete}
        backupPath={runToDelete ? `${backupDestination}/${runToDelete.job_name}` : undefined}
        isCancelled={!!cancelledBackupJob}
        onDelete={async (deleteFiles) => {
          if (jobToDelete) {
            // Deleting a job
            try {
              await window.electronAPI.backup.deleteJob(jobToDelete.id);
              await loadBackupJobs();
              setJobToDelete(null);
            } catch (error) {
              console.error('Failed to delete backup job:', error);
              throw error;
            }
          } else if (runToDelete?.id) {
            // Deleting a run
            const result = await apiClient.backup.deleteRun(runToDelete.id, deleteFiles);
            if (result.success) {
              loadBackupRuns();
              setRunToDelete(null);
              setCancelledBackupJob(null);
            } else {
              throw new Error(result.error || 'Failed to delete backup run');
            }
          }
        }}
      />

      {/* Feature Not Available Dialog */}
      <Dialog open={featureNotAvailableDialogOpen} onOpenChange={setFeatureNotAvailableDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>File Browser Not Available</DialogTitle>
            <DialogDescription>
              {isDockerMode ? (
                <>
                  File browsing is not available in Docker deployments. You can access your backup files at <code className="px-1 py-0.5 bg-muted rounded text-sm">/backups</code> on your Docker host or via SSH.
                </>
              ) : (
                'Browsing files is only available in the desktop app.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setFeatureNotAvailableDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stop Backup Confirmation Dialog */}
      <Dialog open={stopConfirmDialogOpen} onOpenChange={setStopConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop Backup?</DialogTitle>
            <DialogDescription>
              The backup will be cancelled and files will be removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setStopConfirmDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmStop}>
              Stop Backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Checkbox } from '~/components/ui/checkbox';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Plus, Save, FolderOpen, Loader2, Cloud, Clock } from 'lucide-react';
import R2DirectoryPicker from '~/components/R2DirectoryPicker';
import type { BackupJob, R2Config, R2Bucket } from '~/types';

interface BackupJobDialogProps {
  onSuccess?: () => void;
  trigger?: React.ReactNode;
  job?: BackupJob; // Optional job for editing
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function BackupJobDialog({ onSuccess, trigger, job, open: controlledOpen, onOpenChange }: BackupJobDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  const [r2Config, setR2Config] = useState<R2Config | null>(null);
  const [buckets, setBuckets] = useState<R2Bucket[]>([]);
  const [selectedBucketId, setSelectedBucketId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDirectoryPicker, setShowDirectoryPicker] = useState(false);
  
  // Generate default backup name with bucket name (no date since timestamps are added automatically)
  const getDefaultName = () => {
    if (r2Config?.bucketName) {
      return `${r2Config.bucketName}-backup`;
    }
    return 'backup';
  };
  
  const [formData, setFormData] = useState({
    name: job?.name || '',
    sourcePath: job?.sourcePath || '', // This will be R2 path
    schedule: (job?.schedule || 'daily') as BackupJob['schedule'], // Default to daily
    scheduleMetadata: job?.scheduleMetadata || {
      weekday: 1, // Monday
      hour: 0, // 12:00 AM
      minute: 0
    },
    retentionCount: job?.retentionCount !== undefined ? job.retentionCount : 7,
    unlimitedRetention: job?.retentionCount === -1
  });

  // Load buckets when dialog opens
  useEffect(() => {
    if (open) {
      loadBuckets();
      // If editing, set the job's data
      if (job) {
        setFormData({
          name: job.name,
          sourcePath: job.sourcePath || '',
          schedule: job.schedule || 'daily',
          scheduleMetadata: job.scheduleMetadata || {
            weekday: 1,
            hour: 0,
            minute: 0
          },
          retentionCount: job.retentionCount !== undefined ? job.retentionCount : 7,
          unlimitedRetention: job.retentionCount === -1
        });
        setSelectedBucketId(job.bucketId);
      } else {
        // Reset form for new job
        setFormData({
          name: '',
          sourcePath: '',
          schedule: 'daily',
          scheduleMetadata: {
            weekday: 1,
            hour: 0,
            minute: 0
          },
          retentionCount: 7,
          unlimitedRetention: false
        });
        setSelectedBucketId(null);
      }
    }
  }, [open, job]);

  const loadBuckets = async () => {
    try {
      const allBuckets = await window.electronAPI.r2.getAllBuckets();
      setBuckets(allBuckets);
      // Only select a default bucket if we're creating a new job (not editing)
      if (!job && allBuckets.length > 0 && !selectedBucketId) {
        const firstBucket = allBuckets[0];
        setSelectedBucketId(firstBucket.id!);
        // Update default name based on selected bucket
        setFormData(prev => ({
          ...prev,
          name: prev.name || `${firstBucket.bucketName}-backup`
        }));
      }
    } catch (error) {
      console.error('Failed to load buckets:', error);
    }
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      if (!selectedBucketId) {
        alert('Please select a bucket');
        setIsSubmitting(false);
        return;
      }
      
      const jobData: BackupJob = {
        id: job?.id || Date.now().toString(),
        name: formData.name,
        sourcePath: formData.sourcePath.trim() || '', // Empty means entire bucket
        bucketId: selectedBucketId,
        schedule: formData.schedule,
        scheduleMetadata: formData.scheduleMetadata,
        retentionCount: formData.unlimitedRetention ? -1 : formData.retentionCount,
        lastRun: job?.lastRun,
      };
      
      const result = await window.electronAPI.backup.saveJob(jobData);
      if (result.success) {
        setOpen(false);
        // Reset form
        setFormData({
          name: getDefaultName(),
          sourcePath: '',
          schedule: 'daily',
          scheduleMetadata: {
            weekday: 1,
            hour: 0,
            minute: 0
          }
        });
        if (onSuccess) {
          onSuccess();
        }
      } else {
        alert(`Failed to ${job ? 'update' : 'create'} backup job: ${result.error}`);
      }
    } catch (error: any) {
      alert(`Error ${job ? 'updating' : 'creating'} backup job: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined && (
        <DialogTrigger asChild>
          {trigger || (
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New Backup
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{job ? 'Edit' : 'New'} Backup Configuration</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          {buckets.length === 0 ? (
            <div className="text-center py-8">
              <Cloud className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                No buckets configured. Please add a bucket in Settings first.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="bucket">
                  R2 Bucket <span className="text-red-500">*</span>
                </Label>
                <Select 
                  value={selectedBucketId?.toString()} 
                  onValueChange={(value) => {
                    const bucketId = parseInt(value);
                    setSelectedBucketId(bucketId);
                    const bucket = buckets.find(b => b.id === bucketId);
                    if (bucket) {
                      // Always update the name when bucket changes, unless user has customized it
                      const currentBucket = buckets.find(b => b.id === selectedBucketId);
                      const isDefaultName = !currentBucket || 
                        formData.name === '' || 
                        formData.name === `${currentBucket.bucketName}-backup` ||
                        formData.name === 'backup';
                      
                      if (isDefaultName) {
                        setFormData({ ...formData, name: `${bucket.bucketName}-backup` });
                      }
                    }
                  }}
                >
                  <SelectTrigger id="bucket" disabled={isSubmitting}>
                    <SelectValue placeholder="Select a bucket" />
                  </SelectTrigger>
                  <SelectContent>
                    {buckets.map((bucket) => (
                      <SelectItem key={bucket.id} value={bucket.id!.toString()}>
                        <div className="flex items-center gap-2">
                          <span>{bucket.name}</span>
                          <span className="text-xs text-muted-foreground">({bucket.bucketName})</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="name">
                  Backup Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="name"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Production Backup"
                  disabled={isSubmitting}
                />
              </div>
              
              <div className="space-y-2">
            <Label htmlFor="source">
              <span className="flex items-center gap-2">
                <Cloud className="h-3 w-3" />
                R2 Source Folder
              </span>
            </Label>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={() => setShowDirectoryPicker(true)}
              disabled={isSubmitting}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              {formData.sourcePath ? formData.sourcePath : 'Entire Bucket'}
            </Button>
            <p className="text-sm text-muted-foreground">
              Select a folder from R2 to backup, or use entire bucket
            </p>
          </div>


          <div className="space-y-2">
            <Label htmlFor="schedule">Backup Schedule</Label>
            <Select 
              value={formData.schedule} 
              onValueChange={(value: BackupJob['schedule']) => 
                setFormData({ ...formData, schedule: value })
              }
            >
              <SelectTrigger id="schedule" disabled={isSubmitting}>
                <SelectValue placeholder="Select schedule" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Show day and time for weekly schedule */}
          {formData.schedule === 'weekly' && (
            <div className="space-y-2">
              <div className="flex gap-4">
                <Label htmlFor="weekday" className="min-w-fit self-center">Day</Label>
                <Select 
                  value={formData.scheduleMetadata.weekday?.toString()} 
                  onValueChange={(value) => 
                    setFormData({ 
                      ...formData, 
                      scheduleMetadata: { 
                        ...formData.scheduleMetadata, 
                        weekday: parseInt(value) 
                      } 
                    })
                  }
                >
                  <SelectTrigger id="weekday" className="flex-1" disabled={isSubmitting}>
                    <SelectValue placeholder="Select day" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Sunday</SelectItem>
                    <SelectItem value="1">Monday</SelectItem>
                    <SelectItem value="2">Tuesday</SelectItem>
                    <SelectItem value="3">Wednesday</SelectItem>
                    <SelectItem value="4">Thursday</SelectItem>
                    <SelectItem value="5">Friday</SelectItem>
                    <SelectItem value="6">Saturday</SelectItem>
                  </SelectContent>
                </Select>
                <Label htmlFor="schedule-time-weekly" className="min-w-fit self-center">Time</Label>
                <div className="relative flex-1">
                  <Input
                    id="schedule-time-weekly"
                    type="time"
                    value={`${formData.scheduleMetadata.hour?.toString().padStart(2, '0')}:${formData.scheduleMetadata.minute?.toString().padStart(2, '0')}`}
                    onChange={(e) => {
                      const [hour, minute] = e.target.value.split(':').map(Number);
                      setFormData({
                        ...formData,
                        scheduleMetadata: {
                          ...formData.scheduleMetadata,
                          hour,
                          minute
                        }
                      });
                    }}
                    className="peer appearance-none ps-9 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                    disabled={isSubmitting}
                  />
                  <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 peer-disabled:opacity-50">
                    <Clock size={16} aria-hidden="true" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Show time picker for daily schedule only */}
          {formData.schedule === 'daily' && (
            <div className="space-y-2">
              <Label htmlFor="schedule-time-daily">Time</Label>
              <div className="relative">
                <Input
                  id="schedule-time-daily"
                  type="time"
                  value={`${formData.scheduleMetadata.hour?.toString().padStart(2, '0')}:${formData.scheduleMetadata.minute?.toString().padStart(2, '0')}`}
                  onChange={(e) => {
                    const [hour, minute] = e.target.value.split(':').map(Number);
                    setFormData({
                      ...formData,
                      scheduleMetadata: {
                        ...formData.scheduleMetadata,
                        hour,
                        minute
                      }
                    });
                  }}
                  className="peer appearance-none ps-9 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                  disabled={isSubmitting}
                />
                <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 peer-disabled:opacity-50">
                  <Clock size={16} aria-hidden="true" />
                </div>
              </div>
            </div>
          )}

          {/* Retention Settings */}
          <div className="space-y-2">
            <Label>Backup Retention</Label>
            {!formData.unlimitedRetention ? (
              <div className="flex items-center gap-2">
                <span className="text-sm">Keep up to</span>
                <Input
                  type="number"
                  min="1"
                  value={formData.retentionCount === -1 ? 7 : formData.retentionCount}
                  onChange={(e) => setFormData({ ...formData, retentionCount: parseInt(e.target.value) || 7 })}
                  disabled={isSubmitting}
                  className="w-20 h-8"
                />
                <span className="text-sm">backups</span>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Unlimited retention - backups will not be deleted automatically
              </div>
            )}
            <div className="flex items-center gap-2">
              <Checkbox
                id="unlimited-retention"
                checked={formData.unlimitedRetention}
                onCheckedChange={(checked) => 
                  setFormData({ 
                    ...formData, 
                    unlimitedRetention: checked as boolean,
                    retentionCount: checked ? -1 : 7
                  })
                }
                disabled={isSubmitting}
              />
              <Label 
                htmlFor="unlimited-retention" 
                className="text-sm font-normal cursor-pointer"
              >
                No Retention Limit
              </Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Old backups are deleted automatically when the limit is reached.
            </p>
          </div>

              <div className="flex gap-3 pt-4">
                <Button
                  type="submit"
                  disabled={isSubmitting || !formData.name || !selectedBucketId}
                  className="flex-1"
                >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {job ? 'Save Changes' : 'Create Backup Job'}
                </>
              )}
                </Button>
              </div>
            </>
          )}
        </form>
      </DialogContent>
      
      {/* R2 Directory Picker Dialog */}
      <R2DirectoryPicker
        open={showDirectoryPicker}
        onOpenChange={setShowDirectoryPicker}
        onSelect={(path) => {
          setFormData({ ...formData, sourcePath: path });
          setShowDirectoryPicker(false);
        }}
        currentPath={formData.sourcePath}
        bucketId={selectedBucketId || undefined}
        bucketName={buckets.find(b => b.id === selectedBucketId)?.bucketName}
      />
    </Dialog>
  );
}
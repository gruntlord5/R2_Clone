import { useState, useId } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Checkbox } from '~/components/ui/checkbox';
import { CircleAlert } from 'lucide-react';
import type { BackupRun, BackupJob, R2Bucket } from '~/types';

interface DeleteBackupRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backupRun?: BackupRun | null;
  backupJob?: BackupJob | null;
  bucket?: R2Bucket | null;
  backupPath?: string;
  onDelete: (deleteFiles?: boolean) => Promise<void>;
  isCancelled?: boolean;
}

export default function DeleteBackupRunDialog({
  open,
  onOpenChange,
  backupRun,
  backupJob,
  bucket,
  backupPath,
  onDelete,
  isCancelled = false,
}: DeleteBackupRunDialogProps) {
  const id = useId();
  const [isDeleting, setIsDeleting] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [preserveFiles, setPreserveFiles] = useState(false);

  const handleDelete = async (deleteFiles: boolean = false) => {
    setIsDeleting(true);
    try {
      await onDelete(deleteFiles);
      onOpenChange(false);
      setInputValue('');
    } catch (error) {
      console.error('Failed to delete:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  // Reset input and checkbox when dialog opens/closes
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setInputValue('');
      setPreserveFiles(false);
    }
    onOpenChange(open);
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

  if (!backupRun && !backupJob && !bucket) return null;
  
  const isJob = !!backupJob;
  const isBucket = !!bucket;
  const itemName = isBucket ? bucket.name : isJob ? backupJob.name : (backupRun?.job_name || 'Unknown');
  const itemType = isBucket ? 'bucket' : isJob ? 'task' : 'backup';

  // Special UI for cancelled backups - simple yes/no
  if (isCancelled && backupRun) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <div className="flex flex-col items-center gap-2">
            <div
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border"
              aria-hidden="true"
            >
              <CircleAlert className="opacity-80" size={16} />
            </div>
            <DialogHeader>
              <DialogTitle className="text-center">
                Backup cancelled
              </DialogTitle>
              <DialogDescription className="text-center">
                Delete backup history and files?
              </DialogDescription>
            </DialogHeader>
          </div>

          {backupRun && (
            <div className="rounded-lg border bg-muted/50 p-3 space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Backup:</span>{' '}
                {backupRun.job_name || 'Unknown'}
              </div>
              <div>
                <span className="text-muted-foreground">Files transferred:</span>{' '}
                {backupRun.files_transferred || 0}
              </div>
              <div>
                <span className="text-muted-foreground">Size:</span>{' '}
                {formatFileSize(backupRun.total_size)}
              </div>
            </div>
          )}

          <DialogFooter className="!flex-row gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 min-w-0"
              onClick={() => handleOpenChange(false)}
              disabled={isDeleting}
            >
              No, keep files
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1 min-w-0"
              onClick={() => handleDelete(true)}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Yes, delete both'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <div className="flex flex-col items-center gap-2">
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border"
            aria-hidden="true"
          >
            <CircleAlert className="opacity-80" size={16} />
          </div>
          <DialogHeader>
            <DialogTitle className="text-center">
              Delete {isBucket ? 'R2 bucket configuration' : isJob ? 'backup task' : 'backup history'}
            </DialogTitle>
            <DialogDescription className="text-center">
              This action cannot be undone. To confirm, please type{' '}
              <span className="font-medium text-foreground">{itemName}</span> below.
            </DialogDescription>
          </DialogHeader>
        </div>

        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (inputValue === itemName) handleDelete(!preserveFiles); }}>
          <div className="space-y-2">
            <Label htmlFor={id}>{isBucket ? 'Bucket name' : isJob ? 'Task name' : 'Backup name'}</Label>
            <Input
              id={id}
              type="text"
              placeholder={`Type ${itemName} to confirm`}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              disabled={isDeleting}
            />
          </div>

          {!isJob && !isBucket && backupRun && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="preserve-files"
                checked={preserveFiles}
                onCheckedChange={(checked) => setPreserveFiles(checked === true)}
                disabled={isDeleting}
              />
              <label
                htmlFor="preserve-files"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Preserve backup files (only delete history)
              </label>
            </div>
          )}
          
          {isBucket && bucket && (
            <div className="rounded-lg border bg-muted/50 p-3 space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Bucket:</span>{' '}
                <span className="break-all">{bucket.bucketName}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Endpoint:</span>{' '}
                <span className="break-all">{bucket.endpoint || `${bucket.accountId}.r2.cloudflarestorage.com`}</span>
              </div>
              {bucket.region && (
                <div>
                  <span className="text-muted-foreground">Region:</span>{' '}
                  <span className="break-all">{bucket.region}</span>
                </div>
              )}
            </div>
          )}
          
          {isJob && backupJob && (
            <div className="rounded-lg border bg-muted/50 p-3 space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Schedule:</span>{' '}
                {backupJob.schedule === 'hourly' ? 'Every hour' :
                 backupJob.schedule === 'daily' ? 'Daily' :
                 backupJob.schedule === 'weekly' ? 'Weekly' : 'Manual'}
              </div>
              {backupJob.lastRun && (
                <div>
                  <span className="text-muted-foreground">Last run:</span>{' '}
                  {new Date(backupJob.lastRun).toLocaleDateString()}
                </div>
              )}
            </div>
          )}
          
          {!isJob && backupRun && (
            <div className="rounded-lg border bg-muted/50 p-3 space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Date:</span>{' '}
                {new Date(backupRun.started_at).toLocaleString()}
              </div>
              <div>
                <span className="text-muted-foreground">Files:</span>{' '}
                {backupRun.files_transferred || 0}
              </div>
              <div>
                <span className="text-muted-foreground">Size:</span>{' '}
                {formatFileSize(backupRun.total_size)}
              </div>
            </div>
          )}

          <DialogFooter className="!flex-row gap-2 sm:gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" className="flex-1 min-w-0" disabled={isDeleting}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              className="flex-1 min-w-0"
              disabled={inputValue !== itemName || isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
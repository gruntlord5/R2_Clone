import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '~/components/ui/card';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';
import { 
  PlayCircle, 
  Pause,
  Edit2,
  Trash2,
  Clock,
  Cloud,
  HardDrive,
  Calendar,
  Loader2,
  FolderOpen,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  Download,
  MessageSquare
} from 'lucide-react';
import type { BackupJob, RcloneProgress } from '~/types';

interface BackupState {
  isRunning: boolean;
  progress: RcloneProgress | null;
  transferredFiles: string[];
  skippedFiles: string[];
  statusMessage: string;
  nothingToTransfer: boolean;
  actualPath?: string;
}

interface BackupCardProps {
  job: BackupJob;
  state: BackupState;
  nextRunTime?: string | null;
  backupDestination: string;
  onRun: () => void;
  onStop: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export default function BackupCard({
  job,
  state,
  nextRunTime,
  backupDestination,
  onRun,
  onStop,
  onEdit,
  onDelete
}: BackupCardProps) {
  
  const getStatusDot = () => {
    if (state.isRunning) {
      return (
        <div className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
        </div>
      );
    }
    
    if (state.statusMessage.includes('Error')) {
      return <div className="h-3 w-3 rounded-full bg-red-500" />;
    }
    
    if (state.statusMessage.includes('completed')) {
      return <div className="h-3 w-3 rounded-full bg-green-500" />;
    }
    
    if (nextRunTime) {
      return <div className="h-3 w-3 rounded-full bg-gray-400 dark:bg-gray-600" />;
    }
    
    return <div className="h-3 w-3 rounded-full bg-gray-300 dark:bg-gray-700" />;
  };
  
  const getScheduleText = () => {
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
          return `Daily ${hour12}:${minuteStr} ${ampm}`;
        }
        return 'Daily';
      case 'weekly':
        if (job.scheduleMetadata?.weekday !== undefined) {
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          return `Weekly ${days[job.scheduleMetadata.weekday]}`;
        }
        return 'Weekly';
      default:
        return 'Manual';
    }
  };


  return (
    <Card className="group hover:shadow-md transition-all duration-200 overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {getStatusDot()}
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-lg break-words">{job.name}</h3>
              <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {getScheduleText()}
                </span>
                {job.lastRun && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {new Date(job.lastRun).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {!state.isRunning ? (
              <Button 
                variant="default" 
                size="sm"
                onClick={onRun}
                className="gap-2"
              >
                <PlayCircle className="h-4 w-4" />
                Run Now
              </Button>
            ) : (
              <Button 
                variant="destructive" 
                size="sm"
                onClick={onStop}
                className="gap-2"
              >
                <Pause className="h-4 w-4" />
                Stop
              </Button>
            )}
            
            <Button 
              variant="ghost" 
              size="sm"
              onClick={onEdit}
              className="h-8 w-8 p-0"
              title="Edit backup"
            >
              <Edit2 className="h-4 w-4" />
            </Button>
            
            <Button 
              variant="ghost" 
              size="sm"
              onClick={onDelete}
              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
              title="Delete backup"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="space-y-3">
          {/* Source path */}
          <div className="flex items-start gap-2 text-sm">
            <Cloud className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <span className="break-all text-muted-foreground">
              {job.bucket?.bucketName || 'No bucket'}
              {job.sourcePath && `/${job.sourcePath}`}
            </span>
          </div>

          {/* Next run time */}
          {!state.isRunning && nextRunTime && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ArrowRight className="h-3.5 w-3.5" />
              <span>Next run: {new Date(nextRunTime).toLocaleString()}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
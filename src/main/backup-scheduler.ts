import { Cron } from 'croner';
import { EventEmitter } from 'events';
import { getDatabase } from './database';
import RcloneHandler from './rclone';
import RcloneInstaller from './rclone-installer';
import * as fs from 'node:fs';
import path from 'node:path';
import type { BackupJob } from './database';

interface ScheduledTask {
  jobId: string;
  cron: Cron;
  nextRun?: Date;
}

export default class BackupScheduler extends EventEmitter {
  private tasks: Map<string, ScheduledTask> = new Map();
  private rcloneInstaller: RcloneInstaller;
  private activeHandler: RcloneHandler | null = null;
  private isRunning: boolean = false;
  private activeBackupId: string | null = null;
  private startBackupFn?: (jobId: string) => Promise<{ success: boolean; error?: string }>;

  constructor(rcloneInstaller: RcloneInstaller) {
    super();
    this.rcloneInstaller = rcloneInstaller;
  }

  /**
   * Set the function to call when starting backups
   * This should be set to webServer.startBackup after initialization
   */
  public setStartBackupFunction(fn: (jobId: string) => Promise<{ success: boolean; error?: string }>) {
    this.startBackupFn = fn;
  }

  /**
   * Initialize the scheduler and load all scheduled jobs
   */
  public async initialize(): Promise<void> {
    console.log('[Scheduler] Initializing backup scheduler...');
    const db = getDatabase();
    const jobs = db.getAllBackupJobs();
    
    for (const job of jobs) {
      if (job.schedule && job.schedule !== 'manual') {
        this.scheduleJob(job);
      }
    }
    
    this.isRunning = true;
    console.log(`[Scheduler] Initialized with ${this.tasks.size} scheduled jobs`);
  }

  /**
   * Schedule a backup job
   */
  public scheduleJob(job: BackupJob): void {
    // Remove existing schedule if any
    this.unscheduleJob(job.id);

    const cronPattern = this.getCronPattern(job);
    if (!cronPattern) {
      console.log(`[Scheduler] No cron pattern for job ${job.id} with schedule ${job.schedule}`);
      return;
    }

    // Get configured timezone from database
    const db = getDatabase();
    const timezone = db.getTimezone();

    console.log(`[Scheduler] Scheduling job ${job.id} (${job.name}) with pattern: ${cronPattern} (timezone: ${timezone})`);

    const cron = new Cron(cronPattern, { timezone }, () => {
      this.executeBackup(job.id);
    });

    this.tasks.set(job.id, {
      jobId: job.id,
      cron,
      nextRun: cron.nextRun()
    });

    console.log(`[Scheduler] Job ${job.id} scheduled. Next run: ${cron.nextRun()}`);
  }

  /**
   * Unschedule a backup job
   */
  public unscheduleJob(jobId: string): void {
    const task = this.tasks.get(jobId);
    if (task) {
      task.cron.stop();
      this.tasks.delete(jobId);
      console.log(`[Scheduler] Job ${jobId} unscheduled`);
    }
  }

  /**
   * Update a scheduled job (reschedule with new settings)
   */
  public updateJob(job: BackupJob): void {
    if (job.schedule && job.schedule !== 'manual') {
      this.scheduleJob(job);
    } else {
      this.unscheduleJob(job.id);
    }
  }

  /**
   * Get the next run time for a job
   */
  public getNextRun(jobId: string): Date | null {
    const task = this.tasks.get(jobId);
    return task ? task.cron.nextRun() : null;
  }

  /**
   * Get all scheduled jobs with their next run times
   */
  public getScheduledJobs(): Array<{ jobId: string; nextRun: Date | null }> {
    return Array.from(this.tasks.entries()).map(([jobId, task]) => ({
      jobId,
      nextRun: task.cron.nextRun()
    }));
  }

  /**
   * Execute a backup job using the WebSocket-based backup system
   */
  private async executeBackup(jobId: string): Promise<void> {
    const db = getDatabase();
    const job = db.getBackupJob(jobId);

    if (!job) {
      console.error(`[Scheduler] Job ${jobId} not found`);
      this.unscheduleJob(jobId);
      return;
    }

    console.log(`[Scheduler] Triggering backup for job ${jobId} (${job.name})`);

    // Use the WebSocket-based backup system if available
    if (this.startBackupFn) {
      const result = await this.startBackupFn(jobId);
      if (!result.success) {
        console.error(`[Scheduler] Failed to start backup: ${result.error}`);
        this.emit('error', { jobId, error: result.error });
      } else {
        // WebSocket system will broadcast events, we just emit scheduler-specific events
        this.emit('started', { jobId, jobName: job.name });
      }
    } else {
      // Fallback: If WebSocket system not available yet (shouldn't happen in practice)
      console.warn('[Scheduler] WebSocket backup system not available, backup not started');
      this.emit('error', { jobId, error: 'Backup system not initialized' });
    }
  }

  /**
   * Manually trigger a scheduled backup
   */
  public async triggerBackup(jobId: string): Promise<void> {
    await this.executeBackup(jobId);
  }

  /**
   * Convert job schedule to cron pattern
   */
  private getCronPattern(job: BackupJob): string | null {
    if (!job.schedule || job.schedule === 'manual') {
      return null;
    }

    // Parse JSON string to object
    const metadata = job.schedule_metadata
      ? JSON.parse(job.schedule_metadata)
      : {};
    const minute = metadata.minute || 0;
    const hour = metadata.hour || 0;

    switch (job.schedule) {
      case 'hourly':
        // Run at specified minute of every hour
        return `${minute} * * * *`;
      
      case 'daily':
        // Run at specified time every day
        return `${minute} ${hour} * * *`;
      
      case 'weekly':
        // Run at specified time on specified day of week
        const weekday = metadata.weekday !== undefined ? metadata.weekday : 1;
        return `${minute} ${hour} * * ${weekday}`;
      
      default:
        return null;
    }
  }

  /**
   * Stop all scheduled tasks
   */
  public stop(): void {
    for (const task of this.tasks.values()) {
      task.cron.stop();
    }
    this.tasks.clear();
    this.isRunning = false;
    console.log('[Scheduler] All scheduled tasks stopped');
  }

  /**
   * Check if scheduler is running
   */
  public getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Check if a backup is currently running
   */
  public getActiveBackupId(): string | null {
    return this.activeBackupId;
  }
}
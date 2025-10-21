import { spawn, ChildProcess } from 'child_process';
import { statfs } from 'fs/promises';
import { getDatabase } from './database';
import { EventEmitter } from 'events';
import RcloneInstaller from './rclone-installer';

export interface RcloneProgress {
  percentage: number;
  speed: string;
  eta: string;
  transferred: string;
  totalSize?: string;
  errors: number;
  checks: number;
  transferring?: string;
}

export interface R2Config {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucketName: string;
  region?: string;
}

export class RcloneHandler extends EventEmitter {
  private process: ChildProcess | null = null;
  private rcloneInstaller: RcloneInstaller;
  private lastTransferring: string | undefined = undefined;
  private currentFile: string | undefined = undefined;
  private nothingToTransfer: boolean = false;
  private currentConfig: R2Config | null = null;
  private isStopping: boolean = false;
  private prescannedTotalBytes: number = 0;

  constructor(rcloneInstaller: RcloneInstaller) {
    super();
    this.rcloneInstaller = rcloneInstaller;
  }

  private async getRclonePath(): Promise<string> {
    // Use the installer's cached path (instant!)
    if (this.rcloneInstaller.getInstallStatus().isInstalled) {
      return this.rcloneInstaller.getPath();
    }
    // Fallback to stored path
    const db = getDatabase();
    return db.getRclonePath();
  }
  
  setConfig(config: R2Config): void {
    this.currentConfig = config;
  }
  
  private buildR2RemoteArgs(config?: R2Config): string[] {
    const configToUse = config || this.currentConfig;
    if (!configToUse) throw new Error('R2 configuration not found');

    // Get maxConcurrentTransfers from database settings (default 20, min 1, max 64)
    const db = getDatabase();
    const settings = db.getAppSettings();
    const transfers = Math.min(64, Math.max(1, settings.maxConcurrentTransfers || 20));

    return [
      '--s3-provider=Cloudflare',
      `--s3-access-key-id=${configToUse.accessKeyId}`,
      `--s3-secret-access-key=${configToUse.secretAccessKey}`,
      `--s3-endpoint=${configToUse.endpoint}`,
      '--s3-acl=private',
      `--transfers=${transfers}`,
      '--checkers=64'
    ];
  }

  private sanitizeArgsForLogging(args: string[]): string {
    return args
      .map(arg => {
        if (arg.startsWith('--s3-secret-access-key=')) {
          return '--s3-secret-access-key=***REDACTED***';
        }
        return arg;
      })
      .join(' ');
  }
  
  async testConnection(): Promise<boolean> {
    return new Promise(async (resolve, reject) => {
      const config = this.currentConfig;
      if (!config) {
        reject(new Error('R2 configuration not found'));
        return;
      }
      
      const rclonePath = await this.getRclonePath();
      const args = [
        'lsd',
        ':s3:' + config.bucketName,
        ...this.buildR2RemoteArgs()
      ];

      const proc = spawn(rclonePath, args);
      let output = '';
      let error = '';
      
      // Set a 30-second timeout
      const timeout = setTimeout(() => {
        proc.kill();
        reject(new Error('Connection test timed out after 30 seconds. Please check your configuration and network connection.'));
      }, 30000);

      proc.stdout?.on('data', (data) => {
        const dataStr = data.toString();
        output += dataStr;
      });

      proc.stderr?.on('data', (data) => {
        const dataStr = data.toString();
        error += dataStr;
      });
      
      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(true);
        } else {
          // Parse error for more helpful messages
          let errorMessage = 'Connection test failed';
          if (error.includes('no such host')) {
            errorMessage = 'Invalid endpoint URL. Please check your R2 endpoint configuration.';
          } else if (error.includes('InvalidAccessKeyId')) {
            errorMessage = 'Invalid Access Key ID. Please check your credentials.';
          } else if (error.includes('SignatureDoesNotMatch')) {
            errorMessage = 'Invalid Secret Access Key. Please check your credentials.';
          } else if (error.includes('NoSuchBucket')) {
            errorMessage = 'Bucket not found. Please check your bucket name.';
          } else if (error) {
            errorMessage = error.split('\n')[0]; // Use first line of error
          }
          reject(new Error(errorMessage));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
  
  async listDirectories(path: string = ''): Promise<{ name: string; type: 'file' | 'folder'; size?: number }[]> {
    return new Promise(async (resolve, reject) => {
      const config = this.currentConfig;
      if (!config) {
        reject(new Error('R2 configuration not found'));
        return;
      }
      
      const rclonePath = await this.getRclonePath();
      const cleanPath = path.replace(/^\/+/, '').replace(/\/+$/, '').trim();
      const remotePath = cleanPath 
        ? `:s3:${config.bucketName}/${cleanPath}/`
        : `:s3:${config.bucketName}/`;
      
      // Use lsf which lists files and directories
      // Output format: directories have trailing /, files don't
      const args = [
        'lsf',
        remotePath,
        '--max-depth=1',
        ...this.buildR2RemoteArgs()
      ];

      const proc = spawn(rclonePath, args);
      let output = '';
      let error = '';
      
      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        error += data.toString();
      });
      
      proc.on('close', (code) => {
        if (code === 0) {
          const items = output.split('\n')
            .filter(line => line.trim())
            .map(line => {
              const trimmedLine = line.trim();
              // Check if it's a directory (ends with /)
              const isDirectory = trimmedLine.endsWith('/');
              // Remove trailing slash for the name
              const name = isDirectory ? trimmedLine.slice(0, -1) : trimmedLine;

              return {
                name: name,
                type: isDirectory ? 'folder' as const : 'file' as const,
                size: undefined // Size not provided in simple lsf output
              };
            });

          resolve(items);
        } else {
          console.error('[R2 List] Command failed with code:', code);
          console.error('[R2 List] Error output:', error);
          reject(new Error(error || 'Failed to list directories'));
        }
      });
      
      proc.on('error', (err) => {
        console.error('[R2 List] Process error:', err);
        reject(err);
      });
    });
  }
  
  async listFiles(path: string = ''): Promise<string[]> {
    return new Promise(async (resolve, reject) => {
      const config = this.currentConfig;
      if (!config) {
        reject(new Error('R2 configuration not found'));
        return;
      }
      
      const rclonePath = await this.getRclonePath();
      // Handle empty path - don't add trailing slash for bucket root
      const cleanPath = path.replace(/^\/+/, '').trim();
      const remotePath = cleanPath 
        ? `:s3:${config.bucketName}/${cleanPath}`
        : `:s3:${config.bucketName}`;
      const args = [
        'ls',
        remotePath,
        ...this.buildR2RemoteArgs()
      ];
      
      const proc = spawn(rclonePath, args);
      let output = '';
      let error = '';
      
      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });
      
      proc.stderr?.on('data', (data) => {
        error += data.toString();
      });
      
      proc.on('close', (code) => {
        if (code === 0) {
          const files = output.split('\n')
            .filter(line => line.trim())
            .map(line => {
              const parts = line.trim().split(/\s+/);
              return parts.slice(1).join(' ');
            });
          resolve(files);
        } else {
          reject(new Error(error || 'Failed to list files'));
        }
      });
      
      proc.on('error', (err) => {
        reject(err);
      });
    });
  }
  
  async startBackup(sourcePath: string, destinationPath: string, dryRun: boolean = false): Promise<void> {
    const config = this.currentConfig || this.getActiveBucketConfig();
    if (!config) {
      this.emit('error', new Error('R2 configuration not found'));
      return;
    }

    // Reset state for new backup
    this.lastTransferring = undefined;
    this.currentFile = undefined;
    this.nothingToTransfer = false;
    this.prescannedTotalBytes = 0;

    const rclonePath = await this.getRclonePath();
    // sourcePath is now the R2 path (empty means entire bucket), destinationPath is local
    const cleanSourcePath = sourcePath.replace(/^\/+/, '').trim();
    // When source is empty, use bucket root with trailing slash
    const remotePath = cleanSourcePath
      ? `:s3:${config.bucketName}/${cleanSourcePath}`
      : `:s3:${config.bucketName}/`;

    console.log('[Backup] Starting backup:', {
      sourcePath,
      cleanSourcePath,
      remotePath,
      destinationPath
    });

    // Pre-scan total size for smooth progress bar
    const totalBytes = await this.calculateTotalSize(remotePath);
    this.prescannedTotalBytes = totalBytes;  // Store for use in parseProgress
    if (totalBytes > 0) {
      // Check disk space before starting backup
      const diskSpace = await this.checkDiskSpace(destinationPath);
      const requiredSpace = totalBytes;
      const availableSpace = diskSpace.available;

      // Add 5% buffer for safety (filesystem overhead, temporary files, etc.)
      const requiredWithBuffer = requiredSpace * 1.05;
      const spaceAfterTransfer = availableSpace - requiredSpace;

      console.log('[Backup] Disk space check:', {
        required: this.formatBytes(requiredSpace),
        requiredWithBuffer: this.formatBytes(requiredWithBuffer),
        available: this.formatBytes(availableSpace),
        spaceAfterTransfer: this.formatBytes(Math.max(0, spaceAfterTransfer)),
        total: this.formatBytes(diskSpace.total)
      });

      if (availableSpace < requiredWithBuffer) {
        const additionalSpaceRequired = requiredWithBuffer - availableSpace;
        this.emit('error', new Error(
          `Insufficient disk space. Required: ${this.formatBytes(requiredWithBuffer)}, ` +
          `Available: ${this.formatBytes(availableSpace)}, ` +
          `Additional Space Required: ${this.formatBytes(additionalSpaceRequired)}`
        ));
        return; // Stop backup before starting
      }

      console.log('[Backup] Pre-scan complete, emitting initial progress with total:', this.formatBytes(totalBytes));
      this.emit('progress', {
        percentage: 0,
        speed: '0 Kbps',
        eta: 'calculating...',
        transferred: '0 B',
        totalSize: this.formatBytes(totalBytes),
        errors: 0,
        checks: 0,
        transferring: undefined
      });
    }

    const args = [
      'copy',  // Using 'copy' instead of 'sync' to prevent deleting existing local files
      remotePath,  // Source: R2 (entire bucket if sourcePath is empty)
      destinationPath,  // Destination: local
      '--progress',
      '--stats=500ms',
      '--stats-one-line',
      '-vv',  // Very verbose flag to show files being transferred
      ...this.buildR2RemoteArgs()
    ];

    if (dryRun) {
      args.push('--dry-run');
    }

    console.log('[Backup] Spawning rclone with command:', rclonePath);
    console.log('[Backup] Args:', this.sanitizeArgsForLogging(args));

    this.process = spawn(rclonePath, args);
    
    this.process.on('spawn', () => {
      console.log('[Backup] Process spawned successfully');
    });
    
    this.process.on('error', (err) => {
      console.log('[Backup] Process error:', err);
      this.emit('error', err);
    });
    
    this.process.stdout?.on('data', (data) => {
      const output = data.toString();
      
      // DEBUG: Log output to see what we're getting
      console.log('[Backup stdout]:', output.substring(0, 300));
      
      // Also check stdout for file names in DEBUG messages
      const fileMatch = output.match(/(?:DEBUG|INFO)\s+:\s+([^:]+?):/);
      if (fileMatch && fileMatch[1]) {
        const fileName = fileMatch[1].trim();
        if (fileName && 
            !output.includes('Copied') && 
            !fileName.includes('.partial') &&
            fileName !== this.currentFile) {
          this.currentFile = fileName;
          console.log('[Backup] Now transferring file (from stdout):', fileName);
        }
      }
      
      const progress = this.parseProgress(output);
      if (progress) {
        // Add current file to progress if we have one
        if (this.currentFile) {
          progress.transferring = this.currentFile;
          console.log('[Backup] Progress with file:', progress.transferring);
        } else {
          console.log('[Backup] Progress but no current file tracked');
        }
        
        // Check if transferring file changed - means previous file completed
        if (this.lastTransferring && progress.transferring && 
            this.lastTransferring !== progress.transferring) {
          console.log('[Backup] File completed:', this.lastTransferring);
          this.emit('file-transferred', this.lastTransferring);
        }
        this.lastTransferring = progress.transferring;
        
        this.emit('progress', progress);
      }
      
      // Parse for successfully transferred files
      const transferredFile = this.parseTransferredFile(output);
      if (transferredFile) {
        console.log('[Backup] File transferred (from log):', transferredFile);
        this.emit('file-transferred', transferredFile);
      }
      
      // Check for skipped files
      const skippedFile = this.parseSkippedFile(output);
      if (skippedFile) {
        console.log('[Backup] File skipped (unchanged):', skippedFile);
        this.emit('file-skipped', skippedFile);
      }
      
      // Check for "nothing to transfer" message
      if (output.includes('There was nothing to transfer')) {
        console.log('[Backup] Nothing to transfer - all files up to date');
        this.nothingToTransfer = true;
        this.emit('nothing-to-transfer');
      }
      
      this.emit('log', output);
    });
    
    this.process.stderr?.on('data', (data) => {
      const output = data.toString();
      
      // DEBUG: Log stderr to see what we're getting
      console.log('[Backup stderr]:', output.substring(0, 300));
      
      // Check for files mentioned in DEBUG or INFO messages
      // DEBUG messages show files being processed
      const fileMatch = output.match(/(?:DEBUG|INFO)\s+:\s+([^:]+?):/);
      if (fileMatch && fileMatch[1]) {
        const fileName = fileMatch[1].trim();
        // Only set if it's not a Copied message (those are completions) and not a partial file
        if (fileName && 
            !output.includes('Copied') && 
            !fileName.includes('.partial') &&
            fileName !== this.currentFile) {
          this.currentFile = fileName;
          console.log('[Backup] Now transferring file:', fileName);
        }
      }
      
      // Parse for successfully transferred files in stderr
      const transferredFile = this.parseTransferredFile(output);
      if (transferredFile) {
        console.log('[Backup] File transferred from stderr:', transferredFile);
        this.emit('file-transferred', transferredFile);
      }
      
      // Check for skipped files in stderr
      const skippedFile = this.parseSkippedFile(output);
      if (skippedFile) {
        console.log('[Backup] File skipped from stderr:', skippedFile);
        this.emit('file-skipped', skippedFile);
      }
      
      // Check for "nothing to transfer" message in stderr
      if (output.includes('There was nothing to transfer')) {
        console.log('[Backup] Nothing to transfer - all files up to date (from stderr)');
        this.nothingToTransfer = true;
        this.emit('nothing-to-transfer');
      }
      
      this.emit('log', output);
      
      if (output.includes('ERROR')) {
        this.emit('error', new Error(output));
      }
    });
    
    this.process.on('close', (code) => {
      console.log('[Backup] Process closed with code:', code);
      
      if (this.isStopping) {
        // We intentionally stopped it
        this.emit('stopped');
        this.isStopping = false; // Reset flag
      } else if (code === 0) {
        // Pass whether there was nothing to transfer
        this.emit('complete', { nothingToTransfer: this.nothingToTransfer });
      } else {
        // Handle actual errors with user-friendly messages
        let errorMessage: string;
        if (code === 143) {
          errorMessage = 'Backup process was terminated unexpectedly';
        } else if (code === 1) {
          errorMessage = 'Backup failed - please check your settings and try again';
        } else if (code === 2) {
          errorMessage = 'Backup failed - connection error';
        } else {
          errorMessage = `Backup failed with error code ${code}`;
        }
        this.emit('error', new Error(errorMessage));
      }
      this.process = null;
    });
  }
  
  stopBackup(): void {
    if (this.process) {
      this.isStopping = true;
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  /**
   * Calculate total size of files to transfer before backup starts
   */
  private async calculateTotalSize(remotePath: string): Promise<number> {
    return new Promise(async (resolve) => {
      const rclonePath = await this.getRclonePath();
      const args = ['size', remotePath, '--json', ...this.buildR2RemoteArgs()];

      console.log('[Backup] Pre-scanning total size:', remotePath);

      const proc = spawn(rclonePath, args);
      let output = '';
      let error = '';

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        error += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && output.trim()) {
          try {
            const data = JSON.parse(output);
            console.log('[Backup] Total size pre-scan result:', data.bytes, 'bytes (', (data.bytes / (1024 * 1024 * 1024)).toFixed(2), 'GB)');
            resolve(data.bytes || 0);
          } catch (err) {
            console.error('[Backup] Failed to parse size JSON:', err);
            resolve(0);
          }
        } else {
          console.log('[Backup] Size pre-scan failed, will use dynamic totals');
          resolve(0); // Fallback to dynamic if scan fails
        }
      });

      proc.on('error', (err) => {
        console.error('[Backup] Size pre-scan error:', err);
        resolve(0);
      });
    });
  }

  /**
   * Check available disk space on the filesystem containing the given path
   */
  private async checkDiskSpace(path: string): Promise<{ available: number, total: number }> {
    const stats = await statfs(path);
    return {
      available: stats.bavail * stats.bsize, // Available blocks * block size
      total: stats.blocks * stats.bsize
    };
  }

  /**
   * Format bytes into human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
  }

  /**
   * Parse human-readable size string to bytes
   */
  private parseBytes(str: string): number {
    const match = str.trim().match(/([0-9.]+)\s*(\w+)/);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();

    const multipliers: Record<string, number> = {
      'b': 1,
      'kib': 1024,
      'mib': 1024 * 1024,
      'gib': 1024 * 1024 * 1024,
      'tib': 1024 * 1024 * 1024 * 1024,
      // Also support KB, MB, GB (decimal) just in case
      'kb': 1000,
      'mb': 1000 * 1000,
      'gb': 1000 * 1000 * 1000,
      'tb': 1000 * 1000 * 1000 * 1000
    };

    return value * (multipliers[unit] || 1);
  }

  /**
   * Convert speed from bytes/second to bits/second (Kbps, Mbps, Gbps)
   * Network speeds are typically shown in bits, not bytes
   */
  private formatSpeedToBits(speedString: string): string {
    // Parse the speed string (e.g., "56.638 MiB/s" or "0 B/s")
    const match = speedString.trim().match(/([0-9.]+)\s*(\w+)\/s/);
    if (!match) return '0 Kbps';

    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();

    // Convert to bytes per second first
    const bytesPerSecond = (() => {
      const multipliers: Record<string, number> = {
        'b': 1,
        'kib': 1024,
        'mib': 1024 * 1024,
        'gib': 1024 * 1024 * 1024,
        'tib': 1024 * 1024 * 1024 * 1024,
        // Also support KB, MB, GB (decimal)
        'kb': 1000,
        'mb': 1000 * 1000,
        'gb': 1000 * 1000 * 1000,
        'tb': 1000 * 1000 * 1000 * 1000
      };
      return value * (multipliers[unit] || 1);
    })();

    // Convert bytes to bits (multiply by 8)
    const bitsPerSecond = bytesPerSecond * 8;

    // Format using decimal units (1000-based) as per networking standards
    if (bitsPerSecond === 0) return '0 Kbps';
    if (bitsPerSecond < 1000) return `${bitsPerSecond.toFixed(1)} bps`;
    if (bitsPerSecond < 1000000) return `${(bitsPerSecond / 1000).toFixed(1)} Kbps`;
    if (bitsPerSecond < 1000000000) return `${(bitsPerSecond / 1000000).toFixed(1)} Mbps`;
    return `${(bitsPerSecond / 1000000000).toFixed(1)} Gbps`;
  }

  private parseProgress(output: string): RcloneProgress | null {
    // New format: "1.389 GiB / 1.389 GiB, 100%, 56.638 MiB/s, ETA 0s"
    const newFormatMatch = output.match(/([0-9.]+\s+\w+)\s+\/\s+([0-9.]+\s+\w+),\s+(\d+)%,\s+([0-9.]+\s+\w+\/s),\s+ETA\s+(.+?)(?:\s|$)/);
    
    if (newFormatMatch) {
      // Calculate our own percentage based on fixed pre-scanned total
      const transferredBytes = this.parseBytes(newFormatMatch[1]);
      const percentage = this.prescannedTotalBytes > 0
        ? Math.min(100, Math.round((transferredBytes / this.prescannedTotalBytes) * 100))
        : parseInt(newFormatMatch[3]) || 0;  // Fallback to rclone's % if no pre-scan

      return {
        percentage,  // Use our calculated percentage!
        speed: this.formatSpeedToBits(newFormatMatch[4] || '0 B/s'),
        eta: newFormatMatch[5] || '-',
        transferred: newFormatMatch[1] || '0',
        totalSize: this.prescannedTotalBytes > 0
          ? this.formatBytes(this.prescannedTotalBytes)  // Use fixed pre-scanned total!
          : newFormatMatch[2],  // Fallback to rclone's dynamic total if pre-scan failed
        errors: 0,  // Not in this format
        checks: 0,   // Not in this format
        transferring: undefined  // Need to parse separately
      };
    }
    
    // Old format fallback
    const progressMatch = output.match(/Transferred:\s+([^,]+),\s+(\d+)%.*ETA\s+([^,]+)/);
    const speedMatch = output.match(/(\d+\.?\d*\s+\w+\/s)/);
    const statsMatch = output.match(/Errors:\s+(\d+).*Checks:\s+(\d+)/);
    const transferringMatch = output.match(/Transferring:\s*\n\s*\*\s+(.+?):/);
    
    if (progressMatch) {
      return {
        percentage: parseInt(progressMatch[2]) || 0,
        speed: this.formatSpeedToBits(speedMatch ? speedMatch[1] : '0 B/s'),
        eta: progressMatch[3] || '-',
        transferred: progressMatch[1] || '0',
        errors: statsMatch ? parseInt(statsMatch[1]) : 0,
        checks: statsMatch ? parseInt(statsMatch[2]) : 0,
        transferring: transferringMatch ? transferringMatch[1] : undefined
      };
    }
    
    return null;
  }
  
  private parseTransferredFile(output: string): string | null {
    // Parse normal rclone output for transferred files
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      // Look for patterns that indicate a file was successfully transferred
      // Pattern 1: "2025/08/24 00:41:48 INFO  : filename: Multi-thread Copied (new)"
      const multiThreadMatch = line.match(/INFO\s+:\s+(.+?):\s+Multi-thread\s+Copied\s+\(new\)/);
      if (multiThreadMatch) {
        return multiThreadMatch[1].trim();
      }
      
      // Pattern 2: "INFO  : filename: Copied (new)"
      const copiedNewMatch = line.match(/INFO\s+:\s+(.+?):\s+Copied\s+\(new\)/);
      if (copiedNewMatch) {
        return copiedNewMatch[1].trim();
      }
      
      // Pattern 3: "INFO  : filename: Copied (replaced existing)"
      const copiedReplacedMatch = line.match(/INFO\s+:\s+(.+?):\s+Copied\s+\(replaced existing\)/);
      if (copiedReplacedMatch) {
        return copiedReplacedMatch[1].trim();
      }
      
      // Pattern 4: Generic "Copied" message
      const copiedMatch = line.match(/INFO\s+:\s+(.+?):\s+(?:Multi-thread\s+)?Copied/);
      if (copiedMatch) {
        return copiedMatch[1].trim();
      }
    }
    
    return null;
  }
  
  private parseSkippedFile(output: string): string | null {
    // Parse rclone output for skipped files
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      // Pattern 1: "DEBUG : filename: Unchanged skipping"
      const unchangedMatch = line.match(/DEBUG\s+:\s+(.+?):\s+Unchanged\s+skipping/);
      if (unchangedMatch) {
        return unchangedMatch[1].trim();
      }
      
      // Pattern 2: "DEBUG : filename: Size and modification time the same"
      const sameMatch = line.match(/DEBUG\s+:\s+(.+?):\s+Size\s+and\s+modification\s+time\s+the\s+same/);
      if (sameMatch) {
        // Only return if not a system message
        const fileName = sameMatch[1].trim();
        if (!fileName.includes('Local file system') && !fileName.includes('backend')) {
          return fileName;
        }
      }
    }
    
    return null;
  }
}

export default RcloneHandler;
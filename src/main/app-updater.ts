import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

interface UpdateManifest {
  version: string;
  releaseDate: string;
  releaseNotes: string;
  files: Array<{
    url: string;
    sha512: string;
    size: number;
  }>;
}

export class AppUpdater extends EventEmitter {
  private isDocker: boolean;

  constructor() {
    super();
    this.isDocker = process.env.DOCKER === 'true';
  }

  /**
   * Check if auto-update is available (only in Docker mode)
   */
  canAutoUpdate(): boolean {
    return this.isDocker;
  }

  /**
   * Install update from manifest (Docker only)
   */
  async installUpdate(manifest: UpdateManifest): Promise<void> {
    if (!this.isDocker) {
      throw new Error('Auto-update is only available in Docker mode');
    }

    if (!manifest.files || manifest.files.length === 0) {
      throw new Error('No update files available in manifest');
    }

    const debUrl = manifest.files[0].url;
    const tmpPath = '/tmp/r2clone-update.deb';

    try {
      this.emit('status', 'Downloading update...');

      // Download the .deb file
      await this.downloadFile(debUrl, tmpPath, manifest.files[0].size);

      this.emit('progress', { stage: 'installing', progress: 0 });

      // Run apt-get update
      this.emit('status', 'Running apt-get update...');
      await this.runCommand('apt-get', ['update']);
      this.emit('progress', { stage: 'installing', progress: 25 });

      // Fix any dependency issues
      this.emit('status', 'Checking dependencies...');
      await this.runCommand('apt-get', ['install', '-f', '-y']);
      this.emit('progress', { stage: 'installing', progress: 50 });

      // Install the .deb package
      this.emit('status', 'Installing R2Clone package...');
      await this.runCommand('dpkg', ['-i', tmpPath]);
      this.emit('progress', { stage: 'installing', progress: 75 });

      // Fix any remaining dependencies
      this.emit('status', 'Finalizing installation...');
      await this.runCommand('apt-get', ['install', '-f', '-y']);
      this.emit('progress', { stage: 'installing', progress: 100 });

      // Clean up
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }

      this.emit('status', 'Update installed successfully');
      this.emit('complete', manifest.version);
    } catch (error: any) {
      this.emit('error', error.message);
      throw error;
    }
  }

  /**
   * Download file with progress tracking
   */
  private downloadFile(url: string, dest: string, totalSize: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(dest);
      let downloadedSize = 0;

      protocol.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          const progress = Math.round((downloadedSize / totalSize) * 100);
          this.emit('progress', { stage: 'downloading', progress });
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });

        file.on('error', (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    });
  }

  /**
   * Run a command and wait for completion, streaming output
   */
  private runCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      process.stdout?.on('data', (data) => {
        const text = data.toString();
        stdout += text;

        // Stream meaningful output lines to UI
        const lines = text.split('\n').filter((line: string) => line.trim());
        lines.forEach((line: string) => {
          // Filter out progress bars and less useful lines
          if (!line.includes('%') && !line.includes('...') && line.length > 10) {
            this.emit('status', line.trim());
          }
        });
      });

      process.stderr?.on('data', (data) => {
        const text = data.toString();
        stderr += text;

        // Stream meaningful stderr lines to UI
        const lines = text.split('\n').filter((line: string) => line.trim());
        lines.forEach((line: string) => {
          // Show important package manager messages
          if (line.includes('Unpacking') || line.includes('Setting up') ||
              line.includes('Reading package lists') || line.includes('Building dependency tree')) {
            this.emit('status', line.trim());
          }
        });
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
        }
      });

      process.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Restart the application (Docker will restart container automatically)
   */
  restart(): void {
    if (!this.isDocker) {
      throw new Error('Restart is only available in Docker mode');
    }

    console.log('[AppUpdater] Restarting application...');
    // Exit with code 0 so Docker's restart policy kicks in
    process.exit(0);
  }
}

export default AppUpdater;

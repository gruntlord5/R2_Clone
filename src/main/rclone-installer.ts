import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';
import extractZip from 'extract-zip';
import tar from 'tar';
import { EventEmitter } from 'events';

const RCLONE_VERSION = 'v1.67.0'; // Update this to latest stable version
const GITHUB_RELEASES_URL = 'https://github.com/rclone/rclone/releases/download';

interface RcloneAsset {
  platform: NodeJS.Platform;
  arch: string;
  url: string;
  fileName: string;
  extractedBinary: string;
}

export class RcloneInstaller extends EventEmitter {
  private installPath: string;
  private rclonePath: string;

  // In-memory cache for instant access
  private _isInstalled: boolean | null = null;
  private _version: string | null = null;
  private _path: string | null = null;

  constructor() {
    super();
    this.installPath = path.join(app.getPath('userData'), 'rclone');
    this.rclonePath = path.join(this.installPath, process.platform === 'win32' ? 'rclone.exe' : 'rclone');
  }

  /**
   * Initialize the installer - check rclone status once on app startup
   */
  async initialize(): Promise<void> {
    this._isInstalled = await this.checkIsInstalled();
    if (this._isInstalled) {
      this._version = await this.checkVersion();
      this._path = this.calculatePath();
    }
  }

  /**
   * Get cached install status (instant, synchronous)
   */
  getInstallStatus() {
    return {
      isInstalled: this._isInstalled ?? false,
      version: this._version,
      path: this._path
    };
  }
  
  /**
   * Check if rclone is installed (private - called once on startup)
   */
  private async checkIsInstalled(): Promise<boolean> {
    // First check if rclone is in system PATH
    try {
      execSync('rclone version', { stdio: 'ignore' });
      return true;
    } catch {
      // Not in PATH, check local installation
    }

    // Check local installation
    if (fs.existsSync(this.rclonePath)) {
      try {
        execSync(`"${this.rclonePath}" version`, { stdio: 'ignore' });
        return true;
      } catch {
        // Local installation exists but doesn't work
        return false;
      }
    }

    return false;
  }
  
  /**
   * Calculate the path to rclone executable (private - called once on startup)
   */
  private calculatePath(): string {
    // If rclone is in system PATH, use that
    try {
      execSync('rclone version', { stdio: 'ignore' });
      return 'rclone';
    } catch {
      // Return local installation path
      return this.rclonePath;
    }
  }

  /**
   * Get the cached path to rclone executable (instant, synchronous)
   */
  getPath(): string {
    return this._path || this.rclonePath;
  }
  
  /**
   * Check rclone version (private - called once on startup)
   */
  private async checkVersion(): Promise<string | null> {
    try {
      const rclonePath = this.calculatePath();
      const output = execSync(`"${rclonePath}" version`, { encoding: 'utf8' });
      const match = output.match(/rclone v([\d.]+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }
  
  /**
   * Get the appropriate download URL based on platform and architecture
   */
  private getDownloadInfo(): RcloneAsset {
    const platform = process.platform;
    const arch = process.arch;
    
    let assetName: string;
    let extractedBinary: string;
    
    switch (platform) {
      case 'darwin':
        // macOS
        if (arch === 'arm64') {
          assetName = `rclone-${RCLONE_VERSION}-osx-arm64.zip`;
        } else {
          assetName = `rclone-${RCLONE_VERSION}-osx-amd64.zip`;
        }
        extractedBinary = 'rclone';
        break;
        
      case 'win32':
        // Windows
        if (arch === 'x64') {
          assetName = `rclone-${RCLONE_VERSION}-windows-amd64.zip`;
        } else {
          assetName = `rclone-${RCLONE_VERSION}-windows-386.zip`;
        }
        extractedBinary = 'rclone.exe';
        break;
        
      case 'linux':
        // Linux
        if (arch === 'x64') {
          assetName = `rclone-${RCLONE_VERSION}-linux-amd64.zip`;
        } else if (arch === 'arm64') {
          assetName = `rclone-${RCLONE_VERSION}-linux-arm64.zip`;
        } else {
          assetName = `rclone-${RCLONE_VERSION}-linux-386.zip`;
        }
        extractedBinary = 'rclone';
        break;
        
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
    
    return {
      platform,
      arch,
      url: `${GITHUB_RELEASES_URL}/${RCLONE_VERSION}/${assetName}`,
      fileName: assetName,
      extractedBinary
    };
  }
  
  /**
   * Download rclone from GitHub releases
   */
  private async downloadRclone(downloadInfo: RcloneAsset): Promise<string> {
    const downloadPath = path.join(app.getPath('temp'), downloadInfo.fileName);

    this.emit('progress', { stage: 'downloading', progress: 0 });

    const response = await fetch(downloadInfo.url);

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.statusText}`);
    }

    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const writer = fs.createWriteStream(downloadPath);
    let downloadedBytes = 0;

    // Read the response body stream and track progress
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        downloadedBytes += value.length;
        writer.write(value);

        // Emit progress if we know the total size
        if (totalBytes > 0) {
          const percentCompleted = Math.round((downloadedBytes * 100) / totalBytes);
          this.emit('progress', { stage: 'downloading', progress: percentCompleted });
        }
      }

      return new Promise((resolve, reject) => {
        writer.end(() => resolve(downloadPath));
        writer.on('error', reject);
      });
    } catch (error) {
      writer.destroy();
      throw error;
    }
  }
  
  /**
   * Extract the downloaded archive
   */
  private async extractArchive(archivePath: string, downloadInfo: RcloneAsset): Promise<void> {
    this.emit('progress', { stage: 'extracting', progress: 0 });
    
    // Create installation directory if it doesn't exist
    if (!fs.existsSync(this.installPath)) {
      fs.mkdirSync(this.installPath, { recursive: true });
    }
    
    const tempExtractPath = path.join(app.getPath('temp'), 'rclone-extract');
    
    if (archivePath.endsWith('.zip')) {
      await extractZip(archivePath, { dir: tempExtractPath });
    } else if (archivePath.endsWith('.tar.gz')) {
      await tar.extract({
        file: archivePath,
        cwd: tempExtractPath
      });
    }
    
    this.emit('progress', { stage: 'extracting', progress: 50 });
    
    // Find the rclone binary in extracted files
    const extractedDir = fs.readdirSync(tempExtractPath)[0];
    const sourceBinary = path.join(tempExtractPath, extractedDir, downloadInfo.extractedBinary);
    
    // Copy binary to installation path
    fs.copyFileSync(sourceBinary, this.rclonePath);
    
    // Make executable on Unix-like systems
    if (process.platform !== 'win32') {
      fs.chmodSync(this.rclonePath, 0o755);
    }
    
    // Clean up temp files
    fs.rmSync(tempExtractPath, { recursive: true, force: true });
    fs.unlinkSync(archivePath);
    
    this.emit('progress', { stage: 'extracting', progress: 100 });
  }
  
  /**
   * Install rclone
   */
  async install(): Promise<void> {
    try {
      this.emit('status', 'Starting rclone installation...');

      // Check if already installed
      if (await this.checkIsInstalled()) {
        this.emit('status', 'Rclone is already installed');
        this.emit('complete', this.getPath());
        return;
      }

      // Get download information
      const downloadInfo = this.getDownloadInfo();
      this.emit('status', `Downloading rclone for ${downloadInfo.platform} ${downloadInfo.arch}...`);

      // Download rclone
      const archivePath = await this.downloadRclone(downloadInfo);
      this.emit('status', 'Download complete. Extracting...');

      // Extract and install
      await this.extractArchive(archivePath, downloadInfo);

      // Verify installation and update cache
      if (await this.checkIsInstalled()) {
        const version = await this.checkVersion();
        const installedPath = this.calculatePath();

        // Update in-memory cache
        this._isInstalled = true;
        this._version = version;
        this._path = installedPath;

        this.emit('status', `Rclone ${version} installed successfully!`);
        this.emit('complete', installedPath);
      } else {
        throw new Error('Installation verification failed');
      }
    } catch (error: any) {
      this.emit('error', error.message || 'Installation failed');
      throw error;
    }
  }
  
  /**
   * Uninstall local rclone installation
   */
  async uninstall(): Promise<void> {
    if (fs.existsSync(this.installPath)) {
      fs.rmSync(this.installPath, { recursive: true, force: true });

      // Clear in-memory cache
      this._isInstalled = false;
      this._version = null;
      this._path = null;

      this.emit('status', 'Rclone uninstalled');
    }
  }
}

export default RcloneInstaller;
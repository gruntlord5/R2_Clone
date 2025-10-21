import * as https from 'https';
import * as http from 'http';
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

export class UpdateManager extends EventEmitter {
  private manifestUrl: string;
  private currentVersion: string;

  constructor(currentVersion: string) {
    super();
    this.currentVersion = currentVersion;
    this.manifestUrl = this.getManifestUrl();
  }

  private getManifestUrl(): string {
    const baseUrl = 'https://r2clone.gruntmods.com/api/releases';

    if (process.platform === 'darwin') {
      return `${baseUrl}/mac.json`;
    } else if (process.platform === 'win32') {
      return process.arch === 'arm64'
        ? `${baseUrl}/windows-arm64.json`
        : `${baseUrl}/windows.json`;
    } else {
      const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
      return `${baseUrl}/linux-${arch}.json`;
    }
  }

  async checkForUpdates(): Promise<UpdateManifest | null> {
    try {
      console.log('[UpdateManager] Checking for updates at:', this.manifestUrl);
      this.emit('checking');

      const manifest = await this.fetchManifest();

      if (!manifest) {
        this.emit('not-available');
        return null;
      }

      // Compare versions (simple string comparison works for semver)
      if (this.compareVersions(manifest.version, this.currentVersion) > 0) {
        console.log('[UpdateManager] Update available:', manifest.version);
        this.emit('available', manifest);
        return manifest;
      } else {
        console.log('[UpdateManager] Already up to date');
        this.emit('not-available');
        return null;
      }
    } catch (error: any) {
      console.error('[UpdateManager] Error checking for updates:', error);
      this.emit('error', error.message);
      throw error;
    }
  }

  private fetchManifest(): Promise<UpdateManifest> {
    return new Promise((resolve, reject) => {
      const protocol = this.manifestUrl.startsWith('https') ? https : http;

      protocol.get(this.manifestUrl, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const manifest = JSON.parse(data);
            resolve(manifest);
          } catch (err) {
            reject(new Error('Invalid manifest JSON'));
          }
        });
      }).on('error', reject);
    });
  }

  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;

      if (part1 > part2) return 1;
      if (part1 < part2) return -1;
    }

    return 0;
  }

}

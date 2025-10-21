import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import selfsigned from 'selfsigned';

interface CertificateInfo {
  cert: string;
  key: string;
  fingerprint: string;
  expiresAt: Date;
  createdAt: Date;
}

export class CertificateManager {
  private certDir: string;
  private certPath: string;
  private keyPath: string;

  constructor() {
    // Store certificates in app data directory
    this.certDir = path.join(app.getPath('userData'), 'certs');
    this.certPath = path.join(this.certDir, 'server.crt');
    this.keyPath = path.join(this.certDir, 'server.key');
  }

  /**
   * Get or create SSL certificates for HTTPS
   */
  public async getCertificates(): Promise<CertificateInfo> {
    // Check if certificates already exist and are valid
    if (this.certificatesExist() && this.certificatesValid()) {
      console.log('[CertManager] Using existing certificates');
      return this.loadCertificates();
    }

    // Generate new certificates
    console.log('[CertManager] Generating new self-signed certificates...');
    return this.generateCertificates();
  }

  /**
   * Check if certificate files exist
   */
  private certificatesExist(): boolean {
    return fs.existsSync(this.certPath) && fs.existsSync(this.keyPath);
  }

  /**
   * Check if existing certificates are still valid (not expired)
   */
  private certificatesValid(): boolean {
    try {
      const cert = fs.readFileSync(this.certPath, 'utf8');
      const certInfo = this.parseCertificate(cert);

      // Check if certificate expires within next 30 days
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      if (certInfo.expiresAt < thirtyDaysFromNow) {
        console.log('[CertManager] Certificate expires soon, will regenerate');
        return false;
      }

      return true;
    } catch (error) {
      console.error('[CertManager] Error validating certificate:', error);
      return false;
    }
  }

  /**
   * Load existing certificates from disk
   */
  private loadCertificates(): CertificateInfo {
    const cert = fs.readFileSync(this.certPath, 'utf8');
    const key = fs.readFileSync(this.keyPath, 'utf8');

    const info = this.parseCertificate(cert);

    return {
      cert,
      key,
      fingerprint: info.fingerprint,
      expiresAt: info.expiresAt,
      createdAt: info.createdAt,
    };
  }

  /**
   * Generate new self-signed certificates
   */
  private generateCertificates(): CertificateInfo {
    // Ensure cert directory exists
    if (!fs.existsSync(this.certDir)) {
      fs.mkdirSync(this.certDir, { recursive: true });
    }

    // Define certificate attributes
    const attrs = [
      { name: 'commonName', value: 'localhost' },
      { name: 'countryName', value: 'US' },
      { name: 'organizationName', value: 'R2Clone' },
    ];

    // Certificate valid for 10 years
    const validityDays = 3650;

    // Generate self-signed certificate with Subject Alternative Names
    const pems = selfsigned.generate(attrs, {
      keySize: 2048,
      days: validityDays,
      algorithm: 'sha256',
      extensions: [
        {
          name: 'basicConstraints',
          cA: true,
        },
        {
          name: 'keyUsage',
          keyCertSign: true,
          digitalSignature: true,
          nonRepudiation: true,
          keyEncipherment: true,
          dataEncipherment: true,
        },
        {
          name: 'extKeyUsage',
          serverAuth: true,
          clientAuth: true,
        },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' }, // DNS
            { type: 2, value: 'localhost.localdomain' },
            { type: 7, ip: '127.0.0.1' }, // IP
            { type: 7, ip: '::1' }, // IPv6 loopback
          ],
        },
      ],
    });

    // Save to disk with restrictive permissions
    fs.writeFileSync(this.certPath, pems.cert, { mode: 0o600 });
    fs.writeFileSync(this.keyPath, pems.private, { mode: 0o600 });

    console.log('[CertManager] Generated new certificates at:', this.certDir);

    const info = this.parseCertificate(pems.cert);

    return {
      cert: pems.cert,
      key: pems.private,
      fingerprint: info.fingerprint,
      expiresAt: info.expiresAt,
      createdAt: info.createdAt,
    };
  }


  /**
   * Parse certificate to extract metadata
   */
  private parseCertificate(cert: string): { fingerprint: string; expiresAt: Date; createdAt: Date } {
    // Calculate SHA-256 fingerprint
    const hash = crypto.createHash('sha256');
    hash.update(cert);
    const fingerprint = hash.digest('hex').match(/.{2}/g)?.join(':').toUpperCase() || '';

    // For self-signed certs, we'll use creation time and expiry based on filesystem
    const stats = fs.existsSync(this.certPath) ? fs.statSync(this.certPath) : null;
    const createdAt = stats ? stats.birthtime : new Date();

    // Our certs are valid for 10 years
    const expiresAt = new Date(createdAt);
    expiresAt.setFullYear(expiresAt.getFullYear() + 10);

    return {
      fingerprint,
      expiresAt,
      createdAt,
    };
  }

  /**
   * Regenerate certificates (useful if user wants to refresh)
   */
  public async regenerateCertificates(): Promise<CertificateInfo> {
    console.log('[CertManager] Regenerating certificates...');

    // Delete old certificates
    if (fs.existsSync(this.certPath)) {
      fs.unlinkSync(this.certPath);
    }
    if (fs.existsSync(this.keyPath)) {
      fs.unlinkSync(this.keyPath);
    }

    return this.generateCertificates();
  }

  /**
   * Get certificate info without loading full cert/key
   */
  public getCertificateInfo(): { fingerprint: string; expiresAt: Date; createdAt: Date } | null {
    if (!this.certificatesExist()) {
      return null;
    }

    try {
      const cert = fs.readFileSync(this.certPath, 'utf8');
      return this.parseCertificate(cert);
    } catch (error) {
      console.error('[CertManager] Error reading certificate info:', error);
      return null;
    }
  }
}

// Singleton instance
let certManager: CertificateManager | null = null;

export function getCertificateManager(): CertificateManager {
  if (!certManager) {
    certManager = new CertificateManager();
  }
  return certManager;
}

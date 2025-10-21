const fs = require('fs');
const path = require('path');

// Standardize artifact filenames after build
exports.postMake = async (config, makeResults) => {
  console.log('📦 Standardizing artifact filenames...');

  const packageJson = require('./package.json');
  const version = packageJson.version;

  // Process each platform's artifacts and rename to standard names
  for (const result of makeResults) {
    const { platform, arch, artifacts } = result;

    for (const artifactPath of artifacts) {
      const fileName = path.basename(artifactPath);
      const fileSize = fs.statSync(artifactPath).size;

      // Determine standardized filename
      let standardName = '';

      if (platform === 'darwin') {
        // Handle both DMG and ZIP formats
        if (fileName.endsWith('.dmg')) {
          standardName = `r2clone-${version}-mac-universal.dmg`;
        } else if (fileName.endsWith('.zip')) {
          standardName = `r2clone-${version}-mac-universal.zip`;
        }
      } else if (platform === 'win32') {
        if (fileName.includes('Setup')) {
          // Include architecture in filename
          const archSuffix = arch === 'arm64' ? '-arm64' : '';
          standardName = `r2clone-Setup-${version}${archSuffix}.exe`;
        }
      } else if (platform === 'linux') {
        if (fileName.endsWith('.deb')) {
          // Include architecture in filename
          const archName = arch === 'arm64' ? 'arm64' : 'amd64';
          standardName = `r2clone-${version}-${archName}.deb`;
        } else if (fileName.endsWith('.rpm')) {
          // Include architecture in filename
          const archName = arch === 'arm64' ? 'aarch64' : 'x86_64';
          standardName = `r2clone-${version}-${archName}.rpm`;
        } else if (fileName.endsWith('.AppImage')) {
          const archSuffix = arch === 'arm64' ? '-arm64' : '';
          standardName = `r2clone-${version}${archSuffix}.AppImage`;
        }
      }

      if (standardName) {
        // Rename the artifact to match the standardized name
        const artifactDir = path.dirname(artifactPath);
        const newArtifactPath = path.join(artifactDir, standardName);

        if (artifactPath !== newArtifactPath) {
          fs.renameSync(artifactPath, newArtifactPath);
          console.log(`  ↻ Renamed: ${fileName} → ${standardName}`);
          console.log(`     Size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
        } else {
          console.log(`  ✓ ${standardName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
        }
      }
    }
  }

  console.log(`\n📦 Build artifacts ready`);
};
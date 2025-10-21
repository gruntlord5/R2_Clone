const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const hooks = require('./forge-hooks');

module.exports = {
  hooks,
  packagerConfig: {
    asar: true,
    executableName: 'r2clone',
    appBundleId: 'com.gruntmods.r2clone',
    appCategoryType: 'public.app-category.utilities',
    icon: './resources/icons/icon', // Electron Forge will automatically select .icns for macOS, .ico for Windows, .png for Linux
    osxSign: false, // Disable code signing to allow universal builds in CI
    // Universal binary support (x64 + arm64)
    osxUniversal: {
      x64ArchFiles: '*',
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULFO', // Universal Disk Image Format
        name: 'R2Clone',
      },
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

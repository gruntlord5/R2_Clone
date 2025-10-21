import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Info, RefreshCw, Download, CheckCircle, Loader2, Copy } from 'lucide-react';
import { forwardRef, useImperativeHandle, useState, useEffect } from 'react';
import { apiClient, onWebSocketReconnect } from '~/lib/api-client';
import ReactMarkdown from 'react-markdown';

interface AboutDialogProps {
  trigger?: React.ReactNode;
}

export interface AboutDialogRef {
  open: () => void;
  close: () => void;
}

export const AboutDialog = forwardRef<AboutDialogRef, AboutDialogProps>(({ trigger }, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [checkingForUpdate, setCheckingForUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateSuccess, setUpdateSuccess] = useState<string | null>(null);
  const [copiedCommand, setCopiedCommand] = useState(false);

  // Docker auto-update state
  const [isDocker, setIsDocker] = useState(false);
  const [canAutoUpdate, setCanAutoUpdate] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<any>(null);
  const [installStatus, setInstallStatus] = useState<string>('');
  const [updateInstalled, setUpdateInstalled] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Check if running in Electron
  const isElectron = typeof window !== 'undefined' &&
    typeof (window as any).electronAPI?.versions?.electron !== 'undefined';

  useImperativeHandle(ref, () => ({
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  }));
  
  useEffect(() => {
    // Get app version
    apiClient.app.getVersion().then(setAppVersion);

    // Set up auto-updater event listeners (Electron only)
    if (isElectron) {
      const handleUpdateAvailable = (info: any) => {
        setUpdateInfo(info);
        setUpdateAvailable(true);
        setCheckingForUpdate(false);
      };

      const handleUpdateNotAvailable = () => {
        setUpdateAvailable(false);
        setCheckingForUpdate(false);
        setUpdateError(null);
        setUpdateSuccess('You are already running the latest version');
      };

      const handleUpdateError = (error: string) => {
        console.error('Update error:', error);
        setUpdateError(error || 'Failed to check for updates');
        setCheckingForUpdate(false);
      };

      window.electronAPI.app.onUpdateAvailable(handleUpdateAvailable);
      window.electronAPI.app.onUpdateNotAvailable(handleUpdateNotAvailable);
      window.electronAPI.app.onUpdateError(handleUpdateError);

      return () => {
        window.electronAPI.app.removeUpdateListeners();
      };
    } else {
      // Set up Docker auto-update WebSocket listeners (browser mode)
      apiClient.app.onAppUpdateStatus(setInstallStatus);
      apiClient.app.onAppUpdateProgress(setInstallProgress);
      apiClient.app.onAppUpdateError((error: string) => {
        setUpdateError(error);
        setIsInstalling(false);
      });
      apiClient.app.onAppUpdateComplete((version: string) => {
        setUpdateInstalled(true);
        setIsInstalling(false);
        setInstallStatus(`Update to v${version} installed successfully!`);
      });
    }
  }, [isElectron]);

  const handleCheckForUpdates = async () => {
    setCheckingForUpdate(true);
    setUpdateError(null);
    setUpdateSuccess(null);
    try {
      const result = await apiClient.app.checkForUpdates();

      // Handle browser mode response
      if (!isElectron) {
        // Set Docker flags from response
        if (result.isDocker !== undefined) setIsDocker(result.isDocker);
        if (result.canAutoUpdate !== undefined) setCanAutoUpdate(result.canAutoUpdate);

        if (result.success && result.updateAvailable) {
          setUpdateInfo(result.manifest);
          setUpdateAvailable(true);
        } else if (result.success && !result.updateAvailable) {
          setUpdateSuccess('You are already running the latest version');
        } else {
          setUpdateError(result.error || 'Failed to check for updates');
        }
        setCheckingForUpdate(false);
      }
      // Electron mode handles responses via event listeners
    } catch (error) {
      console.error('Failed to check for updates:', error);
      setUpdateError('Failed to check for updates');
      setCheckingForUpdate(false);
    }
  };

  // Detect platform and generate update command
  const getPlatformUpdateInfo = () => {
    if (!updateInfo || !updateInfo.files || updateInfo.files.length === 0) {
      return null;
    }

    const userAgent = navigator.userAgent.toLowerCase();
    const platform = navigator.platform.toLowerCase();

    // Detect platform
    let detectedPlatform = 'unknown';
    if (platform.includes('linux')) {
      detectedPlatform = 'linux';
    } else if (platform.includes('mac')) {
      detectedPlatform = 'mac';
    } else if (platform.includes('win')) {
      detectedPlatform = 'windows';
    }

    // Find appropriate file from manifest
    let updateFile = updateInfo.files[0]; // Default to first file
    const debFile = updateInfo.files.find((f: any) => f.url.endsWith('.deb'));
    const rpmFile = updateInfo.files.find((f: any) => f.url.endsWith('.rpm'));
    const dmgFile = updateInfo.files.find((f: any) => f.url.endsWith('.dmg'));
    const exeFile = updateInfo.files.find((f: any) => f.url.endsWith('.exe'));

    let command = '';
    let instructions = '';

    if (detectedPlatform === 'linux') {
      // Check if Debian/Ubuntu or RPM-based
      if (debFile) {
        command = `curl -L -o /tmp/r2clone.deb ${debFile.url} && sudo apt-get update && sudo apt-get install -f -y && sudo dpkg -i /tmp/r2clone.deb && sudo apt-get install -f -y`;
        instructions = 'Run this command in your terminal to download and install the update:';
        updateFile = debFile;
      } else if (rpmFile) {
        command = `curl -L -o /tmp/r2clone.rpm ${rpmFile.url} && sudo dnf install -y /tmp/r2clone.rpm`;
        instructions = 'Run this command in your terminal to download and install the update:';
        updateFile = rpmFile;
      }
    } else if (detectedPlatform === 'mac' && dmgFile) {
      instructions = `Download the DMG file and install manually:`;
      command = dmgFile.url;
      updateFile = dmgFile;
    } else if (detectedPlatform === 'windows' && exeFile) {
      instructions = `Download the installer and run it:`;
      command = exeFile.url;
      updateFile = exeFile;
    }

    return {
      platform: detectedPlatform,
      command,
      instructions,
      downloadUrl: updateFile.url,
    };
  };

  const handleCopyCommand = async () => {
    const platformInfo = getPlatformUpdateInfo();
    if (platformInfo && platformInfo.command) {
      try {
        await navigator.clipboard.writeText(platformInfo.command);
        setCopiedCommand(true);
        setTimeout(() => setCopiedCommand(false), 2000);
      } catch (error) {
        console.error('Failed to copy command:', error);
      }
    }
  };

  const handleDownloadAndQuit = async () => {
    if (!updateInfo || !updateInfo.files || updateInfo.files.length === 0) {
      setUpdateError('No download URL available');
      return;
    }

    try {
      const downloadUrl = updateInfo.files[0].url;
      // Open download in browser
      await window.electronAPI.shell.openExternal(downloadUrl);
      // Give browser a moment to start the download, then quit
      setTimeout(async () => {
        await window.electronAPI.app.quit();
      }, 500);
    } catch (error) {
      console.error('Failed to open download:', error);
      setUpdateError('Failed to open download URL');
    }
  };

  const handleInstallUpdate = async () => {
    if (!canAutoUpdate || !updateInfo) {
      return;
    }

    setIsInstalling(true);
    setUpdateError(null);

    try {
      const result = await apiClient.app.installUpdate(updateInfo);
      if (!result.success) {
        setUpdateError(result.error || 'Failed to start installation');
        setIsInstalling(false);
      }
      // Progress updates will come via WebSocket
    } catch (error) {
      console.error('Failed to install update:', error);
      setUpdateError('Failed to install update');
      setIsInstalling(false);
    }
  };

  const handleRestartApp = async () => {
    setIsRestarting(true);
    setIsReconnecting(true);
    setInstallStatus('Restarting container and reconnecting...');

    // Register callback for when WebSocket reconnects
    onWebSocketReconnect(() => {
      setIsReconnecting(false);
      setInstallStatus('Reconnected! Redirecting to home...');
      setTimeout(() => {
        window.location.href = '/';
      }, 1000);
    });

    // Set timeout fallback in case reconnection fails
    const failureTimeout = setTimeout(() => {
      setIsRestarting(false);
      setIsReconnecting(false);
      setUpdateError('Failed to reconnect. Please refresh the page manually.');
    }, 30000); // 30 second timeout

    try {
      await apiClient.app.restart();
      // App will restart, WebSocket will disconnect and auto-reconnect
      setIsRestarting(false);
    } catch (error) {
      console.error('Failed to restart:', error);
      setUpdateError('Failed to restart application');
      setIsRestarting(false);
      setIsReconnecting(false);
      clearTimeout(failureTimeout);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" className="flex items-center gap-1">
            <Info className="h-4 w-4" />
            About
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="flex flex-col gap-0 p-0 w-[85vw] sm:max-w-[85vw] h-[80vh] [&>button:last-child]:top-3.5">
        <DialogHeader className="contents space-y-0 text-left">
          <div className="border-b px-6 py-4">
            <DialogTitle className="text-base text-foreground">About R2Clone</DialogTitle>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm text-muted-foreground">Version {appVersion || 'Loading...'}</span>
              {!updateAvailable && !checkingForUpdate && (
                <Button
                  onClick={handleCheckForUpdates}
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Check for Updates
                </Button>
              )}
              {checkingForUpdate && (
                <Button
                  disabled
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                >
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Checking...
                </Button>
              )}
            </div>
          </div>
          <div className="flex-1 flex flex-col min-h-0">
            <DialogDescription asChild>
              <div className="px-6 py-4 flex-1 flex flex-col min-h-0">
                <div className="flex-1 flex flex-col gap-6 min-h-0">
                  {/* Updates Section */}
                  {(updateError || updateSuccess || updateAvailable) && (
                    <div className="space-y-3 flex-shrink-0">
                      {updateError && (
                      <div className="p-2 rounded-md bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
                        {updateError}
                      </div>
                    )}

                    {updateSuccess && (
                      <div className="p-3 rounded-lg border bg-green-50 dark:bg-green-900/20">
                        <div className="flex items-start gap-2">
                          <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5" />
                          <p className="text-sm font-medium text-green-900 dark:text-green-300">
                            {updateSuccess}
                          </p>
                        </div>
                      </div>
                    )}

                    {updateAvailable && (
                      <div className="p-3 rounded-lg border bg-blue-50 dark:bg-blue-900/20 space-y-2">
                        <div className="flex items-start gap-2">
                          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5" />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-blue-900 dark:text-blue-300">
                              Update available: v{updateInfo?.version}
                            </p>
                            {updateInfo?.releaseNotes && (
                              <div className="text-blue-700 dark:text-blue-400 mt-2 prose prose-sm dark:prose-invert max-w-none [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:first:mt-0 [&_h3]:text-blue-900 [&_h3]:dark:text-blue-300 [&_ul]:list-disc [&_ul]:list-inside [&_ul]:space-y-0.5 [&_ul]:ml-2 [&_li]:text-xs [&_p]:text-xs [&_p]:my-1">
                                <ReactMarkdown>
                                  {updateInfo.releaseNotes}
                                </ReactMarkdown>
                              </div>
                            )}
                          </div>
                        </div>

                        {isElectron ? (
                          <Button
                            onClick={handleDownloadAndQuit}
                            size="sm"
                            className="w-full"
                          >
                            <Download className="h-3.5 w-3.5 mr-1.5" />
                            Download & Quit
                          </Button>
                        ) : canAutoUpdate ? (
                          // Docker auto-update UI
                          <div className="space-y-2">
                            {!updateInstalled ? (
                              <>
                                {installStatus && (
                                  <div className="flex items-center gap-2">
                                    <Loader2 className="h-3 w-3 animate-spin text-blue-600 dark:text-blue-400" />
                                    <p className="text-xs text-blue-700 dark:text-blue-400 font-medium">
                                      {installStatus}
                                    </p>
                                  </div>
                                )}
                                {installProgress && (
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-xs text-blue-700 dark:text-blue-400">
                                      <span>{installProgress.stage === 'downloading' ? 'Downloading' : 'Installing'}...</span>
                                      <span>{installProgress.progress}%</span>
                                    </div>
                                    <div className="w-full bg-blue-200 dark:bg-blue-900/40 rounded-full h-2">
                                      <div
                                        className="bg-blue-600 dark:bg-blue-400 h-2 rounded-full transition-all"
                                        style={{ width: `${installProgress.progress}%` }}
                                      />
                                    </div>
                                  </div>
                                )}
                                <Button
                                  onClick={handleInstallUpdate}
                                  disabled={isInstalling}
                                  size="sm"
                                  className="w-full"
                                >
                                  {isInstalling ? (
                                    <>
                                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                      Installing...
                                    </>
                                  ) : (
                                    <>
                                      <Download className="h-3.5 w-3.5 mr-1.5" />
                                      Install Update
                                    </>
                                  )}
                                </Button>
                              </>
                            ) : (
                              <>
                                <p className="text-xs text-green-700 dark:text-green-400">
                                  {installStatus}
                                </p>
                                <Button
                                  onClick={handleRestartApp}
                                  disabled={isRestarting || isReconnecting}
                                  size="sm"
                                  className="w-full"
                                >
                                  {isRestarting || isReconnecting ? (
                                    <>
                                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                      {isRestarting ? 'Restarting...' : 'Reconnecting...'}
                                    </>
                                  ) : (
                                    <>
                                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                                      Restart Now
                                    </>
                                  )}
                                </Button>
                              </>
                            )}
                          </div>
                        ) : (
                          // Regular browser mode (non-Docker)
                          <p className="text-xs text-blue-700 dark:text-blue-400">
                          Open the desktop application to install this update.
                          </p>
                        )}
                      </div>
                    )}

                    </div>
                  )}
                  
                  {/* License Section */}
                  <div className="flex-1 flex flex-col gap-3 min-h-0">
                    <h3 className="text-sm font-semibold text-foreground flex-shrink-0">License</h3>
                    <div className="rounded-md bg-muted/50 p-4 flex-1 overflow-y-auto min-h-0">
                      <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap break-words">
{`Copyright (c) 2024 gruntlord5

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            </DialogDescription>
            <DialogFooter className="px-6 pb-6 sm:justify-center">
              <DialogClose asChild>
                <Button type="button" variant="secondary">Close</Button>
              </DialogClose>
            </DialogFooter>
          </div>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
});

AboutDialog.displayName = 'AboutDialog';
export interface ElectronAPI {
  versions: {
    electron: string;
    node: string;
    chrome: string;
  };
  sendMessage: (channel: string, data: any) => void;
  onMessage: (channel: string, func: (...args: any[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
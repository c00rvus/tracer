import { contextBridge, ipcRenderer } from "electron";
import type { TracerApi } from "../shared/ipc";
import { IPC_CHANNELS } from "./ipcChannels";

const api: TracerApi = {
  session: {
    launchBrowser: () => ipcRenderer.invoke(IPC_CHANNELS.launchBrowser),
    startCapture: () => ipcRenderer.invoke(IPC_CHANNELS.startCapture),
    pauseCapture: () => ipcRenderer.invoke(IPC_CHANNELS.pauseCapture),
    resumeCapture: () => ipcRenderer.invoke(IPC_CHANNELS.resumeCapture),
    stopCapture: () => ipcRenderer.invoke(IPC_CHANNELS.stopCapture),
    save: (filePath?: string) => ipcRenderer.invoke(IPC_CHANNELS.save, filePath),
    open: (filePath?: string) => ipcRenderer.invoke(IPC_CHANNELS.open, filePath),
    getTimeline: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.getTimeline, sessionId),
    getEvent: (eventId: string) => ipcRenderer.invoke(IPC_CHANNELS.getEvent, eventId),
    getScreenshot: (screenshotId: string) => ipcRenderer.invoke(IPC_CHANNELS.getScreenshot, screenshotId),
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getStatus),
    getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
    updateSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, settings),
    chooseDefaultSaveDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.chooseDefaultSaveDirectory)
  },
  window: {
    platform: process.platform as TracerApi["window"]["platform"],
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.windowToggleMaximize),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.windowClose),
    isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.windowIsMaximized),
    notifyLongCapture: (payload) => ipcRenderer.invoke(IPC_CHANNELS.windowNotifyLongCapture, payload),
    onStateChanged: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: { isMaximized: boolean }) =>
        listener(state);
      ipcRenderer.on(IPC_CHANNELS.windowStateChanged, wrapped);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.windowStateChanged, wrapped);
      };
    }
  }
};

contextBridge.exposeInMainWorld("tracer", api);

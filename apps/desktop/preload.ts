import { contextBridge, ipcRenderer } from 'electron';
import type { StudioBridge, StreamEvent } from '../../packages/contracts';
const bridge: StudioBridge = {
  windowControl: action => ipcRenderer.invoke('studio:windowControl', action),
  windowMaximized: () => ipcRenderer.invoke('studio:windowMaximized'),
  onWindowState: callback => {
    const listener = (_: Electron.IpcRendererEvent, value: boolean) => callback(value);
    ipcRenderer.on('studio:windowState', listener); return () => ipcRenderer.removeListener('studio:windowState', listener);
  },
  onConfirm: callback => {
    const listener = (_: Electron.IpcRendererEvent, value: import('../../packages/contracts').Confirmation) => callback(value);
    ipcRenderer.on('studio:confirm', listener); return () => ipcRenderer.removeListener('studio:confirm', listener);
  },
  answerConfirm: (id, accepted) => ipcRenderer.invoke('studio:answerConfirm', id, accepted),
  deleteSession: id => ipcRenderer.invoke('studio:deleteSession', id),
  bootstrap: () => ipcRenderer.invoke('studio:bootstrap'),
  openProject: () => ipcRenderer.invoke('studio:openProject'),
  relocateProject: id => ipcRenderer.invoke('studio:relocateProject', id),
  tree: (id, path) => ipcRenderer.invoke('studio:tree', id, path),
  readFile: (id, path) => ipcRenderer.invoke('studio:readFile', id, path),
  createSession: (projectId, providerId, model) => ipcRenderer.invoke('studio:createSession', projectId, providerId, model),
  configureSession: (id, providerId, model) => ipcRenderer.invoke('studio:configureSession', id, providerId, model),
  providerModels: (id, discover) => ipcRenderer.invoke('studio:providerModels', id, discover),
  saveProvider: (config, key) => ipcRenderer.invoke('studio:saveProvider', config, key),
  deleteProvider: id => ipcRenderer.invoke('studio:deleteProvider', id),
  probeProvider: id => ipcRenderer.invoke('studio:probeProvider', id),
  run: request => ipcRenderer.invoke('studio:run', request),
  stop: id => ipcRenderer.invoke('studio:stop', id),
  command: (id, command) => ipcRenderer.invoke('studio:command', id, command),
  propose: (id, snapshot, content) => ipcRenderer.invoke('studio:propose', id, snapshot, content),
  apply: id => ipcRenderer.invoke('studio:apply', id),
  rollback: id => ipcRenderer.invoke('studio:rollback', id),
  onEvent: callback => {
    const listener = (_: Electron.IpcRendererEvent, event: StreamEvent) => callback(event);
    ipcRenderer.on('studio:event', listener); return () => ipcRenderer.removeListener('studio:event', listener);
  },
};
contextBridge.exposeInMainWorld('studio', bridge);

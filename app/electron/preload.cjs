// Puente seguro entre la app y el proceso principal: solo expone el gestor de actualizaciones.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('canvasUpdater', {
  /** ¿Se puede actualizar desde la app? (no en la versión portable) */
  supported: () => ipcRenderer.invoke('upd:supported'),
  /** Descarga la versión nueva. Devuelve la versión descargada. */
  download: () => ipcRenderer.invoke('upd:download'),
  /** Cierra la app, instala y vuelve a abrirla. */
  install: () => ipcRenderer.invoke('upd:install'),
  onProgress: (fn) => {
    const h = (_e, p) => fn(p);
    ipcRenderer.on('upd:progress', h);
    return () => ipcRenderer.removeListener('upd:progress', h);
  },
});

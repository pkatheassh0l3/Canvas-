// Canvas++ para Windows (Electron).
// El cliente compilado (dist/) se sirve con un protocolo propio app:// en lugar de file://,
// para que funcionen los módulos, los workers (importar PDF) y el almacenamiento local.
const { app, BrowserWindow, shell, Menu, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  // no "secure": así la app puede conectar al NAS por http:// y ws:// en la red local
  { scheme: 'app', privileges: { standard: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 480,
    minHeight: 400,
    backgroundColor: '#faf9f6',
    title: 'Canvas++',
    icon: path.join(DIST, 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadURL('app://canvaspp/index.html');
  // enlaces externos (descargas de actualizaciones, links de documentos) → navegador del sistema
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  if (process.env.CANVAS_DEVTOOLS) win.webContents.openDevTools();
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
});
app.on('window-all-closed', () => app.quit());

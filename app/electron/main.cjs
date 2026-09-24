// Canvas++ para Windows (Electron). Carga el cliente compilado en dist/.
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('node:path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 480,
    minHeight: 400,
    backgroundColor: '#faf9f6',
    title: 'Canvas++',
    icon: path.join(__dirname, '..', 'dist', 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // enlaces externos → navegador del sistema
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.CANVAS_DEVTOOLS) win.webContents.openDevTools();
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

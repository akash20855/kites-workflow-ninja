// Mac desktop shell for the Kites and Threads workflow app.
// The app is fully offline: it loads index.html from this folder and keeps its data in
// this app's local storage, so nothing is needed from the network to use it.
const { app, BrowserWindow, session, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 880,
    minWidth: 380,
    title: 'Kites and Threads · Workflow',
    backgroundColor: '#f5f5f7',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  // Anything opening a new window (for example a link to the sync server) belongs in
  // the real browser, not in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  // The page is loaded from file://, which is an opaque origin, so the sync server's
  // cross origin reply would be hidden from it. Add the header to the /api/ replies
  // only; the server itself stays strict, and every page in a normal browser is served
  // from the server's own origin and needs none of this.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!/\/api\//.test(details.url)) return callback({});
    const headers = Object.assign({}, details.responseHeaders, {
      'Access-Control-Allow-Origin': ['*'],
    });
    callback({ responseHeaders: headers });
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

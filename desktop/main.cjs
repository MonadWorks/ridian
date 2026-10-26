const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, globalShortcut, shell, dialog, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createService, PORT } = require('../lib/server.cjs');
const { atomicWrite } = require('../lib/store.cjs');
app.setName('Ridian');
const testing = process.env.RIDIAN_TEST === '1';
const dataDir = process.env.RIDIAN_DATA_DIR || path.join(app.getPath('appData'), 'Ridian');
app.setPath('userData', dataDir);
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
let win, tray, service, expanded = false, hovered = false, dragState, preferences = {}, fading, scheduler;
const preferencesFile = path.join(dataDir, 'preferences.json');
const cloudFile = path.join(__dirname, 'cloud.json');
const cloudUrl = fs.existsSync(cloudFile) ? JSON.parse(fs.readFileSync(cloudFile, 'utf8')).url : null;
const webRoot = path.join(__dirname, '../web');
function savePreferences() { atomicWrite(preferencesFile, preferences); }
function fade(target) {
  clearInterval(fading);
  if (!win || win.isDestroyed()) return;
  const from = win.getOpacity(); const start = Date.now();
  fading = setInterval(() => {
    if (!win || win.isDestroyed()) return clearInterval(fading);
    const t = Math.min(1, (Date.now() - start) / 220);
    win.setOpacity(from + (target - from) * (1 - Math.pow(1 - t, 3)));
    if (t === 1) clearInterval(fading);
  }, 16);
}
function updateOpacity() { fade(hovered || win.isFocused() ? 1 : expanded ? 0.46 : 0.58); }
function clamped(bounds) {
  const area = screen.getDisplayMatching(bounds).workArea;
  return { ...bounds, x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width)), y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height)) };
}
function setExpanded(value) {
  expanded = !!value;
  const old = win.getBounds();
  const width = expanded ? 356 : 80;
  const height = expanded ? 468 : 80;
  win.setBounds(clamped({ x: old.x + old.width - width, y: old.y, width, height }));
  win.webContents.send('window:expanded', expanded);
  if (expanded) win.show();
  updateOpacity();
  return expanded;
}
function openHistory(online = false) {
  const base = online && cloudUrl ? cloudUrl : `http://127.0.0.1:${PORT}`;
  const token = online ? service.credentials.readToken : service.sessionToken;
  shell.openExternal(`${base}/#key=${encodeURIComponent(token)}`);
}
function showMenu() {
  const menu = Menu.buildFromTemplate([
    { label: 'Today', accelerator: 'CommandOrControl+Shift+Space', click: () => setExpanded(true) },
    { label: 'History', click: () => openHistory() },
    ...(cloudUrl ? [{ label: 'Online history', click: () => openHistory(true) }] : []),
    { type: 'separator' },
    { label: 'AI access', submenu: [
      { label: 'Copy read-only config', click: () => clipboard.writeText(JSON.stringify({ baseUrl: service.credentials.baseUrl, token: service.credentials.readToken, scope: 'read', endpoints: ['/api/v1/today', '/api/v1/history', '/api/v1/strategies'] }, null, 2)) },
      { label: 'Copy read & write config', click: () => clipboard.writeText(JSON.stringify({ baseUrl: service.credentials.baseUrl, token: service.credentials.writeToken, scope: 'write', endpoints: ['/api/v1/tasks', '/api/v1/strategies'] }, null, 2)) }
    ] },
    { label: 'Export…', click: async () => {
      const result = await dialog.showSaveDialog({ defaultPath: `Ridian-${service.store.today()}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!result.canceled && result.filePath) { try { atomicWrite(result.filePath, service.store.snapshot()); } catch { dialog.showErrorBox('Export failed', 'Choose a writable folder.'); } }
    } },
    { label: 'Data folder', click: () => shell.openPath(dataDir) },
    { label: 'Reset order', enabled: !!service.store.state.taskOrder?.length, click: () => { service.store.resetOrder(); win.webContents.send('window:expanded', expanded); } },
    { label: 'Open at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, enabled: app.isPackaged, click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { type: 'separator' },
    { label: 'Quit Ridian', accelerator: 'CommandOrControl+Q', click: () => app.quit() }
  ]);
  menu.popup({ window: win });
}
app.on('second-instance', () => { if (win) { setExpanded(true); win.show(); } });
app.whenReady().then(async () => {
  try {
    if (fs.existsSync(preferencesFile)) preferences = JSON.parse(fs.readFileSync(preferencesFile, 'utf8'));
    service = createService({ directory: dataDir, webRoot, allowedOrigins: cloudUrl ? [new URL(cloudUrl).origin] : [] });
    await service.start();
    service.store.materialize();
    scheduler = setInterval(() => { try { service.store.materialize(); } catch(e) { console.error('Schedule failed:', e.message); } }, 30000);
  } catch (e) {
    dialog.showErrorBox('Unable to start Ridian', e.code === 'EADDRINUSE' ? `Port ${PORT} is in use. Quit the other instance and retry.` : e.message);
    app.quit(); return;
  }
  const work = screen.getPrimaryDisplay().workArea;
  const position = preferences.position || { x: work.x + work.width - 112, y: work.y + 130 };
  win = new BrowserWindow({ ...clamped({ ...position, width: 80, height: 80 }), show: false, frame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false, hasShadow: false, alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#00000000', title: 'Ridian', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
  win.on('blur', updateOpacity);
  win.on('focus', updateOpacity);
  win.on('moved', () => {
    const b = win.getBounds();
    preferences.position = { x: b.x + b.width - 80, y: b.y };
    savePreferences();
  });
  screen.on('display-removed', () => win.setBounds(clamped(win.getBounds())));
  screen.on('display-metrics-changed', () => win.setBounds(clamped(win.getBounds())));
  const validSender = event => event.sender === win.webContents;
  ipcMain.handle('data:request', (event, method, route, body) => {
    if (!validSender(event) || typeof route !== 'string' || !['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) throw new Error('Invalid request');
    return service.dispatch(method, route, body);
  });
  ipcMain.handle('window:expand', (event, value) => { if (validSender(event)) return setExpanded(value); });
  ipcMain.on('window:hover', (event, value) => { if (validSender(event)) { hovered = !!value; updateOpacity(); } });
  ipcMain.on('window:menu', event => { if (validSender(event)) showMenu(); });
  ipcMain.on('task:menu', (event, id) => {
    if (!validSender(event)) return;
    const task = service.store.snapshot().tasks.find(t => t.id === id); if (!task) return;
    Menu.buildFromTemplate([
      { label: 'Priority', enabled: false },
      ...[['urgent', 'Urgent'], ['high', 'High'], ['normal', 'Normal'], ['low', 'Low']].map(([value,label]) => ({ label, type: 'radio', checked: (task.priority || 'normal') === value, click: () => { service.store.update(id, { priority: value }); win.webContents.send('window:expanded', expanded); } }))
    ]).popup({ window: win });
  });
  ipcMain.on('window:history', event => { if (validSender(event)) openHistory(); });
  ipcMain.on('window:drag', (event, phase, x, y) => {
    if (!validSender(event) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (phase === 'start') dragState = { x, y, bounds: win.getBounds() };
    if (phase === 'move' && dragState) win.setBounds(clamped({ ...dragState.bounds, x: Math.round(dragState.bounds.x + x - dragState.x), y: Math.round(dragState.bounds.y + y - dragState.y) }));
    if (phase === 'end') dragState = null;
  });
  const trayImage = nativeImage.createFromPath(path.join(__dirname, '../assets/trayTemplate.png'));
  trayImage.setTemplateImage(true);
  tray = new Tray(trayImage);
  tray.setToolTip('Ridian');
  tray.on('click', () => { setExpanded(!expanded); win.show(); });
  tray.on('right-click', showMenu);
  globalShortcut.register('CommandOrControl+Shift+Space', () => { setExpanded(!expanded); win.show(); });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Ridian', submenu: [{ role: 'quit', label: 'Quit Ridian' }] }, { role: 'editMenu' }]));
  await win.loadURL(`http://127.0.0.1:${PORT}/widget.html`);
  win.showInactive();
  updateOpacity();
  if (process.platform === 'darwin' && !testing) app.dock.hide();
  if (testing) global.__ridianTest = { win, service, setExpanded, updateOpacity, dataDir };
});
app.on('activate', () => { if (win) { win.show(); setExpanded(true); } });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { clearInterval(fading); clearInterval(scheduler); globalShortcut.unregisterAll(); if (service) service.server.close(); });
}

const { app, BrowserWindow, ipcMain, Notification, globalShortcut, screen, Tray, Menu, nativeImage, desktopCapturer, session, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Store = require('electron-store').default;
const store = new Store({ name: 'threadkeeper-data', defaults: { notes: [], tasks: [], links: [], skills: [], research: null, reminderLog: {}, settings: { edge: 'right', reminders: true, launchAtLogin: false, quietHours: false } } });
let win; let tray;
const isDev = !app.isPackaged;
// Windows only shows toast notifications for an app with an identity (AppUserModelID) that belongs to a Start Menu
// shortcut. The installer creates that shortcut for packaged builds. A development run (plain electron.exe) has none,
// so Windows silently drops every toast; ensureWindowsShortcut() below creates one for development runs.
const AUMID = isDev ? 'com.threadkeeper.sidecar.dev' : 'com.threadkeeper.sidecar';
if (process.platform === 'win32') app.setAppUserModelId(AUMID);
function ensureWindowsShortcut() {
  if (process.platform !== 'win32' || !isDev) return;
  try {
    const dir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    fs.mkdirSync(dir, { recursive: true });
    const link = path.join(dir, 'Threadkeeper Sidecar (dev).lnk');
    const details = { target: process.execPath, args: `"${app.getAppPath()}"`, appUserModelId: AUMID, description: 'Threadkeeper Sidecar (development build, used for notifications)' };
    const ok = shell.writeShortcutLink(link, fs.existsSync(link) ? 'replace' : 'create', details);
    if (!ok) console.warn('Could not create the Start Menu shortcut that Windows needs for notifications.');
  } catch (error) { console.warn('Could not create the notification shortcut:', error); }
}

// ---- window geometry ---------------------------------------------------------------
// The window has three shapes: a little draggable tab (optionally wider to hold the cat's
// speech bubble), the notes panel ("cards"), the notes + detail view ("detail"), and the big
// Research Desk ("desk"), which is sized from the display and opens centred.
const TAB_FALLBACK = { width: 76, height: 72 }; // just the cat's head
const PANELS = { cards: { width: 360, height: 670 }, detail: { width: 920, height: 760 } };
let mode = 'tab';
let tabReturn = null;       // where the cat head was before a panel opened, so tucking puts it back exactly there
let panelMoved = false;     // true once the user drags the open panel (then the head returns to the panel instead)
let deskReturn = null;      // where the tab / panel was before the Research Desk opened, so closing the desk puts it back
let dock = 'right';          // which half of the display the window lives in; the bubble opens toward the other half
let tabWidth = TAB_FALLBACK.width; // width of the cat head itself (the rest of a tab-mode window is bubble)
let tabHeight = TAB_FALLBACK.height;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
const workAreaFor = (rect) => screen.getDisplayMatching(rect).workArea;
const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);

function fit(rect) {
  const area = workAreaFor(rect);
  return {
    width: Math.round(rect.width), height: Math.round(rect.height),
    x: Math.round(clamp(rect.x, area.x, area.x + area.width - rect.width)),
    y: Math.round(clamp(rect.y, area.y, area.y + area.height - rect.height)),
  };
}
function dockFor(rect) {
  const area = workAreaFor(rect);
  return rect.x + rect.width / 2 < area.x + area.width / 2 ? 'left' : 'right';
}
// Where the tab itself sits on screen while in tab mode (the window may also hold a bubble).
function tabRect(b) {
  return { x: dock === 'right' ? b.x + b.width - tabWidth : b.x, y: b.y, width: tabWidth, height: tabHeight };
}
function announceLayout() {
  if (!win || win.isDestroyed()) return;
  // Collapsed, the app is only the cat's head: no taskbar button (the tray icon stays). Open, it behaves like a window.
  try { win.setSkipTaskbar(mode === 'tab'); } catch { /* not supported everywhere */ }
  win.webContents.send('window:layout', { mode, dock });
}
function saveTabPosition() {
  if (!win || win.isDestroyed()) return;
  if (mode !== 'tab' && tabReturn && !panelMoved) { store.set('tabPos', { x: tabReturn.x, y: tabReturn.y }); return; }
  const b = mode === 'desk' && deskReturn ? deskReturn : win.getBounds();
  const ref = mode === 'tab' ? tabRect(b) : { x: dockFor(b) === 'left' ? b.x : b.x + b.width - tabWidth, y: b.y };
  store.set('tabPos', { x: ref.x, y: ref.y });
}
function initialTabPosition() {
  const saved = store.get('tabPos');
  if (saved && isFiniteNum(saved.x) && isFiniteNum(saved.y)) {
    const inside = screen.getAllDisplays().some((d) => saved.x >= d.workArea.x && saved.x <= d.workArea.x + d.workArea.width - tabWidth && saved.y >= d.workArea.y && saved.y <= d.workArea.y + d.workArea.height - tabHeight);
    if (inside) return { x: saved.x, y: saved.y };
  }
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - TAB_FALLBACK.width - 6, y: Math.round(area.y + (area.height - TAB_FALLBACK.height) * 0.46) };
}

function createWindow() {
  const pos = fit({ ...initialTabPosition(), width: TAB_FALLBACK.width, height: TAB_FALLBACK.height });
  mode = 'tab';
  dock = dockFor(pos);
  win = new BrowserWindow({
    ...pos,
    title: 'Threadkeeper Sidecar', frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    // thickFrame:false stops Windows from drawing a frame, shadow or snap outline around the transparent window, so the
    // collapsed app is only the cat's head. Not user-resizable: the app sizes the window itself (also no edge snapping).
    thickFrame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, alwaysOnTop: true,
    skipTaskbar: true, show: false,
    // Reminders and the cat must keep running when the window is small or covered.
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'floating');
  if (isDev) win.loadURL('http://127.0.0.1:5173'); else win.loadFile(path.join(__dirname, '../dist/index.html'));
  win.once('ready-to-show', () => win.show());
  // Links (search results, DOIs, source URLs) open in the user's browser, never as a new window inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    const own = isDev ? url.startsWith('http://127.0.0.1:5173') : url.startsWith('file:');
    if (!own) { event.preventDefault(); openExternalSafe(url); }
  });
  win.webContents.on('did-finish-load', announceLayout);
  win.on('closed', () => { win = null; });
}
function openExternalSafe(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol === 'https:' || u.protocol === 'http:') { shell.openExternal(u.toString()); return { ok: true }; }
  } catch { /* not a URL */ }
  return { ok: false };
}
ipcMain.handle('shell:openExternal', (e, url) => (e.sender === win?.webContents ? openExternalSafe(url) : { ok: false }));
function openDesk() {
  if (!win) createWindow();
  else { win.show(); win.focus(); }
  const send = () => win && win.webContents.send('open:desk');
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, 400)); else send();
}
const sentLog = []; // last few notifications, kept for diagnostics and tests
// Windows removes a toast (and its click handler) once the Notification object is garbage collected, so keep a
// reference to each one for a while.
const liveNotifications = new Set();
function sendToPage(channel, payload) {
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send(channel, payload);
}
function showNotification({ title, body, taskId, force }) {
  sentLog.push({ title, body, at: Date.now() }); if (sentLog.length > 20) sentLog.shift();
  if (process.env.TK_TEST) { globalThis.__tkNotifications = sentLog; }
  if (!force && !store.get('settings.reminders', true)) return { ok: false, reason: 'reminders are switched off in Settings' };
  if (!Notification.isSupported()) return { ok: false, reason: 'this system does not support desktop notifications' };
  try {
    const n = new Notification({ title: String(title || 'Threadkeeper reminder').slice(0, 120), body: String(body || 'You have something to follow up on.').slice(0, 300), silent: false, timeoutType: 'default' });
    const forget = () => liveNotifications.delete(n);
    liveNotifications.add(n);
    setTimeout(forget, 30 * 60 * 1000);
    n.on('click', () => {
      forget();
      if (!win || win.isDestroyed()) createWindow();
      else { win.show(); win.focus(); }
      const send = () => win && win.webContents.send('notification:open-task', taskId || null);
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, 400)); else send();
    });
    n.on('close', forget);
    n.on('failed', (_e, error) => {
      forget();
      console.warn('Notification failed:', error);
      sendToPage('reminder:failed', { reason: String(error || 'Windows did not show the notification') });
    });
    n.show();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error && error.message ? error.message : 'unknown error' };
  }
}

// ---- deadline reminders --------------------------------------------------------------
// The main process owns reminders, so they fire whatever the window is doing (tab, panel, desk, hidden, or a page
// that is busy). What has been sent is kept in its own ledger ("reminderLog"), which the page never overwrites, so a
// save from the page can never cause a repeat. A task is reminded about an hour before its time and when it is due.
const { pendingReminders, reminderMessage } = require('./reminders.cjs');
let reminderTimer = null;
function checkReminders() {
  try {
    const now = Date.now();
    const log = { ...(store.get('reminderLog') || {}) };
    const { out, silent } = pendingReminders(store.get('tasks', []), log, now);
    for (const k of silent) log[k] = now;
    if (out.length) {
      for (const r of out) log[r.key] = now;
      const enabled = store.get('settings.reminders', true);
      const messages = out.length > 3
        ? [{ title: 'Threadkeeper reminders', body: `${out.length} tasks are due or coming up: ${out.slice(0, 3).map((r) => r.task.title).join(', ')}…`, taskId: null }]
        : out.map((r) => ({ ...reminderMessage(r, now), taskId: r.task.id }));
      let failure = null;
      if (enabled) for (const m of messages) { const res = showNotification(m); if (!res.ok && !failure) failure = res.reason; }
      // The page shows the reminder too (a banner in the panel, the cat's bubble in the tab), so nothing is missed
      // when Windows hides toasts (Focus assist, notifications off) or the system has no notification support.
      sendToPage('reminder:fired', {
        items: out.map((r) => ({ taskId: r.task.id, stage: r.stage, ...reminderMessage(r, now) })),
        delivered: enabled && !failure, reason: enabled ? failure : 'reminders are switched off in Settings',
      });
    }
    if (out.length || silent.length) {
      // keep the ledger small: forget entries older than 60 days
      for (const [k, t] of Object.entries(log)) if (now - Number(t) > 60 * 86400000) delete log[k];
      store.set('reminderLog', log);
    }
  } catch (error) { console.warn('Reminder check failed:', error); }
}
function scheduleReminderCheck(delay = 800) { clearTimeout(reminderTimer); reminderTimer = setTimeout(checkReminders, delay); }
app.whenReady().then(() => {
  // Recording is only requested from the app's own explicit Start recording action.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const fromThisApp = Boolean(win && webContents === win.webContents);
    const mediaPermission = permission === 'media' || permission === 'camera' || permission === 'microphone';
    const requestsMedia = !details?.mediaTypes || details.mediaTypes.some(type => type === 'audio' || type === 'video');
    callback(fromThisApp && mediaPermission && requestsMedia);
  });
  createWindow();
  globalShortcut.register('CommandOrControl+Shift+Space', () => { if (!win) createWindow(); else { win.show(); win.focus(); win.webContents.send('capture:focus'); } });
  const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=');
  tray = new Tray(icon); tray.setToolTip('Threadkeeper Sidecar'); tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Threadkeeper', click: () => { if (!win) createWindow(); else { win.show(); win.focus(); } } },
    { label: 'Open Research Desk', click: openDesk },
    { label: 'Quick capture (Ctrl+Shift+Space)', click: () => { if (!win) createWindow(); else { win.show(); win.focus(); win.webContents.send('capture:focus'); } } },
    { type: 'separator' }, { label: 'Quit', click: () => app.quit() }
  ]));
  // Reminders: checked every 15 seconds, shortly after every save, and when the computer wakes up.
  ensureWindowsShortcut();
  scheduleReminderCheck(4000);
  setInterval(checkReminders, 15000);
  try { powerMonitor.on('resume', () => scheduleReminderCheck(2000)); powerMonitor.on('unlock-screen', () => scheduleReminderCheck(2000)); } catch { /* not on every platform */ }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', saveTabPosition);
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (event) => { /* Keep the tray agent alive on Windows. */ });
ipcMain.handle('store:getAll', () => ({ notes: store.get('notes', []), tasks: store.get('tasks', []), links: store.get('links', []), skills: store.get('skills', []), research: store.get('research', null), settings: store.get('settings', {}) }));
ipcMain.handle('store:saveAll', (_event, data) => {
  for (const key of ['notes','tasks','links','skills','research','settings']) if (data[key] !== undefined) store.set(key, data[key]);
  if (data.tasks !== undefined || data.settings !== undefined) scheduleReminderCheck();
  return { ok: true };
});
function deskSize(area) {
  return { width: Math.min(1400, area.width - 32), height: Math.min(900, area.height - 32) };
}
function resizeWindow(next) {
  if (!win) return { ok: false };
  const b = win.getBounds();
  if (next === 'desk') {
    // Remember where we came from, then open centred on the display the sidecar is on.
    if (mode !== 'desk') deskReturn = mode === 'tab' ? tabRect(b) : { x: b.x, y: b.y, width: b.width, height: b.height };
    const area = workAreaFor(b);
    const size = deskSize(area);
    mode = 'desk';
    win.setBounds(fit({ x: area.x + (area.width - size.width) / 2, y: area.y + (area.height - size.height) / 2, ...size }));
    win.setAlwaysOnTop(true);
    announceLayout();
    return { ok: true, mode, dock };
  }
  if (mode === 'tab' && next !== 'tab') { tabReturn = tabRect(b); panelMoved = false; }
  let ref = mode === 'desk' ? (deskReturn || tabRect(b)) : mode === 'tab' ? tabRect(b) : b; // grow from / shrink toward the tab, not from the bubble
  if (mode === 'desk') deskReturn = null;
  if (next === 'tab') {
    // Tucking away: go back to exactly where the head was picked up, unless the user moved the panel since.
    if (tabReturn && !panelMoved) ref = { ...ref, x: tabReturn.x, y: tabReturn.y, width: tabWidth, height: tabHeight };
    tabReturn = null; panelMoved = false;
  }
  const nearLeft = dockFor(ref) === 'left';
  const size = next === 'tab' ? { width: tabWidth, height: tabHeight } : (PANELS[next] || PANELS.cards);
  const area = workAreaFor(ref);
  const height = Math.min(size.height, area.height - 24);
  // Keep the window where the user dragged it; open inward from the side of the display it is on.
  const x = nearLeft ? ref.x : ref.x + ref.width - size.width;
  mode = next in PANELS ? next : 'tab';
  dock = nearLeft ? 'left' : 'right';
  win.setBounds(fit({ x, y: ref.y, width: size.width, height }));
  win.setAlwaysOnTop(true);
  saveTabPosition();
  announceLayout();
  return { ok: true, mode, dock };
}
ipcMain.handle('window:setMode', (e, next) => (e.sender === win?.webContents ? resizeWindow(next) : { ok: false }));
ipcMain.handle('window:toggleExpanded', (e, expanded) => (e.sender === win?.webContents ? resizeWindow(expanded ? 'detail' : 'cards') : { ok: false }));
ipcMain.handle('window:getLayout', (e) => (e.sender === win?.webContents ? { mode, dock } : null));

// The tab reports how big it is (tab + any speech bubble) so the window wraps it exactly and
// no invisible window area gets in the way of whatever is underneath.
ipcMain.handle('window:setTabLayout', (e, layout = {}) => {
  if (e.sender !== win?.webContents || !win || mode !== 'tab') return { ok: false };
  if (drag) { pendingTabLayout = layout; return { ok: true, dock }; } // resizing mid-drag would fight the drag; apply it when the drag ends
  applyTabLayout(layout);
  return { ok: true, dock };
});

// Dragging: the window follows the real cursor, read here in the main process (pointer coordinates measured inside
// the page lag behind a moving window). The page says where inside the window it was grabbed; every tick the window
// is placed so that point sits under the cursor. That is absolute, so a late or missed tick can never leave the window
// behind or snap it back. setPosition (not setBounds) is used while moving: on scaled Windows displays repeated
// setBounds calls can nudge the size and position. The exact size is restored once when the drag ends.
let drag = null;
let pendingTabLayout = null;
function stopDrag() { if (drag) { clearInterval(drag.timer); drag = null; } }
function applyTabLayout(layout) {
  const width = clamp(Math.round(Number(layout.width)) || 0, 40, 720);
  const height = clamp(Math.round(Number(layout.height)) || 0, 40, 720);
  const tw = clamp(Math.round(Number(layout.tabWidth)) || width, 40, width);
  const th = clamp(Math.round(Number(layout.tabHeight)) || height, 40, height);
  const b = win.getBounds();
  const current = tabRect(b);
  const hasBubble = width > tw + 1;
  tabWidth = tw; tabHeight = th;
  if (!hasBubble) dock = dockFor({ ...current, width: tw });
  const x = dock === 'right' ? current.x + tw - width : current.x;
  const next = fit({ x, y: current.y, width, height });
  if (next.x !== b.x || next.y !== b.y || next.width !== b.width || next.height !== b.height) win.setBounds(next);
  if (!hasBubble) { saveTabPosition(); announceLayout(); }
}
ipcMain.on('drag:start', (e, d = {}) => {
  if (!win || e.sender !== win.webContents) return;
  stopDrag();
  const start = win.getBounds();
  const cursor = screen.getCursorScreenPoint();
  const ox = Number(d.ox); const oy = Number(d.oy);
  // Where the window was grabbed. Prefer the page's measurement (taken at pointer-down, before anything moved);
  // fall back to the cursor minus the few pixels the pointer travelled before the drag began.
  const grab = isFiniteNum(ox) && isFiniteNum(oy) && ox >= -4 && oy >= -4 && ox <= start.width + 4 && oy <= start.height + 4
    ? { x: ox, y: oy }
    : { x: cursor.x - (isFiniteNum(Number(d.dx)) ? clamp(Number(d.dx), -30, 30) : 0) - start.x, y: cursor.y - (isFiniteNum(Number(d.dy)) ? clamp(Number(d.dy), -30, 30) : 0) - start.y };
  const size = { width: start.width, height: start.height };
  const startedAt = Date.now();
  let last = null;
  const tick = () => {
    if (!win || win.isDestroyed() || Date.now() - startedAt > 90000) { stopDrag(); return; }
    const p = screen.getCursorScreenPoint();
    const next = fit({ x: p.x - grab.x, y: p.y - grab.y, ...size });
    if (last && last.x === next.x && last.y === next.y) return;
    last = next;
    win.setPosition(next.x, next.y);
  };
  tick();
  drag = { timer: setInterval(tick, 8), size };
});
ipcMain.on('drag:move', () => { /* the cursor is read in the main process; kept so older pages do not error */ });
ipcMain.on('drag:end', (e) => {
  if (!win || e.sender !== win.webContents) return;
  const size = drag?.size;
  stopDrag();
  // Settle exactly where the user let go, with the window's real size.
  const b = win.getBounds();
  const settled = fit({ x: b.x, y: b.y, width: size?.width || b.width, height: size?.height || b.height });
  if (settled.x !== b.x || settled.y !== b.y || settled.width !== b.width || settled.height !== b.height) win.setBounds(settled);
  if (mode === 'desk') return; // the desk stays where it is; closing it returns to the tab
  if (mode !== 'tab') panelMoved = true; // the user moved the open panel: the head will come back to it
  else tabReturn = null;
  if (pendingTabLayout && mode === 'tab') { const layout = pendingTabLayout; pendingTabLayout = null; applyTabLayout(layout); }
  pendingTabLayout = null;
  if (mode === 'tab' && win.getBounds().width <= tabWidth + 1) dock = dockFor(win.getBounds());
  saveTabPosition();
  announceLayout();
});
ipcMain.handle('window:notify', (e, payload) => (e.sender === win?.webContents ? showNotification(payload || {}) : { ok: false, reason: 'not allowed' }));
ipcMain.handle('app:version', () => app.getVersion());


// Media assets live as ordinary files in the app's local data directory; note records
// only retain compact attachment metadata. The renderer may request a data URL for display.
function attachmentDirectory() {
  const dir = path.join(app.getPath('userData'), 'attachments');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function extensionForMime(mimeType) {
  const type = String(mimeType || '').toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('webm')) return 'webm';
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('wav')) return 'wav';
  if (type.includes('ogg')) return 'ogg';
  return 'bin';
}
ipcMain.handle('media:save', async (_event, payload = {}) => {
  if (typeof payload.dataUrl !== 'string' || !payload.dataUrl.startsWith('data:')) {
    throw new Error('The media payload was invalid.');
  }
  const base64At = payload.dataUrl.indexOf(';base64,', 5);
  const commaAt = base64At >= 0 ? base64At + 7 : payload.dataUrl.indexOf(',', 5);
  if (commaAt < 5) throw new Error('Could not read the media data.');
  const metadata = payload.dataUrl.slice(5, commaAt);
  const encodedContent = payload.dataUrl.slice(commaAt + 1);
  const mimeFromData = metadata.split(';')[0];
  const mimeType = payload.mimeType || mimeFromData || 'application/octet-stream';
  const isBase64 = base64At >= 0 || metadata.split(';').includes('base64');
  const buffer = isBase64 ? Buffer.from(encodedContent, 'base64') : Buffer.from(decodeURIComponent(encodedContent));
  const maxBytes = 150 * 1024 * 1024;
  if (buffer.byteLength > maxBytes) throw new Error('This recording is too large to save (150 MB limit).');
  const id = crypto.randomUUID();
  const name = `${id}.${extensionForMime(mimeType)}`;
  fs.writeFileSync(path.join(attachmentDirectory(), name), buffer);
  return { id, name: payload.name || name, mimeType, size: buffer.byteLength };
});
ipcMain.handle('media:read', async (_event, id, requestedMime) => {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid attachment ID.');
  const dir = attachmentDirectory();
  const possible = fs.readdirSync(dir).find(name => name.startsWith(`${id}.`));
  if (!possible) return null;
  const filePath = path.join(dir, possible);
  const ext = path.extname(possible).toLowerCase();
  const fallbackMime = ({ '.png':'image/png', '.jpg':'image/jpeg', '.webm':'video/webm', '.mp4':'video/mp4', '.wav':'audio/wav', '.ogg':'audio/ogg' })[ext] || 'application/octet-stream';
  const mime = typeof requestedMime === 'string' && /^(?:image|audio|video)\/[A-Za-z0-9.+-]+(?:;[A-Za-z0-9=.+-]+)*$/.test(requestedMime) ? requestedMime : fallbackMime;
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
});
ipcMain.handle('media:delete', async (_event, id) => {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false };
  const dir = attachmentDirectory();
  const found = fs.readdirSync(dir).find(name => name.startsWith(`${id}.`));
  if (found) fs.unlinkSync(path.join(dir, found));
  return { ok: true };
});
ipcMain.handle('capture:screen', async () => {
  const bounds = win ? win.getBounds() : screen.getPrimaryDisplay().bounds;
  const display = screen.getDisplayMatching(bounds);
  const width = Math.min(2560, Math.max(1280, display.size.width));
  const height = Math.min(1600, Math.max(720, display.size.height));
  const wasVisible = Boolean(win && win.isVisible());
  // Hide the always-on-top sidecar so it does not cover the content being captured.
  if (wasVisible) win.hide();
  try {
    await new Promise(resolve => setTimeout(resolve, 280));
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
      fetchWindowIcons: false
    });
    const source = sources.find(item => item.display_id === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) throw new Error('No display was available to capture.');
    return { dataUrl: source.thumbnail.toDataURL(), displayName: source.name, capturedAt: new Date().toISOString() };
  } finally {
    if (wasVisible && win) win.show();
  }
});

// Source text for the Research Desk: one small JSON file per source (page text can be large), kept next to
// the other local data. Page text never leaves the device unless the user runs an AI action on it.
function pagesDirectory() {
  const dir = path.join(app.getPath('userData'), 'pages');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const validDocId = (id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);
ipcMain.handle('pages:save', async (_event, docId, pages) => {
  if (!validDocId(docId) || !Array.isArray(pages)) throw new Error('Invalid source text.');
  const clean = pages.slice(0, 1000).map((p) => ({ page: Number(p.page) || 1, text: String(p.text || '').slice(0, 60000) }));
  fs.writeFileSync(path.join(pagesDirectory(), `${docId}.json`), JSON.stringify(clean));
  return { ok: true };
});
ipcMain.handle('pages:read', async (_event, docId) => {
  if (!validDocId(docId)) return [];
  const file = path.join(pagesDirectory(), `${docId}.json`);
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
});
ipcMain.handle('pages:delete', async (_event, docId) => {
  if (!validDocId(docId)) return { ok: false };
  const file = path.join(pagesDirectory(), `${docId}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return { ok: true };
});
ipcMain.handle('export:save', async (_event, { name, content } = {}) => {
  // Markdown export: written to the user's Documents folder so no save dialog is needed from a frameless window.
  const safe = String(name || 'threadkeeper-export.md').replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'threadkeeper-export.md';
  let dir; try { dir = app.getPath('documents'); fs.mkdirSync(dir, { recursive: true }); } catch { dir = app.getPath('home'); }
  let file = path.join(dir, safe); let n = 1;
  while (fs.existsSync(file)) { file = path.join(dir, safe.replace(/(\.[^.]*)?$/, ` (${n})$1`)); n += 1; }
  fs.writeFileSync(file, String(content || ''), 'utf8');
  return { ok: true, path: file };
});

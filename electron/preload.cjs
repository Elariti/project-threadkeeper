const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('threadkeeper', {
  getAll: () => ipcRenderer.invoke('store:getAll'),
  saveAll: (data) => ipcRenderer.invoke('store:saveAll', data),
  toggleExpanded: (expanded) => ipcRenderer.invoke('window:toggleExpanded', expanded),
  setWindowMode: (mode) => ipcRenderer.invoke('window:setMode', mode),
  getLayout: () => ipcRenderer.invoke('window:getLayout'),
  setTabLayout: (layout) => ipcRenderer.invoke('window:setTabLayout', layout),
  onLayout: (callback) => ipcRenderer.on('window:layout', (_event, layout) => callback(layout)),
  // Moving the window by dragging the tab or the header
  dragStart: (d = {}) => ipcRenderer.send('drag:start', { dx: d.dx, dy: d.dy, ox: d.ox, oy: d.oy }),
  dragMove: (delta) => ipcRenderer.send('drag:move', { dx: delta.dx, dy: delta.dy }),
  dragEnd: () => ipcRenderer.send('drag:end'),
  notify: (payload) => ipcRenderer.invoke('window:notify', payload),
  version: () => ipcRenderer.invoke('app:version'),
  onCaptureFocus: (callback) => ipcRenderer.on('capture:focus', callback),
  onOpenTask: (callback) => ipcRenderer.on('notification:open-task', (_event, id) => callback(id)),
  // Reminders are scheduled in the main process; the page is told when one fires (or a toast fails) so it can show it too.
  onReminder: (callback) => ipcRenderer.on('reminder:fired', (_event, payload) => callback(payload)),
  onReminderFailed: (callback) => ipcRenderer.on('reminder:failed', (_event, payload) => callback(payload)),
  mainReminders: true,
  // Research Desk: scholarly search and open-access full text go through the optional backend; links open in the browser.
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  saveAttachment: (payload) => ipcRenderer.invoke('media:save', payload),
  readAttachment: (id, mimeType) => ipcRenderer.invoke('media:read', id, mimeType),
  deleteAttachment: (id) => ipcRenderer.invoke('media:delete', id),
  captureScreen: () => ipcRenderer.invoke('capture:screen'),
  // Research Desk: source text per document, markdown export, and the tray's "Open Research Desk"
  savePages: (docId, pages) => ipcRenderer.invoke('pages:save', docId, pages),
  readPages: (docId) => ipcRenderer.invoke('pages:read', docId),
  deletePages: (docId) => ipcRenderer.invoke('pages:delete', docId),
  saveExport: (payload) => ipcRenderer.invoke('export:save', payload),
  onOpenDesk: (callback) => ipcRenderer.on('open:desk', callback),
});

// Page text of each source lives outside the main data file (it can be large). The desktop app keeps one
// small JSON file per source; the browser fallback uses localStorage.
const key = (id) => `tk-pages-${id}`;

export async function savePages(docId, pages) {
  if (window.threadkeeper?.savePages) return window.threadkeeper.savePages(docId, pages);
  try { localStorage.setItem(key(docId), JSON.stringify(pages)); } catch (e) { console.warn('Could not store page text', e); }
  return { ok: true };
}
export async function loadPages(docId) {
  if (window.threadkeeper?.readPages) return (await window.threadkeeper.readPages(docId)) || [];
  try { return JSON.parse(localStorage.getItem(key(docId)) || '[]'); } catch { return []; }
}
export async function deletePages(docId) {
  if (window.threadkeeper?.deletePages) return window.threadkeeper.deletePages(docId);
  try { localStorage.removeItem(key(docId)); } catch { /* ignore */ }
  return { ok: true };
}

// Data-model changes for notes. Pure functions (tested in notesModel.test.mjs).
const nowIso = () => new Date().toISOString();
const defaultId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/**
 * Version 2 separates checklists from deadlines. Old "tasks" become:
 *  - an item in their note's checklist (no deadline, or already done),
 *  - a Reminder note (an open task with a deadline), so no deadline is lost.
 * Reminder-note deadlines and Research Desk tasks are kept as they are.
 */
export function migrateChecklists(state, fromVersion = 1, uuid = defaultId) {
  if (fromVersion >= 2) return state;
  const notes = (state.notes || []).map((n) => ({ ...n, items: [...(n.items || [])] }));
  const byId = new Map(notes.map((n) => [n.id, n]));
  const keep = []; const reminders = []; let loose = null;
  for (const t of state.tasks || []) {
    if (t.researchItemId || String(t.id).startsWith('rem-')) { keep.push(t); continue; }
    const owner = byId.get(t.checklistId || t.noteId);
    if (t.dueAt && !t.completed) {
      const note = { id: uuid(), title: t.title, body: owner ? `Moved here from the checklist in “${owner.title || 'Untitled note'}”.` : '', noteType: 'reminder', color: 'peach', project: owner?.project || 'Personal', pinned: false, attachments: [], items: [], reminderAt: t.dueAt, createdAt: t.createdAt || nowIso(), updatedAt: nowIso() };
      reminders.push(note);
      keep.push({ ...t, id: `rem-${note.id}`, noteId: note.id, checklistId: note.id, remindAt: t.remindAt || t.dueAt });
      continue;
    }
    const item = { id: t.id, text: t.title, done: Boolean(t.completed) };
    if (owner) owner.items.push(item);
    else {
      if (!loose) loose = { id: uuid(), title: 'Checklist', body: '', noteType: 'checklist', color: 'mint', project: 'Personal', pinned: false, attachments: [], items: [], createdAt: nowIso(), updatedAt: nowIso() };
      loose.items.push(item);
    }
  }
  return { ...state, notes: [...reminders, ...notes, ...(loose ? [loose] : [])], tasks: keep, settings: { ...(state.settings || {}), modelVersion: 2 } };
}


import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { v4 as uuid } from 'uuid';
import {
  Bell, BrainCircuit, Camera, Check, CheckCheck, ChevronLeft, ChevronRight, Circle, Clock3, Command, GitBranch,
  Image as ImageIcon, Link2, ListChecks, LoaderCircle, Mic, Minimize2, Plus, Save, Search, Send, Settings2, ShieldCheck,
  Network, Sparkles, StickyNote, Trash2, Video, X,
} from 'lucide-react';
import './styles.css';
import CatMascot from './components/CatMascot';
import PocketCat from './components/PocketCat';
import TabCluster from './components/TabCluster';
import NewNoteModal from './components/NewNoteModal';
import ChecklistEditor from './components/ChecklistEditor';
import CaptureModal from './components/CaptureModal';
import { useWindowDrag } from './hooks/useWindowDrag';
import { NOTE_COLORS, NOTE_TYPES, TEXT_TYPES, typeById } from './lib/noteTypes';
import { dismissKey, dueReminders, formatDate, getDeadlineAlerts, parseDeadline, reminderText } from './lib/deadlines';
import { grabScreen } from './lib/capture';
import { migrateChecklists as migrateModel } from './lib/notesModel';
const migrateChecklists = (state, from) => migrateModel(state, from, uuid);
import Desk from './research/desk/Desk';
import { NoteToMapModal } from './research/desk/Modals';
import { useResearch } from './research/useResearch';
import { emptyResearch } from './research/model';
import { affectedItems, pendingThreads } from './research/store';

const nowIso = () => new Date().toISOString();
const shortTitle = (t) => { const s = String(t || 'Untitled note').trim() || 'Untitled note'; return s.length > 40 ? `${s.slice(0, 39)}…` : s; };
const dateOffset = (days, hour = 17, minute = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, minute, 0, 0); return d.toISOString(); };
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const demoState = () => ({
  notes: [
    { id: 'n-research', title: 'Compare baseline results', body: 'Look at the latest papers on 3D Gaussian Splatting and compare with our current results. Focus on identity consistency and memory efficiency.', noteType: 'research', color: 'butter', project: 'GD3DGR', pinned: true, attachments: [], createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'n-todo', title: 'Experiment to-dos', body: '', noteType: 'checklist', color: 'mint', project: 'GD3DGR', pinned: false, attachments: [], items: [{ id: 'ci-1', text: 'Run baseline comparison', done: false }, { id: 'ci-2', text: 'Document experiment results', done: false }, { id: 'ci-3', text: 'Draft report outline', done: true }], createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'n-idea', title: 'Report structure', body: 'Explain the method, show the quantitative comparison, then discuss failure cases and limitations.', noteType: 'text', color: 'lilac', project: 'GD3DGR', pinned: false, attachments: [], createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'n-reading', title: 'Paper to revisit', body: 'Look for evaluation methods that measure geometric consistency, not just visual quality.', noteType: 'text', color: 'mint', project: 'Research', pinned: false, attachments: [], createdAt: nowIso(), updatedAt: nowIso() },
    { id: 'n-meeting', title: 'Meeting with supervisor', body: 'Bring the baseline comparison and the draft outline.', noteType: 'reminder', color: 'peach', project: 'Personal', pinned: false, attachments: [], reminderAt: dateOffset(1, 10, 0), createdAt: nowIso(), updatedAt: nowIso() },
  ],
  tasks: [
    { id: 'rem-n-meeting', title: 'Meeting with supervisor', noteId: 'n-meeting', dueAt: dateOffset(1, 10, 0), remindAt: dateOffset(1, 10, 0), completed: false, notified: false, checklistId: 'n-meeting', createdAt: nowIso() },
  ],
  links: [
    { id: 'l-1', fromId: 'n-research', toId: 'n-idea', relation: 'feeds into', status: 'accepted', origin: 'demo', explanation: 'The experiment results will be used in the report.' },
    { id: 'l-2', fromId: 'n-research', toId: 'n-reading', relation: 'informs', status: 'suggested', origin: 'ai', explanation: 'The evaluation methods in this paper may help interpret the experiment.' },
  ],
  skills: [],
  research: emptyResearch(),
  settings: { reminders: true, quietHours: false, catBubble: true, aiBaseUrl: 'http://127.0.0.1:8000', demoMode: true, modelVersion: 2 },
});

/** Keeps the "Reminder" note and its deadline task in step. Other note types are left alone. */
function syncReminderTask(tasks, note) {
  if (note.noteType !== 'reminder') return tasks;
  const id = `rem-${note.id}`;
  const existing = tasks.find((t) => t.id === id);
  if (!note.reminderAt) return tasks.filter((t) => t.id !== id);
  const title = note.title || 'Reminder';
  if (existing && existing.dueAt === note.reminderAt && existing.title === title) return tasks;
  const dateChanged = !existing || existing.dueAt !== note.reminderAt;
  const base = existing || { id, noteId: note.id, checklistId: note.id, completed: false, createdAt: nowIso() };
  const next = { ...base, title, dueAt: note.reminderAt, remindAt: note.reminderAt, ...(dateChanged ? { notified: false, notifiedSoon: false, dismissedFor: null, completed: false } : {}) };
  return existing ? tasks.map((t) => (t.id === id ? next : t)) : [next, ...tasks];
}

function App() {
  const [data, setData] = useState(demoState);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState('n-research');
  const [expanded, setExpanded] = useState(false);
  const [panelMode, setPanelMode] = useState('tab');
  const [section, setSection] = useState('note');
  const [composer, setComposer] = useState('');
  const [chat, setChat] = useState([{ role: 'assistant', text: 'I’m here. Add a thought, ask about your projects, or tell me what you need to remember.' }]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null); // { message, action? }
  const [reminderBanner, setReminderBanner] = useState(null); // { items, at } – a reminder that fired while the panel was open
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [capture, setCapture] = useState(null); // { kind, shot?, target }
  const [mediaUrls, setMediaUrls] = useState({});
  const [showSettings, setShowSettings] = useState(false);
  const [researchResults, setResearchResults] = useState(null);
  const [lastSaved, setLastSaved] = useState('');
  const [saveState, setSaveState] = useState('saved');
  const [dock, setDock] = useState('right');
  const [greeting, setGreeting] = useState('');
  const [focusTitle, setFocusTitle] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [noteToMap, setNoteToMap] = useState(null); // note being added to the research map
  const [alertsOpen, setAlertsOpen] = useState(false); // the cat's deadline bubble is popped out (a reminder just fired)
  const composerRef = useRef(null);
  const titleRef = useRef(null);
  const greetTimer = useRef(null);
  const dataRef = useRef(data);
  const modeRef = useRef(panelMode);
  dataRef.current = data;
  modeRef.current = panelMode;
  const sectionRef = useRef(section); sectionRef.current = section;
  const selectedRef = useRef(null);
  const removeNoteRef = useRef(null);
  const openTaskRef = useRef(null);

  const selected = data.notes.find((n) => n.id === selectedId) || data.notes[0];
  selectedRef.current = selected?.id || null;
  const deadlines = data.tasks.filter((t) => !t.completed && t.dueAt); // reminders (and Research Desk tasks with a date)
  const overdue = deadlines.filter((t) => new Date(t.dueAt) < new Date()).length;
  const dueSoon = deadlines.filter((t) => new Date(t.dueAt) >= new Date() && new Date(t.dueAt) < new Date(Date.now() + 7 * 86400000)).length;
  const openItems = data.notes.flatMap((n) => (n.items || []).filter((i) => !i.done).map((i) => ({ ...i, note: n })));
  const selectedReminder = selected?.noteType === 'reminder' ? data.tasks.find((t) => t.id === `rem-${selected.id}`) : null;
  const relatedLinks = selected ? data.links.filter((l) => l.status !== 'rejected' && (l.fromId === selected.id || l.toId === selected.id)) : [];
  const relatedNotes = relatedLinks.map((l) => ({ link: l, note: data.notes.find((n) => n.id === (l.fromId === selected.id ? l.toId : l.fromId)) })).filter((x) => x.note);
  const alerts = useMemo(
    () => (data.settings.catBubble === false ? [] : getDeadlineAlerts(data.tasks, new Date(clock))),
    [data.tasks, data.settings.catBubble, clock],
  );

  // ---- load / save -------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        if (window.threadkeeper?.getAll) {
          const saved = await window.threadkeeper.getAll();
          const version = saved?.settings?.modelVersion || 1;
          if (saved && saved.notes?.length) setData(migrateChecklists({ ...demoState(), ...saved, settings: { ...demoState().settings, ...(saved.settings || {}) } }, version));
          else if (saved) setData((prev) => migrateChecklists({ ...prev, ...saved, settings: { ...prev.settings, ...(saved.settings || {}) } }, saved.tasks?.length ? version : 2));
        } else {
          const raw = localStorage.getItem('threadkeeper-state-v1');
          if (raw) { const saved = JSON.parse(raw); setData(migrateChecklists(saved, saved.settings?.modelVersion || 1)); }
        }
      } catch (e) { console.warn('Could not load saved state', e); }
      try { const layout = await window.threadkeeper?.getLayout?.(); if (layout?.dock) setDock(layout.dock); } catch { /* browser preview */ }
      setReady(true);
    })();
  }, []);

  const writeToDisk = async (snapshot) => {
    if (window.threadkeeper?.saveAll) await window.threadkeeper.saveAll(snapshot);
    else localStorage.setItem('threadkeeper-state-v1', JSON.stringify(snapshot));
    setLastSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    setSaveState('saved');
  };

  useEffect(() => {
    if (!ready) return undefined;
    setSaveState('saving');
    const timeout = setTimeout(async () => {
      try { await writeToDisk(data); } catch (e) { console.error('Save failed', e); setSaveState('error'); }
    }, 220);
    return () => clearTimeout(timeout);
  }, [data, ready]);

  const selectedAttachmentKey = (selected?.attachments || []).map((a) => a.id).join('|');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const attachment of (selected?.attachments || [])) {
        if (mediaUrls[attachment.id]) continue;
        try {
          const url = attachment.dataUrl || await window.threadkeeper?.readAttachment?.(attachment.id, attachment.mimeType);
          if (url && !cancelled) setMediaUrls((prev) => ({ ...prev, [attachment.id]: url }));
        } catch (error) { console.warn('Could not load attachment', error); }
      }
    })();
    return () => { cancelled = true; };
  }, [selected?.id, selectedAttachmentKey]);

  useEffect(() => {
    if (!focusTitle || !titleRef.current) return;
    titleRef.current.focus();
    titleRef.current.select();
    setFocusTitle(false);
  }, [focusTitle, selectedId, panelMode, section]);

  // ---- clocks, reminders ---------------------------------------------------------------
  useEffect(() => { const id = setInterval(() => setClock(Date.now()), 15000); return () => clearInterval(id); }, []);

  // Desktop reminders: a heads-up in the hour before, then one at the reminder time. The notification is sent
  // from here (not from inside a state update), and `sentRef` stops a slow save from ever causing a repeat.
  const sentRef = useRef(new Set());
  const deliver = async (payload) => {
    try {
      if (window.threadkeeper?.notify) return (await window.threadkeeper.notify(payload)) || { ok: false, reason: 'no answer from the app' };
      if ('Notification' in window) {
        if (Notification.permission === 'default') await Notification.requestPermission();
        if (Notification.permission === 'granted') { new Notification(payload.title, { body: payload.body }); return { ok: true }; }
        return { ok: false, reason: 'the browser blocked notifications' };
      }
      return { ok: false, reason: 'notifications are not available here' };
    } catch (e) { return { ok: false, reason: e.message || 'unknown error' }; }
  };
  const sendTestNotification = async () => {
    const res = await deliver({ title: 'Threadkeeper test', body: 'If you can see this, reminders will reach you.', taskId: null, force: true });
    notify(res.ok ? 'Test notification sent. Nothing on screen? Check your system notification settings.' : `Could not show a notification (${res.reason || 'unknown reason'}).`);
  };
  // In the desktop app the main process schedules reminders (they fire even if this page is busy or the window is
  // hidden) and tells the page when one fires, so it can show it here too: a banner in the panel / desk, and the
  // cat's bubble in the tab. That way a reminder is never missed when Windows hides the toast.
  const failureShown = useRef(false);
  useEffect(() => {
    const bridge = window.threadkeeper;
    if (!bridge?.onReminder) return;
    bridge.onReminder((payload) => {
      const items = payload?.items || [];
      if (!items.length) return;
      const ids = new Set(items.map((i) => i.taskId));
      const due = new Set(items.filter((i) => i.stage === 'due').map((i) => i.taskId));
      setData((prev) => ({ ...prev, tasks: prev.tasks.map((t) => (ids.has(t.id) ? { ...t, notifiedSoon: true, ...(due.has(t.id) ? { notified: true } : {}) } : t)) }));
      setClock(Date.now());
      setGreeting('');
      if (modeRef.current !== 'tab') setReminderBanner({ items, at: Date.now() });
      else setAlertsOpen(true);
      if (!payload.delivered && payload.reason && !failureShown.current) {
        failureShown.current = true;
        notify(`No desktop notification was shown (${payload.reason}). Threadkeeper will show reminders here instead.`, 6000);
      }
    });
    bridge.onReminderFailed?.((p) => {
      if (failureShown.current) return;
      failureShown.current = true;
      notify(`Windows did not show the notification (${p?.reason || 'unknown reason'}). Check Settings → System → Notifications.`, 6000);
    });
  }, []);
  useEffect(() => {
    if (!ready || !data.settings.reminders || window.threadkeeper?.mainReminders) return undefined; // browser preview only
    let busyNow = false;
    const check = async () => {
      if (busyNow) return;
      busyNow = true;
      try {
        const now = Date.now();
        const fresh = dueReminders(dataRef.current.tasks, now, sentRef.current);
        if (fresh.length) {
          for (const f of fresh) sentRef.current.add(`${f.task.id}|${f.task.remindAt}|${f.stage}`);
          const messages = fresh.length > 3
            ? [{ title: 'Threadkeeper reminders', body: `${fresh.length} tasks are due or coming up.`, taskId: null }]
            : fresh.map((f) => ({ ...reminderText(f, now), taskId: f.task.id }));
          let failure = null;
          for (const message of messages) { const res = await deliver(message); if (!res.ok && !failure) failure = res; }
          setData((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) => {
              const hits = fresh.filter((f) => f.task.id === t.id);
              if (!hits.length) return t;
              return { ...t, notifiedSoon: true, ...(hits.some((f) => f.stage === 'due') ? { notified: true } : {}) };
            }),
          }));
          if (failure) notify(`A desktop notification could not be shown (${failure.reason || 'unknown reason'}). The cat will remind you instead.`);
        }
        setClock(now);
      } finally { busyNow = false; }
    };
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, [ready, data.settings.reminders]);

  // ---- keyboard + desktop events -------------------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.code === 'Space') { e.preventDefault(); changeExpanded(true); setSection('ai'); setTimeout(() => composerRef.current?.focus(), 100); return; }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'n' && modeRef.current !== 'tab' && modeRef.current !== 'desk') { e.preventDefault(); openNewNote(); return; }
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
      if (e.key === 'Delete' && !typing && modeRef.current === 'detail' && sectionRef.current === 'note' && selectedRef.current && !document.querySelector('.modal-backdrop')) { e.preventDefault(); removeNoteRef.current?.(selectedRef.current); return; }
      if (e.key === 'Escape') {
        if (document.querySelector('.modal-backdrop')) { setShowSettings(false); return; }
        if (modeRef.current === 'desk') return; // the big Research Desk is never tucked away by accident
        changeMode('tab');
      }
    };
    window.addEventListener('keydown', onKey);
    window.threadkeeper?.onCaptureFocus?.(() => { changeExpanded(true); setSection('ai'); setTimeout(() => composerRef.current?.focus(), 100); });
    window.threadkeeper?.onOpenTask?.((id) => openTaskRef.current?.(id));
    window.threadkeeper?.onLayout?.((layout) => { if (layout?.dock) setDock(layout.dock); });
    window.threadkeeper?.onOpenDesk?.(() => changeMode('desk'));
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- window modes --------------------------------------------------------------------
  const persist = (patch) => setData((prev) => ({ ...prev, ...patch }));
  const toastTimer = useRef(null);
  const notify = (message, ms = 2600, action = null) => {
    clearTimeout(toastTimer.current);
    setToast({ message, action });
    toastTimer.current = setTimeout(() => setToast(null), ms);
  };
  // Deleting is instant, with an Undo in the toast for a few seconds. Files on disk (attachments, source text) are
  // only removed once the Undo window has passed (or the app closes).
  const undoRef = useRef(null);
  const finalizeUndo = () => {
    const u = undoRef.current;
    if (!u) return;
    undoRef.current = null;
    clearTimeout(u.timer);
    try { u.cleanup?.(); } catch (e) { console.warn('Cleanup after delete failed', e); }
  };
  const offerUndo = (message, restore, cleanup) => {
    finalizeUndo();
    const u = { restore, cleanup };
    u.timer = setTimeout(() => { if (undoRef.current === u) finalizeUndo(); }, 8000);
    undoRef.current = u;
    notify(message, 8000, { label: 'Undo', run: () => { if (undoRef.current !== u) return; clearTimeout(u.timer); undoRef.current = null; restore(); notify('Restored'); } });
  };
  useEffect(() => { window.addEventListener('beforeunload', finalizeUndo); return () => window.removeEventListener('beforeunload', finalizeUndo); }, []);
  const r = useResearch({ data, setData, notify, offerUndo });
  const pendingCount = pendingThreads(r.view).length;
  const flaggedCount = affectedItems(r.view).size;
  const changeMode = async (mode) => {
    const leavingTab = modeRef.current === 'tab' && mode !== 'tab';
    const apply = () => { setPanelMode(mode); setExpanded(mode === 'detail'); modeRef.current = mode; };
    const bridge = window.threadkeeper;
    if (mode === 'tab') setGreeting('');
    if (leavingTab) { try { const r = await bridge?.setWindowMode?.(mode); if (r?.dock) setDock(r.dock); } catch (e) { console.warn(e); } apply(); }
    else { apply(); try { const r = await bridge?.setWindowMode?.(mode); if (r?.dock) setDock(r.dock); } catch (e) { console.warn(e); } }
  };
  const changeExpanded = (value) => changeMode(value ? 'detail' : 'cards');
  const headerDrag = useWindowDrag();
  const panelDrag = useWindowDrag();

  // ---- the cat -------------------------------------------------------------------------
  const dismissAlerts = () => {
    const keys = new Map(alerts.map((a) => [a.task.id, dismissKey(a.task, a.bucket)]));
    setData((prev) => ({ ...prev, tasks: prev.tasks.map((t) => (keys.has(t.id) ? { ...t, dismissedFor: keys.get(t.id) } : t)) }));
  };
  useEffect(() => { if (!alertsOpen) return undefined; const t = setTimeout(() => setAlertsOpen(false), 90000); return () => clearTimeout(t); }, [alertsOpen]);
  // The cat pops up by itself when a deadline enters a new stage (5 minutes before, then overdue).
  const seenAlerts = useRef(null);
  useEffect(() => {
    const keys = alerts.map((a) => `${a.task.id}|${dismissKey(a.task, a.bucket)}`);
    if (seenAlerts.current && keys.some((k) => !seenAlerts.current.has(k))) setAlertsOpen(true);
    seenAlerts.current = new Set(keys);
  }, [alerts]);
  const petCat = () => {
    if (alerts.length) { setAlertsOpen(true); return; } // show what is due
    const next = data.tasks.filter((t) => !t.completed && t.dueAt).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
    const parts = [];
    if (next) parts.push(`Next up: ${next.title} (${formatDate(next.dueAt)})`);
    if (flaggedCount) parts.push(`${flaggedCount} thing${flaggedCount === 1 ? '' : 's'} on your research map need${flaggedCount === 1 ? 's' : ''} a second look`);
    else if (pendingCount) parts.push(`${pendingCount} thread${pendingCount === 1 ? '' : 's'} waiting for your review`);
    setGreeting(parts.length ? parts.join(' · ') : 'You’re all caught up! 🌿');
    clearTimeout(greetTimer.current);
    greetTimer.current = setTimeout(() => setGreeting(''), 6000);
  };
  /** Open whatever a deadline belongs to: its Reminder note, or the Research Desk for research tasks. */
  const openTask = (taskId) => {
    const t = dataRef.current.tasks.find((x) => x.id === taskId);
    if (t?.researchItemId) { changeMode('desk'); return; }
    const noteId = t?.noteId || (taskId && String(taskId).startsWith('rem-') ? String(taskId).slice(4) : null);
    if (noteId && dataRef.current.notes.some((n) => n.id === noteId)) setSelectedId(noteId);
    setSection('note');
    changeMode('detail');
  };
  openTaskRef.current = openTask;
  const openDesk = () => changeMode('desk');

  // ---- notes ---------------------------------------------------------------------------
  const openNewNote = () => { setNewNoteOpen(true); changeExpanded(true); };

  const updateNote = (id, patch) => setData((prev) => {
    const notes = prev.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: nowIso() } : n));
    const note = notes.find((n) => n.id === id);
    return { ...prev, notes, tasks: note ? syncReminderTask(prev.tasks, note) : prev.tasks };
  });

  const createNote = ({ title = '', body = '', noteType = 'text', open = true, ...extra } = {}) => {
    const note = {
      id: uuid(), title, body, noteType, attachments: [], items: [], color: typeById(noteType).color,
      project: noteType === 'research' ? 'Research' : 'Personal', pinned: false, createdAt: nowIso(), updatedAt: nowIso(), ...extra,
    };
    setData((prev) => ({ ...prev, notes: [note, ...prev.notes], tasks: syncReminderTask(prev.tasks, note) }));
    if (open) {
      setSelectedId(note.id);
      setSection('note');
      changeExpanded(true);
    }
    return note;
  };
  const setItems = (noteId, items) => updateNote(noteId, { items });

  const handleNewNote = ({ type, remindAt }) => {
    setNewNoteOpen(false);
    if (type === 'image') { startScreenCapture('new'); return; }
    if (type === 'voice' || type === 'video') { setCapture({ kind: type, target: 'new' }); return; }
    createNote({
      noteType: type,
      body: typeById(type).template,
      ...(type === 'reminder' && remindAt ? { reminderAt: new Date(remindAt).toISOString() } : {}),
    });
    setFocusTitle(true);
    notify(`${typeById(type).label} created`);
  };

  const startNoteToMap = (note) => {
    if (!r.view.project) { notify('Start a research project first, then add this note to its map.'); openDesk(); return; }
    setNoteToMap(note);
  };
  const confirmNoteToMap = (type) => {
    const note = noteToMap;
    setNoteToMap(null);
    if (!note) return;
    r.addNoteToMap(note, type);
    notify(`Added “${note.title || 'Untitled note'}” to the research map`);
  };

  const removeNote = (id) => {
    const before = dataRef.current;
    const index = before.notes.findIndex((n) => n.id === id);
    const note = before.notes[index];
    if (!note) return;
    const goneLinks = before.links.filter((l) => l.fromId === id || l.toId === id);
    const goneTasks = before.tasks.filter((t) => t.noteId === id || t.checklistId === id);
    setData((prev) => ({ ...prev, notes: prev.notes.filter((n) => n.id !== id), links: prev.links.filter((l) => l.fromId !== id && l.toId !== id), tasks: prev.tasks.filter((t) => t.noteId !== id && t.checklistId !== id) }));
    if (selectedId === id || !selectedId) {
      const next = before.notes[index + 1] || before.notes[index - 1];
      setSelectedId(next?.id || null);
      if (!next) changeExpanded(false);
    }
    offerUndo(
      `Deleted “${shortTitle(note.title)}”${goneTasks.length ? ` and ${goneTasks.length} task${goneTasks.length === 1 ? '' : 's'}` : ''}`,
      () => setData((prev) => {
        if (prev.notes.some((n) => n.id === note.id)) return prev;
        const notes = [...prev.notes]; notes.splice(Math.min(index, notes.length), 0, note);
        const keep = (list, gone) => [...gone.filter((g) => !list.some((x) => x.id === g.id)), ...list];
        return { ...prev, notes, links: keep(prev.links, goneLinks), tasks: keep(prev.tasks, goneTasks) };
      }),
      () => (note.attachments || []).forEach((a) => window.threadkeeper?.deleteAttachment?.(a.id)),
    );
  };

  removeNoteRef.current = removeNote;

  const flushSave = async () => {
    try { setSaveState('saving'); await writeToDisk(dataRef.current); notify('Saved on this device'); } catch (e) { setSaveState('error'); notify(`Could not save: ${e.message || 'unknown error'}`); }
  };

  // ---- captures ------------------------------------------------------------------------
  const saveAttachmentData = async ({ dataUrl, name, mimeType, kind }) => {
    if (window.threadkeeper?.saveAttachment) {
      const saved = await window.threadkeeper.saveAttachment({ dataUrl, name, mimeType });
      return { ...saved, kind };
    }
    return { id: uuid(), name, mimeType, kind, dataUrl }; // browser fallback for testing
  };

  const startScreenCapture = async (target = 'new') => {
    setCapture(null);
    try {
      const shot = await grabScreen();
      setCapture({ kind: 'image', shot, target });
    } catch (error) {
      notify(error.name === 'NotAllowedError' ? 'Screen capture was cancelled.' : `Could not capture the screen: ${error.message || 'unknown error'}`);
    }
  };
  const startRecorder = (kind, target = 'new') => setCapture({ kind, target });

  const commitCapture = async ({ kind, dataUrl, mimeType, name, title, caption, durationSeconds, target, capturedAt, source }) => {
    const attachment = await saveAttachmentData({ dataUrl, name, mimeType, kind });
    setMediaUrls((prev) => ({ ...prev, [attachment.id]: attachment.dataUrl || dataUrl }));
    const existing = target !== 'new' ? dataRef.current.notes.find((n) => n.id === target) : null;
    if (existing) {
      updateNote(existing.id, {
        attachments: [...(existing.attachments || []), attachment],
        body: caption ? (existing.body ? `${existing.body}\n\n${caption}` : caption) : existing.body,
      });
      setSelectedId(existing.id);
      setSection('note');
      changeExpanded(true);
      notify(`Added to “${existing.title || 'Untitled note'}”`);
    } else {
      const fallback = kind === 'image'
        ? `Captured from ${source || 'your screen'} on ${new Date(capturedAt || Date.now()).toLocaleString()}.`
        : kind === 'voice' ? 'Audio recording saved locally.' : 'Video recording saved locally.';
      createNote({ title, body: caption || fallback, noteType: kind, attachments: [attachment], durationSeconds });
      notify(`${typeById(kind).label} saved`);
    }
    setCapture(null);
  };

  const removeAttachment = (noteId, attachment) => {
    window.threadkeeper?.deleteAttachment?.(attachment.id);
    const note = dataRef.current.notes.find((n) => n.id === noteId);
    updateNote(noteId, { attachments: (note?.attachments || []).filter((a) => a.id !== attachment.id) });
    notify('Attachment removed');
  };

  // ---- tasks + links -------------------------------------------------------------------
  const toggleTask = (id) => setData((prev) => ({ ...prev, tasks: prev.tasks.map((t) => (t.id === id ? { ...t, completed: !t.completed, completedAt: !t.completed ? nowIso() : null } : t)) }));
  const linkNotes = (fromId, toId, relation = 'related to', status = 'accepted', explanation = 'Connected from the note workspace.') => {
    if (!fromId || !toId || fromId === toId) return;
    const exists = data.links.some((l) => (l.fromId === fromId && l.toId === toId) || (l.fromId === toId && l.toId === fromId));
    if (exists) { notify('These notes are already connected'); return; }
    setData((prev) => ({ ...prev, links: [{ id: uuid(), fromId, toId, relation, status, origin: 'user', explanation }, ...prev.links] }));
    notify('Notes connected');
  };
  const proposeConnections = () => {
    if (!selected) return;
    const words = new Set((`${selected.title} ${selected.body} ${selected.project || ''}`).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
    const candidates = data.notes
      .filter((n) => n.id !== selected.id && !data.links.some((l) => (l.fromId === selected.id && l.toId === n.id) || (l.fromId === n.id && l.toId === selected.id)))
      .map((n) => ({ note: n, score: [n.title, n.body, n.project || ''].join(' ').toLowerCase().split(/[^a-z0-9]+/).filter((w) => words.has(w) && w.length > 3).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!candidates.length) { notify('No obvious matches yet. Add more context or connect notes manually.'); return; }
    const best = candidates[0];
    linkNotes(selected.id, best.note.id, 'possibly related', 'suggested', `Suggested because the notes share ${best.score} meaningful keyword${best.score === 1 ? '' : 's'}. Review before accepting.`);
    changeExpanded(true);
  };

  // ---- AI inbox ------------------------------------------------------------------------
  const askAI = async (message) => {
    const text = message.trim();
    if (!text || busy) return;
    const taskIntent = /^(add task|create task|remind me to|remember to|todo:|task:|add a task)/i.test(text);
    const noteIntent = /^(add note|new note|remember that|save this thought|note:)/i.test(text);
    if (taskIntent) {
      const parsed = parseDeadline(text);
      const cleanTitle = text.replace(/^(add task|create task|remind me to|remember to|todo:|task:|add a task)\s*/i, '').replace(/\b(today|tomorrow|tonight|next week|in \d+ days?|on monday|on tuesday|on wednesday|on thursday|on friday|on saturday|on sunday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/ig, '').replace(/\s+/g, ' ').replace(/[,. ]+$/, '').trim() || text;
      setChat((prev) => [...prev, { role: 'user', text }]); setComposer('');
      if (parsed) {
        // A deadline is a Reminder note: the cat speaks up 5 minutes before it and again if it is overdue.
        createNote({ noteType: 'reminder', title: cleanTitle, reminderAt: parsed, open: false });
        setChat((prev) => [...prev, { role: 'assistant', text: `Added a reminder “${cleanTitle}” for ${formatDate(parsed)}. The cat will tell you 5 minutes before, and again if it becomes overdue. You can change the time in the reminder note.` }]);
      } else {
        const target = selected?.noteType === 'checklist' ? selected : data.notes.find((n) => n.noteType === 'checklist');
        const item = { id: uuid(), text: cleanTitle, done: false };
        if (target) setItems(target.id, [...(target.items || []), item]);
        else createNote({ noteType: 'checklist', title: 'To-do', items: [item], open: false });
        setChat((prev) => [...prev, { role: 'assistant', text: `Added “${cleanTitle}” to ${target ? `the checklist “${target.title || 'Untitled note'}”` : 'a new checklist note “To-do”'}. Say a time (e.g. “tomorrow”) if you want a reminder instead.` }]);
      }
      return;
    }
    if (noteIntent) {
      const cleanBody = text.replace(/^(add note|new note|remember that|save this thought|note:)\s*/i, '').trim() || text;
      setChat((prev) => [...prev, { role: 'user', text }]); setComposer('');
      const title = cleanBody.length > 48 ? `${cleanBody.slice(0, 45).trim()}…` : cleanBody;
      const note = createNote({ title, body: cleanBody });
      setChat((prev) => [...prev, { role: 'assistant', text: `Saved that as “${note.title}” and added it to your notes.` }]);
      setSection('ai'); changeExpanded(true);
      return;
    }
    setChat((prev) => [...prev, { role: 'user', text }]); setComposer(''); setBusy(true); setSection('ai'); changeExpanded(true);
    const context = {
      notes: data.notes.map((n) => ({ id: n.id, title: n.title, body: n.body, project: n.project })),
      tasks: [...data.tasks.map((t) => ({ id: t.id, title: t.title, completed: t.completed, dueAt: t.dueAt, noteId: t.noteId })),
        ...data.notes.flatMap((n) => (n.items || []).map((i) => ({ id: i.id, title: i.text, completed: i.done, dueAt: null, noteId: n.id })))],
      links: data.links.filter((l) => l.status === 'accepted').map((l) => ({ fromId: l.fromId, toId: l.toId, relation: l.relation })),
      selectedNote: selected ? { title: selected.title, body: selected.body, id: selected.id } : null,
      summary: { overdue, dueSoon, unfinished: openItems.length + deadlines.length },
    };
    try {
      const base = data.settings.aiBaseUrl || 'http://127.0.0.1:8000';
      const response = await fetch(`${base.replace(/\/$/, '')}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, context }) });
      if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.detail || `AI service returned ${response.status}`); }
      const result = await response.json();
      setChat((prev) => [...prev, { role: 'assistant', text: result.answer || 'I could not generate a response.' }]);
    } catch (error) {
      const fallback = localAnswer(text);
      setChat((prev) => [...prev, { role: 'assistant', text: fallback + (error.message?.includes('Failed to fetch') ? '\n\nAI service is offline. Start the optional backend and configure your Nebius key to enable model-powered responses.' : `\n\nAI service: ${error.message}`) }]);
    } finally { setBusy(false); }
  };
  const localAnswer = (text) => {
    const q = text.toLowerCase();
    if (/overdue|late|past due/.test(q)) { const list = deadlines.filter((t) => new Date(t.dueAt) < new Date()); return list.length ? `You have ${list.length} overdue reminder${list.length === 1 ? '' : 's'}:\n${list.map((t) => `• ${t.title} (was due ${formatDate(t.dueAt)})`).join('\n')}` : 'Nothing is overdue. Nice work.'; }
    if (/unfinished|remaining|what.*left|checklist|to-?do/.test(q)) { return openItems.length ? `Still to do:\n${openItems.slice(0, 12).map((i) => `• ${i.text} (${i.note.title || 'Untitled note'})`).join('\n')}` : 'Every checklist item is done.'; }
    if (/deadline|due soon|due this week|reminder/.test(q)) { const list = [...deadlines].sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt)); return list.length ? `Your upcoming reminders:\n${list.slice(0, 5).map((t) => `• ${t.title} — ${formatDate(t.dueAt)}`).join('\n')}` : 'There are no reminders saved.'; }
    if (/connect|related|link/.test(q)) return 'Select a note, then use “Suggest links” in its expanded view to create a relationship. I can suggest relationships when the AI service is connected.';
    return `I can help with your saved workspace. You have ${data.notes.length} notes, ${openItems.length} open checklist item${openItems.length === 1 ? '' : 's'}, and ${deadlines.length} reminder${deadlines.length === 1 ? '' : 's'} (${overdue} overdue).\n\nTry “What is unfinished?”, “Show my deadlines”, or start the AI backend to enable deeper reasoning.`;
  };
  const research = async () => {
    const query = composer.trim() || selected?.title || 'personal productivity and connected note systems';
    setChat((prev) => [...prev, { role: 'user', text: `Research: ${query}` }]); setComposer(''); setBusy(true); setSection('ai');
    try {
      const base = data.settings.aiBaseUrl || 'http://127.0.0.1:8000';
      const res = await fetch(`${base.replace(/\/$/, '')}/research`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail || 'Research failed');
      setResearchResults(result.results || []);
      setChat((prev) => [...prev, { role: 'assistant', text: `${result.answer || 'I found some sources for you.'}\n\n${(result.results || []).map((r) => `• ${r.title}\n  ${r.url}\n  ${(r.content || '').slice(0, 240)}`).join('\n\n')}` }]);
    } catch (e) { setChat((prev) => [...prev, { role: 'assistant', text: `Research is not available: ${e.message}. Configure TAVILY_API_KEY in backend/.env and start the backend.` }]); }
    finally { setBusy(false); }
  };

  // ---- render --------------------------------------------------------------------------
  if (!ready) return <div className="boot" aria-busy="true" />; // the window starts as the (transparent) cat-head tab

  if (panelMode === 'tab') {
    return (
      <TabCluster
        dock={dock}
        alerts={alerts}
        alertsOpen={alertsOpen}
        message={greeting}
        onOpen={() => changeMode('cards')}
        onPet={petCat}
        onDismissAlerts={() => { dismissAlerts(); setAlertsOpen(false); }}
        onDismissMessage={() => setGreeting('')}
        onDone={toggleTask}
        onOpenChecklist={(id) => openTask(id || alerts[0]?.task.id)}
      />
    );
  }

  if (panelMode === 'desk') {
    return (
      <>
        <Desk r={r} tasks={data.tasks} notify={notify} headerDrag={headerDrag} onBack={() => changeMode('cards')} onTuck={() => changeMode('tab')}
          banner={<ReminderBanner banner={reminderBanner} tasks={data.tasks} onDone={(id) => toggleTask(id)} onOpen={(id) => { setReminderBanner(null); openTask(id); }} onClose={() => setReminderBanner(null)} />} />
        <Toast toast={toast} onClose={() => setToast(null)} />
      </>
    );
  }

  const captureNote = expanded && section === 'note' && selected ? selected : null;
  const selectedType = selected ? typeById(selected.noteType || 'text') : null;
  const canSwitchType = selected && TEXT_TYPES.includes(selected.noteType || 'text');

  return (
    <div className={`app-shell mode-${panelMode}`}>
      <header className="topbar drag-region" {...headerDrag} title="Drag to move Threadkeeper">
        <div className="brand"><div className="brand-mark yarn-mark">🧶</div><div><div className="brand-name">Threadkeeper<span>.</span></div><div className="brand-caption">little thoughts, held gently</div></div></div>
        <div className="top-actions">
          <div className="topbar-cat" aria-hidden="true"><CatMascot variant="peek" size={50} mood={alerts.length ? 'alert' : 'happy'} /></div>
          <span className="saved-indicator"><span className={`status-dot ${saveState}`} />{saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : lastSaved ? 'Saved' : 'Local-first'}</span>
          <button className="icon-btn" title="Settings" onClick={() => setShowSettings(true)}><Settings2 size={16} /></button>
          <button className="icon-btn" title="Show notes only" onClick={() => changeExpanded(false)}><Minimize2 size={15} /></button>
          <button className="icon-btn tuck-btn" title="Tuck away into the little tab" onClick={() => changeMode('tab')}><ChevronRight size={15} /></button>
        </div>
      </header>
      <ReminderBanner banner={reminderBanner} tasks={data.tasks} onDone={(id) => { toggleTask(id); }} onOpen={(id) => { setReminderBanner(null); openTask(id); }} onClose={() => setReminderBanner(null)} />
      <main className={`workspace ${expanded ? 'is-expanded' : ''}`}>
        <aside className="rail">
          <button className="research-card" onClick={openDesk} data-testid="open-desk" title="Open the Research Desk">
            <span className="rc-icon"><Network size={18} /></span>
            <span className="rc-text"><strong>Research Desk</strong><small>{r.view.project ? `${r.view.project.name} · ${r.view.items.length} items${flaggedCount ? ` · ${flaggedCount} to re-check` : pendingCount ? ` · ${pendingCount} to review` : ''}` : 'Turn papers into an argument map'}</small></span>
            {(pendingCount > 0 || flaggedCount > 0) && <em className="rc-badge" data-testid="rc-badge">{pendingCount || flaggedCount}</em>}
            <ChevronRight size={14} />
          </button>
          <div className="rail-label"><span>YOUR NOTES <em>{data.notes.length}</em></span><button className="tiny-icon" title="New note (Ctrl+N)" onClick={openNewNote}><Plus size={14} /></button></div>
          <div className="notes-list">
            {data.notes.map((note) => {
              const type = typeById(note.noteType || 'text');
              const TypeIcon = type.Icon;
              const cardColor = note.color === 'lilac' ? 'lavender' : (note.color || 'butter');
              const linkedCount = data.links.filter((l) => l.status !== 'rejected' && (l.fromId === note.id || l.toId === note.id)).length;
              const noteTasks = data.tasks.filter((t) => t.noteId === note.id || t.checklistId === note.id);
              const nextDue = noteTasks.filter((t) => !t.completed && t.dueAt).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
              const items = note.items || [];
              const itemsDone = items.filter((i) => i.done).length;
              return (
                <div key={note.id} className="note-card-wrap">
                <button className={`sticky-card note-card ${cardColor} ${selected?.id === note.id && section === 'note' ? 'is-selected' : ''}`} onClick={() => { setSelectedId(note.id); setSection('note'); changeExpanded(true); }}>
                  <div className="sticky-top"><span className="card-type"><TypeIcon size={12} /> {type.label}</span>{note.pinned && <span className="pin-dot" />}</div>
                  <div className="sticky-title">{note.title || 'Untitled note'}</div>
                  <div className="sticky-copy">{note.body || (items.length ? items.filter((i) => !i.done).slice(0, 2).map((i) => `☐ ${i.text}`).join('  ') || 'All done ✓' : note.attachments?.length ? 'A little memory saved here.' : 'An empty page, ready for an idea…')}</div>
                  {items.length > 0 && <div className="due-chip checklist-chip"><ListChecks size={10} /> {itemsDone}/{items.length} done</div>}
                  {note.attachments?.length > 0 && <div className="attachment-chip">{note.attachments.length} attachment{note.attachments.length === 1 ? '' : 's'} · {note.attachments.map((a) => a.kind).join(', ')}</div>}
                  {nextDue && <div className={`due-chip ${new Date(nextDue.dueAt) < new Date() ? 'is-overdue' : ''}`}><Bell size={10} /> {new Date(nextDue.dueAt) < new Date() ? 'Overdue' : formatDate(nextDue.dueAt)}</div>}
                  <div className="sticky-foot"><span>{note.project || 'Personal'}</span><span>{linkedCount > 0 && <><Link2 size={10} />{linkedCount}</>}<ChevronRight size={12} /></span></div>
                </button>
                <button className="card-delete" title="Delete note (you can undo)" aria-label={`Delete note ${note.title || 'Untitled note'}`} onClick={() => removeNote(note.id)} data-testid="card-delete"><Trash2 size={13} /></button>
                </div>
              );
            })}
            {!data.notes.length && <div className="empty-state small-empty"><StickyNote size={22} /><strong>A fresh little space</strong><span>Press + to make a note: text, checklist, reminder, screenshot, voice or video.</span><button className="primary-button" onClick={openNewNote}>Make your first note <Plus size={13} /></button></div>}
          </div>
          <div className="rail-shortcuts">
            <button className={`shortcut-card lavender ${section === 'ai' ? 'is-selected' : ''}`} onClick={() => { setSection('ai'); changeExpanded(true); setTimeout(() => composerRef.current?.focus(), 120); }}><Sparkles size={15} /><span><strong>AI Inbox</strong><small>Ask, capture, or connect thoughts</small></span><ChevronRight size={13} /></button>
          </div>
          <div className="rail-bottom">
            <button className="primary-button new-note-cta" onClick={openNewNote}><Plus size={14} /> New note</button>
            <div className="mascot-row"><PocketCat /><div className="mascot-copy"><strong>Little thoughts, safely tucked away.</strong><span><Command size={10} /> Ctrl+N new note · Ctrl+Shift+Space capture</span></div></div>
          </div>
        </aside>

        {expanded && <section className="detail-panel">
          <div className="panel-head drag-region" {...panelDrag}>
            <div className="breadcrumbs"><span>WORKSPACE</span><ChevronRight size={12} /><strong>{section === 'ai' ? 'THREADKEEPER AI' : 'NOTE DETAIL'}</strong></div>
            <div className="panel-tools">
              <button className="mini-new" onClick={openNewNote} title="Create another note (Ctrl+N)"><Plus size={13} /> New note</button>
              <button className="icon-btn" title="Collapse" onClick={() => changeExpanded(false)}><ChevronLeft size={15} /></button>
              <button className="icon-btn" title="Tuck away" onClick={() => changeMode('tab')}><ChevronRight size={15} /></button>
              <button className="icon-btn" title="Show notes only" onClick={() => changeExpanded(false)}><X size={15} /></button>
            </div>
          </div>

          {section === 'note' && <div className="detail-content note-detail">
            {selected ? <>
              <div className={`large-sticky ${selected.color === 'lilac' ? 'lavender' : selected.color || 'butter'}`}>
                <div className="large-sticky-head">
                  <span className="eyebrow">{selectedType.label.toUpperCase()}</span>
                  <div className="note-head-actions">
                    {r.research.items.some((i) => i.noteId === selected.id)
                      ? <button className="note-on-map" title="This note is an item on your research map. Open the Research Desk." onClick={openDesk}><Network size={12} /> On research map</button>
                      : <button className="note-add-map" title="Add this note to your research map" onClick={() => startNoteToMap(selected)} data-testid="note-to-map"><Network size={12} /> Add to research map</button>}
                    <button className="note-delete" title="Delete note (you can undo)" onClick={() => removeNote(selected.id)} data-testid="note-delete"><Trash2 size={13} /> Delete</button></div>
                </div>
                {canSwitchType && (
                  <div className="type-chips" role="radiogroup" aria-label="Note type">
                    {TEXT_TYPES.map((id) => { const t = typeById(id); const I = t.Icon; return <button key={id} role="radio" aria-checked={(selected.noteType || 'text') === id} className={(selected.noteType || 'text') === id ? 'is-chosen' : ''} onClick={() => updateNote(selected.id, { noteType: id })}><I size={11} /> {t.label.replace(' note', '')}</button>; })}
                  </div>
                )}
                <input ref={titleRef} className="note-title-input" value={selected.title} onChange={(e) => updateNote(selected.id, { title: e.target.value })} placeholder="Give this note a title…" aria-label="Note title" />
                {(selected.noteType === 'checklist' || (selected.items || []).length > 0) && <ChecklistEditor key={selected.id} items={selected.items || []} onChange={(items) => setItems(selected.id, items)} />}
                <textarea className={`note-body-input ${selected.noteType === 'checklist' ? 'is-secondary' : ''}`} value={selected.body} onChange={(e) => updateNote(selected.id, { body: e.target.value })} placeholder={selected.noteType === 'checklist' ? 'Notes (optional)…' : 'Your thoughts go here…'} />
                {(selected.noteType || 'text') === 'reminder' && (
                  <div className="reminder-box">
                    <label className="reminder-inline"><Bell size={13} /> Deadline
                      <input type="datetime-local" value={toLocalInput(selected.reminderAt)} onChange={(e) => updateNote(selected.id, { reminderAt: e.target.value ? new Date(e.target.value).toISOString() : null })} data-testid="reminder-at" />
                    </label>
                    {selectedReminder ? (
                      <span className={`reminder-status ${selectedReminder.completed ? 'is-done' : new Date(selectedReminder.dueAt) < new Date() ? 'is-overdue' : ''}`}>
                        {selectedReminder.completed ? 'Done' : new Date(selectedReminder.dueAt) < new Date() ? 'Overdue' : 'The cat will remind you 5 minutes before'}
                        <button className="secondary-button compact" onClick={() => toggleTask(selectedReminder.id)} data-testid="reminder-done">{selectedReminder.completed ? 'Reopen' : <><Check size={12} /> Mark done</>}</button>
                      </span>
                    ) : <span className="reminder-status">Set a date and time to get reminded.</span>}
                  </div>
                )}
                {(selected.attachments || []).length > 0 && <div className="attachment-list">{selected.attachments.map((att) => (
                  <div className="saved-attachment" key={att.id}>
                    <div className="saved-attachment-head">
                      <span>{att.kind === 'voice' ? <Mic size={13} /> : att.kind === 'video' ? <Video size={13} /> : <ImageIcon size={13} />} {att.kind === 'voice' ? 'Voice recording' : att.kind === 'video' ? 'Video recording' : 'Screen capture'}</span>
                      <span className="attachment-tools"><a href={mediaUrls[att.id] || undefined} download={att.name || 'threadkeeper-attachment'} className="download-link">Download</a><button className="tiny-icon" title="Remove attachment" onClick={() => removeAttachment(selected.id, att)}><Trash2 size={12} /></button></span>
                    </div>
                    {!mediaUrls[att.id] ? <p className="muted-note">Loading your saved attachment…</p> : att.kind === 'image' ? <img className="attachment-image" src={mediaUrls[att.id]} alt={att.name || 'Saved screen capture'} /> : att.kind === 'voice' ? <audio className="attachment-audio" controls src={mediaUrls[att.id]} /> : <video className="attachment-video" controls playsInline src={mediaUrls[att.id]} />}
                    <small>{att.name || 'Saved on this device'}{att.size ? ` · ${(att.size / 1024 / 1024).toFixed(1)} MB` : ''}</small>
                  </div>
                ))}</div>}
                <div className="attach-bar">
                  <span>Add to this note</span>
                  <button onClick={() => startScreenCapture(selected.id)}><Camera size={12} /> Screenshot</button>
                  <button onClick={() => startRecorder('voice', selected.id)}><Mic size={12} /> Voice</button>
                  <button onClick={() => startRecorder('video', selected.id)}><Video size={12} /> Video</button>
                </div>
                <div className="large-sticky-footer">
                  <span className="color-picker" role="radiogroup" aria-label="Note colour">{NOTE_COLORS.map((c) => <button key={c} role="radio" aria-checked={(selected.color || 'butter') === c} className={`swatch ${c} ${(selected.color || 'butter') === c ? 'is-chosen' : ''}`} onClick={() => updateNote(selected.id, { color: c })} aria-label={`${c} colour`} />)}</span>
                  <span className="save-state"><ShieldCheck size={12} /> {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved yet' : lastSaved ? `Saved ${lastSaved}` : 'Saved on this device'}</span>
                  <button className="save-note-btn" onClick={flushSave}><Save size={12} /> Save note</button>
                </div>
              </div>
              <div className="section-heading"><div><h3>Connected notes</h3><p>Ideas are more useful when they connect.</p></div><button className="secondary-button compact" onClick={proposeConnections}><GitBranch size={13} /> Suggest links</button></div>
              {relatedNotes.length ? <div className="connection-list">{relatedNotes.map(({ link, note }) => (
                <div className="connection-card" key={link.id}>
                  <button className={`connection-color ${note.color || 'butter'}`} onClick={() => { setSelectedId(note.id); setSection('note'); }} aria-label={`Open ${note.title}`} />
                  <button className="connection-main" onClick={() => { setSelectedId(note.id); setSection('note'); }}><strong>{note.title || 'Untitled note'}</strong><span>{link.relation} · {note.project || 'Personal'}</span>{link.explanation && <small>{link.explanation}</small>}</button>
                  <div className="connection-actions">{link.status === 'suggested' ? <><button className="tiny-icon accept" title="Accept link" onClick={() => setData((p) => ({ ...p, links: p.links.map((l) => (l.id === link.id ? { ...l, status: 'accepted', relation: 'related to' } : l)) }))}><Check size={14} /></button><button className="tiny-icon" title="Reject link" onClick={() => setData((p) => ({ ...p, links: p.links.map((l) => (l.id === link.id ? { ...l, status: 'rejected' } : l)) }))}><X size={14} /></button></> : <Link2 size={14} className="muted-icon" />}</div>
                </div>
              ))}</div> : <div className="empty-state small-empty"><GitBranch size={22} /><strong>No connections yet</strong><span>Suggest links to find related ideas, or connect a note below.</span></div>}
              <div className="section-heading connect-heading"><div><h3>Link another note</h3><p>Create an explicit relationship.</p></div></div>
              <div className="link-picker">{data.notes.filter((n) => n.id !== selected.id && !relatedLinks.some((x) => (x.fromId === selected.id && x.toId === n.id) || (x.fromId === n.id && x.toId === selected.id))).slice(0, 4).map((n) => <button key={n.id} onClick={() => linkNotes(selected.id, n.id, 'related to', 'accepted', 'Manually connected by you.')}><span className={`color-swatch ${n.color || 'butter'}`} /><span>{n.title || 'Untitled note'}</span><Plus size={13} /></button>)}</div>
            </> : <div className="empty-state"><StickyNote /><strong>No notes yet</strong><button className="primary-button" onClick={openNewNote}>Create your first note</button></div>}
          </div>}

          {section === 'ai' && <div className="detail-content ai-detail">
            <div className="ai-intro"><div className="ai-orb large-orb"><BrainCircuit size={24} /></div><div><div className="eyebrow">YOUR PERSONAL AI</div><h1>Let's pick up the thread.</h1><p>I keep your notes and tasks connected, so you can focus on the work in front of you.</p></div></div>
            <div className="quick-prompts"><button onClick={() => askAI('What is unfinished?')}><ListChecks size={13} /> What is unfinished?</button><button onClick={() => askAI('Show my upcoming deadlines')}><Bell size={13} /> Upcoming deadlines</button><button onClick={() => askAI('Summarise my current project and decisions')}><BrainCircuit size={13} /> Catch me up</button></div>
            <div className="chat-messages">{chat.map((m, i) => <div className={`chat-message ${m.role}`} key={i}><div className="chat-avatar">{m.role === 'assistant' ? <BrainCircuit size={14} /> : <span>Y</span>}</div><div className="chat-bubble">{m.text.split('\n').map((line, j, arr) => <React.Fragment key={j}>{line}{j < arr.length - 1 && <br />}</React.Fragment>)}</div></div>)}{busy && <div className="chat-message assistant"><div className="chat-avatar"><BrainCircuit size={14} /></div><div className="chat-bubble thinking"><LoaderCircle size={14} className="spin" /> Working on it…</div></div>}</div>
            <div className="composer"><textarea ref={composerRef} value={composer} onChange={(e) => setComposer(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAI(composer); } }} placeholder="Ask or add anything…" rows={2} /><div className="composer-bottom"><span><ShieldCheck size={12} /> Only relevant context is shared with AI</span><div><button className="research-btn" disabled={busy} onClick={research}><Search size={13} /> Research</button><button className="send-btn" disabled={busy || !composer.trim()} onClick={() => askAI(composer)}><Send size={14} /></button></div></div></div>
            <div className="ai-footnote"><span className="status-dot" /> Local memory active <span>·</span> {data.notes.length} notes connected to your workspace</div>
          </div>}
        </section>}
      </main>

      {noteToMap && <NoteToMapModal note={noteToMap} projectName={r.view.project?.name || ''} onAdd={confirmNoteToMap} onClose={() => setNoteToMap(null)} />}
      {newNoteOpen && <NewNoteModal onClose={() => setNewNoteOpen(false)} onCreate={handleNewNote} />}
      {capture && <CaptureModal key={`${capture.kind}-${capture.shot?.capturedAt || 'rec'}`} kind={capture.kind} shot={capture.shot} currentNote={captureNote} defaultTarget={capture.target} onSave={commitCapture} onRetake={() => startScreenCapture(capture.target)} onClose={() => setCapture(null)} notify={notify} />}
      {showSettings && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}><div className="modal"><div className="modal-head"><div><div className="eyebrow">YOUR SPACE, YOUR RULES</div><h2>Settings</h2></div><button className="icon-btn" onClick={() => setShowSettings(false)}><X size={16} /></button></div>
        <label className="setting-row"><span><strong>Desktop reminders</strong><small>Notify me when tasks reach their reminder time.</small></span><input type="checkbox" checked={data.settings.reminders} onChange={(e) => persist({ settings: { ...data.settings, reminders: e.target.checked } })} /></label>
        <div className="setting-row test-row"><span><strong>Test a notification</strong><small>Sends one now. If nothing appears, check Windows Settings → System → Notifications (and that Focus assist / Do not disturb is off).</small></span><button className="secondary-button compact" onClick={sendTestNotification}>Send test</button></div>
        <label className="setting-row"><span><strong>Cat deadline bubble</strong><small>The cat pops up a reminder 5 minutes before each deadline, and again once it is overdue.</small></span><input type="checkbox" checked={data.settings.catBubble !== false} onChange={(e) => persist({ settings: { ...data.settings, catBubble: e.target.checked } })} /></label>
        <label>AI service URL<input value={data.settings.aiBaseUrl || ''} onChange={(e) => persist({ settings: { ...data.settings, aiBaseUrl: e.target.value } })} placeholder="http://127.0.0.1:8000" /></label>
        <p className="modal-hint"><ShieldCheck size={13} /> Notes are stored locally. Only the context needed for an AI request is sent to the configured service.</p>
        <div className="settings-actions"><button className="secondary-button" onClick={() => { if (confirm('Restore sample notes and tasks? Your research projects are kept.')) { setData({ ...demoState(), research: dataRef.current.research }); setSelectedId('n-research'); setSection('note'); changeMode('cards'); setShowSettings(false); notify('Demo workspace restored'); } }}>Restore demo data</button><button className="primary-button" onClick={() => setShowSettings(false)}>Done <Check size={14} /></button></div></div></div>}
      <Toast toast={toast} onClose={() => setToast(null)} />
      <footer className="app-footer"><span><span className="status-dot" /> SAVED ON THIS DEVICE <span className="version">· private by default</span></span><span>Built for thoughts that deserve a follow-through.</span></footer>
    </div>
  );
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.action ? 'has-action' : ''}`} role="status">
      <Check size={14} /><span>{toast.message}</span>
      {toast.action && <button className="toast-action" onClick={() => { toast.action.run(); }}>{toast.action.label}</button>}
      {toast.action && <button className="toast-x" aria-label="Close" onClick={onClose}><X size={12} /></button>}
    </div>
  );
}

/** A reminder that fired while the panel or desk was open (the desktop toast may be hidden by Windows). */
function ReminderBanner({ banner, tasks, onDone, onOpen, onClose }) {
  if (!banner) return null;
  const items = banner.items.filter((i) => { const t = tasks.find((x) => x.id === i.taskId); return !t || !t.completed; });
  if (!items.length) return null;
  return (
    <div className="reminder-banner" role="alert" data-testid="reminder-banner">
      <Bell size={15} />
      <ul>{items.slice(0, 3).map((i) => (
        <li key={`${i.taskId}-${i.stage}`}><strong>{i.title}</strong><span>{i.body}</span>
          {i.taskId && <button className="rb-done" onClick={() => onDone(i.taskId)} title="Mark done"><Check size={12} /> Done</button>}</li>
      ))}{items.length > 3 && <li className="rb-more">+{items.length - 3} more</li>}</ul>
      <button className="rb-open" onClick={() => onOpen(items[0]?.taskId)}>Open</button>
      <button className="icon-btn" aria-label="Dismiss reminder" onClick={onClose}><X size={14} /></button>
    </div>
  );
}

document.documentElement.classList.toggle('web-preview', !window.threadkeeper);
createRoot(document.getElementById('root')).render(<App />);

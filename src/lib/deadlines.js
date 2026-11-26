// Deadline helpers shared by reminders, the cat's bubble and the AI inbox.
// A deadline is a Reminder note. The cat speaks up 5 minutes before it, and again once it is overdue.

export function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}


export const HEADS_UP_MS = 5 * 60 * 1000;

/** 'overdue' | 'soon' (within 5 minutes) | null (null = nothing worth interrupting for yet). */
export function dueBucket(dueAt, now = new Date()) {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  if (due.getTime() <= now.getTime()) return 'overdue';
  if (due.getTime() - now.getTime() <= HEADS_UP_MS) return 'soon';
  return null;
}

/** Dismissals are remembered per stage (soon, overdue), so the cat speaks up again once a deadline is overdue. */
export const dismissKey = (task, bucket) => `${task.dueAt}|${bucket}`;

/**
 * Deadlines the cat should tell the user about: not done, due within 5 minutes or overdue, and not already
 * dismissed for their current time and stage. Moving the time, or going from "soon" to "overdue", brings it back.
 */
export function getDeadlineAlerts(tasks, now = new Date()) {
  return tasks
    .filter((t) => !t.completed && t.dueAt)
    .map((task) => ({ task, bucket: dueBucket(task.dueAt, now) }))
    .filter((x) => x.bucket && x.task.dismissedFor !== dismissKey(x.task, x.bucket))
    .sort((a, b) => new Date(a.task.dueAt) - new Date(b.task.dueAt));
}

/**
 * Desktop reminders that are due right now: a heads-up 5 minutes before the reminder time,
 * then one when it arrives (or when the app next runs, if it was closed). `sent` holds keys
 * already delivered this session so a slow save can never cause a repeat.
 */
export function dueReminders(tasks, nowMs = Date.now(), sent = new Set()) {
  const out = [];
  for (const task of tasks) {
    if (task.completed || !task.remindAt) continue;
    const at = new Date(task.remindAt).getTime();
    if (!Number.isFinite(at)) continue;
    if (nowMs >= at) {
      if (!task.notified && !sent.has(`${task.id}|${task.remindAt}|due`)) out.push({ task, stage: 'due', at });
    } else if (nowMs >= at - HEADS_UP_MS) {
      if (!task.notified && !task.notifiedSoon && !sent.has(`${task.id}|${task.remindAt}|soon`)) out.push({ task, stage: 'soon', at });
    }
  }
  return out;
}

export function reminderText({ task, stage, at }, nowMs = Date.now()) {
  const time = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (stage === 'soon') {
    const mins = Math.max(1, Math.round((at - nowMs) / 60000));
    return { title: `Due in ${mins} min`, body: `${task.title} (${time})` };
  }
  if (nowMs - at > 5 * 60000) return { title: 'Overdue', body: `${task.title} was due ${formatDate(task.remindAt)}` };
  return { title: 'Due now', body: task.title };
}

export function describeDue(task, bucket, now = new Date()) {
  const d = new Date(task.dueAt);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (bucket === 'overdue') return `Overdue · ${d.toDateString() === now.toDateString() ? 'today' : d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
  const mins = Math.max(1, Math.round((d.getTime() - now.getTime()) / 60000));
  return `In ${mins} min · ${time}`;
}

export function parseDeadline(text) {
  const now = new Date();
  const lower = text.toLowerCase();
  let date = null;
  if (/\btoday\b/.test(lower)) date = new Date(now);
  else if (/\btomorrow\b/.test(lower)) { date = new Date(now); date.setDate(date.getDate() + 1); }
  else if (/\btonight\b/.test(lower)) date = new Date(now);
  else {
    const inDays = lower.match(/\bin (\d+) days?\b/);
    if (inDays) { date = new Date(now); date.setDate(date.getDate() + Number(inDays[1])); }
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    if (!date) {
      const match = lower.match(/\b(?:on )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
      if (match) {
        date = new Date(now);
        const target = weekdays.indexOf(match[1]);
        let delta = (target - date.getDay() + 7) % 7;
        if (delta === 0) delta = 7;
        date.setDate(date.getDate() + delta);
      }
    }
    const iso = lower.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (iso) date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 17, 0, 0, 0);
  }
  if (!date) return null;
  if (/\btonight\b/.test(lower)) date.setHours(20, 0, 0, 0); else date.setHours(17, 0, 0, 0);
  return date.toISOString();
}

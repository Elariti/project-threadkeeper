// Pure reminder logic shared by the main process and the tests. No Electron imports here.
const HEADS_UP_MS = 5 * 60 * 1000; // the cat (and the desktop) speak up 5 minutes before a deadline, then when it is overdue
const TOO_OLD_MS = 3 * 24 * 60 * 60 * 1000; // a reminder missed by more than 3 days is not announced on startup
const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = (ms) => new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
function reminderMessage({ task, stage, at }, now) {
  const title = String(task.title || 'A task').slice(0, 200);
  if (stage === 'soon') return { title: `Due in ${Math.max(1, Math.round((at - now) / 60000))} min`, body: `${title} (${fmtTime(at)})` };
  if (now - at > 5 * 60000) return { title: 'Overdue', body: `${title} was due ${fmtDay(at)}, ${fmtTime(at)}` };
  return { title: 'Due now', body: title };
}
/** Pure: which reminders are due at `now`, given the tasks and the ledger of what was already sent. */
function pendingReminders(tasks, log, now) {
  const out = []; const silent = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task || task.completed) continue;
    const when = task.remindAt || task.dueAt;
    if (!when) continue;
    const at = new Date(when).getTime();
    if (!Number.isFinite(at)) continue;
    const key = `${task.id}|${when}`;
    if (now >= at) {
      if (log[`${key}|due`] || (task.notified && task.remindAt === when)) continue;
      if (now - at > TOO_OLD_MS) { silent.push(`${key}|due`); continue; }
      out.push({ task, stage: 'due', at, key: `${key}|due` });
    } else if (now >= at - HEADS_UP_MS) {
      if (log[`${key}|soon`] || log[`${key}|due`] || (task.notifiedSoon && task.remindAt === when)) continue;
      out.push({ task, stage: 'soon', at, key: `${key}|soon` });
    }
  }
  return { out, silent };
}
module.exports = { HEADS_UP_MS, TOO_OLD_MS, pendingReminders, reminderMessage };

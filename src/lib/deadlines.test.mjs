import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissKey, dueBucket, dueReminders, getDeadlineAlerts, reminderText } from './deadlines.js';

const at = (h, m = 0, day = 0) => new Date(2030, 0, 10 + day, h, m, 0, 0);
const task = (over = {}) => ({ id: 't1', title: 'Submit draft', completed: false, notified: false, dueAt: at(15).toISOString(), remindAt: at(15).toISOString(), ...over });

test('dueBucket: only 5 minutes before (soon) and once overdue', () => {
  const now = at(12);
  assert.equal(dueBucket(at(9).toISOString(), now), 'overdue');
  assert.equal(dueBucket(at(12).toISOString(), now), 'overdue');
  assert.equal(dueBucket(at(12, 4).toISOString(), now), 'soon');
  assert.equal(dueBucket(at(12, 6).toISOString(), now), null, 'later today is not an alert');
  assert.equal(dueBucket(at(9, 0, 1).toISOString(), now), null, 'tomorrow is not an alert');
});

test('a dismissed bubble comes back when the deadline becomes overdue', () => {
  const t = task({ dueAt: at(12, 4).toISOString(), remindAt: null });
  assert.equal(getDeadlineAlerts([t], at(12)).length, 1);
  const dismissed = { ...t, dismissedFor: dismissKey(t, 'soon') };
  assert.equal(getDeadlineAlerts([dismissed], at(12, 1)).length, 0, 'quiet after dismissing the heads-up');
  assert.equal(getDeadlineAlerts([dismissed], at(12, 5)).length, 1, 'speaks up again once overdue');
});

test('an old-style dismissal (just the due date) no longer silences the cat for good', () => {
  const t = task({ dismissedFor: at(15).toISOString() });
  assert.equal(getDeadlineAlerts([t], at(16)).length, 1);
});

test('completed tasks and tasks without a date never alert', () => {
  assert.equal(getDeadlineAlerts([task({ completed: true }), task({ id: 'x', dueAt: null })], at(16)).length, 0);
});

test('reminders: heads-up 5 minutes before, then due, each only once', () => {
  assert.equal(dueReminders([task()], at(14, 50).getTime()).length, 0, 'too early');
  const soon = dueReminders([task()], at(14, 56).getTime());
  assert.deepEqual(soon.map((x) => x.stage), ['soon']);
  assert.match(reminderText(soon[0], at(14, 56).getTime()).title, /Due in 4 min/);
  assert.equal(dueReminders([task({ notifiedSoon: true })], at(14, 56).getTime()).length, 0);
  const due = dueReminders([task({ notifiedSoon: true })], at(15, 1).getTime());
  assert.deepEqual(due.map((x) => x.stage), ['due']);
  assert.equal(reminderText(due[0], at(15, 1).getTime()).title, 'Due now');
  assert.equal(dueReminders([task({ notified: true })], at(15, 1).getTime()).length, 0);
});

test('reminders: the in-session sent set prevents repeats before the save lands', () => {
  const sent = new Set([`t1|${at(15).toISOString()}|due`]);
  assert.equal(dueReminders([task()], at(15, 1).getTime(), sent).length, 0);
});

test('reminders missed while the app was closed fire once, marked overdue', () => {
  const late = dueReminders([task()], at(20).getTime());
  assert.equal(late.length, 1);
  assert.equal(reminderText(late[0], at(20).getTime()).title, 'Overdue');
});

test('completed or reminder-less tasks never notify', () => {
  assert.equal(dueReminders([task({ completed: true }), task({ id: 'b', remindAt: null })], at(16).getTime()).length, 0);
});

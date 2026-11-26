import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateChecklists } from './notesModel.js';

test('old checklist tasks become checklist items or reminder notes; nothing is lost', () => {
  let n = 0; const id = () => `new-${(n += 1)}`;
  const state = {
    notes: [{ id: 'a', title: 'Experiment', noteType: 'research', items: [] }, { id: 'r', title: 'Meeting', noteType: 'reminder', reminderAt: '2030-01-01T10:00:00Z' }],
    tasks: [
      { id: 't1', title: 'Run baseline', noteId: 'a', checklistId: 'a', dueAt: null, completed: false },
      { id: 't2', title: 'Outline', noteId: 'a', checklistId: 'a', dueAt: '2020-01-01T10:00:00Z', completed: true },
      { id: 't3', title: 'Submit report', noteId: 'a', checklistId: 'a', dueAt: '2030-02-01T17:00:00Z', remindAt: '2030-02-01T17:00:00Z', completed: false, notified: false },
      { id: 't4', title: 'Loose to-do', noteId: null, dueAt: null, completed: false },
      { id: 'rem-r', title: 'Meeting', noteId: 'r', dueAt: '2030-01-01T10:00:00Z', completed: false },
      { id: 'rt', title: 'Research task', researchItemId: 'x', dueAt: null, completed: false },
    ],
    settings: {},
  };
  const out = migrateChecklists(state, 1, id);
  const a = out.notes.find((x) => x.id === 'a');
  assert.deepEqual(a.items.map((i) => [i.text, i.done]), [['Run baseline', false], ['Outline', true]]);
  const reminder = out.notes.find((x) => x.title === 'Submit report');
  assert.equal(reminder.noteType, 'reminder');
  assert.equal(reminder.reminderAt, '2030-02-01T17:00:00Z');
  assert.ok(out.tasks.some((t) => t.id === `rem-${reminder.id}` && t.dueAt === '2030-02-01T17:00:00Z'));
  assert.deepEqual(out.notes.find((x) => x.title === 'Checklist').items.map((i) => i.text), ['Loose to-do']);
  assert.deepEqual(out.tasks.map((t) => t.id).sort(), [`rem-${reminder.id}`, 'rem-r', 'rt'].sort());
  assert.equal(out.settings.modelVersion, 2);
  assert.equal(migrateChecklists(out, 2, id), out, 'runs once');
});

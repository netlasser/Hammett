import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeReminderTimestamp,
  createInitialSeedTasks,
  createTask,
  deleteTask,
  filterTasks,
  getDueReminders,
  getQuadrantTasks,
  markReminderFired,
  moveTaskToQuadrant,
  toggleTaskCompletion,
  updateTask,
} from './matrix';

test('createTask rejects empty or whitespace-only titles', () => {
  const base = createInitialSeedTasks(1_000_000);
  assert.throws(() => createTask(base, { title: '   ', quadrant: 'q1' }), /empty/);
});

test('createTask appends task to target quadrant with incrementing order', () => {
  const base = createInitialSeedTasks(1_000_000);
  const q1CountBefore = getQuadrantTasks(base, 'q1').length;
  const { tasks, created } = createTask(
    base,
    {
      title: 'Finalize security audit',
      notes: 'Double check IAM permissions',
      quadrant: 'q1',
      reminderAt: 1_900_000,
    },
    1_000_500,
    'test-id-1',
  );

  assert.equal(created.id, 'test-id-1');
  assert.equal(created.quadrant, 'q1');
  assert.equal(created.order, q1CountBefore);
  assert.equal(getQuadrantTasks(tasks, 'q1').length, q1CountBefore + 1);
});

test('moveTaskToQuadrant moves tasks across quadrants and normalizes order indices', () => {
  const base = createInitialSeedTasks(1_000_000);
  const movingId = 'seed-1';
  const updated = moveTaskToQuadrant(base, movingId, 'q2', 0, 1_001_000);

  const q1 = getQuadrantTasks(updated, 'q1');
  const q2 = getQuadrantTasks(updated, 'q2');

  assert.equal(q1.some((t) => t.id === movingId), false);
  assert.equal(q2[0].id, movingId);
  assert.deepEqual(
    q2.map((t) => t.order),
    [0, 1, 2],
  );
  assert.deepEqual(
    q1.map((t) => t.order),
    [0],
  );
});

test('moveTaskToQuadrant reorders within the same quadrant', () => {
  const base = createInitialSeedTasks(1_000_000);
  const updated = moveTaskToQuadrant(base, 'seed-2', 'q1', 0, 1_002_000);
  const q1 = getQuadrantTasks(updated, 'q1');
  assert.deepEqual(
    q1.map((t) => t.id),
    ['seed-2', 'seed-1'],
  );
});

test('toggleTaskCompletion and deleteTask update state cleanly', () => {
  const base = createInitialSeedTasks(1_000_000);
  const toggled = toggleTaskCompletion(base, 'seed-1', 1_005_000);
  assert.equal(toggled.find((t) => t.id === 'seed-1')?.completed, true);
  assert.equal(filterTasks(toggled, '', 'completed').length, 1);

  const deleted = deleteTask(toggled, 'seed-1');
  assert.equal(deleted.some((t) => t.id === 'seed-1'), false);
});

test('getDueReminders returns unfired active reminders at or before nowMs', () => {
  const now = 2_000_000;
  const { tasks } = createTask(
    [],
    {
      title: 'Call Pepper',
      quadrant: 'q1',
      reminderAt: now - 1_000,
    },
    now - 10_000,
    'rem-1',
  );
  const { tasks: tasks2 } = createTask(
    tasks,
    {
      title: 'Future review',
      quadrant: 'q2',
      reminderAt: now + 60_000,
    },
    now - 5_000,
    'rem-2',
  );

  const due = getDueReminders(tasks2, now);
  assert.deepEqual(
    due.map((t) => t.id),
    ['rem-1'],
  );

  const afterFire = markReminderFired(tasks2, 'rem-1');
  assert.equal(getDueReminders(afterFire, now).length, 0);
});

test('updateTask resets reminderFired when reminderAt changes', () => {
  const now = 2_000_000;
  const tasks = [
    {
      id: 't1',
      title: 'Check telemetry',
      quadrant: 'q1' as const,
      completed: false,
      createdAt: now - 5000,
      updatedAt: now - 5000,
      order: 0,
      reminderAt: now - 1000,
      reminderFired: true,
    },
  ];
  const updated = updateTask(tasks, 't1', { reminderAt: now + 30_000 }, now);
  assert.equal(updated[0].reminderFired, false);
  assert.equal(updated[0].reminderAt, now + 30_000);
});

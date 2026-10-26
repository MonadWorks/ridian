const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, orderTasks } = require('../lib/store.cjs');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ridian-order-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = new Date('2026-10-26T12:00:00');
  const store = new Store(directory, () => now);
  const visible = () => { const data = store.snapshot(); return orderTasks(data.tasks.filter(item => (!item.completedAt && item.date <= data.today) || item.completedDate === data.today), data.taskOrder).map(item => item.id); };
  return { store, directory, visible, tomorrow: () => { now = new Date('2026-10-27T12:00:00'); } };
}

test('manual ordering overrides priority and completion and persists after restart', t => {
  const { store, directory, visible } = fixture(t);
  const a = store.add({ title: 'A', priority: 'high' }), b = store.add({ title: 'B', priority: 'high' }), c = store.add({ title: 'C', priority: 'low' });
  const done = store.add({ title: 'Done', priority: 'urgent' }); store.update(done.id, { done: true });
  assert.deepEqual(visible(), [a.id, b.id, c.id, done.id]);
  store.reorder({ id: b.id, beforeId: a.id });
  assert.deepEqual(visible(), [b.id, a.id, c.id, done.id]);
  store.reorder({ id: a.id, beforeId: null });
  assert.deepEqual(visible(), [b.id, c.id, done.id, a.id]);
  const restarted = new Store(directory).snapshot();
  assert.deepEqual(orderTasks(restarted.tasks, restarted.taskOrder).map(item => item.id), visible());
  store.update(a.id, { priority: 'urgent' });
  assert.deepEqual(visible(), [b.id, c.id, done.id, a.id]);
  assert.equal(store.snapshot().tasks.find(item => item.id === a.id).priority, 'urgent');
});

test('new tasks and newly completed tasks get default placement without scrambling manual order', t => {
  const { store, visible } = fixture(t);
  const high = store.add({ title: 'High', priority: 'high' }), low = store.add({ title: 'Low', priority: 'low' });
  store.reorder({ id: high.id, beforeId: null });
  const newcomer = store.add({ title: 'New', priority: 'urgent' });
  assert.deepEqual(visible(), [newcomer.id, low.id, high.id]);
  store.update(low.id, { done: true });
  assert.deepEqual(visible(), [newcomer.id, high.id, low.id]);
  store.reorder({ id: low.id, beforeId: newcomer.id });
  store.update(low.id, { done: true }); // Repeating the same status must not undo a manual move.
  assert.deepEqual(visible(), [low.id, newcomer.id, high.id]);
  store.resetOrder();
  assert.deepEqual(visible(), [newcomer.id, high.id, low.id]);
});

test('carryover order survives midnight; invalid and stale moves never change data', t => {
  const { store, directory, visible, tomorrow } = fixture(t);
  const a = store.add({ title: 'A' }), b = store.add({ title: 'B' });
  store.reorder({ id: b.id, beforeId: a.id }); tomorrow();
  assert.deepEqual(visible(), [b.id, a.id]);
  const original = fs.readFileSync(path.join(directory, 'journal.json'), 'utf8');
  assert.throws(() => store.reorder({ id: b.id, beforeId: 'missing' }));
  assert.throws(() => store.reorder({ id: b.id }));
  assert.equal(fs.readFileSync(path.join(directory, 'journal.json'), 'utf8'), original);
  store.remove(b.id);
  assert.ok(!store.snapshot().taskOrder.includes(b.id));
  assert.deepEqual(visible(), [a.id]);
});

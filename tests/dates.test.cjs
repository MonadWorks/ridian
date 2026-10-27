const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validDate, addDays, addMonths, tasksForDate } = require('../web/dates.js');
const { Store, orderTasks } = require('../lib/store.cjs');

test('calendar arithmetic handles leap days, month ends, year boundaries, and DST dates', () => {
  assert.equal(validDate('2028-02-29'), true);
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate(undefined), false);
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
});

test('future plans persist, can be reordered, and become due with carryover as time advances', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ridian-planning-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = new Date('2026-10-26T12:00:00');
  const store = new Store(directory, () => now);
  const carry = store.add({ title: 'Carry', date: '2026-10-25' });
  const today = store.add({ title: 'Today', priority: 'high' });
  const a = store.add({ title: 'Future high', date: '2026-10-27', priority: 'high' });
  const b = store.add({ title: 'Future low', date: '2026-10-27', priority: 'low' });
  const list = date => orderTasks(tasksForDate(store.snapshot().tasks, date, store.today()), store.state.taskOrder).map(t => t.id);
  store.reorder({ id: carry.id, beforeId: today.id });
  store.reorder({ id: b.id, beforeId: a.id, date: '2026-10-27' });
  assert.deepEqual(list('2026-10-26'), [carry.id, today.id]);
  assert.deepEqual(list('2026-10-27'), [b.id, a.id]);
  const reopened = new Store(directory, () => now);
  assert.deepEqual(orderTasks(tasksForDate(reopened.state.tasks, '2026-10-27', reopened.today()), reopened.state.taskOrder).map(t => t.id), [b.id, a.id]);
  const before = fs.readFileSync(store.file, 'utf8');
  assert.throws(() => store.reorder({ id: carry.id, beforeId: a.id, date: '2026-10-27' }));
  assert.throws(() => store.reorder({ id: b.id, beforeId: null, date: '2026-02-30' }));
  assert.equal(fs.readFileSync(store.file, 'utf8'), before);
  now = new Date('2026-10-27T00:01:00');
  assert.deepEqual(list(store.today()), [b.id, a.id, carry.id, today.id]);
  assert.equal(store.snapshot().tasks.find(t => t.id === carry.id).date, '2026-10-25');
});

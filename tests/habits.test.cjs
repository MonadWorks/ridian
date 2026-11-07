const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Store } = require('../lib/store.cjs');
const { createService } = require('../lib/server.cjs');
const { habitStats, isDue } = require('../web/habits.js');
const { fixture, flush } = require('./helpers/widget.cjs');

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ridian-habits-'));
  const service = createService({ directory, webRoot: path.join(__dirname, '../web'), port: 0 });
  let date = '2026-10-26';
  service.store.now = () => new Date(`${date}T12:00:00Z`);
  t.after(() => { service.server.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { service, store: service.store, directory, setDate(value) { date = value; } };
}
async function ui(t) {
  const s = setup(t);
  const a = s.store.addHabit({ title: 'Read a chapter', startDate: '2026-10-20' });
  const b = s.store.addHabit({ title: 'Take a walk' });
  s.store.checkHabit(a.id, { date: '2026-10-24', done: true });
  s.store.checkHabit(a.id, { date: '2026-10-25', done: true });
  const f = await fixture({ habitService: s.service });
  f.event(f.$('#show-habits'), 'click'); await flush();
  return { ...s, ...f, a, b };
}

test('habits migrate alongside existing tasks and persist titles, checks, schedules and manual order', t => {
  const s = setup(t), task = s.store.add({ title: 'Keep task', priority: 'urgent' });
  const a = s.store.addHabit({ title: 'Read' }), b = s.store.addHabit({ title: 'Walk' });
  s.store.checkHabit(a.id, { done: true }); s.store.checkHabit(a.id, { done: true });
  assert.equal(s.store.habit(a.id).checkins.length, 1);
  s.store.updateHabit(a.id, { title: '阅读', weekdays: [1, 3, 5] });
  s.store.reorderHabits({ id: b.id, beforeId: a.id });
  const restarted = new Store(s.directory, s.store.now), snapshot = restarted.snapshot();
  assert.deepEqual(snapshot.tasks, [task]); assert.deepEqual(snapshot.habits.map(habit => habit.id), [b.id, a.id]);
  assert.equal(restarted.habit(a.id).title, '阅读'); assert.deepEqual(restarted.habit(a.id).checkins, ['2026-10-26']);
  restarted.removeHabit(b.id); assert.equal(restarted.snapshot().habits.length, 1);
  // Loading a version-1 journal without habits is additive and does not rewrite it.
  const old = { version: 1, tasks: [task], strategies: [], taskOrder: [task.id] };
  fs.writeFileSync(path.join(s.directory, 'journal.json'), JSON.stringify(old));
  const migrated = new Store(s.directory, s.store.now);
  assert.deepEqual(migrated.snapshot().habits, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(migrated.file)), old);
  migrated.addHabit({ title: 'New habit' }); assert.deepEqual(migrated.snapshot().taskOrder, [task.id]);
});

test('streaks carry through an unfinished today, reset after a missed day, and recompute after backfill or undo', t => {
  const s = setup(t), habit = s.store.addHabit({ title: 'Read', startDate: '2026-10-23' });
  for (const date of ['2026-10-23', '2026-10-24', '2026-10-25']) s.store.checkHabit(habit.id, { date, done: true });
  assert.deepEqual(habitStats(s.store.habit(habit.id), '2026-10-26'), { current: 3, longest: 3, total: 3 });
  s.setDate('2026-10-27');
  assert.equal(habitStats(s.store.habit(habit.id), s.store.today()).current, 0);
  s.store.checkHabit(habit.id, { date: '2026-10-26', done: true });
  assert.deepEqual(habitStats(s.store.habit(habit.id), s.store.today()), { current: 4, longest: 4, total: 4 });
  s.store.checkHabit(habit.id, { date: '2026-10-24', done: false });
  assert.deepEqual(habitStats(s.store.habit(habit.id), s.store.today()), { current: 2, longest: 2, total: 3 });
});

test('scheduled days skip rest days and frequency changes preserve earlier history', t => {
  const s = setup(t), habit = s.store.addHabit({ title: 'Walk', weekdays: [1, 3, 5], startDate: '2026-10-19' });
  for (const date of ['2026-10-19', '2026-10-21', '2026-10-23']) s.store.checkHabit(habit.id, { date, done: true });
  assert.equal(habitStats(s.store.habit(habit.id), '2026-10-25').current, 3);
  assert.equal(habitStats(s.store.habit(habit.id), '2026-10-26').current, 3);
  s.store.updateHabit(habit.id, { weekdays: [2, 4] });
  const updated = s.store.habit(habit.id);
  assert.equal(isDue(updated, '2026-10-19'), true); assert.equal(isDue(updated, '2026-10-26'), false);
  assert.equal(isDue(updated, '2026-10-27'), true); assert.equal(habitStats(updated, '2026-10-27').current, 3);
  assert.equal(habitStats(updated, '2026-10-28').current, 0);
  assert.equal(updated.schedules.length, 2);
  s.store.updateHabit(habit.id, { title: 'Walk outside', weekdays: [2, 4] });
  assert.equal(s.store.habit(habit.id).schedules.length, 2);
});

test('invalid dates, future checks, empty schedules and failed disk writes preserve the saved state', t => {
  const s = setup(t), habit = s.store.addHabit({ title: 'Walk', weekdays: [1] }), before = s.store.snapshot();
  for (const body of [{ date: '2026-02-30', done: true }, { date: '2026-10-27', done: true }, { date: '2026-10-25', done: true }, { done: 'yes' }]) assert.throws(() => s.store.checkHabit(habit.id, body), { status: 400 });
  for (const patch of [{ title: '' }, { weekdays: [] }, { weekdays: [7] }, { weekdays: 'daily' }]) assert.throws(() => s.store.updateHabit(habit.id, patch), { status: 400 });
  assert.throws(() => s.store.reorderHabits({ id: habit.id, beforeId: 'missing' }), { status: 404 });
  assert.deepEqual(s.store.snapshot(), before);
  const save = s.store.save; s.store.save = () => { throw new Error('Disk unavailable'); };
  assert.throws(() => s.store.checkHabit(habit.id, { done: true }), /Disk unavailable/);
  assert.deepEqual(s.store.snapshot(), before); s.store.save = save;
  s.setDate('2026-10-27'); assert.throws(() => s.store.checkHabit(habit.id, { done: true }), /rest day/);
});

test('habit HTTP API authenticates every write and includes records in exports', async t => {
  const s = setup(t), port = await s.service.start(), { readToken, writeToken } = s.service.credentials;
  const call = (route, method = 'GET', body, token = writeToken) => fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const habit = await (await call('/api/v1/habits', 'POST', { title: 'Read' })).json();
  for (const [route, method, body] of [
    ['/api/v1/habits', 'POST', { title: 'Blocked' }],
    [`/api/v1/habits/${habit.id}`, 'PATCH', { title: 'Blocked' }],
    [`/api/v1/habits/${habit.id}/checkins`, 'POST', { done: true }],
    ['/api/v1/habits/order', 'POST', { id: habit.id, beforeId: null }],
    [`/api/v1/habits/${habit.id}`, 'DELETE']
  ]) assert.equal((await call(route, method, body, readToken)).status, 403);
  assert.equal((await call(`/api/v1/habits/${habit.id}/checkins`, 'POST', { done: true })).status, 200);
  const exported = await (await call('/api/v1/export', 'GET', undefined, readToken)).json();
  assert.deepEqual(exported.habits[0].checkins, ['2026-10-26']);
  assert.equal((await (await call('/api/v1/habits', 'GET', undefined, readToken)).json()).habits[0].id, habit.id);
  assert.equal((await call(`/api/v1/habits/${habit.id}/checkins`, 'POST', { date: '2026-10-27', done: true })).status, 400);
  assert.equal((await call(`/api/v1/habits/${habit.id}`, 'DELETE')).status, 200);
});

test('Habits shows seven days, preserves task planning and drafts, and adds names as text', async t => {
  const f = await ui(t);
  assert.equal(f.$('#day-title').textContent, 'Habits'); assert.equal(f.$('#task-panel').hidden, true);
  assert.equal(f.$('.day-navigation').hidden, true); assert.equal(f.$('.habit-week').children.length, 7);
  assert.equal(f.$('.habit-streak').textContent, '2 days');
  f.$('#habit-input').value = '<img src=x> 阅读'; f.event(f.$('#habit-add'), 'submit'); await flush();
  assert.equal(f.store.snapshot().habits.at(-1).title, '<img src=x> 阅读'); assert.equal(f.$('#habits img'), null);
  f.event(f.$('#show-tasks'), 'click'); f.event(f.$('#next-date'), 'click'); f.$('#task-input').value = 'Tomorrow draft';
  f.event(f.$('#show-habits'), 'click'); f.$('#habit-input').value = 'Habit draft';
  f.api.expand(false); f.api.expand(true);
  assert.equal(f.$('#habit-input').value, 'Habit draft'); assert.equal(f.$('#day-title').textContent, 'Habits');
  f.event(f.$('#show-tasks'), 'click');
  assert.equal(f.$('#day-title').textContent, 'Tomorrow'); assert.equal(f.$('#task-input').value, 'Tomorrow draft');
});

test('check-ins animate in place, undo, backfill through the month and keep future dates disabled', async t => {
  const f = await ui(t), selector = `[data-id="${f.a.id}"] [data-date="2026-10-26"]`;
  const ids = () => [...f.$('#habits').children].map(row => row.dataset.id);
  f.event(f.$(selector), 'click'); await flush();
  assert.deepEqual(ids(), [f.a.id, f.b.id]); assert.equal(f.$(selector).getAttribute('aria-pressed'), 'true');
  assert.ok(f.$(selector).classList.contains('just-checked')); assert.equal(f.$('.habit-streak').textContent, '3 days');
  f.event(f.$(selector), 'click'); await flush(); assert.equal(f.$('.habit-streak').textContent, '2 days');
  f.event(f.$('.habit-title'), 'click');
  assert.equal(f.$('#habit-detail').hidden, false); assert.equal(f.$('#habit-add').hidden, true);
  assert.equal(f.$('.habit-calendar [data-date="2026-10-27"]').disabled, true);
  assert.equal(f.$('.habit-calendar [data-date="2026-10-19"]').disabled, true);
  f.event(f.$('.habit-calendar [data-date="2026-10-23"]'), 'click'); await flush();
  assert.ok(f.store.habit(f.a.id).checkins.includes('2026-10-23'));
  assert.equal(f.$('.habit-stats strong').textContent, '3');
  f.event(f.$('#habit-detail'), 'keydown', { key: 'Escape' });
  assert.equal(f.$('#habit-detail').hidden, true); assert.equal(f.$('.sheet').hidden, false);
});

test('failed optimistic check-in rolls back, a pending write locks switching, and stale refreshes are ignored', async t => {
  const f = await ui(t), selector = `[data-id="${f.a.id}"] [data-date="2026-10-26"]`, original = f.api.request;
  let releaseRead, rejectSave;
  f.api.request = (method, route, body) => method === 'GET' ? new Promise(resolve => { releaseRead = () => resolve({ ...f.state, habits: [] }); }) : new Promise((resolve, reject) => { rejectSave = () => reject(new Error('Check-in failed')); });
  const refreshing = vm.runInContext('refresh()', f.context);
  f.event(f.$(selector), 'click');
  assert.equal(f.$('#show-tasks').disabled, true); assert.equal(f.$(selector).getAttribute('aria-pressed'), 'true');
  f.event(f.$('#show-tasks'), 'click'); assert.equal(f.$('#day-title').textContent, 'Habits');
  releaseRead(); await refreshing; rejectSave(); await flush();
  assert.equal(f.$(selector).getAttribute('aria-pressed'), 'false'); assert.equal(f.$('#show-tasks').disabled, false);
  assert.equal(f.$('#error').textContent, 'Check-in failed');
  f.api.request = original; f.event(f.$(selector), 'click'); await flush();
  assert.equal(f.$(selector).getAttribute('aria-pressed'), 'true');
});

test('habit editing preserves Chinese drafts across refresh and collapse, validates frequency and retries failed saves', async t => {
  const f = await ui(t); f.event(f.$('.habit-title'), 'click'); f.event(f.$('.habit-edit'), 'click');
  const name = f.$('#habit-name'); name.value = '每天阅读';
  f.event(name, 'compositionstart'); f.event(f.$('#habit-edit-form'), 'submit'); await flush();
  assert.equal(f.store.habit(f.a.id).title, 'Read a chapter');
  f.event(name, 'compositionend');
  await vm.runInContext('refresh()', f.context); f.api.expand(false); f.api.expand(true);
  assert.equal(f.$('#habit-name'), name); assert.equal(name.value, '每天阅读');
  for (const node of f.document.querySelectorAll('.habit-weekday-choice')) f.event(node, 'click');
  f.event(f.$('#habit-edit-form'), 'submit'); await flush(); assert.equal(f.$('#error').textContent, 'Choose at least one day.');
  f.event(f.$('[data-weekday="1"]'), 'click');
  const request = f.api.request; f.api.request = async () => { throw new Error('Save failed'); };
  f.event(f.$('#habit-edit-form'), 'submit'); await flush();
  assert.equal(f.$('#habit-name').value, '每天阅读'); assert.equal(f.$('.habit-save').disabled, false);
  f.api.request = request; f.event(f.$('#habit-edit-form'), 'submit'); await flush();
  assert.equal(f.store.habit(f.a.id).title, '每天阅读');
  assert.deepEqual(f.store.habit(f.a.id).schedules.at(-1).weekdays, [1]); assert.equal(f.$('#habit-name'), null);
});

test('habits reorder across checked states and deletion uses an explicit second click', async t => {
  const f = await ui(t);
  f.event(f.$('.habit .reorder-handle'), 'keydown', { key: 'End' }); await flush();
  assert.deepEqual(f.store.snapshot().habits.map(habit => habit.id), [f.b.id, f.a.id]);
  await vm.runInContext('refresh()', f.context);
  assert.equal(f.$('.habit').dataset.id, f.b.id);
  const transfer = { setData() {}, setDragImage() {} };
  f.event(f.$('.habit-title'), 'dragstart', { dataTransfer: transfer, clientX: 260, clientY: 375 });
  f.event(f.$('.habit-scroll'), 'drop', { dataTransfer: transfer, clientY: 450 }); await flush();
  assert.deepEqual(f.store.snapshot().habits.map(habit => habit.id), [f.a.id, f.b.id]);
  f.event(f.$('.habit-title'), 'click', { detail: 1 }); assert.equal(f.$('#habit-detail').hidden, true);
  f.event(f.$('.habit-title'), 'pointerdown', { button: 0 }); f.event(f.$('.habit-title'), 'click');
  f.event(f.$('.habit-edit'), 'click'); f.event(f.$('.habit-delete'), 'click');
  assert.equal(f.store.snapshot().habits.length, 2); f.event(f.$('.habit-keep'), 'click');
  assert.equal(f.store.snapshot().habits.length, 2); f.event(f.$('.habit-delete'), 'click'); f.event(f.$('.habit-delete'), 'click'); await flush();
  assert.equal(f.store.snapshot().habits.length, 1); assert.equal(f.$('#habit-detail').hidden, true);
});

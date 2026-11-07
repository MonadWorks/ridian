const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { fixture, flush } = require('./helpers/widget.cjs');

test('new-task priority opens before typing and the axis previews continuously', async () => {
  const f = await fixture(); f.open();
  const slider = f.$('.priority-range');
  assert.equal(slider.getAttribute('type'), 'range');
  assert.equal(slider.getAttribute('aria-orientation'), 'horizontal');
  assert.equal(slider.getAttribute('step'), 'any');
  assert.equal(f.$('#task-input').value, '');
  assert.equal(f.$('#priority-picker').hidden, false);
  assert.equal(f.event(slider, 'pointerdown', { button: 0 }).defaultPrevented, false);
  f.value(1.4); const fill = f.$('#priority-picker').style.getPropertyValue('--fill');
  const color = f.$('#priority-picker').style.getPropertyValue('--priority-color');
  f.value(1.45);
  assert.equal(Number(slider.value), 1.45);
  assert.notEqual(f.$('#priority-picker').style.getPropertyValue('--fill'), fill);
  assert.notEqual(f.$('#priority-picker').style.getPropertyValue('--priority-color'), color);
  assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0);
});

test('chosen priority is submitted with a new task and resets only after success', async () => {
  const f = await fixture(); f.open(); f.value(2.8);
  f.event(f.$('.priority-range'), 'change');
  assert.equal(Number(f.$('.priority-range').value), 3);
  assert.equal(f.$('#draft-priority-label').textContent, 'Urgent');
  f.$('#task-input').value = '中文待办'; f.event(f.$('#add-form'), 'submit'); await flush();
  assert.equal(f.state.tasks[0].priority, 'urgent');
  assert.equal(f.state.tasks[0].title, '中文待办');
  assert.equal(f.$('#draft-priority-label').textContent, 'Normal');
  assert.equal(f.$('#task-input').value, '');
  assert.ok(f.$('.task .priority.urgent'));
});

test('Escape cancels an unfinished draft selection without collapsing the sheet', async () => {
  const f = await fixture(); f.open(); f.value(3);
  f.event(f.$('.priority-range'), 'keydown', { key: 'Escape' });
  assert.equal(f.$('#draft-priority-label').textContent, 'Normal');
  assert.equal(f.$('#priority-picker').hidden, true);
  assert.equal(f.$('.sheet').hidden, false);
  assert.equal(f.state.tasks.length, 0);
});

test('existing task priorities persist on release, including all four levels', async () => {
  const f = await fixture({ tasks: [{ id: 'existing', title: 'Review', priority: 'normal', date: '2026-10-26', completedAt: null }] });
  for (const [index, level] of ['low', 'normal', 'high', 'urgent'].entries()) {
    f.event(f.$('.task .priority'), 'click');
    const previous = f.state.tasks[0].priority;
    f.value(index);
    assert.equal(f.state.tasks[0].priority, previous);
    f.event(f.$('.priority-range'), 'change'); await flush();
    assert.equal(f.state.tasks[0].priority, level);
    assert.equal(f.$('#priority-picker').hidden, true);
    assert.equal(f.$('.task .priority').disabled, false);
  }
});

test('failed creation preserves both typed content and selected priority', async () => {
  const f = await fixture({ failCreate: true }); f.open(); f.value(3); f.event(f.$('.priority-range'), 'change');
  f.$('#task-input').value = 'Keep this draft'; f.event(f.$('#add-form'), 'submit'); await flush();
  assert.equal(f.state.tasks.length, 0);
  assert.equal(f.$('#task-input').value, 'Keep this draft');
  assert.equal(f.$('#draft-priority-label').textContent, 'Urgent');
  assert.equal(f.$('#draft-priority').disabled, false);
  assert.equal(f.$('#error').textContent, 'Test save failed');
});

test('release eases to a detent while keyboard selection works without dragging', async () => {
  const f = await fixture({ reducedMotion: false }); f.open(); f.value(2.55); f.event(f.$('.priority-range'), 'change');
  assert.equal(Number(f.$('.priority-range').value), 2.55);
  f.advance(65); assert.ok(Number(f.$('.priority-range').value) > 2.55 && Number(f.$('.priority-range').value) < 3);
  f.advance(130); assert.equal(Number(f.$('.priority-range').value), 3);
  f.event(f.$('.priority-range'), 'keydown', { key: 'Home' });
  assert.equal(Number(f.$('.priority-range').value), 0);
  f.event(f.$('.priority-range'), 'keydown', { key: 'ArrowRight' });
  assert.equal(Number(f.$('.priority-range').value), 1);
  f.event(f.$('.priority-range'), 'keydown', { key: 'Enter' });
  assert.equal(f.$('#draft-priority-label').textContent, 'Normal');
  assert.equal(f.$('#priority-picker').hidden, true);
});

const sampleTasks = [
  { id: 'high', title: 'High task', priority: 'high', date: '2026-10-26', completedAt: null },
  { id: 'low', title: 'Low task', priority: 'low', date: '2026-10-26', completedAt: null },
  { id: 'done', title: 'Done task', priority: 'urgent', date: '2026-10-26', completedAt: '2026-10-26T10:00:00Z' }
];
const displayedIds = f => [...f.$('#tasks').children].map(row => row.dataset.id);

test('default order puts all completed tasks last regardless of priority', async () => {
  const f = await fixture({ tasks: [...sampleTasks].reverse() });
  assert.deepEqual(displayedIds(f), ['high', 'low', 'done']);
});

test('keyboard moves cross priority and completion boundaries and survive refresh', async () => {
  const f = await fixture({ tasks: sampleTasks });
  f.event(f.$('[data-id="high"] .reorder-handle'), 'keydown', { key: 'End' }); await flush();
  assert.deepEqual(displayedIds(f), ['low', 'done', 'high']);
  assert.deepEqual(Array.from(f.state.taskOrder), ['low', 'done', 'high']);
  assert.equal(f.state.tasks[0].priority, 'high');
  await vm.runInContext('refresh()', f.context);
  assert.deepEqual(displayedIds(f), ['low', 'done', 'high']);
  f.event(f.$('[data-id="done"] .reorder-handle'), 'keydown', { key: 'Home' }); await flush();
  assert.deepEqual(displayedIds(f), ['done', 'low', 'high']);
});

test('native drag events save only on drop and cancellation leaves order unchanged', async () => {
  const f = await fixture({ tasks: sampleTasks });
  const transfer = { setData() {}, setDragImage() {} };
  f.event(f.$('[data-id="high"] .task-text'), 'dragstart', { dataTransfer: transfer, clientX: 260, clientY: 375 });
  f.event(f.$('.list-scroll'), 'dragover', { dataTransfer: transfer, clientY: 450 });
  assert.equal(f.calls.filter(call => call.route === '/api/v1/order').length, 0);
  f.event(f.document, 'dragend');
  assert.deepEqual(displayedIds(f), ['high', 'low', 'done']);
  f.event(f.$('[data-id="high"] .task-text'), 'dragstart', { dataTransfer: transfer, clientX: 260, clientY: 375 });
  f.event(f.$('.list-scroll'), 'drop', { dataTransfer: transfer, clientY: 450 }); await flush();
  assert.deepEqual(displayedIds(f), ['low', 'done', 'high']);
  assert.equal(f.calls.filter(call => call.route === '/api/v1/order').length, 1);
});

test('a failed reorder restores the previous order', async () => {
  const f = await fixture({ tasks: sampleTasks, failReorder: true });
  f.event(f.$('[data-id="high"] .reorder-handle'), 'keydown', { key: 'End' }); await flush();
  assert.deepEqual(displayedIds(f), ['high', 'low', 'done']);
  assert.equal(f.$('#error').textContent, 'Test order save failed');
  assert.equal(f.$('.check').disabled, false);
});

const plannedTasks = [
  { id: 'carry', title: 'Carryover', priority: 'normal', date: '2026-10-24', completedAt: null },
  { id: 'today', title: 'Today task', priority: 'high', date: '2026-10-26', completedAt: null },
  { id: 'tomorrow', title: 'Tomorrow task', priority: 'low', date: '2026-10-27', completedAt: null },
  { id: 'later', title: 'Later task', priority: 'urgent', date: '2026-11-05', completedAt: null }
];

test('date navigation separates future plans from carryover and keeps the orb on today', async () => {
  const f = await fixture({ tasks: plannedTasks });
  assert.deepEqual(displayedIds(f), ['today', 'carry']);
  assert.equal(f.$('#return-today').hidden, true);
  f.event(f.$('#next-date'), 'click');
  assert.equal(f.$('#day-title').textContent, 'Tomorrow');
  assert.deepEqual(displayedIds(f), ['tomorrow']);
  assert.equal(f.$('#orb-number').textContent, '2');
  assert.equal(f.$('#progress-label').textContent, '0 / 1');
  assert.equal(f.$('#return-today').hidden, false);
  assert.equal(f.$('#return-today').textContent.trim(), '');
  f.event(f.$('#next-date'), 'click');
  assert.deepEqual(displayedIds(f), []);
  assert.equal(f.$('#empty').hidden, false);
  f.event(f.$('#return-today'), 'click');
  assert.equal(f.$('#day-title').textContent, 'Today');
  assert.deepEqual(displayedIds(f), ['today', 'carry']);
  f.event(f.$('#previous-date'), 'click');
  assert.equal(f.$('#day-title').textContent, 'Yesterday');
  assert.deepEqual(displayedIds(f), []);
});

test('future creation saves the chosen day and priority, preserving drafts while browsing', async () => {
  const f = await fixture();
  f.$('#task-input').value = 'Prepare a review'; f.open(); f.value(2); f.event(f.$('.priority-range'), 'change');
  f.event(f.$('#next-date'), 'click');
  assert.equal(f.$('#task-input').value, 'Prepare a review');
  assert.equal(f.$('#draft-priority-label').textContent, 'High');
  f.event(f.$('#add-form'), 'submit'); await flush();
  assert.equal(f.state.tasks[0].date, '2026-10-27');
  assert.equal(f.state.tasks[0].priority, 'high');
  assert.equal(f.$('.task-text').textContent, 'Prepare a review');
  assert.equal(f.$('#orb-number').textContent, '·');
  f.event(f.$('#return-today'), 'click');
  assert.deepEqual(displayedIds(f), []);
  f.event(f.$('#next-date'), 'click'); await vm.runInContext('refresh()', f.context);
  assert.equal(f.$('.task-text').textContent, 'Prepare a review');
});

test('calendar selects another month, marks scheduled days, and supports keyboard and Escape', async () => {
  const f = await fixture({ tasks: plannedTasks });
  f.event(f.$('#choose-date'), 'click');
  assert.equal(f.$('#date-calendar').hidden, false);
  assert.equal(f.$('.calendar-month').textContent, 'October 2026');
  assert.equal(f.document.activeElement.dataset.date, '2026-10-26');
  assert.equal(f.$('[data-date="2026-10-27"]').classList.contains('has-tasks'), true);
  f.event(f.$('[data-month="1"]'), 'click');
  assert.equal(f.$('.calendar-month').textContent, 'November 2026');
  f.event(f.$('[data-date="2026-11-05"]'), 'click');
  assert.equal(f.$('#date-calendar').hidden, true);
  assert.deepEqual(displayedIds(f), ['later']);
  f.event(f.$('#choose-date'), 'click');
  f.event(f.document.activeElement, 'keydown', { key: 'ArrowDown' });
  assert.equal(f.document.activeElement.dataset.date, '2026-11-12');
  f.event(f.document.activeElement, 'keydown', { key: 'PageUp' });
  assert.equal(f.document.activeElement.dataset.date, '2026-10-12');
  f.event(f.document.activeElement, 'keydown', { key: 'Escape' });
  assert.equal(f.$('#date-calendar').hidden, true);
  assert.equal(f.$('.sheet').hidden, false);
  assert.deepEqual(displayedIds(f), ['later']);
  assert.equal(f.document.activeElement, f.$('#choose-date'));
});

test('future reordering preserves today order and survives switching dates', async () => {
  const tasks = [...plannedTasks, { id: 'future-high', title: 'Future high', priority: 'high', date: '2026-10-27', completedAt: null }];
  const f = await fixture({ tasks, taskOrder: ['carry', 'today'] });
  f.event(f.$('#next-date'), 'click');
  assert.deepEqual(displayedIds(f), ['future-high', 'tomorrow']);
  f.event(f.$('[data-id="future-high"] .reorder-handle'), 'keydown', { key: 'End' }); await flush();
  assert.deepEqual(displayedIds(f), ['tomorrow', 'future-high']);
  assert.equal(f.calls.find(call => call.route === '/api/v1/order').body.date, '2026-10-27');
  f.event(f.$('#return-today'), 'click');
  assert.deepEqual(displayedIds(f), ['carry', 'today']);
  f.event(f.$('#next-date'), 'click'); await vm.runInContext('refresh()', f.context);
  assert.deepEqual(displayedIds(f), ['tomorrow', 'future-high']);
});

test('today follows midnight while explicitly selected days stay selected', async () => {
  const f = await fixture({ tasks: plannedTasks });
  f.state.today = '2026-10-27'; await vm.runInContext('refresh()', f.context);
  assert.equal(f.$('#day-title').textContent, 'Today');
  assert.match(f.$('#today-date').textContent, /Oct 27/);
  assert.deepEqual(displayedIds(f), ['today', 'carry', 'tomorrow']);
  f.event(f.$('#next-date'), 'click'); f.event(f.$('#next-date'), 'click');
  f.state.today = '2026-10-28'; await vm.runInContext('refresh()', f.context);
  assert.match(f.$('#today-date').textContent, /Oct 29/);
  assert.equal(f.$('#day-title').textContent, 'Tomorrow');
  f.event(f.$('#return-today'), 'click');
  assert.match(f.$('#today-date').textContent, /Oct 28/);
});

test('early completion keeps its planned date and records the actual completion day', async () => {
  const f = await fixture({ tasks: plannedTasks }); f.event(f.$('#next-date'), 'click');
  f.event(f.$('.check'), 'click'); await flush();
  const task = f.state.tasks.find(task => task.id === 'tomorrow');
  assert.equal(task.date, '2026-10-27'); assert.equal(task.completedDate, '2026-10-26');
  assert.equal(f.$('.task.done').dataset.id, 'tomorrow');
  f.event(f.$('#return-today'), 'click');
  assert.deepEqual(displayedIds(f), ['today', 'carry', 'tomorrow']);
});

test('in-flight saves lock the destination and a stale refresh cannot erase a new plan', async () => {
  const f = await fixture(); f.event(f.$('#next-date'), 'click');
  const original = f.api.request, stale = structuredClone(f.state);
  let resolveRead, releaseSave;
  f.api.request = (method, ...args) => method === 'GET'
    ? new Promise(resolve => { resolveRead = () => resolve(stale); })
    : new Promise(resolve => { releaseSave = () => resolve(original(method, ...args)); });
  const refreshing = vm.runInContext('refresh()', f.context);
  f.$('#task-input').value = 'Saved for tomorrow'; f.event(f.$('#add-form'), 'submit');
  assert.equal(f.$('#next-date').disabled, true);
  f.event(f.$('#return-today'), 'click');
  assert.equal(f.$('#day-title').textContent, 'Tomorrow');
  releaseSave(); await flush(); resolveRead(); await refreshing;
  assert.equal(f.$('.task-text').textContent, 'Saved for tomorrow');
  assert.equal(f.state.tasks[0].date, '2026-10-27');
  assert.equal(f.$('#next-date').disabled, false);
});

test('failed future creation and collapse retain the draft and its selected day', async () => {
  const f = await fixture({ failCreate: true }); f.event(f.$('#next-date'), 'click');
  f.$('#task-input').value = 'Try later'; f.event(f.$('#add-form'), 'submit'); await flush();
  f.api.expand(false); f.api.expand(true);
  assert.equal(f.$('#day-title').textContent, 'Tomorrow');
  assert.equal(f.$('#task-input').value, 'Try later');
  assert.equal(f.$('#next-date').disabled, false);
  assert.equal(f.$('#error').textContent, 'Test save failed');
});

test('a single click edits in place, saves with Enter, and preserves task identity and metadata', async () => {
  const f = await fixture({ tasks: sampleTasks, taskOrder: ['low', 'high', 'done'] });
  const original = structuredClone(f.state.tasks[0]);
  f.event(f.$('[data-id="high"] .task-text'), 'click');
  const input = f.$('.edit-input'); assert.ok(input); assert.equal(input.value, 'High task');
  input.value = 'Updated task'; f.event(input, 'keydown', { key: 'Enter' }); await flush();
  assert.equal(f.$('.edit-input'), null);
  assert.equal(f.$('[data-id="high"] .task-text').textContent, 'Updated task');
  assert.deepEqual(f.state.tasks[0], { ...original, title: 'Updated task' });
  assert.deepEqual(displayedIds(f), ['low', 'high', 'done']);
  assert.equal(f.calls.filter(call => call.method === 'POST' || call.method === 'DELETE').length, 0);
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
  assert.equal(f.document.activeElement, f.$('[data-id="high"] .task-text'));
  assert.equal(f.$('[data-id="high"] .check').getAttribute('aria-label'), 'Updated task');
  await vm.runInContext('refresh()', f.context);
  assert.equal(f.$('[data-id="high"] .task-text').textContent, 'Updated task');
});

test('blur saves future tasks and keyboard activation edits completed tasks without reopening them', async () => {
  const f = await fixture({ tasks: [...plannedTasks, ...sampleTasks.slice(2)] });
  f.event(f.$('#next-date'), 'click');
  f.event(f.$('[data-id="tomorrow"] .task-text'), 'click');
  f.$('.edit-input').value = 'Updated tomorrow'; f.event(f.$('.edit-input'), 'blur'); await flush();
  assert.equal(f.state.tasks.find(task => task.id === 'tomorrow').date, '2026-10-27');
  assert.equal(f.$('.task-text').textContent, 'Updated tomorrow');
  f.event(f.$('#return-today'), 'click');
  const original = structuredClone(f.state.tasks.find(task => task.id === 'done'));
  f.event(f.$('[data-id="done"] .task-text'), 'keydown', { key: 'F2' });
  f.$('.edit-input').value = 'Updated completed task'; f.event(f.$('.edit-input'), 'keydown', { key: 'Enter' }); await flush();
  assert.deepEqual(f.state.tasks.find(task => task.id === 'done'), { ...original, title: 'Updated completed task' });
  assert.equal(f.$('[data-id="done"]').classList.contains('done'), true);
});

test('Escape cancels editing and blank titles stay editable without deleting the task', async () => {
  const f = await fixture({ tasks: sampleTasks });
  f.event(f.$('[data-id="high"] .task-text'), 'click');
  f.$('.edit-input').value = 'Changed draft'; f.event(f.$('.edit-input'), 'keydown', { key: 'Escape' }); await flush();
  assert.equal(f.state.tasks[0].title, 'High task'); assert.equal(f.$('.sheet').hidden, false);
  assert.equal(f.$('.edit-input'), null);
  f.event(f.$('[data-id="high"] .task-text'), 'click');
  f.$('.edit-input').value = '  '; f.event(f.$('.edit-input'), 'keydown', { key: 'Enter' }); await flush();
  assert.equal(f.$('.edit-input').getAttribute('aria-invalid'), 'true');
  assert.equal(f.state.tasks.length, 3); assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 0);
  f.$('.edit-input').value = 'Valid title'; f.event(f.$('.edit-input'), 'input');
  f.event(f.$('.edit-input'), 'keydown', { key: 'Enter' }); await flush();
  assert.equal(f.state.tasks[0].title, 'Valid title');
});

test('Chinese composition finishes before Enter saves; refresh and re-expansion preserve an edit', async () => {
  const f = await fixture({ tasks: sampleTasks });
  f.event(f.$('[data-id="high"] .task-text'), 'click');
  const input = f.$('.edit-input'); input.value = '复习神经网络';
  f.event(input, 'compositionstart');
  f.event(input, 'keydown', { key: 'Enter', isComposing: true });
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 0);
  await vm.runInContext('refresh()', f.context); f.api.expand(true);
  assert.equal(f.$('.edit-input'), input); assert.equal(input.value, '复习神经网络');
  f.event(input, 'compositionend');
  f.event(input, 'keydown', { key: 'Enter', shiftKey: true });
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 0);
  f.event(input, 'keydown', { key: 'Enter' }); await flush();
  assert.equal(f.state.tasks[0].title, '复习神经网络');
});

test('failed edits retain the complete draft and can be retried', async () => {
  const f = await fixture({ tasks: sampleTasks, failEdit: true });
  f.event(f.$('[data-id="high"] .task-text'), 'click');
  const input = f.$('.edit-input'); input.value = 'Keep this edited draft';
  f.event(input, 'keydown', { key: 'Enter' }); await flush();
  assert.equal(f.state.tasks[0].title, 'High task');
  assert.equal(f.$('.edit-input'), input); assert.equal(input.value, 'Keep this edited draft');
  assert.equal(input.readOnly, false); assert.equal(f.$('#error').textContent, 'Test edit save failed');
  f.api.request = async (method, route, body) => {
    assert.equal(method, 'PATCH'); assert.equal(route, '/api/v1/tasks/high');
    const saved = { ...f.state.tasks[0], title: body.title }; Object.assign(f.state.tasks[0], saved); return saved;
  };
  f.event(input, 'keydown', { key: 'Enter' }); await flush();
  assert.equal(f.$('.edit-input'), null);
  assert.equal(f.$('[data-id="high"] .task-text').textContent, 'Keep this edited draft');
});

test('one pending edit save handles Enter and blur once, then completes the clicked checkbox', async () => {
  const f = await fixture({ tasks: sampleTasks });
  f.event(f.$('[data-id="high"] .task-text'), 'click');
  const input = f.$('.edit-input'); input.value = 'Rename then complete';
  const original = f.api.request; let release;
  f.api.request = (method, route, body) => body?.title ? new Promise(resolve => { release = () => resolve(original(method, route, body)); }) : original(method, route, body);
  f.event(input, 'keydown', { key: 'Enter' }); f.event(input, 'blur');
  f.event(f.$('[data-id="high"] .check'), 'click');
  assert.equal(input.readOnly, true);
  release(); await flush();
  const changes = f.calls.filter(call => call.method === 'PATCH');
  assert.equal(changes.length, 2); assert.equal(changes[0].body.title, 'Rename then complete'); assert.equal(changes[1].body.done, true);
  assert.ok(f.state.tasks[0].completedAt);
  assert.equal(f.$('.edit-input'), null);
});

test('dragging still reorders and its trailing click does not start an edit', async () => {
  const f = await fixture({ tasks: sampleTasks });
  const transfer = { setData() {}, setDragImage() {} };
  f.event(f.$('[data-id="high"] .task-text'), 'dragstart', { dataTransfer: transfer, clientX: 260, clientY: 375 });
  f.event(f.$('.list-scroll'), 'drop', { dataTransfer: transfer, clientY: 450 }); await flush();
  f.event(f.$('[data-id="high"] .task-text'), 'click', { detail: 1 });
  assert.equal(f.$('.edit-input'), null);
  assert.deepEqual(displayedIds(f), ['low', 'done', 'high']);
  f.event(f.$('[data-id="high"] .task-text'), 'pointerdown', { button: 0 });
  f.event(f.$('[data-id="high"] .task-text'), 'click', { detail: 1 });
  assert.ok(f.$('.edit-input'));
});

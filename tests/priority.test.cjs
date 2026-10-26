// DOM unit tests only: no browser, network, native app, or personal data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const root = path.join(__dirname, '..');
const flush = () => new Promise(resolve => setImmediate(resolve));

async function fixture({ tasks = [], reducedMotion = true, failCreate = false } = {}) {
  const { window, document } = parseHTML(fs.readFileSync(path.join(root, 'web/widget.html'), 'utf8'));
  Object.defineProperty(document, 'activeElement', { value: document.body, writable: true });
  window.HTMLElement.prototype.focus = function () { this.ownerDocument.activeElement = this; };
  window.HTMLElement.prototype.animate = () => {};
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.classList.contains('sheet') ? { left: 12, right: 344, top: 12, bottom: 456, width: 332, height: 444 } : { left: 240, right: 304, top: 370, bottom: 398, width: 64, height: 28 };
  };
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 248; } });
  let now = 0, nextFrame = 0;
  const frames = new Map(), calls = [];
  const state = { tasks: structuredClone(tasks), today: '2026-10-26', exportedAt: '2026-10-26T12:00:00Z' };
  let expandedCallback;
  window.ridian = {
    onExpanded(callback) { expandedCallback = callback; },
    expand(value) { expandedCallback(value); },
    hover() {}, drag() {}, menu() {}, history() {}, taskMenu() {},
    async request(method, route, body) {
      calls.push({ method, route, body });
      if (method === 'GET') return structuredClone(state);
      if (method === 'POST') {
        if (failCreate) throw new Error('Test save failed');
        const task = { ...body, id: `task-${state.tasks.length}`, date: state.today, completedAt: null };
        state.tasks.push(task); return structuredClone(task);
      }
      if (method === 'PATCH') {
        const task = state.tasks.find(item => route.endsWith(item.id));
        Object.assign(task, body); return structuredClone(task);
      }
    }
  };
  const context = vm.createContext({ window, document, console, CSS: { escape: value => value }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    matchMedia: () => ({ matches: reducedMotion }), performance: { now: () => now },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame(id) { frames.delete(id); } });
  const source = fs.readFileSync(path.join(root, 'web/priority.js'), 'utf8').replace('export function createPriorityPicker', 'function createPriorityPicker') + '\n' + fs.readFileSync(path.join(root, 'web/widget.js'), 'utf8').replace(/^import .*\n/, '');
  new vm.Script(source, { filename: 'priority-widget-unit.js' }).runInContext(context);
  await flush();
  const $ = selector => document.querySelector(selector);
  const event = (element, type, extra = {}) => { const e = new window.Event(type, { bubbles: true, cancelable: true }); Object.assign(e, extra); element.dispatchEvent(e); return e; };
  const open = () => event($('#draft-priority'), 'click');
  const value = raw => { $('.priority-range').value = String(raw); event($('.priority-range'), 'input'); };
  const advance = milliseconds => { now = milliseconds; const queue = [...frames.values()]; frames.clear(); queue.forEach(callback => callback(now)); };
  expandedCallback(true);
  await flush();
  return { $, event, open, value, advance, state, calls, document };
}

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

// DOM unit tests only: no browser, network, native app, or personal data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const root = path.join(__dirname, '../..');
const flush = () => new Promise(resolve => setImmediate(resolve));

async function fixture({ tasks = [], taskOrder = [], reducedMotion = true, failCreate = false, failReorder = false, failEdit = false, habitService = null } = {}) {
  const { window, document } = parseHTML(fs.readFileSync(path.join(root, 'web/widget.html'), 'utf8'));
  Object.defineProperty(document, 'activeElement', { value: document.body, writable: true });
  window.HTMLElement.prototype.focus = function () { this.ownerDocument.activeElement = this; };
  window.HTMLElement.prototype.select = function () {};
  window.HTMLElement.prototype.animate = () => {};
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.classList.contains('sheet') ? { left: 12, right: 344, top: 12, bottom: 456, width: 332, height: 444 } : { left: 240, right: 304, top: 370, bottom: 398, width: 64, height: 28 };
  };
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 248; } });
  let now = 0, nextFrame = 0;
  const frames = new Map(), calls = [];
  const state = { tasks: structuredClone(tasks).map(task => ({ ...task, completedDate: task.completedDate ?? (task.completedAt ? task.date : null) })), taskOrder, today: '2026-10-26', exportedAt: '2026-10-26T12:00:00Z' };
  let expandedCallback;
  window.ridian = {
    onExpanded(callback) { expandedCallback = callback; },
    expand(value) { expandedCallback(value); },
    hover() {}, drag() {}, menu() {}, history() {}, taskMenu() {},
    async request(method, route, body) {
      calls.push({ method, route, body });
      if (route.startsWith('/api/v1/habits') && habitService) return habitService.dispatch(method, route, body);
      if (method === 'GET') return { ...structuredClone(state), habits: habitService ? habitService.store.snapshot().habits : [] };
      if (method === 'POST' && route === '/api/v1/order') {
        if (failReorder) throw new Error('Test order save failed');
        const visible = require('../../web/dates.js').tasksForDate(state.tasks, body.date || state.today, state.today);
        state.taskOrder = require('../../web/task-order.js').moveOrder(visible, state.taskOrder, body.id, body.beforeId);
        return { taskOrder: [...state.taskOrder] };
      }
      if (method === 'POST') {
        if (failCreate) throw new Error('Test save failed');
        const task = { ...body, id: `task-${state.tasks.length}`, date: body.date || state.today, completedAt: null, completedDate: null };
        state.tasks.push(task); return structuredClone(task);
      }
      if (method === 'PATCH') {
        if (failEdit && 'title' in body) throw new Error('Test edit save failed');
        const task = state.tasks.find(item => route.endsWith(item.id));
        Object.assign(task, body);
        if ('done' in body) { task.completedAt = body.done ? `${state.today}T12:00:00Z` : null; task.completedDate = body.done ? state.today : null; state.taskOrder = state.taskOrder.filter(id => id !== task.id); }
        return structuredClone(task);
      }
    }
  };
  const context = vm.createContext({ window, document, console, CSS: { escape: value => value }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    matchMedia: () => ({ matches: reducedMotion }), performance: { now: () => now },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame(id) { frames.delete(id); } });
  const source = ['task-order.js', 'dates.js', 'reorder.js', 'priority.js', 'calendar.js', 'habits.js', 'habit-view.js', 'widget.js'].map(file => fs.readFileSync(path.join(root, 'web', file), 'utf8').replace(/^export function /gm, 'function ').replace(/^import .*\n/gm, '')).join('\n');
  new vm.Script(source, { filename: 'priority-widget-unit.js' }).runInContext(context);
  await flush();
  const $ = selector => document.querySelector(selector);
  const event = (element, type, extra = {}) => { const e = new window.Event(type, { bubbles: true, cancelable: true }); Object.assign(e, extra); element.dispatchEvent(e); return e; };
  const open = () => event($('#draft-priority'), 'click');
  const value = raw => { $('.priority-range').value = String(raw); event($('.priority-range'), 'input'); };
  const advance = milliseconds => { now = milliseconds; const queue = [...frames.values()]; frames.clear(); queue.forEach(callback => callback(now)); };
  expandedCallback(true);
  await flush();
  return { $, event, open, value, advance, state, calls, document, context, api: window.ridian };
}

module.exports = { fixture, flush };

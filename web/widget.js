import { createPriorityPicker } from './priority.js';
import './task-order.js';
import { createTaskReorder } from './reorder.js';
import './dates.js';
import { createCalendar } from './calendar.js';
const { orderTasks, moveOrder } = window.RidianOrder;
const { localDate, validDate, addDays, tasksForDate } = window.RidianDates;
const api = window.ridian;
const $ = id => document.getElementById(id);
let expanded = false, snapshot = { tasks: [], today: '' }, busy = new Set(), refreshInFlight = false, reorderSaving = false;
let selectedDate = '', adding = false, revision = 0;
const today = () => snapshot.today || localDate();
const viewedDate = () => selectedDate || today();
const viewedTasks = () => tasksForDate(snapshot.tasks, viewedDate(), today());
const request = (method, path, body) => api ? api.request(method, path, body) : Promise.reject(new Error('Open the Ridian desktop app.'));
function error(message = '') { $('error').hidden = !message; $('error').textContent = message; }
function announce(message) { $('announcement').textContent = message; }
let draftPriority = 'normal';
function setDraftPriority(value) {
  draftPriority = value;
  const label = value[0].toUpperCase() + value.slice(1);
  $('draft-priority').className = `draft-priority ${value}`;
  $('draft-priority').setAttribute('aria-label', `Priority for new task: ${label}`);
  $('draft-priority-label').textContent = label;
}
const priorityPicker = createPriorityPicker({ commit: setPriority, getDraftPriority: () => draftPriority, onDraftChange: setDraftPriority });
priorityPicker.bindDraft($('draft-priority'));
const taskReorder = createTaskReorder({ list: $('tasks'), canStart: () => !busy.size && !adding && !reorderSaving && !priorityPicker.isOpen && !calendar.isOpen && !document.querySelector('.edit-input'), move: reorderTask });
const canChangeDate = () => !busy.size && !adding && !reorderSaving && !taskReorder.isDragging && !document.querySelector('.edit-input');
const calendar = createCalendar({ trigger: $('choose-date'), getDate: viewedDate, getToday: today, getTasks: () => snapshot.tasks, select: selectDate, canOpen: () => { if (!canChangeDate()) return false; priorityPicker.close(); return true; } });
function updateNavigation() {
  for (const id of ['choose-date', 'previous-date', 'next-date', 'return-today']) $(id).disabled = !canChangeDate();
  $('previous-date').disabled ||= !validDate(addDays(viewedDate(), -1)) || viewedDate() === '0001-01-01';
  $('next-date').disabled ||= !validDate(addDays(viewedDate(), 1));
}
function selectDate(date) {
  if (!validDate(date) || date < '0001-01-01' || !canChangeDate()) return;
  calendar.close(); priorityPicker.close();
  const previous = viewedDate();
  selectedDate = date === today() ? '' : date;
  render();
  document.querySelector('.list-scroll').scrollTop = 0;
  if (date !== previous && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelector('.list-scroll').animate([{ opacity: .2, transform: `translateX(${date > previous ? 7 : -7}px)` }, { opacity: 1, transform: 'translateX(0)' }], { duration: 180, easing: 'cubic-bezier(.22,1,.36,1)' });
  }
  announce($('today-date').textContent);
}
function render(justDone, priorityChanged) {
  const previousPositions = new Map([...document.querySelectorAll('.task')].map(row => [row.dataset.id, row.getBoundingClientRect().top]));
  if (selectedDate === today()) selectedDate = '';
  const date = viewedDate(), visible = orderTasks(viewedTasks(), snapshot.taskOrder);
  const pending = visible.filter(t => !t.completedAt).length;
  const done = visible.length - pending;
  const todayTasks = tasksForDate(snapshot.tasks, today(), today()), todayPending = todayTasks.filter(task => !task.completedAt).length;
  $('orb-number').textContent = todayPending || (todayTasks.length ? '✓' : '·');
  $('orb').setAttribute('aria-label', `Open task list, ${todayPending} pending today`);
  $('progress-ring').style.strokeDashoffset = String(163.363 * (todayTasks.length ? todayPending / todayTasks.length : 1));
  $('progress-label').textContent = visible.length ? `${done} / ${visible.length}` : '';
  const dateObject = new Date(`${date}T12:00:00`);
  $('today-date').textContent = dateObject.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short', ...(date.slice(0, 4) !== today().slice(0, 4) ? { year: 'numeric' } : {}) });
  const heading = date === today() ? 'Today' : date === addDays(today(), 1) ? 'Tomorrow' : date === addDays(today(), -1) ? 'Yesterday' : dateObject.toLocaleDateString('en-US', { weekday: 'long' });
  $('day-title').textContent = heading;
  document.querySelector('.sheet').setAttribute('aria-label', `${heading}, ${date}`);
  $('choose-date').setAttribute('aria-label', `Choose a date, ${date}`);
  $('return-today').hidden = date === today();
  $('task-input').setAttribute('aria-label', date === today() ? 'Add a task' : `Add a task for ${date}`);
  updateNavigation();
  $('empty').hidden = visible.length > 0;
  const fragment = document.createDocumentFragment();
  for (const task of visible) {
    const li = document.createElement('li'); li.className = `task${task.completedAt ? ' done' : ''}${task.id === justDone ? ' just-done' : ''}`; li.dataset.id = task.id;
    li.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); api?.taskMenu(task.id); });
    const check = document.createElement('button'); check.className = 'check'; check.setAttribute('role', 'checkbox'); check.setAttribute('aria-checked', !!task.completedAt); check.setAttribute('aria-label', task.title); check.disabled = busy.has(task.id) || reorderSaving;
    check.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>';
    check.addEventListener('click', () => toggle(task));
    const label = document.createElement('span'); label.className = 'task-text'; label.textContent = task.title; label.title = 'Drag to reorder · Double-click to edit';
    const flag = priorityPicker.create(task);
    flag.disabled = busy.has(task.id) || reorderSaving;
    if (task.id === priorityChanged) flag.classList.add('priority-confirmed');
    label.addEventListener('dblclick', () => edit(task, label));
    const remove = document.createElement('button'); remove.className = 'delete'; remove.textContent = '×'; remove.setAttribute('aria-label', `Delete ${task.title}`);
    remove.disabled = busy.has(task.id) || reorderSaving;
    remove.addEventListener('click', async () => { if (busy.has(task.id)) return; busy.add(task.id); revision++; updateNavigation(); try { await request('DELETE', `/api/v1/tasks/${task.id}`); snapshot.tasks = snapshot.tasks.filter(item => item.id !== task.id); render(); announce('Task deleted'); } catch(e) { error(e.message); } finally { busy.delete(task.id); updateNavigation(); } });
    li.append(check, label, flag, remove); taskReorder.attach(li, task); fragment.append(li);
  }
  const focused = document.activeElement.closest?.('[data-id]')?.dataset.id;
  const focusedControl = document.activeElement.classList.contains('priority') ? '.priority' : document.activeElement.classList.contains('reorder-handle') ? '.reorder-handle' : '.check';
  $('tasks').replaceChildren(fragment);
  if (focused) $('tasks').querySelector(`[data-id="${CSS.escape(focused)}"] ${focusedControl}`)?.focus({ preventScroll: true });
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const row of $('tasks').children) {
      const previous = previousPositions.get(row.dataset.id);
      const delta = previous === undefined ? 5 : previous - row.getBoundingClientRect().top;
      if (delta) row.animate([{ transform: `translateY(${delta}px)`, opacity: previous === undefined ? 0 : 1 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
  }
}
async function reorderTask(id, beforeId) {
  if (reorderSaving || busy.size) return;
  const previous = snapshot.taskOrder;
  const tasks = viewedTasks(), date = viewedDate();
  const next = moveOrder(tasks, previous, id, beforeId);
  const before = orderTasks(tasks, previous).map(task => task.id).join();
  if (orderTasks(tasks, next).map(task => task.id).join() === before) return;
  reorderSaving = true;
  revision++;
  snapshot.taskOrder = next;
  render();
  try {
    const saved = await request('POST', '/api/v1/order', { id, beforeId, date });
    snapshot.taskOrder = saved.taskOrder;
    error(); announce('Order saved');
  } catch (e) { snapshot.taskOrder = previous; error(e.message); }
  finally { reorderSaving = false; render(); }
}
async function refresh() {
  if (refreshInFlight || priorityPicker.isOpen || calendar.isOpen || taskReorder.isDragging || reorderSaving || adding || busy.size || document.querySelector('.edit-input')) return;
  refreshInFlight = true;
  const startedRevision = revision;
  try { const next = await request('GET', '/api/v1/history'); if (startedRevision !== revision || priorityPicker.isOpen || calendar.isOpen || taskReorder.isDragging || reorderSaving || adding || busy.size || document.querySelector('.edit-input')) return; if (JSON.stringify(snapshot) !== JSON.stringify({ ...next, exportedAt: snapshot.exportedAt })) { snapshot = next; render(); } error(); }
  catch(e) { error(e.message); } finally { refreshInFlight = false; }
}
async function setPriority(task, value) {
  if (busy.has(task.id)) return;
  const previous = task.priority;
  busy.add(task.id);
  revision++;
  task.priority = value;
  render(undefined, task.id);
  try {
    const saved = await request('PATCH', `/api/v1/tasks/${task.id}`, { priority: value });
    Object.assign(task, saved);
    announce(`Priority ${value}`);
    error();
  } catch (e) { task.priority = previous; render(); error(e.message); }
  finally {
    busy.delete(task.id);
    updateNavigation();
    const control = $('tasks').querySelector(`[data-id="${CSS.escape(task.id)}"] .priority`);
    if (control) control.disabled = false;
    const check = $('tasks').querySelector(`[data-id="${CSS.escape(task.id)}"] .check`);
    if (check) check.disabled = false;
    const remove = $('tasks').querySelector(`[data-id="${CSS.escape(task.id)}"] .delete`);
    if (remove) remove.disabled = false;
  }
}
async function toggle(task) {
  if (busy.has(task.id)) return;
  busy.add(task.id); const old = { ...task }, oldOrder = snapshot.taskOrder;
  revision++;
  snapshot.taskOrder = (snapshot.taskOrder || []).filter(id => id !== task.id);
  task.completedAt = task.completedAt ? null : new Date().toISOString();
  task.completedDate = task.completedAt ? today() : null;
  render(task.completedAt ? task.id : null);
  try { const saved = await request('PATCH', `/api/v1/tasks/${task.id}`, { done: !!task.completedAt }); Object.assign(task, saved); announce(saved.completedAt ? 'Completed' : 'Reopened'); error(); }
  catch(e) { Object.assign(task, old); snapshot.taskOrder = oldOrder; render(); error(e.message); }
  finally { busy.delete(task.id); updateNavigation(); for (const control of $('tasks').querySelectorAll(`[data-id="${CSS.escape(task.id)}"] button`)) control.disabled = false; }
}
function edit(task, label) {
  if (label.querySelector('input')) return;
  label.closest('.task').draggable = false;
  const input = document.createElement('input'); input.className = 'edit-input'; input.value = task.title; input.maxLength = 240; input.setAttribute('aria-label', 'Edit task');
  label.replaceChildren(input); input.focus(); input.select(); let committed = false;
  updateNavigation();
  const finish = async cancel => { if (committed) return; committed = true; if (!cancel && input.value.trim() && input.value.trim() !== task.title) { revision++; try { const saved = await request('PATCH', `/api/v1/tasks/${task.id}`, { title: input.value }); Object.assign(task, saved); } catch(e) { error(e.message); } } input.remove(); render(); };
  input.addEventListener('keydown', e => { if (e.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); finish(false); } if (e.key === 'Escape') { e.stopPropagation(); finish(true); } });
  input.addEventListener('blur', () => finish(false));
}
async function changeExpanded(value) {
  taskReorder.cancel();
  priorityPicker.close();
  calendar.close();
  if (!value) { document.querySelector('.sheet').classList.add('closing'); await new Promise(r => setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150)); }
  if (api) await api.expand(value); else applyExpanded(value);
}
function applyExpanded(value) {
  if (!value) { priorityPicker.close(); calendar.close(); taskReorder.cancel(); }
  expanded = value; $('orb').hidden = value; document.querySelector('.sheet').hidden = !value; document.querySelector('.sheet').classList.remove('closing');
  if (value) { render(); refresh(); setTimeout(() => { if (!calendar.isOpen && !priorityPicker.isOpen) $('task-input').focus(); }, 200); } else $('orb').focus();
}
api?.onExpanded(applyExpanded);
api?.onToday?.(() => selectDate(today()));
$('collapse').onclick = () => changeExpanded(false);
$('menu').onclick = () => api?.menu();
$('history').onclick = () => api?.history();
$('previous-date').onclick = () => selectDate(addDays(viewedDate(), -1));
$('next-date').onclick = () => selectDate(addDays(viewedDate(), 1));
$('return-today').onclick = () => selectDate(today());
document.addEventListener('contextmenu', e => { if (e.target.tagName !== 'INPUT') { e.preventDefault(); api?.menu(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && expanded) changeExpanded(false); });
$('widget').addEventListener('mouseenter', () => api?.hover(true));
$('widget').addEventListener('mouseleave', () => api?.hover(false));
$('add-form').addEventListener('submit', async e => {
  e.preventDefault(); const input = $('task-input'); const title = input.value.trim(); if (!title || input.disabled || reorderSaving || busy.size) return;
  priorityPicker.close();
  calendar.close();
  const date = viewedDate(); adding = true; revision++; updateNavigation();
  input.disabled = true;
  $('draft-priority').disabled = true;
  try { const saved = await request('POST', '/api/v1/tasks', { title, priority: draftPriority, date }); snapshot.tasks.push(saved); input.value = ''; setDraftPriority('normal'); render(); error(); announce(`Task added for ${date}`); }
  catch(e) { error(e.message); } finally { adding = false; updateNavigation(); input.disabled = false; $('draft-priority').disabled = false; input.focus(); }
});
function draggable(element, clickable) {
  let start, moved = false;
  element.addEventListener('pointerdown', e => { if (e.button !== 0 || (!clickable && e.target.closest('button'))) return; start = { x: e.screenX, y: e.screenY }; moved = false; element.setPointerCapture(e.pointerId); api?.drag('start', e.screenX, e.screenY); });
  element.addEventListener('pointermove', e => { if (!start) return; if (Math.hypot(e.screenX-start.x,e.screenY-start.y)>4) moved = true; if (moved) api?.drag('move',e.screenX,e.screenY); });
  element.addEventListener('pointerup', e => { if (!start) return; api?.drag('end',e.screenX,e.screenY); start = null; if (!moved && clickable) changeExpanded(true); });
  element.addEventListener('pointercancel', () => { start = null; api?.drag('end',0,0); });
  if (clickable) element.addEventListener('click', e => { if (e.detail === 0) changeExpanded(true); });
}
draggable($('orb'), true); draggable($('drag-handle'), false);
refresh(); setInterval(() => { if (!busy.size) refresh(); }, 4000);

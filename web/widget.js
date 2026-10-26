import { createPriorityPicker } from './priority.js';
const api = window.ridian;
const $ = id => document.getElementById(id);
let expanded = false, snapshot = { tasks: [], today: '' }, busy = new Set(), refreshInFlight = false;
const request = (method, path, body) => api ? api.request(method, path, body) : Promise.reject(new Error('Open the Ridian desktop app.'));
function error(message = '') { $('error').hidden = !message; $('error').textContent = message; }
function announce(message) { $('announcement').textContent = message; }
const priorityPicker = createPriorityPicker({ commit: setPriority });
function render(justDone, priorityChanged) {
  const previousPositions = new Map([...document.querySelectorAll('.task')].map(row => [row.dataset.id, row.getBoundingClientRect().top]));
  const ranks = { urgent: 0, high: 1, normal: 2, low: 3 };
  const visible = [...snapshot.tasks].sort((a,b) => (ranks[a.priority || 'normal'] - ranks[b.priority || 'normal']));
  const pending = visible.filter(t => !t.completedAt).length;
  const done = visible.length - pending;
  $('orb-number').textContent = pending || (done ? '✓' : '·');
  $('orb').setAttribute('aria-label', `Open today, ${pending} pending`);
  $('progress-ring').style.strokeDashoffset = String(163.363 * (1 - (visible.length ? done / visible.length : 0)));
  $('progress-label').textContent = visible.length ? `${done} / ${visible.length}` : '';
  $('today-date').textContent = new Date(`${snapshot.today || new Date().toLocaleDateString('en-CA')}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' });
  $('empty').hidden = visible.length > 0;
  const fragment = document.createDocumentFragment();
  for (const task of visible) {
    const li = document.createElement('li'); li.className = `task${task.completedAt ? ' done' : ''}${task.id === justDone ? ' just-done' : ''}`; li.dataset.id = task.id;
    li.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); api?.taskMenu(task.id); });
    const check = document.createElement('button'); check.className = 'check'; check.setAttribute('role', 'checkbox'); check.setAttribute('aria-checked', !!task.completedAt); check.setAttribute('aria-label', task.title); check.disabled = busy.has(task.id);
    check.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>';
    check.addEventListener('click', () => toggle(task));
    const label = document.createElement('span'); label.className = 'task-text'; label.textContent = task.title; label.title = 'Double-click to edit';
    const flag = priorityPicker.create(task);
    flag.disabled = busy.has(task.id);
    if (task.id === priorityChanged) flag.classList.add('priority-confirmed');
    label.addEventListener('dblclick', () => edit(task, label));
    const remove = document.createElement('button'); remove.className = 'delete'; remove.textContent = '×'; remove.setAttribute('aria-label', `Delete ${task.title}`);
    remove.addEventListener('click', async () => { if (busy.has(task.id)) return; busy.add(task.id); try { await request('DELETE', `/api/v1/tasks/${task.id}`); snapshot.tasks = snapshot.tasks.filter(item => item.id !== task.id); render(); announce('Task deleted'); } catch(e) { error(e.message); } finally { busy.delete(task.id); } });
    li.append(check, label, flag, remove); fragment.append(li);
  }
  const focused = document.activeElement.closest?.('[data-id]')?.dataset.id;
  const focusedControl = document.activeElement.classList.contains('priority') ? '.priority' : '.check';
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
async function refresh() {
  if (refreshInFlight || priorityPicker.isOpen || busy.size || document.querySelector('.edit-input')) return;
  refreshInFlight = true;
  try { const next = await request('GET', '/api/v1/today'); if (priorityPicker.isOpen || busy.size) return; if (JSON.stringify(snapshot) !== JSON.stringify({ ...next, exportedAt: snapshot.exportedAt })) { snapshot = next; render(); } error(); }
  catch(e) { error(e.message); } finally { refreshInFlight = false; }
}
async function setPriority(task, value) {
  if (busy.has(task.id)) return;
  const previous = task.priority;
  busy.add(task.id);
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
    const control = $('tasks').querySelector(`[data-id="${CSS.escape(task.id)}"] .priority`);
    if (control) control.disabled = false;
    const check = $('tasks').querySelector(`[data-id="${CSS.escape(task.id)}"] .check`);
    if (check) check.disabled = false;
  }
}
async function toggle(task) {
  if (busy.has(task.id)) return;
  busy.add(task.id); const old = { ...task };
  task.completedAt = task.completedAt ? null : new Date().toISOString();
  render(task.completedAt ? task.id : null);
  try { const saved = await request('PATCH', `/api/v1/tasks/${task.id}`, { done: !!task.completedAt }); Object.assign(task, saved); announce(saved.completedAt ? 'Completed' : 'Reopened'); error(); }
  catch(e) { Object.assign(task, old); render(); error(e.message); }
  finally { busy.delete(task.id); const button = $('tasks').querySelector(`[data-id="${task.id}"] .check`); if (button) button.disabled = false; const flag = $('tasks').querySelector(`[data-id="${task.id}"] .priority`); if (flag) flag.disabled = false; }
}
function edit(task, label) {
  if (label.querySelector('input')) return;
  const input = document.createElement('input'); input.className = 'edit-input'; input.value = task.title; input.maxLength = 240; input.setAttribute('aria-label', 'Edit task');
  label.replaceChildren(input); input.focus(); input.select(); let committed = false;
  const finish = async cancel => { if (committed) return; committed = true; if (!cancel && input.value.trim() && input.value.trim() !== task.title) { try { await request('PATCH', `/api/v1/tasks/${task.id}`, { title: input.value }); } catch(e) { error(e.message); } } input.remove(); await refresh(); render(); };
  input.addEventListener('keydown', e => { if (e.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); finish(false); } if (e.key === 'Escape') { e.stopPropagation(); finish(true); } });
  input.addEventListener('blur', () => finish(false));
}
async function changeExpanded(value) {
  priorityPicker.close();
  if (!value) { document.querySelector('.sheet').classList.add('closing'); await new Promise(r => setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150)); }
  if (api) await api.expand(value); else applyExpanded(value);
}
function applyExpanded(value) {
  if (!value) priorityPicker.close();
  expanded = value; $('orb').hidden = value; document.querySelector('.sheet').hidden = !value; document.querySelector('.sheet').classList.remove('closing');
  if (value) { refresh(); setTimeout(() => $('task-input').focus(), 200); } else $('orb').focus();
}
api?.onExpanded(applyExpanded);
$('collapse').onclick = () => changeExpanded(false);
$('menu').onclick = () => api?.menu();
$('history').onclick = () => api?.history();
document.addEventListener('contextmenu', e => { if (e.target.tagName !== 'INPUT') { e.preventDefault(); api?.menu(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && expanded) changeExpanded(false); });
$('widget').addEventListener('mouseenter', () => api?.hover(true));
$('widget').addEventListener('mouseleave', () => api?.hover(false));
$('add-form').addEventListener('submit', async e => {
  e.preventDefault(); const input = $('task-input'); const title = input.value.trim(); if (!title || input.disabled) return;
  input.disabled = true;
  try { await request('POST', '/api/v1/tasks', { title }); input.value = ''; await refresh(); announce('Task added'); }
  catch(e) { error(e.message); } finally { input.disabled = false; input.focus(); }
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

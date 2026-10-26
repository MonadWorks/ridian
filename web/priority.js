const levels = ['low', 'normal', 'high', 'urgent'];
const labels = ['Low', 'Normal', 'High', 'Urgent'];
const colors = [[143, 172, 151], [153, 174, 191], [210, 174, 105], [162, 128, 205]];
const clamp = value => Math.max(0, Math.min(3, value));

// The actual input owns dragging, so both the axis and the thumb work natively.
export function createPriorityPicker({ commit, getDraftPriority, onDraftChange, host = document.body }) {
  const panel = document.createElement('div');
  panel.id = 'priority-picker';
  panel.className = 'priority-picker';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Priority');
  panel.innerHTML = `<div class="priority-heading"><span class="priority-spark" aria-hidden="true"></span><output class="priority-value" aria-hidden="true">Normal</output></div>
    <div class="priority-axis">
      <div class="priority-ticks" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <input class="priority-range" type="range" min="0" max="3" step="any" value="1" aria-label="Priority" aria-orientation="horizontal" aria-valuetext="Normal">
    </div>`;
  host.append(panel);
  const range = panel.querySelector('.priority-range');
  const output = panel.querySelector('.priority-value');
  const axis = panel.querySelector('.priority-axis');
  let active = null, snapFrame = 0;
  const indexOf = value => Math.max(0, levels.indexOf(value || 'normal'));

  function paint(raw, updateDraft = true) {
    if (!active) return;
    const value = clamp(Number(raw));
    const index = Math.round(value);
    const from = Math.floor(value), to = Math.min(3, from + 1), mix = value - from;
    const rgb = colors[from].map((channel, i) => Math.round(channel + (colors[to][i] - channel) * mix));
    range.value = value;
    panel.style.setProperty('--priority-color', `rgb(${rgb.join(' ')})`);
    panel.style.setProperty('--fill', `${16 + (active.axisWidth - 32) * value / 3}px`);
    panel.dataset.level = levels[index];
    output.textContent = labels[index];
    range.setAttribute('aria-valuetext', labels[index]);
    active.trigger.dataset.preview = levels[index];
    if (!active.task && updateDraft) onDraftChange(levels[index]);
  }

  function close(cancel = false, restoreFocus = false) {
    if (!active) return;
    cancelAnimationFrame(snapFrame);
    const previous = active;
    active = null;
    if (!previous.task && cancel) onDraftChange(previous.original);
    previous.trigger.setAttribute('aria-expanded', 'false');
    delete previous.trigger.dataset.preview;
    previous.trigger.closest('.task')?.classList.remove('choosing-priority');
    panel.classList.remove('dragging');
    panel.hidden = true;
    if (restoreFocus && previous.trigger.isConnected) previous.trigger.focus({ preventScroll: true });
  }

  function save(index, dismiss) {
    if (!active) return;
    const session = active, value = levels[index];
    paint(index);
    session.original = value;
    if (session.task || dismiss) close(false, true);
    if (session.task && value !== (session.task.priority || 'normal')) {
      Promise.resolve(commit(session.task, value)).then(() => {
        const replacement = document.querySelector(`[data-id="${CSS.escape(session.task.id)}"] .priority`);
        if (replacement && (document.activeElement === document.body || document.activeElement === session.trigger)) replacement.focus({ preventScroll: true });
      });
    }
    if (!session.task && dismiss) document.getElementById('task-input')?.focus({ preventScroll: true });
  }

  function confirm(dismiss = false, immediate = false) {
    if (!active) return;
    cancelAnimationFrame(snapFrame);
    active.dragging = false;
    panel.classList.remove('dragging');
    const session = active, start = Number(range.value), index = Math.round(start);
    if (immediate || matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(start - index) < 0.001) return save(index, dismiss);
    const began = performance.now();
    function frame(now) {
      if (active !== session) return;
      const progress = Math.min(1, (now - began) / 130);
      paint(start + (index - start) * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) snapFrame = requestAnimationFrame(frame); else save(index, dismiss);
    }
    snapFrame = requestAnimationFrame(frame);
  }

  function open(trigger, task = null) {
    if (active?.trigger === trigger) { confirm(true, true); return; }
    close();
    const original = task ? task.priority || 'normal' : getDraftPriority();
    const bounds = trigger.getBoundingClientRect();
    const sheet = document.querySelector('.sheet').getBoundingClientRect();
    const width = Math.min(286, sheet.width - 24), height = 112;
    const left = Math.max(sheet.left + 12, Math.min(bounds.right - width, sheet.right - width - 12));
    const preferredTop = bounds.top - height - 10;
    const top = preferredTop >= sheet.top + 10 ? preferredTop : Math.min(bounds.bottom + 10, sheet.bottom - height - 10);
    active = { trigger, task, original, dragging: false };
    panel.style.width = `${width}px`;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.hidden = false;
    active.axisWidth = axis.clientWidth;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.closest('.task')?.classList.add('choosing-priority');
    paint(indexOf(original), false);
    range.focus({ preventScroll: true });
  }

  function bind(trigger, task = null) {
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', panel.id);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.title = 'Priority';
    trigger.onclick = () => open(trigger, task);
  }

  function create(task) {
    const button = document.createElement('button');
    const level = task.priority || 'normal';
    button.type = 'button';
    button.className = `priority ${level}`;
    button.setAttribute('aria-label', `Priority: ${labels[indexOf(level)]} — ${task.title}`);
    button.innerHTML = '<span class="priority-dot" aria-hidden="true"></span>';
    bind(button, task);
    return button;
  }

  range.addEventListener('pointerdown', event => {
    if (!active || event.button !== 0) return;
    cancelAnimationFrame(snapFrame);
    active.dragging = true;
    panel.classList.add('dragging');
    // Do not preventDefault: native range dragging must receive this event.
  });
  range.addEventListener('input', () => paint(range.value));
  range.addEventListener('change', () => confirm());
  document.addEventListener('pointerup', () => { if (active?.dragging) { active.dragging = false; panel.classList.remove('dragging'); } });
  range.addEventListener('pointercancel', () => close(true, true));
  range.addEventListener('keydown', event => {
    if (!active || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    cancelAnimationFrame(snapFrame);
    const value = Math.round(Number(range.value));
    paint(event.key === 'Home' ? 0 : event.key === 'End' ? 3 : value + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1));
  });
  document.addEventListener('keydown', event => {
    if (!active || event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true, true); }
    else if (event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); confirm(true, true); }
    else if (event.key === 'Tab') { confirm(true, true); }
  }, true);
  document.addEventListener('pointerdown', event => {
    if (active && !panel.contains(event.target) && !active.trigger.contains(event.target)) confirm(true, true);
  }, true);
  document.addEventListener('contextmenu', () => close(true), true);
  document.querySelector('.list-scroll').addEventListener('scroll', () => close(true), { passive: true });
  window.addEventListener('blur', () => close(true));
  window.addEventListener('resize', () => close(true));
  return { create, bindDraft: button => bind(button), close, get isOpen() { return !!active; } };
}

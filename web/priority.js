// One shared picker keeps a long list quiet, and pauses refresh while dragging.
export function createPriorityPicker({ commit, host = document.body }) {
  const levels = ['urgent', 'high', 'normal', 'low'];
  const names = ['Urgent', 'High', 'Normal', 'Low'];
  const step = 40, inset = 28, width = 136, height = 176;
  const panel = document.createElement('div');
  panel.id = 'priority-picker';
  panel.className = 'priority-picker';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Priority');
  const group = document.createElement('div');
  group.className = 'priority-options';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Priority');
  const thumb = document.createElement('span');
  thumb.className = 'priority-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  const buttons = levels.map((level, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `priority-option ${level}`;
    button.setAttribute('role', 'radio');
    button.innerHTML = `<span>${names[index]}</span><i aria-hidden="true"></i>`;
    button.onclick = () => finish(index);
    group.append(button);
    return button;
  });
  panel.append(group, thumb);
  host.append(panel);
  let active = null;

  function preview(index, focus = false) {
    if (!active) return;
    active.index = Math.max(0, Math.min(levels.length - 1, index));
    panel.dataset.level = levels[active.index];
    thumb.style.transform = `translateY(${active.index * step}px)`;
    buttons.forEach((button, i) => {
      button.setAttribute('aria-checked', String(i === active.index));
      button.tabIndex = i === active.index ? 0 : -1;
    });
    active.trigger.dataset.preview = levels[active.index];
    if (focus) buttons[active.index].focus({ preventScroll: true });
  }

  function close(restoreFocus = false) {
    if (!active) return;
    const previous = active;
    active = null;
    if (previous.pointerId !== undefined && previous.trigger.hasPointerCapture(previous.pointerId)) previous.trigger.releasePointerCapture(previous.pointerId);
    previous.trigger.setAttribute('aria-expanded', 'false');
    delete previous.trigger.dataset.preview;
    previous.trigger.closest('.task')?.classList.remove('choosing-priority');
    document.documentElement.classList.remove('priority-dragging');
    panel.hidden = true;
    if (restoreFocus && previous.trigger.isConnected) previous.trigger.focus({ preventScroll: true });
  }

  async function finish(index) {
    if (!active) return;
    const { task, trigger } = active;
    const value = levels[index];
    close(true);
    if (value !== (task.priority || 'normal')) await commit(task, value);
    // A successful save may have sorted/replaced the row.
    const replacement = document.querySelector(`[data-id="${CSS.escape(task.id)}"] .priority`);
    if (replacement && (document.activeElement === document.body || document.activeElement === trigger)) replacement.focus({ preventScroll: true });
  }

  function open(task, trigger, keyboard = false) {
    close();
    const index = Math.max(0, levels.indexOf(task.priority || 'normal'));
    const bounds = trigger.getBoundingClientRect();
    const sheet = document.querySelector('.sheet').getBoundingClientRect();
    const left = Math.max(sheet.left + 8, Math.min(bounds.left + bounds.width / 2 - 108, sheet.right - width - 8));
    const top = Math.max(sheet.top + 8, Math.min(bounds.top + bounds.height / 2 - inset - index * step, sheet.bottom - height - 8));
    active = { task, trigger, index, top, left, moved: false };
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.closest('.task')?.classList.add('choosing-priority');
    preview(index, keyboard);
  }

  function create(task) {
    const button = document.createElement('button');
    const level = task.priority || 'normal';
    button.type = 'button';
    button.className = `priority ${level}`;
    button.setAttribute('aria-label', `Priority: ${names[levels.indexOf(level)]} — ${task.title}`);
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', panel.id);
    button.setAttribute('aria-expanded', 'false');
    button.title = 'Priority · Drag up or down';
    button.innerHTML = '<span class="priority-dot" aria-hidden="true"></span>';
    button.onpointerdown = event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      open(task, button);
      active.pointerId = event.pointerId;
      active.startY = event.clientY;
      button.setPointerCapture(event.pointerId);
      document.documentElement.classList.add('priority-dragging');
    };
    button.onpointermove = event => {
      if (!active || active.trigger !== button || active.pointerId !== event.pointerId) return;
      if (Math.abs(event.clientY - active.startY) > 4) active.moved = true;
      if (active.moved) preview(Math.round((event.clientY - active.top - inset) / step));
    };
    button.onpointerup = event => {
      if (!active || active.trigger !== button || active.pointerId !== event.pointerId) return;
      const moved = active.moved, index = active.index;
      delete active.pointerId;
      if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
      document.documentElement.classList.remove('priority-dragging');
      // Dropping outside the small rail cancels instead of making a stray change.
      if (moved) {
        const inside = event.clientX >= active.left - 20 && event.clientX <= active.left + width + 20 && event.clientY >= active.top - 24 && event.clientY <= active.top + height + 24;
        if (inside) finish(index); else close(true);
      } else preview(index, true);
    };
    button.onpointercancel = () => { if (active?.trigger === button) close(true); };
    button.onlostpointercapture = () => { if (active?.trigger === button && active.pointerId !== undefined) close(true); };
    button.onclick = event => { if (event.detail === 0) open(task, button, true); };
    return button;
  }

  document.addEventListener('pointerdown', event => {
    if (active && !panel.contains(event.target) && !active.trigger.contains(event.target)) close();
  }, true);
  document.addEventListener('keydown', event => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); close(true);
    } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      preview(event.key === 'Home' ? 0 : event.key === 'End' ? levels.length - 1 : active.index + (event.key === 'ArrowUp' ? -1 : 1), true);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopImmediatePropagation(); finish(active.index);
    } else if (event.key === 'Tab') close(true);
  }, true);
  document.addEventListener('contextmenu', () => close(), true);
  document.querySelector('.list-scroll').addEventListener('scroll', () => close(), { passive: true });
  window.addEventListener('blur', () => close());
  window.addEventListener('resize', () => close());
  return { create, close, get isOpen() { return !!active; } };
}

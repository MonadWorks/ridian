// Native row dragging provides the moving preview; only the drop mutates data.
export function createTaskReorder({ list, canStart, move }) {
  const container = list.parentElement;
  const marker = document.createElement('div');
  marker.className = 'order-marker';
  marker.hidden = true;
  marker.setAttribute('aria-hidden', 'true');
  container.append(marker);
  let active = null, scrollFrame = 0, dragAllowed = true, suppressClick = false;
  const rows = () => [...list.querySelectorAll('.task')];

  function cancel() {
    cancelAnimationFrame(scrollFrame);
    if (active) active.row.classList.remove('being-dragged');
    active = null;
    marker.hidden = true;
    container.classList.remove('reordering');
    dragAllowed = true;
  }

  function locate(y) {
    if (!active) return;
    const others = rows().filter(row => row !== active.row);
    const next = others.find(row => { const box = row.getBoundingClientRect(); return y < box.top + box.height / 2; });
    active.beforeId = next?.dataset.id || null;
    active.hasTarget = true;
    const bounds = container.getBoundingClientRect();
    const edge = next ? next.getBoundingClientRect().top : others.length ? others.at(-1).getBoundingClientRect().bottom : list.getBoundingClientRect().top;
    marker.style.top = `${edge - bounds.top + container.scrollTop - 1}px`;
    marker.hidden = false;
  }

  function scroll() {
    if (!active) return;
    const bounds = container.getBoundingClientRect();
    const distance = active.y < bounds.top + 28 ? active.y - bounds.top - 28 : active.y > bounds.bottom - 28 ? active.y - bounds.bottom + 28 : 0;
    if (!distance) return;
    const previous = container.scrollTop;
    container.scrollTop += Math.max(-9, Math.min(9, distance / 3));
    locate(active.y);
    if (container.scrollTop !== previous) scrollFrame = requestAnimationFrame(scroll);
  }

  list.addEventListener('pointerdown', event => {
    suppressClick = false;
    dragAllowed = event.button === 0 && !event.target.closest('input,textarea,.check,.priority,.delete');
  });
  list.addEventListener('dragstart', event => {
    const row = event.target.closest('.task');
    if (!row || !dragAllowed || !canStart() || event.target.closest('input,textarea,.check,.priority,.delete') || row.querySelector('.edit-input')) { event.preventDefault(); return; }
    suppressClick = true;
    active = { row, id: row.dataset.id, y: event.clientY, hasTarget: false };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', row.dataset.id);
    const box = row.getBoundingClientRect();
    event.dataTransfer.setDragImage(row, Math.max(0, event.clientX - box.left), Math.max(0, event.clientY - box.top));
    // Defer dimming so the native drag preview retains readable text.
    requestAnimationFrame(() => { if (active?.row === row) row.classList.add('being-dragged'); });
    container.classList.add('reordering');
  });
  container.addEventListener('dragover', event => {
    if (!active) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    active.y = event.clientY;
    locate(event.clientY);
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(scroll);
  });
  container.addEventListener('drop', event => {
    if (!active) return;
    event.preventDefault(); event.stopPropagation();
    locate(event.clientY);
    const { id, beforeId } = active;
    cancel();
    move(id, beforeId);
  });
  container.addEventListener('dragleave', event => {
    if (active && !container.contains(event.relatedTarget)) marker.hidden = true;
  });
  document.addEventListener('dragend', cancel);
  document.addEventListener('keydown', event => {
    if (active && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
  }, true);
  list.addEventListener('keydown', event => {
    const handle = event.target.closest('.reorder-handle');
    if (!handle || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || !canStart()) return;
    event.preventDefault(); event.stopPropagation();
    const row = handle.closest('.task'), current = rows(), index = current.indexOf(row);
    const destination = event.key === 'Home' ? 0 : event.key === 'End' ? current.length - 1 : Math.max(0, Math.min(current.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
    if (destination === index) return;
    const remaining = current.filter(item => item !== row);
    move(row.dataset.id, remaining[destination]?.dataset.id || null);
  });

  function attach(row, task) {
    row.draggable = true;
    const handle = document.createElement('span');
    handle.className = 'reorder-handle';
    handle.tabIndex = 0;
    handle.draggable = true;
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', `Move ${task.title}`);
    handle.title = 'Drag to reorder · ↑ / ↓';
    handle.innerHTML = '<svg viewBox="0 0 12 18" aria-hidden="true"><circle cx="4" cy="5" r=".8"/><circle cx="8" cy="5" r=".8"/><circle cx="4" cy="9" r=".8"/><circle cx="8" cy="9" r=".8"/><circle cx="4" cy="13" r=".8"/><circle cx="8" cy="13" r=".8"/></svg>';
    row.prepend(handle);
  }
  return { attach, cancel, get isDragging() { return !!active; }, get suppressClick() { return suppressClick; } };
}

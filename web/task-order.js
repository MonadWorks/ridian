// Shared by Node and the renderer: priority is a default, never a drag constraint.
(function (root) {
  const ranks = { urgent: 0, high: 1, normal: 2, low: 3 };
  function compareDefault(a, b) {
    return Number(!!a.completedAt) - Number(!!b.completedAt)
      || (!a.completedAt ? (ranks[a.priority] ?? 2) - (ranks[b.priority] ?? 2) : 0);
  }
  function orderTasks(tasks, manualOrder = []) {
    const defaults = [...tasks].sort(compareDefault);
    const byId = new Map(tasks.map(task => [task.id, task]));
    const seen = new Set(), result = [];
    for (const id of manualOrder || []) {
      if (byId.has(id) && !seen.has(id)) { result.push(byId.get(id)); seen.add(id); }
    }
    if (!result.length) return defaults;
    // Insert newcomers without changing the relative order of existing rows.
    for (const task of defaults) {
      if (seen.has(task.id)) continue;
      const index = result.findIndex(other => compareDefault(task, other) < 0);
      result.splice(index < 0 ? result.length : index, 0, task);
    }
    return result;
  }
  function moveOrder(tasks, manualOrder, id, beforeId) {
    const visible = orderTasks(tasks, manualOrder).map(task => task.id);
    if (!visible.includes(id) || (beforeId !== null && !visible.includes(beforeId))) throw new Error('Task is no longer in this day’s list.');
    if (id === beforeId) return [...(manualOrder || [])];
    const next = visible.filter(item => item !== id);
    next.splice(beforeId === null ? next.length : next.indexOf(beforeId), 0, id);
    return [...next, ...(manualOrder || []).filter(item => !visible.includes(item))];
  }
  const api = { orderTasks, moveOrder };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RidianOrder = api;
})(typeof window !== 'undefined' ? window : globalThis);

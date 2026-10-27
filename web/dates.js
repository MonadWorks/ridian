// Calendar dates are local days, shared by the renderer and the data service.
(function (root) {
  function localDate(date = new Date()) {
    return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00`);
    return !Number.isNaN(+date) && localDate(date) === value;
  }
  function addDays(value, amount) {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }
  function addMonths(value, amount) {
    const date = new Date(`${value}T12:00:00Z`), day = date.getUTCDate();
    date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + amount);
    const last = new Date(date); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
    date.setUTCDate(Math.min(day, last.getUTCDate()));
    return date.toISOString().slice(0, 10);
  }
  function tasksForDate(tasks, date, today) {
    return tasks.filter(task => date === today
      ? (!task.completedAt && task.date <= today) || task.completedDate === today
      : task.date === date || task.completedDate === date);
  }
  const api = { localDate, validDate, addDays, addMonths, tasksForDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RidianDates = api;
})(typeof window !== 'undefined' ? window : globalThis);

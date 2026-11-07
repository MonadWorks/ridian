const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { orderTasks, moveOrder } = require('../web/task-order.js');
const { tasksForDate } = require('../web/dates.js');
const { everyDay, weekdaysOn, isDue } = require('../web/habits.js');

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00`);
  return !Number.isNaN(+d) && localDate(d) === value;
}
function addDays(date, amount) {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + amount); return d.toISOString().slice(0, 10);
}
function dayDistance(a, b) { return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000); }
function invalid(message) { return Object.assign(new Error(message), { status: 400 }); }
function priority(value = 'normal') { if (!['low', 'normal', 'high', 'urgent'].includes(value)) throw invalid('Priority must be low, normal, high, or urgent.'); return value; }
function habitTitle(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 240) throw invalid('Use a title of 1–240 characters.');
  return value.trim();
}
function habitWeekdays(value) {
  if (!Array.isArray(value) || !value.length || value.length > 7 || value.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw invalid('Choose at least one weekday, from 0 (Sunday) to 6.');
  return [...new Set(value)].sort();
}
function validateStrategy(input, today) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 240) throw invalid('Use a title of 1–240 characters.');
  const startDate = input.startDate || today;
  if (!validDate(startDate) || startDate < '2000-01-01' || startDate > '2100-12-31') throw invalid('Start date must be between 2000 and 2100.');
  if (input.endDate && (!validDate(input.endDate) || input.endDate < startDate)) throw invalid('Invalid end date.');
  const schedule = input.schedule;
  if (!schedule || !['interval', 'weekly', 'dates'].includes(schedule.type)) throw invalid('Schedule type must be interval, weekly, or dates.');
  if (schedule.type === 'interval' && (!Number.isInteger(schedule.everyDays) || schedule.everyDays < 1 || schedule.everyDays > 3650)) throw invalid('everyDays must be an integer from 1 to 3650.');
  if (schedule.type === 'weekly' && (!Array.isArray(schedule.weekdays) || !schedule.weekdays.length || schedule.weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6))) throw invalid('weekdays must contain integers from 0 (Sunday) to 6.');
  if (schedule.type === 'dates' && (!Array.isArray(schedule.dates) || !schedule.dates.length || schedule.dates.length > 730 || schedule.dates.some(d => !validDate(d)))) throw invalid('Provide 1–730 valid dates.');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw invalid('enabled must be a boolean.');
  if (input.metadata !== undefined && (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata) || JSON.stringify(input.metadata).length > 4000)) throw invalid('metadata must be an object under 4000 characters.');
  return { title, priority: priority(input.priority), startDate, endDate: input.endDate || null, schedule: structuredClone(schedule), enabled: input.enabled !== false, metadata: input.metadata || {} };
}
function atomicWrite(file, data) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    const fd = fs.openSync(tmp, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
class Store {
  constructor(directory, now = () => new Date()) {
    this.directory = directory;
    this.now = now;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, 'journal.json');
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { version: 1, tasks: [], strategies: [] };
    if (this.state.version !== 1 || !Array.isArray(this.state.tasks)) throw new Error('Invalid data format. The original file was preserved.');
    if (this.state.taskOrder !== undefined && !Array.isArray(this.state.taskOrder)) throw new Error('Invalid order data. The original file was preserved.');
    this.state.strategies ||= [];
    if (this.state.habits !== undefined && !Array.isArray(this.state.habits)) throw new Error('Invalid habit data. The original file was preserved.');
    this.state.habits ||= [];
    if (!fs.existsSync(this.file)) atomicWrite(this.file, this.state);
  }
  today() { return localDate(this.now()); }
  snapshot() {
    return { ...structuredClone(this.state), today: this.today(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, exportedAt: this.now().toISOString() };
  }
  save(next) {
    const backupDir = path.join(this.directory, 'backups');
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const backup = path.join(backupDir, `${this.today()}.json`);
    if (!fs.existsSync(backup)) atomicWrite(backup, this.state);
    atomicWrite(this.file, next);
    this.state = next;
  }
  add({ title, date = this.today(), priority: requestedPriority = 'normal' }) {
    title = typeof title === 'string' ? title.trim() : '';
    if (!title || title.length > 240) throw Object.assign(new Error('Use 1–240 characters.'), { status: 400 });
    if (!validDate(date)) throw Object.assign(new Error('Invalid date.'), { status: 400 });
    const timestamp = this.now().toISOString();
    const task = { id: crypto.randomUUID(), title, priority: priority(requestedPriority), date, createdAt: timestamp, updatedAt: timestamp, completedAt: null, completedDate: null };
    this.save({ ...this.state, tasks: [...this.state.tasks, task] });
    return task;
  }
  update(id, patch) {
    const task = this.state.tasks.find(t => t.id === id);
    if (!task) throw Object.assign(new Error('Task not found.'), { status: 404 });
    const updated = { ...task, updatedAt: this.now().toISOString() };
    if ('priority' in patch) updated.priority = priority(patch.priority);
    if ('date' in patch) { if (!validDate(patch.date)) throw invalid('Invalid date.'); updated.date = patch.date; }
    if ('title' in patch) {
      const title = typeof patch.title === 'string' ? patch.title.trim() : '';
      if (!title || title.length > 240) throw Object.assign(new Error('Use 1–240 characters.'), { status: 400 });
      updated.title = title;
    }
    if ('done' in patch) {
      if (typeof patch.done !== 'boolean') throw Object.assign(new Error('done must be a boolean.'), { status: 400 });
      updated.completedAt = patch.done ? task.completedAt || this.now().toISOString() : null;
      updated.completedDate = patch.done ? task.completedDate || this.today() : null;
    }
    const next = { ...this.state, tasks: this.state.tasks.map(t => t.id === id ? updated : t) };
    if ('done' in patch && !!task.completedAt !== patch.done) next.taskOrder = (this.state.taskOrder || []).filter(item => item !== id);
    this.save(next);
    return updated;
  }
  remove(id) {
    if (!this.state.tasks.some(t => t.id === id)) throw Object.assign(new Error('Task not found.'), { status: 404 });
    this.save({ ...this.state, tasks: this.state.tasks.filter(t => t.id !== id), taskOrder: (this.state.taskOrder || []).filter(item => item !== id) });
  }
  reorder({ id, beforeId, date = this.today() }) {
    if (typeof id !== 'string' || (beforeId !== null && typeof beforeId !== 'string')) throw invalid('Provide id and beforeId (or null for the end).');
    if (!validDate(date)) throw invalid('Invalid date.');
    const tasks = tasksForDate(this.state.tasks, date, this.today());
    let taskOrder;
    try { taskOrder = moveOrder(tasks, this.state.taskOrder, id, beforeId); } catch (error) { throw invalid(error.message); }
    this.save({ ...this.state, taskOrder });
    return { taskOrder };
  }
  resetOrder() {
    this.save({ ...this.state, taskOrder: [] });
    return { taskOrder: [] };
  }
  habit(id) {
    const habit = this.state.habits.find(item => item.id === id);
    if (!habit) throw Object.assign(new Error('Habit not found.'), { status: 404 });
    return habit;
  }
  addHabit({ title, weekdays = everyDay, startDate = this.today() }) {
    if (!validDate(startDate) || startDate < '2000-01-01' || startDate > this.today()) throw invalid('Start date must be between 2000-01-01 and today.');
    const timestamp = this.now().toISOString();
    const habit = { id: crypto.randomUUID(), title: habitTitle(title), startDate, schedules: [{ from: startDate, weekdays: habitWeekdays(weekdays) }], checkins: [], createdAt: timestamp, updatedAt: timestamp };
    this.save({ ...this.state, habits: [...this.state.habits, habit] });
    return structuredClone(habit);
  }
  updateHabit(id, patch) {
    const habit = this.habit(id), updated = structuredClone(habit);
    if ('title' in patch) updated.title = habitTitle(patch.title);
    if ('weekdays' in patch) {
      const weekdays = habitWeekdays(patch.weekdays), date = this.today();
      if (JSON.stringify(weekdays) !== JSON.stringify(weekdaysOn(habit, date))) {
        updated.schedules = [...habit.schedules.filter(schedule => schedule.from < date), { from: date, weekdays }];
      }
    }
    updated.updatedAt = this.now().toISOString();
    this.save({ ...this.state, habits: this.state.habits.map(item => item.id === id ? updated : item) });
    return structuredClone(updated);
  }
  checkHabit(id, { date = this.today(), done }) {
    const habit = this.habit(id);
    if (!validDate(date) || date < habit.startDate || date > this.today()) throw invalid('Choose a date between this habit’s start and today.');
    if (typeof done !== 'boolean') throw invalid('done must be a boolean.');
    if (done && !habit.checkins.includes(date) && !isDue(habit, date)) throw invalid('This is a rest day.');
    const checkins = new Set(habit.checkins);
    if (done) checkins.add(date); else checkins.delete(date);
    const updated = { ...habit, checkins: [...checkins].sort(), updatedAt: this.now().toISOString() };
    this.save({ ...this.state, habits: this.state.habits.map(item => item.id === id ? updated : item) });
    return structuredClone(updated);
  }
  reorderHabits({ id, beforeId }) {
    const habit = this.habit(id);
    if (beforeId !== null) this.habit(beforeId);
    if (id === beforeId) return { habits: structuredClone(this.state.habits) };
    const habits = this.state.habits.filter(item => item.id !== id);
    habits.splice(beforeId === null ? habits.length : habits.findIndex(item => item.id === beforeId), 0, habit);
    this.save({ ...this.state, habits });
    return { habits: structuredClone(habits) };
  }
  removeHabit(id) {
    this.habit(id);
    this.save({ ...this.state, habits: this.state.habits.filter(item => item.id !== id) });
  }
  addStrategy(input) {
    const strategy = { ...validateStrategy(input, this.today()), id: crypto.randomUUID(), createdAt: this.now().toISOString(), cursorDate: null };
    this.save({ ...this.state, strategies: [...this.state.strategies, strategy] });
    this.materialize(); return strategy;
  }
  updateStrategy(id, patch) {
    const current = this.state.strategies.find(s => s.id === id);
    if (!current) throw Object.assign(new Error('Strategy not found.'), { status: 404 });
    const next = { ...current, ...validateStrategy({ ...current, ...patch }, this.today()), cursorDate: null };
    this.save({ ...this.state, strategies: this.state.strategies.map(s => s.id === id ? next : s) });
    this.materialize(); return next;
  }
  removeStrategy(id) {
    if (!this.state.strategies.some(s => s.id === id)) throw Object.assign(new Error('Strategy not found.'), { status: 404 });
    this.save({ ...this.state, strategies: this.state.strategies.filter(s => s.id !== id) });
  }
  materialize() {
    const today = this.today(); const next = structuredClone(this.state); let changed = false;
    const existing = new Set(next.tasks.filter(t => t.strategyId).map(t => `${t.strategyId}:${t.scheduledDate || t.date}`));
    for (const s of next.strategies) {
      if (!s.enabled || s.startDate > today || (s.cursorDate && s.cursorDate >= today)) continue;
      const end = s.endDate && s.endDate < today ? s.endDate : today;
      let date = s.cursorDate ? addDays(s.cursorDate, 1) : s.startDate;
      if (date > end) continue;
      for (; date <= end; date = addDays(date, 1)) {
        const schedule = s.schedule;
        const due = schedule.type === 'interval' ? dayDistance(s.startDate, date) % schedule.everyDays === 0 : schedule.type === 'weekly' ? schedule.weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay()) : schedule.dates.includes(date);
        if (due && !existing.has(`${s.id}:${date}`)) {
          const timestamp = this.now().toISOString();
          next.tasks.push({ id: crypto.randomUUID(), title: s.title, priority: s.priority, date, strategyId: s.id, scheduledDate: date, createdAt: timestamp, updatedAt: timestamp, completedAt: null, completedDate: null });
          existing.add(`${s.id}:${date}`);
        }
      }
      s.cursorDate = end; changed = true;
    }
    if (changed) this.save(next);
  }
}
module.exports = { Store, localDate, validDate, atomicWrite, addDays, dayDistance, orderTasks };

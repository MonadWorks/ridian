// Pure, shared calendar rules. Schedule edits apply from their effective date.
(function (root) {
  const { addDays } = typeof module !== 'undefined' && module.exports ? require('./dates.js') : root.RidianDates;
  const everyDay = [0, 1, 2, 3, 4, 5, 6];
  function weekdaysOn(habit, date) {
    const schedules = habit.schedules || [{ from: habit.startDate, weekdays: everyDay }];
    return schedules.filter(schedule => schedule.from <= date).at(-1)?.weekdays || [];
  }
  function isDue(habit, date) {
    return date >= habit.startDate && weekdaysOn(habit, date).includes(new Date(`${date}T12:00:00Z`).getUTCDay());
  }
  function habitStats(habit, today) {
    const checks = new Set((habit.checkins || []).filter(date => date <= today));
    let current = 0, longest = 0;
    for (let date = habit.startDate; date <= today; date = addDays(date, 1)) {
      if (!isDue(habit, date)) continue;
      if (checks.has(date)) { current++; longest = Math.max(longest, current); }
      else if (date < today) current = 0;
    }
    return { current, longest, total: checks.size };
  }
  const api = { everyDay, weekdaysOn, isDue, habitStats };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RidianHabits = api;
})(typeof window !== 'undefined' ? window : globalThis);

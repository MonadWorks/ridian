export function createCalendar({ trigger, getDate, getToday, getTasks, select, canOpen }) {
  const { validDate, addDays, addMonths } = window.RidianDates;
  const panel = document.createElement('section');
  panel.id = 'date-calendar'; panel.className = 'date-calendar'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Choose a date');
  panel.innerHTML = '<div class="calendar-header"><button type="button" class="icon-button" data-month="-1" aria-label="Previous month"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 6-4 4 4 4"/></svg></button><span class="calendar-month" aria-live="polite"></span><button type="button" class="icon-button" data-month="1" aria-label="Next month"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 6 4 4-4 4"/></svg></button></div><div class="calendar-week" aria-hidden="true"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div><div class="calendar-days"></div>';
  document.querySelector('.sheet').append(panel);
  trigger.setAttribute('aria-controls', panel.id); trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
  let focusedDate = '', month = '';
  const inRange = date => validDate(date) && date >= '0001-01-01';
  function close(restoreFocus = false) {
    panel.hidden = true; trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }
  function render(focusDay = false) {
    const today = getToday(), selected = getDate();
    const monthDate = new Date(`${month}T12:00:00`);
    panel.querySelector('.calendar-month').textContent = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const start = addDays(month, -(monthDate.getDay() + 6) % 7);
    const occupied = new Set(getTasks().flatMap(task => [task.date, task.completedDate].filter(Boolean)));
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 42; i++) {
      const date = addDays(start, i), button = document.createElement('button');
      button.type = 'button'; button.className = 'calendar-day'; button.dataset.date = date;
      button.textContent = String(Number(date.slice(8, 10)));
      button.disabled = !inRange(date); button.tabIndex = date === focusedDate ? 0 : -1;
      button.classList.toggle('outside-month', date.slice(0, 7) !== month.slice(0, 7));
      button.classList.toggle('has-tasks', occupied.has(date));
      button.setAttribute('aria-pressed', String(date === selected));
      if (date === today) button.setAttribute('aria-current', 'date');
      if (inRange(date)) button.setAttribute('aria-label', new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
      button.addEventListener('click', () => { close(true); select(date); });
      fragment.append(button);
    }
    panel.querySelector('.calendar-days').replaceChildren(fragment);
    for (const button of panel.querySelectorAll('[data-month]')) button.disabled = !inRange(addMonths(month, Number(button.dataset.month)));
    if (focusDay) panel.querySelector(`[data-date="${focusedDate}"]`)?.focus({ preventScroll: true });
  }
  for (const button of panel.querySelectorAll('[data-month]')) button.addEventListener('click', () => {
    focusedDate = addMonths(focusedDate, Number(button.dataset.month)); month = `${focusedDate.slice(0, 7)}-01`; render();
  });
  trigger.addEventListener('click', () => {
    if (!panel.hidden) return close(true);
    if (!canOpen()) return;
    focusedDate = getDate(); month = `${focusedDate.slice(0, 7)}-01`;
    panel.hidden = false; trigger.setAttribute('aria-expanded', 'true'); render(true);
  });
  panel.addEventListener('keydown', event => {
    const day = event.target.closest('[data-date]');
    if (!day) return;
    const date = day.dataset.date, weekday = (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday }[event.key];
    const next = offset !== undefined ? addDays(date, offset) : event.key === 'PageUp' ? addMonths(date, -1) : event.key === 'PageDown' ? addMonths(date, 1) : '';
    if (!next) return;
    event.preventDefault(); event.stopPropagation();
    if (inRange(next)) { focusedDate = next; month = `${next.slice(0, 7)}-01`; render(true); }
  });
  document.addEventListener('keydown', event => {
    if (panel.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); }
  }, true);
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !panel.contains(event.target) && !trigger.contains(event.target)) close();
  });
  document.addEventListener('focusin', event => {
    if (!panel.hidden && !panel.contains(event.target) && !trigger.contains(event.target)) close();
  });
  return { close, get isOpen() { return !panel.hidden; } };
}

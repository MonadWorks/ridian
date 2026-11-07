import './habits.js';
import { createTaskReorder } from './reorder.js';

export function createHabitView({ getData, request, onChange, onBusy, error, announce }) {
  const { addDays, addMonths } = window.RidianDates;
  const { isDue, habitStats, weekdaysOn } = window.RidianHabits;
  const $ = id => document.getElementById(id);
  const list = $('habits'), detail = $('habit-detail'), input = $('habit-input');
  let selectedId = null, month = '', editing = false, saving = false, confirmingDelete = false, composing = false;
  const today = () => getData().today || window.RidianDates.localDate();
  const habits = () => getData().habits || [];
  const selected = () => habits().find(habit => habit.id === selectedId);
  const shortDate = date => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const longDate = date => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const checkIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>';
  const arrow = direction => `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${direction < 0 ? 'm12 6-4 4 4 4' : 'm8 6 4 4-4 4'}"/></svg>`;
  const reorder = createTaskReorder({ list, canStart: () => !saving && !selectedId, move: moveHabit, rowSelector: '.habit', blockedSelector: 'input,textarea,.habit-day' });

  function button(label, className, action, html) {
    const node = document.createElement('button'); node.type = 'button'; node.className = className;
    node.setAttribute('aria-label', label); node.title = label;
    if (html) node.innerHTML = html;
    node.addEventListener('click', action);
    return node;
  }
  function replaceHabit(value) { getData().habits = habits().map(habit => habit.id === value.id ? value : habit); }
  function lock(value) {
    saving = value; input.disabled = value;
    for (const control of document.querySelectorAll('#habit-panel button, #habit-detail input')) {
      if (value) { control.dataset.wasDisabled = String(control.disabled); control.disabled = true; }
      else if ('wasDisabled' in control.dataset) { control.disabled = control.dataset.wasDisabled === 'true'; delete control.dataset.wasDisabled; }
    }
    $('habit-panel').setAttribute('aria-busy', String(value)); onBusy(value);
  }
  async function mutate(action) {
    if (saving) return false;
    lock(true); error();
    try { await action(); return true; }
    catch (e) { error(e.message); return false; }
    finally { lock(false); onChange(); }
  }
  function dayButton(habit, date, calendar = false, justChecked = '') {
    const done = habit.checkins.includes(date), due = isDue(habit, date), current = date === today();
    const node = button(`${habit.title}, ${longDate(date)}, ${done ? 'completed; undo' : due ? 'mark complete' : 'rest day'}`, calendar ? 'habit-day habit-calendar-day' : 'habit-day', () => check(habit.id, date));
    node.dataset.date = date; node.dataset.focus = `${habit.id}:${date}`;
    node.setAttribute('aria-pressed', String(done));
    node.classList.toggle('checked', done); node.classList.toggle('rest-day', !due);
    if (current) node.setAttribute('aria-current', 'date');
    if (justChecked === `${habit.id}:${date}`) node.classList.add('just-checked');
    node.disabled = saving || date > today() || date < habit.startDate || (!due && !done);
    node.title = `${longDate(date)}${date > today() ? ' · Upcoming' : date < habit.startDate ? ' · Before start' : !due && !done ? ' · Rest day' : done ? ' · Completed' : ''}`;
    if (calendar) node.textContent = String(Number(date.slice(8)));
    else {
      const label = document.createElement('span'); label.className = 'habit-weekday'; label.textContent = dayNames[new Date(`${date}T12:00:00Z`).getUTCDay()].slice(0, 1);
      const dot = document.createElement('span'); dot.className = 'habit-dot'; dot.innerHTML = checkIcon;
      node.append(label, dot);
    }
    return node;
  }
  function render(justChecked = '') {
    if (editing) return;
    const focused = document.activeElement?.dataset.focus;
    if (selectedId && !selected()) selectedId = null;
    detail.hidden = !selectedId;
    list.parentElement.hidden = !!selectedId; $('habit-add').hidden = !!selectedId;
    if (selectedId) renderDetail(justChecked);
    else {
      const fragment = document.createDocumentFragment();
      for (const habit of habits()) {
        const row = document.createElement('li'); row.className = 'habit'; row.dataset.id = habit.id;
        const heading = document.createElement('div'); heading.className = 'habit-heading';
        const title = button(`View ${habit.title}`, 'habit-title', event => { if (event.detail !== 0 && reorder.suppressClick) return; open(habit.id); });
        title.textContent = habit.title; title.dataset.focus = `title:${habit.id}`; title.disabled = saving;
        const streak = document.createElement('span'), count = habitStats(habit, today()).current;
        streak.className = 'habit-streak'; streak.textContent = `${count} ${count === 1 ? 'day' : 'days'}`;
        streak.setAttribute('aria-label', `${count} consecutive scheduled days`);
        heading.append(title, streak);
        const week = document.createElement('div'); week.className = 'habit-week';
        for (let offset = -6; offset <= 0; offset++) week.append(dayButton(habit, addDays(today(), offset), false, justChecked));
        row.append(heading, week); reorder.attach(row, habit);
        row.querySelector('.reorder-handle').dataset.focus = `move:${habit.id}`;
        fragment.append(row);
      }
      list.replaceChildren(fragment); $('habits-empty').hidden = habits().length > 0;
    }
    if (focused) $('habit-panel').querySelector(`[data-focus="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }
  async function check(id, date) {
    if (saving) return;
    const original = habits().find(habit => habit.id === id);
    if (!original) return;
    const done = !original.checkins.includes(date);
    if (date > today() || date < original.startDate || (done && !isDue(original, date))) return;
    const optimistic = { ...original, checkins: done ? [...original.checkins, date].sort() : original.checkins.filter(value => value !== date) };
    const changed = `${id}:${date}`;
    await mutate(async () => {
      replaceHabit(optimistic); render(done ? changed : ''); onChange();
      try { replaceHabit(await request('POST', `/api/v1/habits/${id}/checkins`, { date, done })); announce(done ? `${original.title} completed` : 'Check-in removed'); }
      catch (e) { replaceHabit(original); throw e; }
    });
    render(done && habits().find(habit => habit.id === id)?.checkins.includes(date) ? changed : '');
  }
  async function moveHabit(id, beforeId) {
    const previous = habits(), moving = previous.find(habit => habit.id === id);
    if (!moving || saving || id === beforeId) return;
    await mutate(async () => {
      const next = previous.filter(habit => habit.id !== id);
      next.splice(beforeId === null ? next.length : next.findIndex(habit => habit.id === beforeId), 0, moving);
      getData().habits = next; render();
      try { getData().habits = (await request('POST', '/api/v1/habits/order', { id, beforeId })).habits; announce('Habit order saved'); }
      catch (e) { getData().habits = previous; throw e; }
    });
    render();
  }
  function open(id) {
    if (saving) return;
    selectedId = id; month = `${today().slice(0, 7)}-01`; error(); render(); detail.scrollTop = 0;
    detail.querySelector('.habit-back')?.focus();
  }
  function back() {
    if (saving) return;
    if (editing) { editing = false; confirmingDelete = false; error(); render(); detail.querySelector('.habit-edit')?.focus(); }
    else { const id = selectedId; selectedId = null; error(); render(); list.querySelector(`[data-id="${CSS.escape(id)}"] .habit-title`)?.focus(); }
  }
  function renderDetail(justChecked) {
    const habit = selected(), stats = habitStats(habit, today());
    detail.replaceChildren();
    const heading = document.createElement('div'); heading.className = 'habit-detail-heading';
    const backButton = button('Back to habits', 'icon-button habit-back', back, arrow(-1));
    const title = button(`Edit ${habit.title}`, 'habit-detail-title', edit); title.textContent = habit.title;
    const editButton = button('Edit habit', 'icon-button habit-edit', edit, '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4 3.5 3.5M4 16l1-4L13 4a2 2 0 0 1 3 3l-8 8-4 1Z"/></svg>');
    heading.append(backButton, title, editButton); detail.append(heading);
    const summary = document.createElement('div'); summary.className = 'habit-stats';
    for (const [label, count] of [['Current', stats.current], ['Total', stats.total], ['Best', stats.longest]]) {
      const stat = document.createElement('div'), value = document.createElement('strong'), name = document.createElement('span');
      value.textContent = count; name.textContent = label; stat.append(value, name); summary.append(stat);
    }
    detail.append(summary);
    const navigation = document.createElement('div'); navigation.className = 'calendar-header';
    const previous = button('Previous month', 'icon-button', () => changeMonth(-1), arrow(-1));
    previous.disabled = month <= `${habit.startDate.slice(0, 7)}-01`;
    const label = document.createElement('span'); label.className = 'calendar-month'; label.textContent = new Date(`${month}T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const next = button('Next month', 'icon-button', () => changeMonth(1), arrow(1)); next.disabled = month >= '2100-12-01';
    previous.dataset.focus = 'month:previous'; next.dataset.focus = 'month:next';
    navigation.append(previous, label, next); detail.append(navigation);
    const week = document.createElement('div'); week.className = 'calendar-week'; week.setAttribute('aria-hidden', 'true');
    for (const day of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) { const label = document.createElement('span'); label.textContent = day; week.append(label); }
    const days = document.createElement('div'); days.className = 'habit-calendar'; days.setAttribute('aria-label', label.textContent);
    const first = addDays(month, -(new Date(`${month}T12:00:00Z`).getUTCDay() + 6) % 7);
    for (let i = 0; i < 42; i++) {
      const date = addDays(first, i), day = dayButton(habit, date, true, justChecked);
      day.classList.toggle('outside-month', date.slice(0, 7) !== month.slice(0, 7)); days.append(day);
    }
    detail.append(week, days);
    const since = document.createElement('div'); since.className = 'habit-since';
    const caption = document.createElement('span'); caption.textContent = `Since ${shortDate(habit.startDate)}`; since.append(caption);
    if (month.slice(0, 7) !== today().slice(0, 7)) since.append(button('Back to this month', 'icon-button', () => { month = `${today().slice(0, 7)}-01`; render(); }, '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="5" width="12" height="11" rx="2"/><path d="M7 3.5v3M13 3.5v3M4 9h12"/><circle cx="10" cy="12.5" r="1" fill="currentColor" stroke="none"/></svg>'));
    detail.append(since);
    if (saving) for (const control of detail.querySelectorAll('button')) control.disabled = true;
  }
  function changeMonth(amount) { if (saving) return; month = addMonths(month, amount); render(); }
  function edit() {
    if (saving) return;
    const habit = selected(); editing = true; confirmingDelete = false;
    detail.innerHTML = '<form id="habit-edit-form" class="habit-edit-form"><label for="habit-name">Name</label><input id="habit-name" maxlength="240" autocomplete="off"><fieldset><legend>Repeat</legend><div class="habit-weekdays"></div></fieldset><div class="habit-edit-actions"><button type="button" class="habit-cancel">Cancel</button><button type="submit" class="habit-save">Save</button></div><div class="habit-delete-area"><button type="button" class="habit-delete">Delete habit</button></div></form>';
    const name = $('habit-name'); name.value = habit.title;
    const weekdays = new Set(weekdaysOn(habit, today()));
    for (const day of [1, 2, 3, 4, 5, 6, 0]) {
      const node = button(dayNames[day], 'habit-weekday-choice', () => {
        if (saving) return;
        if (weekdays.has(day)) weekdays.delete(day); else weekdays.add(day);
        node.setAttribute('aria-pressed', String(weekdays.has(day)));
      });
      node.textContent = dayNames[day].slice(0, 1); node.setAttribute('aria-pressed', String(weekdays.has(day))); node.dataset.weekday = day;
      detail.querySelector('.habit-weekdays').append(node);
    }
    detail.querySelector('.habit-cancel').onclick = back;
    name.addEventListener('compositionstart', () => { composing = true; });
    name.addEventListener('compositionend', () => { composing = false; });
    name.addEventListener('keydown', event => { if (event.isComposing || event.keyCode === 229 || composing) { if (event.key === 'Enter') event.preventDefault(); event.stopPropagation(); } });
    $('habit-edit-form').addEventListener('submit', async event => {
      event.preventDefault(); if (saving || composing) return;
      const title = name.value.trim();
      if (!title) { error('Add a habit name.'); name.focus(); return; }
      if (!weekdays.size) { error('Choose at least one day.'); return; }
      const saved = await mutate(async () => { replaceHabit(await request('PATCH', `/api/v1/habits/${habit.id}`, { title, weekdays: [...weekdays].sort() })); announce('Habit updated'); });
      if (saved) { editing = false; render(); detail.querySelector('.habit-edit')?.focus(); }
    });
    detail.querySelector('.habit-delete').onclick = async () => {
      if (saving) return;
      if (!confirmingDelete) {
        confirmingDelete = true;
        detail.querySelector('.habit-delete').textContent = 'Delete habit & records?';
        const cancel = button('Keep habit', 'habit-keep', () => { confirmingDelete = false; detail.querySelector('.habit-delete').textContent = 'Delete habit'; cancel.remove(); });
        cancel.textContent = 'Keep'; detail.querySelector('.habit-delete-area').append(cancel); return;
      }
      const removed = await mutate(async () => { await request('DELETE', `/api/v1/habits/${habit.id}`); getData().habits = habits().filter(item => item.id !== habit.id); announce('Habit deleted'); });
      if (removed) { editing = false; selectedId = null; render(); input.focus(); }
    };
    detail.scrollTop = 0; name.focus(); name.select();
  }
  $('habit-add').addEventListener('submit', async event => {
    event.preventDefault(); const title = input.value.trim(); if (!title || saving || composing) return;
    const added = await mutate(async () => { const habit = await request('POST', '/api/v1/habits', { title }); getData().habits = [...habits(), habit]; input.value = ''; announce('Habit added'); });
    render(); if (added) list.parentElement.scrollTop = list.parentElement.scrollHeight; input.focus();
  });
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });
  input.addEventListener('keydown', event => { if ((event.isComposing || event.keyCode === 229 || composing) && event.key === 'Enter') event.preventDefault(); });
  document.addEventListener('keydown', event => {
    if ($('habit-panel').hidden || event.key !== 'Escape' || event.isComposing || composing) return;
    if (selectedId) { event.preventDefault(); event.stopImmediatePropagation(); back(); }
  }, true);
  return { render, cancelDrag: reorder.cancel, get busy() { return saving; }, get interacting() { return saving || (editing && !$('habit-panel').hidden) || reorder.isDragging; }, focus() { if (!selectedId) input.focus(); } };
}

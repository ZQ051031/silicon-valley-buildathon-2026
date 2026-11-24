import {
  MINUTE, advanceTimer, timeLeft, toggleTimer, resetTimer, configureTimer, localDay,
  addTask, editTask, toggleTask, deleteTask, filterTasks, addCard, reviewCard, dueCards,
  loadState, saveSlice,
} from './study.js';

const $ = (id) => document.getElementById(id);
const storage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};
const state = loadState(storage);
const dateLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const logLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
let today;
let filter = 'all';
let editingId = null;
let displayedCard = null;
let revealed = false;

function persist(slice) {
  $('storage-warning').hidden = saveSlice(storage, slice, state[slice]);
}

function id() {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (word) => word.toString(16).padStart(8, '0')).join('');
}

function friendlyDate(day) {
  return dateLabel.format(new Date(`${day}T12:00:00`));
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderTimer(now) {
  const timer = state.timer;
  const remaining = timeLeft(timer, now);
  const seconds = Math.ceil(remaining / 1000);
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  if ($('clock').textContent !== clock) $('clock').textContent = clock;
  const phase = timer.mode === 'focus' ? 'Focus' : 'Break';
  const startLabel = timer.deadline !== null ? 'Pause'
    : remaining < timer[timer.mode] * MINUTE ? `Resume ${timer.mode}` : `Start ${timer.mode}`;
  if ($('phase').textContent !== phase) $('phase').textContent = phase;
  if ($('start').textContent !== startLabel) $('start').textContent = startLabel;
  $('timer-face').dataset.phase = timer.mode;
  $('progress').value = 1 - remaining / (timer[timer.mode] * MINUTE);
}

function renderSessions() {
  const { log } = state.timer;
  $('session-count').textContent = `${log.length} ${log.length === 1 ? 'session' : 'sessions'}`;
  if (!log.length) {
    $('session-log').replaceChildren(element('p', 'empty', 'Finished focus sessions will appear here.'));
    return;
  }
  const list = element('ol', 'session-list');
  for (const session of log) {
    const entry = element('li');
    entry.append(element('strong', '', `${session.minutes} min`), ` · ${logLabel.format(session.endedAt)}`);
    list.append(entry);
  }
  $('session-log').replaceChildren(list);
}

function syncTimer(now) {
  const next = advanceTimer(state.timer, now);
  if (next !== state.timer) {
    state.timer = next;
    persist('timer');
    renderSessions();
    $('timer-status').textContent = next.mode === 'break'
      ? 'Focus session logged. Your break is ready.' : 'Break complete. Your next focus session is ready.';
  }
  renderTimer(now);
}

$('start').addEventListener('click', () => {
  const now = Date.now();
  syncTimer(now);
  state.timer = toggleTimer(state.timer, now);
  persist('timer');
  renderTimer(now);
});

$('reset').addEventListener('click', () => {
  const now = Date.now();
  syncTimer(now);
  state.timer = resetTimer(state.timer, now);
  persist('timer');
  renderTimer(now);
  $('timer-status').textContent = 'Timer reset.';
});

$('timer-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const now = Date.now();
  syncTimer(now);
  state.timer = configureTimer(state.timer, $('focus-minutes').valueAsNumber, $('break-minutes').valueAsNumber, now);
  persist('timer');
  renderTimer(now);
  $('timer-settings').open = false;
  $('timer-settings').querySelector('summary').focus();
  $('timer-status').textContent = 'New timer lengths saved. Timer reset.';
});

function taskAction(label, task, action) {
  const button = element('button', 'text-button', label);
  button.type = 'button';
  button.setAttribute('aria-label', `${label}: ${task.title}`);
  button.addEventListener('click', action);
  return button;
}

function renderTasks(focusId) {
  const tasks = filterTasks(state.tasks, filter, today);
  $('task-count').textContent = `${state.tasks.filter((task) => !task.completed).length} open`;
  $('task-empty').hidden = tasks.length > 0;
  $('task-empty').textContent = {
    all: 'No tasks yet. What’s one thing you want to get done?',
    open: 'No open tasks.',
    today: 'No open tasks due today or overdue.',
    done: 'No completed tasks yet.',
  }[filter];
  const fragment = document.createDocumentFragment();
  let restoreFocus;
  for (const task of tasks) {
    const row = element('li', 'task-row');
    const label = element('label');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.completed;
    checkbox.setAttribute('aria-label', task.title);
    checkbox.addEventListener('change', () => {
      state.tasks = toggleTask(state.tasks, task.id);
      persist('tasks');
      renderTasks(task.id);
      $('task-status').textContent = checkbox.checked ? 'Task completed.' : 'Task reopened.';
    });
    if (task.id === focusId) restoreFocus = checkbox;
    const text = element('span');
    const metadata = element('span', 'task-byline');
    const priority = element('span', 'badge', `${task.priority[0].toUpperCase()}${task.priority.slice(1)} priority`);
    priority.dataset.priority = task.priority;
    metadata.append(priority);
    if (task.due) {
      const prefix = task.due < today && !task.completed ? 'Overdue: ' : 'Due ';
      const date = element('time', '', prefix + friendlyDate(task.due));
      date.dateTime = task.due;
      metadata.append(date);
    }
    text.append(element('strong', 'task-name', task.title), metadata);
    label.append(checkbox, text);
    const actions = element('div', 'task-actions');
    actions.append(
      taskAction('Edit', task, () => beginEdit(task)),
      taskAction('Delete', task, () => {
        state.tasks = deleteTask(state.tasks, task.id);
        if (editingId === task.id) clearTaskForm();
        persist('tasks');
        renderTasks(task.id);
        $('task-status').textContent = 'Task deleted.';
      }),
    );
    row.append(label, actions);
    fragment.append(row);
  }
  $('task-list').replaceChildren(fragment);
  if (focusId) (restoreFocus || $('filters').querySelector('[aria-pressed="true"]')).focus();
}

function beginEdit(task) {
  editingId = task.id;
  $('task-title').value = task.title;
  $('task-priority').value = task.priority;
  $('task-due').value = task.due;
  $('task-submit').textContent = 'Save task';
  $('task-cancel').hidden = false;
  $('task-status').textContent = '';
  $('task-title').focus();
}

function clearTaskForm() {
  editingId = null;
  $('task-form').reset();
  $('task-submit').textContent = 'Add task';
  $('task-cancel').hidden = true;
}

$('task-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const fields = { title: $('task-title').value, priority: $('task-priority').value, due: $('task-due').value };
  const target = editingId;
  try {
    state.tasks = target ? editTask(state.tasks, target, fields) : addTask(state.tasks, id(), fields);
  } catch (error) {
    $('task-status').textContent = error.message;
    return;
  }
  persist('tasks');
  clearTaskForm();
  if (!target) setFilter('all');
  else renderTasks();
  $('task-status').textContent = target ? 'Task updated.' : 'Task added.';
  $('task-title').focus();
});

$('task-cancel').addEventListener('click', () => {
  const target = editingId;
  clearTaskForm();
  renderTasks(target);
  $('task-status').textContent = 'Edit canceled.';
});

function setFilter(next) {
  filter = next;
  for (const button of $('filters').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
  }
  renderTasks();
}

$('filters').addEventListener('click', (event) => {
  const next = event.target.closest('button')?.dataset.filter;
  if (next) {
    setFilter(next);
    $('task-status').textContent = '';
  }
});

function renderReview() {
  const due = dueCards(state.cards, today);
  const card = due[0];
  if (displayedCard !== card?.id) revealed = false;
  displayedCard = card?.id;
  $('review-count').textContent = `${due.length} due`;
  $('review-card').hidden = !card;
  $('review-empty').hidden = Boolean(card);
  $('review-empty').textContent = state.cards.length
    ? 'You’re caught up! Scheduled cards will return on their due dates.' : 'No cards due. Add a card to start practicing.';
  if (card) {
    $('review-question').textContent = card.question;
    $('review-answer').textContent = card.answer;
  }
  $('reveal').hidden = revealed;
  $('revealed').hidden = !revealed;
  const upcoming = state.cards.filter((item) => item.due > today).map((item) => item.due).sort()[0];
  $('next-review').hidden = !upcoming;
  $('next-review').textContent = upcoming ? `Next scheduled review: ${friendlyDate(upcoming)}` : '';
}

$('card-form').addEventListener('submit', (event) => {
  event.preventDefault();
  syncDay(Date.now());
  try {
    state.cards = addCard(state.cards, id(), $('question').value, $('answer').value, today);
  } catch (error) {
    $('review-status').textContent = error.message;
    return;
  }
  persist('cards');
  $('card-form').reset();
  renderReview();
  $('review-status').textContent = 'Card added to today’s queue.';
  $('question').focus();
});

$('reveal').addEventListener('click', () => {
  revealed = true;
  renderReview();
  $('review-answer').focus();
});

$('ratings').addEventListener('click', (event) => {
  const rating = event.target.closest('button')?.dataset.rating;
  if (!rating || !displayedCard || !revealed) return;
  const current = displayedCard;
  syncDay(Date.now());
  if (current !== displayedCard) {
    $('review-question').focus();
    return;
  }
  try {
    state.cards = reviewCard(state.cards, current, rating, today);
  } catch (error) {
    $('review-status').textContent = error.message;
    return;
  }
  const rated = state.cards.find((card) => card.id === current);
  persist('cards');
  renderReview();
  $('review-status').textContent = `Card scheduled for ${friendlyDate(rated.due)} (${rated.interval} ${rated.interval === 1 ? 'day' : 'days'}).`;
  $(displayedCard ? 'review-question' : 'review-status').focus();
});

function syncDay(now) {
  const current = localDay(now);
  if (today === current) return;
  today = current;
  $('weekday').textContent = weekday.format(now);
  $('date').textContent = shortDate.format(now);
  renderTasks();
  renderReview();
}

function tick() {
  const now = Date.now();
  syncTimer(now);
  syncDay(now);
}

$('focus-minutes').value = state.timer.focus;
$('break-minutes').value = state.timer.break;
renderSessions();
tick();
setInterval(tick, 250);
document.addEventListener('visibilitychange', tick);

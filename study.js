export const MINUTE = 60_000;
export const STORAGE_KEY = 'studysprint.v1';
export const PRIORITIES = ['low', 'medium', 'high'];
const MAX_INTERVAL = 365;
const durationOK = (n) => Number.isInteger(n) && n >= 1 && n <= 180;

export function createTimer() {
  return { focus: 25, break: 5, mode: 'focus', remaining: 25 * MINUTE, deadline: null, log: [] };
}

export function advanceTimer(timer, now) {
  if (timer.deadline === null || now < timer.deadline) return timer;
  const focused = timer.mode === 'focus';
  const mode = focused ? 'break' : 'focus';
  return {
    ...timer, mode, deadline: null, remaining: timer[mode] * MINUTE,
    log: focused ? [{ endedAt: timer.deadline, minutes: timer.focus }, ...timer.log] : timer.log,
  };
}

export function timeLeft(timer, now) {
  return timer.deadline === null ? timer.remaining : Math.max(0, timer.deadline - now);
}

export function toggleTimer(timer, now) {
  const current = advanceTimer(timer, now);
  if (current.deadline === null) return { ...current, deadline: now + current.remaining };
  return { ...current, remaining: timeLeft(current, now), deadline: null };
}

export function resetTimer(timer, now) {
  const current = advanceTimer(timer, now);
  return { ...current, remaining: current[current.mode] * MINUTE, deadline: null };
}

export function configureTimer(timer, focus, rest, now) {
  if (!durationOK(focus) || !durationOK(rest)) throw new RangeError('Enter whole minutes from 1 to 180.');
  const current = advanceTimer(timer, now);
  const configured = { ...current, focus, break: rest };
  return { ...configured, remaining: configured[configured.mode] * MINUTE, deadline: null };
}

export function localDay(now) {
  const date = new Date(now);
  return [String(date.getFullYear()).padStart(4, '0'), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}

function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

function cleanText(value, max, label) {
  const cleaned = typeof value === 'string' ? value.trim() : '';
  if (!cleaned || cleaned.length > max) throw new RangeError(`${label} must be 1–${max} characters.`);
  return cleaned;
}

function taskFields({ title, priority, due }) {
  if (!PRIORITIES.includes(priority)) throw new RangeError('Choose a valid priority.');
  if (due !== '' && !validDay(due)) throw new RangeError('Enter a valid due date.');
  return { title: cleanText(title, 120, 'Task'), priority, due };
}

export function addTask(tasks, id, fields) {
  return [{ id, ...taskFields(fields), completed: false }, ...tasks];
}

export function editTask(tasks, id, fields) {
  const updates = taskFields(fields);
  return tasks.map((task) => task.id === id ? { ...task, ...updates } : task);
}

export function toggleTask(tasks, id) {
  return tasks.map((task) => task.id === id ? { ...task, completed: !task.completed } : task);
}

export function deleteTask(tasks, id) {
  return tasks.filter((task) => task.id !== id);
}

export function filterTasks(tasks, filter, today) {
  if (filter === 'open') return tasks.filter((task) => !task.completed);
  if (filter === 'done') return tasks.filter((task) => task.completed);
  if (filter === 'today') return tasks.filter((task) => !task.completed && task.due && task.due <= today);
  return tasks;
}

export function addCard(cards, id, question, answer, today) {
  if (!validDay(today)) throw new RangeError('Enter a valid review date.');
  return [...cards, {
    id, question: cleanText(question, 240, 'Question'), answer: cleanText(answer, 1000, 'Answer'),
    due: today, interval: 0,
  }];
}

export function reviewCard(cards, id, rating, today) {
  if (!['again', 'hard', 'easy'].includes(rating) || !validDay(today)) {
    throw new RangeError('Invalid review rating or date.');
  }
  return cards.map((card) => {
    if (card.id !== id || card.due > today) return card;
    const interval = rating === 'again' ? 1 : Math.min(MAX_INTERVAL, rating === 'hard'
      ? Math.max(2, Math.ceil(card.interval * 1.5))
      : Math.max(4, card.interval * 2));
    // UTC arithmetic on calendar dates avoids DST offset changes.
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + interval);
    const due = date.toISOString().slice(0, 10);
    if (!validDay(due)) throw new RangeError('The next review date is out of range.');
    return { ...card, interval, due };
  });
}

export function dueCards(cards, today) {
  return cards.filter((card) => card.due <= today).sort((a, b) => a.due.localeCompare(b.due));
}

const usableId = (item) => typeof item?.id === 'string' && item.id.length > 0;
const usableText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const validTask = (item) => usableId(item) && usableText(item.title, 120)
  && PRIORITIES.includes(item.priority) && typeof item.completed === 'boolean' && (item.due === '' || validDay(item.due));
const validCard = (item) => usableId(item) && usableText(item.question, 240) && usableText(item.answer, 1000)
  && validDay(item.due) && Number.isInteger(item.interval) && item.interval >= 0 && item.interval <= MAX_INTERVAL;
const validTimestamp = (value) => Number.isFinite(value) && value >= 0 && Number.isFinite(+new Date(value));
const validTimer = (timer) => timer && durationOK(timer.focus) && durationOK(timer.break)
  && ['focus', 'break'].includes(timer.mode) && Number.isFinite(timer.remaining)
  && timer.remaining > 0 && timer.remaining <= timer[timer.mode] * MINUTE
  && (timer.deadline === null || validTimestamp(timer.deadline));

function readSaved(storage, key, fallback = null) {
  try {
    const value = storage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return null;
  }
}

function migrateLegacy(storage, state) {
  try {
    for (const [slice, value] of Object.entries(state)) {
      if (storage.getItem(`${STORAGE_KEY}.${slice}`) === null && !saveSlice(storage, slice, value)) return;
    }
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Keep the legacy data if storage prevents migration.
  }
}

export function loadState(storage) {
  const legacy = readSaved(storage, STORAGE_KEY);
  const candidate = readSaved(storage, `${STORAGE_KEY}.timer`, legacy?.timer);
  const tasks = readSaved(storage, `${STORAGE_KEY}.tasks`, legacy?.tasks);
  const cards = readSaved(storage, `${STORAGE_KEY}.cards`, legacy?.cards);
  const log = Array.isArray(candidate?.log) ? candidate.log.filter(
    (entry) => entry && validTimestamp(entry.endedAt) && durationOK(entry.minutes),
  ) : [];
  const state = {
    timer: { ...(validTimer(candidate) ? candidate : createTimer()), log },
    tasks: Array.isArray(tasks) ? tasks.filter(validTask) : [],
    cards: Array.isArray(cards) ? cards.filter(validCard) : [],
  };
  if (legacy && typeof legacy === 'object') migrateLegacy(storage, state);
  return state;
}

export function saveSlice(storage, slice, value) {
  try {
    storage.setItem(`${STORAGE_KEY}.${slice}`, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

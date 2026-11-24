import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MINUTE, STORAGE_KEY, createTimer, advanceTimer, timeLeft, toggleTimer, resetTimer, configureTimer,
  localDay, addTask, editTask, toggleTask, deleteTask, filterTasks, addCard, reviewCard, dueCards,
  loadState, saveSlice,
} from './study.js';

const today = '2028-02-28';
const fields = { title: ' Outline essay ', priority: 'high', due: today };
const store = (raw = null) => {
  const entries = new Map([[STORAGE_KEY, raw]]);
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
    removeItem: (key) => { entries.delete(key); },
  };
};

test('timer pauses and resumes from its actual deadline', () => {
  let timer = toggleTimer(createTimer(), 1_000);
  assert.equal(timer.deadline, 1_000 + 25 * MINUTE);
  timer = toggleTimer(timer, 1_000 + 1575);
  assert.equal(timeLeft(timer, 1_000_000), 25 * MINUTE - 1575);
  timer = toggleTimer(timer, 3_000);
  assert.equal(timer.deadline, 3_000 + 25 * MINUTE - 1575);
});

test('an elapsed focus is logged once, and an elapsed break is not logged', () => {
  const timer = toggleTimer(createTimer(), 0);
  assert.equal(advanceTimer(timer, timer.deadline - 1), timer);
  let phase = advanceTimer(timer, 10 * timer.deadline);
  assert.deepEqual(phase.log, [{ endedAt: timer.deadline, minutes: 25 }]);
  assert.equal(phase.mode, 'break');
  assert.equal(phase.remaining, 5 * MINUTE);
  assert.equal(advanceTimer(phase, 11 * timer.deadline), phase);
  phase = toggleTimer(phase, 10 * timer.deadline);
  phase = advanceTimer(phase, phase.deadline);
  assert.equal(phase.mode, 'focus');
  assert.equal(phase.log.length, 1);
});

test('reset and settings return the current phase to its configured length', () => {
  let timer = configureTimer(createTimer(), 1, 180, 0);
  timer = toggleTimer(timer, 0);
  assert.equal(timeLeft(timer, MINUTE + 1), 0);
  const reset = resetTimer(timer, 5_000);
  assert.equal(reset.remaining, MINUTE);
  assert.equal(reset.deadline, null);
  assert.equal(reset.log.length, 0);
  timer = advanceTimer(timer, MINUTE);
  timer = configureTimer(timer, 30, 8, MINUTE);
  assert.equal(timer.remaining, 8 * MINUTE);
  assert.equal(timer.log.length, 1);
  for (const invalid of [0, -1, 181, NaN, 1.5, '10']) {
    assert.throws(() => configureTimer(timer, invalid, 5, 0), RangeError);
    assert.throws(() => configureTimer(timer, 25, invalid, 0), RangeError);
  }
});

test('planner adds, edits, completes, reopens and deletes without mutating its input', () => {
  const original = addTask([], 'a', fields);
  assert.deepEqual(original[0], { ...fields, title: 'Outline essay', id: 'a', completed: false });
  const done = toggleTask(original, 'a');
  const edited = editTask(done, 'a', { title: 'Revise essay', priority: 'low', due: '' });
  assert.deepEqual(edited[0], { id: 'a', title: 'Revise essay', priority: 'low', due: '', completed: true });
  assert.equal(toggleTask(edited, 'a')[0].completed, false);
  assert.deepEqual(deleteTask(edited, 'missing'), edited);
  assert.deepEqual(deleteTask(edited, 'a'), []);
  assert.equal(original[0].completed, false);
});

test('planner filters all, open, done, and due today including overdue', () => {
  let tasks = [];
  for (const [id, due] of [['undated', ''], ['future', '2028-02-29'], ['today', today], ['overdue', '2028-02-01'], ['done', today]]) {
    tasks = addTask(tasks, id, { ...fields, due });
  }
  tasks = toggleTask(tasks, 'done');
  const ids = (filter) => filterTasks(tasks, filter, today).map(({ id }) => id);
  assert.deepEqual(ids('all'), ['done', 'overdue', 'today', 'future', 'undated']);
  assert.deepEqual(ids('open'), ['overdue', 'today', 'future', 'undated']);
  assert.deepEqual(ids('done'), ['done']);
  assert.deepEqual(ids('today'), ['overdue', 'today']);
});

test('planner rejects blanks, overflow, invalid priority and rolled-over dates', () => {
  for (const bad of [{ title: '  ' }, { title: 'x'.repeat(121) }, { priority: 'urgent' },
    { due: '2027-02-29' }, { due: '28/02/2028' }, { due: '2028-04-31' }]) {
    assert.throws(() => addTask([], 'a', { ...fields, ...bad }), RangeError);
    assert.throws(() => editTask(addTask([], 'a', fields), 'a', { ...fields, ...bad }), RangeError);
  }
  assert.equal(addTask([], 'a', { ...fields, due: '2028-02-29' })[0].due, '2028-02-29');
});

test('new cards enter the queue immediately; older due dates come first', () => {
  let cards = addCard([], 'a', ' Question ', ' Answer ', today);
  cards = addCard(cards, 'b', 'Older?', 'Yes', '2028-02-27');
  cards = addCard(cards, 'c', 'Tomorrow?', 'Yes', '2028-02-29');
  assert.deepEqual(dueCards(cards, today).map(({ id }) => id), ['b', 'a']);
  assert.deepEqual(cards[0], { id: 'a', question: 'Question', answer: 'Answer', due: today, interval: 0 });
});

test('Again, Hard and Easy set distinct gaps across leap day', () => {
  const cards = addCard([], 'a', 'Q', 'A', today);
  for (const [rating, interval, due] of [['again', 1, '2028-02-29'], ['hard', 2, '2028-03-01'], ['easy', 4, '2028-03-03']]) {
    const reviewed = reviewCard(cards, 'a', rating, today);
    assert.deepEqual(reviewed[0], { ...cards[0], due, interval });
    assert.equal(dueCards(reviewed, today).length, 0);
    assert.equal(dueCards(reviewed, due).length, 1);
    assert.deepEqual(reviewCard(reviewed, 'a', rating, today), reviewed);
  }
});

test('repeat reviews grow from the current day, cap at 365 days, and Again resets', () => {
  let cards = [{ ...addCard([], 'a', 'Q', 'A', today)[0], interval: 9 }];
  cards = reviewCard(cards, 'a', 'hard', '2028-03-01');
  assert.equal(cards[0].interval, 14);
  assert.equal(cards[0].due, '2028-03-15');
  for (let count = 0; count < 10; count += 1) cards = reviewCard(cards, 'a', 'easy', cards[0].due);
  assert.equal(cards[0].interval, 365);
  assert.equal(reviewCard(cards, 'a', 'again', cards[0].due)[0].interval, 1);
  assert.equal(localDay(new Date(2028, 1, 29, 23, 59)), '2028-02-29');
});

test('review rejects blank or oversized fields and invalid ratings and dates', () => {
  assert.throws(() => addCard([], 'a', ' ', 'A', today), RangeError);
  assert.throws(() => addCard([], 'a', 'Q', '', today), RangeError);
  assert.throws(() => addCard([], 'a', 'Q', 'a'.repeat(1001), today), RangeError);
  assert.throws(() => addCard([], 'a', 'Q', 'A', '2028-02-30'), RangeError);
  assert.throws(() => reviewCard([], 'a', 'skip', today), RangeError);
  assert.throws(() => reviewCard([], 'a', 'easy', ''), RangeError);
});

test('storage round-trips the running timer, log, tasks and review cards', () => {
  const storage = store();
  const timer = toggleTimer(advanceTimer(toggleTimer(createTimer(), 0), 25 * MINUTE), 25 * MINUTE);
  const state = { timer, tasks: addTask([], 'a', fields), cards: addCard([], 'b', 'Q', 'A', today) };
  for (const [slice, value] of Object.entries(state)) assert.equal(saveSlice(storage, slice, value), true);
  assert.deepEqual(loadState(storage), state);
});

test('writes from stale tabs preserve other slices and untouched legacy data', () => {
  const timer = toggleTimer(createTimer(), 0);
  const legacyTasks = addTask([], 'old', fields);
  const storage = store(JSON.stringify({ timer, tasks: legacyTasks, cards: [] }));
  const tabA = loadState(storage);
  const tabB = loadState(storage);

  tabA.tasks = addTask(tabA.tasks, 'new', { ...fields, title: 'Write draft' });
  assert.equal(saveSlice(storage, 'tasks', tabA.tasks), true);
  tabB.cards = addCard(tabB.cards, 'b', 'Q', 'A', today);
  assert.equal(saveSlice(storage, 'cards', tabB.cards), true);
  assert.deepEqual(loadState(storage), { timer, tasks: tabA.tasks, cards: tabB.cards });

  assert.equal(saveSlice(storage, 'tasks', []), true);
  assert.deepEqual(loadState(storage), { timer, tasks: [], cards: tabB.cards });
});

test('migration removes the legacy key without overwriting existing slices', () => {
  const timer = toggleTimer(createTimer(), 0);
  const cards = addCard([], 'b', 'Q', 'A', today);
  const storage = store(JSON.stringify({ timer, tasks: addTask([], 'old', fields), cards }));
  assert.equal(saveSlice(storage, 'tasks', []), true);
  assert.deepEqual(loadState(storage), { timer, tasks: [], cards });
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.deepEqual(loadState(storage), { timer, tasks: [], cards });
});

test('migration retains the legacy key until a failed slice write can be retried', () => {
  const state = { timer: createTimer(), tasks: addTask([], 'a', fields), cards: [] };
  const legacy = JSON.stringify(state);
  const storage = store(legacy);
  const setItem = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === `${STORAGE_KEY}.tasks`) throw new Error('No storage space');
    setItem(key, value);
  };
  assert.deepEqual(loadState(storage), state);
  assert.equal(storage.getItem(STORAGE_KEY), legacy);
  storage.setItem = setItem;
  assert.deepEqual(loadState(storage), state);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('storage handles corrupted, partly malformed and inaccessible data', () => {
  const initial = { timer: createTimer(), tasks: [], cards: [] };
  for (const raw of [null, '{broken', 'null', '"string"']) assert.deepEqual(loadState(store(raw)), initial);
  const tasks = addTask([], 'a', fields);
  assert.deepEqual(loadState(store(JSON.stringify({
    timer: { focus: 0, log: [null, { minutes: 25, endedAt: 25 * MINUTE }] },
    tasks: [...tasks, null], cards: [{ id: 'x', due: today }],
  }))), { ...initial, tasks, timer: { ...initial.timer, log: [{ minutes: 25, endedAt: 25 * MINUTE }] } });
  const inaccessible = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  assert.deepEqual(loadState(inaccessible), initial);
  assert.equal(saveSlice(inaccessible, 'timer', initial.timer), false);
});

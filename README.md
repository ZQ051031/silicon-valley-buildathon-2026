# StudySprint

StudySprint is a local-first study desk for turning a study goal into a task, giving it a focus block, and remembering what you learned. It runs entirely in your browser: no accounts, backend, API calls, third-party assets, or build step.

## Run it locally

From the repository root, run:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000/>. Use a local server rather than opening `index.html` directly; browsers can block ES module imports from `file://`.

## Publish with GitHub Pages

Once the app is merged into `main`, a repository maintainer can open **Settings → Pages**, choose **Deploy from a branch**, select **main** and **/ (root)**, and save. After Pages finishes publishing, follow the URL shown in Settings. The site uses relative paths and works under a repository subdirectory without changing any files.

## Features

- **Focus timer** — Set the focus and break lengths (1–180 whole minutes), start, pause, resume, or reset. Finished focus blocks increment the counter and record their duration and end time. The next phase waits for you to start it. Saving new lengths resets the current phase.
- **Task planner** — Add, edit, complete, reopen, or delete tasks. Choose a priority and an optional due date, then filter by All, Open, Due today (including overdue), or Done.
- **Spaced review** — Create question/answer cards and practice from the oldest due date first. Reveal the answer, then rate your recall: **Again** returns the card tomorrow, **Hard** schedules at least 2 days (or 1.5× the previous interval, rounded up), and **Easy** schedules at least 4 days (or 2× the previous interval). Intervals top out at 365 days, and dates follow your local calendar.

Timer state, logs, tasks, and cards are stored in `localStorage` on the current browser and site origin. They survive reloads but do not sync between browsers or devices. Clearing site data removes them.

## Testing Notes

Run the dependency-free tests with Node.js 20 or newer:

```sh
npm test
```

**Result: 13 passed, 0 failed** (Node.js 22). The tests cover timer pause/resume, reset, exact deadlines and one-time logging; task CRUD, filters, blank inputs, and invalid dates; all three review ratings, leap-day rollover and interval bounds; and storage round-trips, stale tabs, corrupt data, and unavailable storage.

**Browser verification:** In headless Chrome, exercised all three tools, reloaded during a running timer and after saving tasks and cards, advanced to the next day to check the review queue, and exercised the review flow at 390 px wide with no horizontal overflow. No console errors or external requests were observed.

**Iteration:** The first browser check clicked the completion checkbox but then waited for it to stay visible. In the **Due today** filter, completing it correctly removes it. The revised check verifies that it disappears from **Due today**, appears checked in **Done**, and stays checked after reload.

**Two-tab fix:** After reproducing a task lost when another tab saved a card, we stored timer, planner, and review data separately and verified both changes survived reload.

The [timed demo script](./DEMO_SCRIPT.md) walks through the three tools in 2 minutes 35 seconds.

## Reused components and license

None. StudySprint uses original HTML, CSS, JavaScript and an SVG brand mark, along with standard browser APIs, system fonts, and Node's built-in test runner. There are no bundled libraries or frameworks. The project is licensed under the [MIT License](./LICENSE).

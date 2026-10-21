# Daily Workout

An installable web app (PWA) that proposes a daily workout, paces your progression toward the goals you set, and logs your sessions. It runs fully offline and stores everything on your phone.

## Install on Android
1. Open the site in Chrome.
2. Menu (⋮) → **Add to Home screen** (or **Install app**).
3. Launch it from the home screen and follow the setup.

## How it works
- Rotating plan with rest days (workout A, workout B, rest), about 5 training days a week.
- Each exercise has a start, a goal and a target date. Sessions are paced to reach the goal on time and adjust to what you log.
- Skipped a workout? **Push to tomorrow** shifts everything one day.
- Data lives in the browser's local storage on your device. Use **Settings → Export backup** to keep a copy.

## Develop
```
npm start      # serves on http://localhost:8080
npm test       # logic tests (Node)
```
No build step. Open `tests.html` to run the same tests in a browser.

## Shipping an update
Change the code, bump `CACHE` in `sw.js` (e.g. `workout-v5`), commit and push. Installed copies pick up the new version the next time they open online.

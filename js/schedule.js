// Rotating queue with rest days. State fields used:
//   rotation[]   e.g. ['A','B','R',...]
//   queueIndex   index of the entry that is next
//   anchorDate   date that entry is scheduled for (YYYY-MM-DD)
//   stretchDone  dates on which daily stretching was done
import { WORKOUTS } from './seed.js';

const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

export const todayStr = (d = new Date()) => fmt(d);
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
export const diffDays = (a, b) => {
  const [ya, ma, da] = a.split('-').map(Number), [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 864e5);
};
const maxDate = (a, b) => (a > b ? a : b);

// Rest days pass by themselves: once their date is behind us the queue moves on.
// Workouts never auto-skip; they wait until done or pushed.
export function normalize(state, today) {
  let changed = false;
  const n = state.rotation.length;
  for (let i = 0; i < n && state.rotation[state.queueIndex] === 'R' && state.anchorDate < today; i++) {
    state.queueIndex = (state.queueIndex + 1) % n;
    state.anchorDate = addDays(state.anchorDate, 1);
    changed = true;
  }
  return changed;
}

// status: 'today' | 'pending' (scheduled earlier, still waiting) | 'later' (done/pushed, next is in the future)
export function currentEntry(state, today) {
  const entry = state.rotation[state.queueIndex % state.rotation.length];
  const status = state.anchorDate > today ? 'later' : state.anchorDate < today ? 'pending' : 'today';
  return { entry, date: state.anchorDate, status };
}

// Finishing a workout: the next queue entry is tomorrow.
export function completeEntry(state, today) {
  state.queueIndex = (state.queueIndex + 1) % state.rotation.length;
  state.anchorDate = addDays(today, 1);
}

// Push to tomorrow: the queue does not advance, so everything after shifts one day.
export function pushEntry(state, today) {
  state.anchorDate = addDays(maxDate(state.anchorDate, today), 1);
}

const effAnchor = (state, today) => maxDate(state.anchorDate, today);

export function entryOn(state, date, today) {
  const k = diffDays(effAnchor(state, today), date);
  if (k < 0) return null;
  return state.rotation[(state.queueIndex + k) % state.rotation.length];
}

const trainsOn = (entry, id) => !!entry && entry !== 'R' && !!WORKOUTS[entry] && WORKOUTS[entry].exercises.includes(id);

// Number of sessions of an exercise from `from` through `to` (inclusive), following the queue.
// Stretching happens daily, so it counts days instead.
export function countSessions(state, id, from, to) {
  if (to < from) return 0;
  if (id === 'stretch') {
    const start = (state.stretchDone || []).includes(from) ? addDays(from, 1) : from;
    return Math.max(0, diffDays(start, to) + 1);
  }
  const days = Math.min(diffDays(from, to), 1500);
  let c = 0;
  for (let i = 0; i <= days; i++) if (trainsOn(entryOn(state, addDays(from, i), from), id)) c++;
  return c;
}

// First date from `today` on by which `n` sessions of the exercise will have happened.
export function dateForSessions(state, id, n, today) {
  let c = 0;
  for (let i = 0; i < 1500; i++) {
    const d = addDays(today, i);
    if (id === 'stretch' ? !(i === 0 && (state.stretchDone || []).includes(today)) : trainsOn(entryOn(state, d, today), id)) c++;
    if (c >= n) return d;
  }
  return null;
}

export function parseRotation(text) {
  const tokens = text.toUpperCase().split(/[\s,]+/).filter(Boolean);
  if (!tokens.length) throw new Error('Rotation is empty');
  for (const t of tokens) if (t !== 'R' && !WORKOUTS[t]) throw new Error(`Unknown entry "${t}" (use A, B or R)`);
  if (tokens.every(t => t === 'R')) throw new Error('Rotation needs at least one workout');
  return tokens;
}

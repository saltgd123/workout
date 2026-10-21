// Goal pacing. Every goal tracks a single number ("level") that must climb from `start` to `target`
// by `targetDate`. Dumbbell goals are mapped to that single number via double progression:
//   p = (weight - w0)/wstep * R + (reps - lo),  R = hi - lo
// i.e. each rep inside the range is one unit, and +5 lb equals one full range of reps.
import { EXERCISES, DEFAULT_GOALS } from './seed.js';
import { countSessions, dateForSessions, diffDays } from './schedule.js';

export const SETS = 3;
export const EPS = 1e-9;
// Largest increase per session before the pace is flagged as unrealistic.
const LIMIT = { reps: 2, seconds: 10, db: 2, inches: 0.25 };

export const unitOf = kind => (kind === 'seconds' ? 5 : kind === 'inches' ? 0.5 : 1);
const roundTo = (x, u) => Math.round(x / u) * u;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function dbP(g, weight, reps) {
  return ((weight - g.w0) / g.wstep) * (g.hi - g.lo) + (reps - g.lo);
}
export function pToDb(g, p) {
  const R = g.hi - g.lo;
  p = Math.round(p);
  const k = Math.floor(p / R);
  return { weight: g.w0 + k * g.wstep, reps: g.lo + p - k * R };
}
// Chart-friendly: the weight you'd be lifting at the bottom of the rep range.
export const dbEquivLb = (g, p) => g.w0 + (p / (g.hi - g.lo)) * g.wstep;

export function makeGoal(id, input, today) {
  const ex = EXERCISES[id];
  const base = { id, kind: ex.kind, startDate: today, targetDate: input.targetDate };
  if (ex.kind === 'db') {
    const R = ex.hi - ex.lo;
    const startReps = Math.min(input.startReps, ex.hi);
    const lo = Math.min(ex.lo, startReps);
    const g = { ...base, w0: input.startWeight, wstep: ex.wstep, lo, hi: lo + R,
      startWeight: input.startWeight, startReps };
    g.targetWeight = input.targetWeight;
    g.targetReps = Math.min(input.targetReps, g.hi);
    g.start = startReps - lo;
    g.target = dbP(g, g.targetWeight, g.targetReps);
    g.current = g.level = g.start;
    g.last = { weight: g.startWeight, reps: startReps };
    return g;
  }
  return { ...base, start: input.start, target: input.target, current: input.start, level: input.start };
}

// A pending goal has a target but no starting level yet: the first session is a max test.
// tgt = {target} or {targetWeight, targetReps}.
export function makePendingGoal(id, tgt, targetDate, today) {
  return { id, kind: EXERCISES[id].kind, pending: true, tgt, targetDate, startDate: today };
}

// Turn a pending goal into a real one from the logged test set(s). Returns null if nothing usable was logged.
export function resolveTest(g, sets, today) {
  const input = { targetDate: g.targetDate };
  if (g.kind === 'db') {
    const best = sets.filter(s => s.weight > 0 && s.reps > 0)
      .sort((a, b) => b.weight - a.weight || b.reps - a.reps)[0];
    if (!best) return null;
    Object.assign(input, { startWeight: best.weight, startReps: best.reps, ...g.tgt });
  } else {
    const key = g.kind === 'seconds' ? 'seconds' : 'reps';
    const best = Math.max(0, ...sets.map(s => +s[key] || 0));
    if (best <= 0) return null;
    Object.assign(input, { start: best, ...g.tgt });
  }
  return makeGoal(g.id, input, today);
}

export const isReached = g => !g.pending && g.current >= g.target - EPS;

// What to do next session (and how the goal is tracking).
export function planFor(state, id, today) {
  const g = state.goals[id];
  if (!g) return null;
  const u = unitOf(g.kind);
  const left = countSessions(state, id, today, g.targetDate);
  if (g.pending) {
    const sets = [g.kind === 'db' ? { weight: DEFAULT_GOALS[id].startWeight } : {}];
    return { id, name: EXERCISES[id].name, kind: g.kind, g, left, reached: false, pending: true, r: 0, P: null, sets, status: 'pending', warn: null, hold: null };
  }
  const reached = isReached(g);
  const need = Math.max(0, g.target - g.level);
  const r = reached ? 0 : left > 0 ? need / left : need; // required gain per remaining session
  let P = reached ? g.target : Math.min(g.target, roundTo(g.level + r, u));
  if (g.kind === 'reps') P = Math.max(1, P);

  let sets = [];
  if (g.kind === 'db') {
    const { weight, reps } = pToDb(g, P);
    sets = Array.from({ length: SETS }, () => ({ weight, reps }));
  } else if (g.kind === 'reps' || g.kind === 'seconds') {
    const key = g.kind === 'reps' ? 'reps' : 'seconds';
    const low = Math.max(g.kind === 'reps' ? 1 : u, roundTo(P * 0.8, u));
    sets = [P, low, low].map(v => ({ [key]: v }));
  }

  // On track? Compare with the straight line from start to target.
  const total = Math.max(1, diffDays(g.startDate, g.targetDate));
  const frac = clamp(diffDays(g.startDate, today) / total, 0, 1);
  const expected = g.start + (g.target - g.start) * frac;
  const tol = Math.max(u, Math.abs(g.target - g.start) * 0.05);
  const status = reached ? 'reached'
    : today > g.targetDate ? 'overdue'
    : g.current >= expected + tol ? 'ahead'
    : g.current >= expected - tol ? 'on' : 'behind';

  let warn = null;
  const limit = LIMIT[g.kind];
  if (!reached && r > limit + EPS) {
    const n = Math.ceil((g.target - g.level) / limit);
    warn = { perSession: r, limit, suggestDate: dateForSessions(state, id, n, today) };
  }

  const hold = id === 'stretch' ? Math.min(60, 30 + 5 * Math.floor(Math.max(0, diffDays(g.startDate, today)) / 14)) : null;
  return { id, name: EXERCISES[id].name, kind: g.kind, g, left, reached, r, P, sets, status, warn, hold, expected };
}

// Pull the comparable result out of what was logged. Returns null when nothing was logged.
// Reps/seconds: best set. Dumbbells: the weakest set, since every set has to hit the target.
export function actualOf(g, sets) {
  if (g.kind === 'db') {
    const ps = sets.filter(s => s.reps > 0 && s.weight > 0).map(s => ({ p: dbP(g, s.weight, s.reps), s }));
    if (!ps.length) return null;
    const worst = ps.reduce((a, b) => (b.p < a.p ? b : a));
    return { value: worst.p, last: { weight: worst.s.weight, reps: worst.s.reps } };
  }
  const key = g.kind === 'seconds' ? 'seconds' : 'reps';
  const best = Math.max(0, ...sets.map(s => +s[key] || 0));
  return best > 0 ? { value: best } : null;
}

// Hit the prescription: level advances along the plan (or jumps to what you really did).
// Missed it: re-pace from what you actually did.
export function applyResult(g, prescribed, actual, r) {
  g.current = actual.value;
  if (actual.last) g.last = actual.last;
  g.level = actual.value >= prescribed - EPS
    ? Math.min(g.target, Math.max(actual.value, g.level + r))
    : actual.value;
}

export function logReach(g, inches) {
  g.current = g.level = inches;
}

// Rough session length in minutes: ~40 s of work per set, the exercise's rest between sets,
// plus ~30 s to set up each exercise. Excludes the daily stretching.
export function estimateMinutes(exerciseIds) {
  const WORK = 40, SETUP = 30;
  const sec = exerciseIds.reduce((t, id) => t + SETS * (WORK + (EXERCISES[id].rest ?? 60)) + SETUP, 0);
  return Math.round(sec / 60);
}

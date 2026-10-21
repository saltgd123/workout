import { DEFAULT_ROTATION, EXERCISES, ORDER, DEFAULT_GOALS, DEFAULT_WEEKS } from './seed.js';
import { makeGoal } from './progression.js';
import { todayStr, addDays } from './schedule.js';

const KEY = 'workout.v1';

export function defaultState() {
  return {
    version: 1,
    setup: false,
    rotation: [...DEFAULT_ROTATION],
    queueIndex: 0,
    anchorDate: null,
    goals: {},
    goalHistory: [],
    logs: [],        // {date, workoutId, status:'done'|'pushed', sets, results}
    reaches: [],     // {date, inches}
    stretchDone: [], // dates
  };
}

// Bring older saved data in line with the current exercise list: drop goals for removed
// exercises and add default goals for new ones (old logs are kept as history).
function migrate(s) {
  if (!s.setup) return s;
  const today = todayStr();
  for (const id of Object.keys(s.goals)) if (!EXERCISES[id]) delete s.goals[id];
  for (const id of ORDER) {
    if (s.goals[id]) continue;
    const d = DEFAULT_GOALS[id], targetDate = addDays(today, DEFAULT_WEEKS * 7);
    s.goals[id] = makeGoal(id, EXERCISES[id].kind === 'db'
      ? { startWeight: d.startWeight, startReps: d.startReps, targetWeight: d.goalWeight, targetReps: d.goalReps, targetDate }
      : { start: d.start, target: d.goal, targetDate }, today);
  }
  return s;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrate({ ...defaultState(), ...JSON.parse(raw) }) : defaultState();
  } catch {
    return defaultState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.warn('Could not save', e);
    return false;
  }
}

export const clearAll = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

export const exportJSON = state => JSON.stringify(state, null, 2);

export function parseImport(text) {
  const s = JSON.parse(text);
  if (!s || s.version !== 1 || typeof s.goals !== 'object' || !Array.isArray(s.rotation)) {
    throw new Error('This is not a valid backup file');
  }
  return migrate({ ...defaultState(), ...s });
}

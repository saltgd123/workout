// Run in the terminal with `node tests.js`, or open tests.html in a browser.
import { defaultState } from './js/store.js';
import { addDays, normalize, currentEntry, completeEntry, pushEntry, countSessions, parseRotation } from './js/schedule.js';
import { makeGoal, makePendingGoal, resolveTest, isReached, planFor, actualOf, applyResult, dbP, pToDb, estimateMinutes } from './js/progression.js';
import { WORKOUTS } from './js/seed.js';

const T = '2026-01-05';
const results = [];
const check = (name, ok, extra = '') => results.push({ name, ok: !!ok, extra });

function fresh() {
  const s = defaultState();
  s.setup = true;
  s.anchorDate = T;
  return s;
}
function withGoal(s, id, input) {
  s.goals[id] = makeGoal(id, { targetDate: addDays(T, 84), ...input }, T);
  return s;
}

export function runTests() {
  results.length = 0;

  // --- schedule ---
  let s = fresh();
  check('starts on workout A today', currentEntry(s, T).entry === 'A' && currentEntry(s, T).status === 'today');
  completeEntry(s, T);
  check('completing advances queue; next is tomorrow', s.queueIndex === 1 && s.anchorDate === addDays(T, 1) && currentEntry(s, T).status === 'later');

  s = fresh();
  pushEntry(s, T);
  check('push keeps the same workout but moves it to tomorrow', s.queueIndex === 0 && s.anchorDate === addDays(T, 1));
  check('pushed workout is not "today" any more', currentEntry(s, T).status === 'later');
  check('pushed workout becomes today tomorrow', currentEntry(s, addDays(T, 1)).status === 'today');

  s = fresh();
  check('pending workout never auto-skips', (normalize(s, addDays(T, 3)), currentEntry(s, addDays(T, 3)).entry === 'A' && currentEntry(s, addDays(T, 3)).status === 'pending'));
  pushEntry(s, addDays(T, 3));
  check('pushing a late workout lands on the day after today', s.anchorDate === addDays(T, 4));

  s = fresh();
  s.rotation = ['R', 'A'];
  normalize(s, addDays(T, 1));
  check('rest day passes on its own', s.rotation[s.queueIndex] === 'A' && s.anchorDate === addDays(T, 1));

  s = fresh();
  check('push-ups appear 3x in the first 5 days', countSessions(s, 'pushup', T, addDays(T, 4)) === 3);
  pushEntry(s, T);
  check('after a push they appear 2x in the same window', countSessions(s, 'pushup', T, addDays(T, 4)) === 2);
  check('stretching counts every day', countSessions(fresh(), 'stretch', T, addDays(T, 6)) === 7);
  check('rotation parser accepts "A b, r"', parseRotation('A b, r').join('') === 'ABR');
  check('rotation parser rejects junk', (() => { try { parseRotation('A X'); return false; } catch { return true; } })());

  // --- progression ---
  s = withGoal(fresh(), 'pushup', { start: 10, target: 40 });
  let p = planFor(s, 'pushup', T);
  check('first push-up prescription is a small step up', p.P >= 10 && p.P <= 12, `P=${p.P}`);
  check('on track at the start, no warning', p.status === 'on' && !p.warn);
  check('push-up sets: top set then ~80%', p.sets.length === 3 && p.sets[1].reps === Math.round(p.P * 0.8));

  s = withGoal(fresh(), 'pushup', { start: 10, target: 100, targetDate: addDays(T, 7) });
  p = planFor(s, 'pushup', T);
  check('unrealistic goal gets a warning and a later date', p.warn && p.warn.suggestDate > addDays(T, 7), JSON.stringify(p.warn));

  // hitting the prescription advances; missing it re-paces from actual
  s = withGoal(fresh(), 'pushup', { start: 10, target: 40 });
  let g = s.goals.pushup;
  p = planFor(s, 'pushup', T);
  applyResult(g, p.P, actualOf(g, [{ reps: p.P }, { reps: 8 }, { reps: 8 }]), p.r);
  check('hit: level moves up', g.level > 10 && g.current === p.P, `level=${g.level}`);
  p = planFor(s, 'pushup', T);
  applyResult(g, p.P, actualOf(g, [{ reps: 9 }]), p.r);
  check('miss: level drops to what you actually did', g.level === 9 && g.current === 9);

  // following the plan every session reaches the goal by the date
  s = withGoal(fresh(), 'pushup', { start: 10, target: 40 });
  g = s.goals.pushup;
  let day = T, guard = 0;
  while (!(g.current >= g.target) && guard++ < 200) {
    normalize(s, day);
    const cur = currentEntry(s, day);
    if (cur.entry === 'A' && cur.status !== 'later') {
      const pl = planFor(s, 'pushup', day);
      applyResult(g, pl.P, actualOf(g, [{ reps: pl.P }]), pl.r);
      completeEntry(s, day);
    } else if (cur.entry !== 'R' && cur.status !== 'later') completeEntry(s, day);
    day = addDays(day, 1);
  }
  check('doing exactly what is prescribed reaches 40 by the target date', g.current >= 40 && day <= addDays(T, 85), `reached ${day}`);

  // dumbbell mapping
  s = withGoal(fresh(), 'curl', { startWeight: 15, startReps: 10, targetWeight: 30, targetReps: 10 });
  g = s.goals.curl;
  check('curl p mapping round-trips', JSON.stringify(pToDb(g, dbP(g, 20, 9))) === JSON.stringify({ weight: 20, reps: 9 }));
  check('reps ranges climb then weight bumps (12 reps -> next weight at 8)', JSON.stringify(pToDb(g, dbP(g, 15, 12) + 1)) === JSON.stringify({ weight: 20, reps: 9 }));
  const a = actualOf(g, [{ weight: 20, reps: 10 }, { weight: 20, reps: 8 }, { weight: 20, reps: 10 }]);
  check('dumbbell result uses the weakest set', a.last.reps === 8 && a.value === dbP(g, 20, 8));
  p = planFor(s, 'curl', T);
  check('curl prescription is weight x reps x 3', p.sets.length === 3 && p.sets[0].weight >= 15 && p.sets[0].reps > 0, JSON.stringify(p.sets[0]));

  // low starting reps shift the range down instead of breaking weight
  s = withGoal(fresh(), 'curl', { startWeight: 25, startReps: 6, targetWeight: 40, targetReps: 8 });
  p = planFor(s, 'curl', T);
  check('starting below the rep range keeps the starting weight', p.sets[0].weight === 25, JSON.stringify(p.sets[0]));

  // goal reached
  s = withGoal(fresh(), 'pushup', { start: 10, target: 40 });
  s.goals.pushup.current = 40;
  check('reached goal is flagged', planFor(s, 'pushup', T).reached && planFor(s, 'pushup', T).status === 'reached');

  // stretch goal
  s = withGoal(fresh(), 'stretch', { start: -6, target: 0 });
  p = planFor(s, 'stretch', T);
  check('stretch plan has a hold time and daily session count', p.hold === 30 && p.left === 85, `left=${p.left}`);

  // sessions fit in 30-45 minutes and both include all three ab exercises
  for (const k of ['A', 'B']) {
    const m = estimateMinutes(WORKOUTS[k].exercises);
    check(`workout ${k} estimate is 30-45 min`, m >= 30 && m <= 45, `${m} min`);
    check(`workout ${k} has crunches, rollout and leg raises`, ['crunch', 'rollout', 'legraise'].every(id => WORKOUTS[k].exercises.includes(id)));
  }
  s = withGoal(fresh(), 'rollout', { start: 5, target: 15 });
  check('abs are trained on every workout day (10 of 14 days)', countSessions(s, 'rollout', T, addDays(T, 13)) === 10);

  // --- max test (pending goals) ---
  s = fresh();
  s.goals.pushup = makePendingGoal('pushup', { target: 40 }, addDays(T, 84), T);
  p = planFor(s, 'pushup', T);
  check('pending goal: one test set, no pacing', p.pending && p.sets.length === 1 && p.status === 'pending' && !p.warn && p.P === null);
  check('pending goal is not reached', !isReached(s.goals.pushup));
  let ng = resolveTest(s.goals.pushup, [{ reps: 14 }], T);
  check('test result becomes the start, goal and date are kept', ng && ng.start === 14 && ng.current === 14 && ng.target === 40 && ng.targetDate === addDays(T, 84) && !ng.pending);
  check('empty test stays pending', resolveTest(s.goals.pushup, [{ reps: 0 }], T) === null);
  s.goals.pushup = ng;
  p = planFor(s, 'pushup', T);
  check('after the test the normal plan starts from it', !p.pending && p.P >= 14 && p.P <= 16, `P=${p.P}`);
  s.goals.curl = makePendingGoal('curl', { targetWeight: 30, targetReps: 10 }, addDays(T, 84), T);
  ng = resolveTest(s.goals.curl, [{ weight: 20, reps: 9 }], T);
  check('dumbbell test: start weight x reps, goal kept', ng.startWeight === 20 && ng.startReps === 9 && ng.targetWeight === 30 && ng.last.weight === 20);
  ng = resolveTest(makePendingGoal('pushup', { target: 40 }, addDays(T, 84), T), [{ reps: 45 }], T);
  check('testing above the goal counts as reached', isReached(ng));
  ng = resolveTest(s.goals.curl, [{ weight: 20, reps: 20 }], T);
  check('dumbbell reps above the range are capped at the top of the range', ng.startReps === 12);

  return results;
}

if (typeof document === 'undefined') {
  const r = runTests();
  for (const t of r) console.log(`${t.ok ? 'PASS' : 'FAIL'}  ${t.name}${t.ok ? '' : '  ' + t.extra}`);
  const failed = r.filter(t => !t.ok).length;
  console.log(`\n${r.length - failed}/${r.length} passed`);
  process.exit(failed ? 1 : 0);
}

import { EXERCISES, WORKOUTS, ORDER, STRETCHES, DEFAULT_GOALS, DEFAULT_WEEKS, TIPS } from './seed.js';
import { load, save, clearAll, defaultState, exportJSON, parseImport } from './store.js';
import { todayStr, addDays, diffDays, normalize, currentEntry, completeEntry, pushEntry, parseRotation } from './schedule.js';
import { planFor, makeGoal, makePendingGoal, resolveTest, isReached, actualOf, applyResult, logReach, dbEquivLb, estimateMinutes } from './progression.js';

let state = load();
let tab = 'today';
let histEx = 'pushup';
let doAnyway = false;
let wizard = null;   // first-run setup progress
let editing = null;  // goal id being edited on the Goals tab

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

// ---------- helpers ----------
const num = v => Math.round(v * 10) / 10;
const fmtDate = s => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtDateLong = s => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stepFor = kind => (kind === 'inches' ? 0.5 : kind === 'seconds' ? 5 : 1);

function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove('show'), 3200);
}

function valStr(g, which) {
  if (g.kind === 'db') {
    if (which === 'start') return `${g.startWeight} lb × ${g.startReps}`;
    if (which === 'target') return `${g.targetWeight} lb × ${g.targetReps}`;
    return `${g.last.weight} lb × ${g.last.reps}`;
  }
  const v = g[which];
  if (g.kind === 'seconds') return `${num(v)} s`;
  if (g.kind === 'inches') return `${v > 0 ? '+' : ''}${num(v)}"`;
  return `${num(v)} reps`;
}

function pendingTarget(g) {
  const t = g.tgt;
  if (g.kind === 'db') return `${t.targetWeight} lb × ${t.targetReps}`;
  if (g.kind === 'seconds') return `${t.target} s`;
  if (g.kind === 'inches') return `${t.target > 0 ? '+' : ''}${t.target}"`;
  return `${t.target} reps`;
}

function setSummary(p) {
  if (p.kind === 'db') return `${p.sets.length} × ${p.sets[0].reps} @ ${p.sets[0].weight} lb`;
  const key = p.kind === 'seconds' ? 'seconds' : 'reps';
  return p.sets.map(s => s[key]).join(' / ') + (p.kind === 'seconds' ? ' s' : ' reps');
}

const STATUS = {
  reached: ['Goal reached 🎉', 'good'], ahead: ['Ahead of pace', 'good'], on: ['On track', 'ok'],
  behind: ['Behind pace', 'bad'], overdue: ['Past target date', 'bad'], pending: ['Max test next session', 'ok'],
};
const chip = status => `<span class="chip ${STATUS[status][1]}">${STATUS[status][0]}</span>`;

function warnHTML(p) {
  if (!p.warn) return '';
  const unit = p.kind === 'inches' ? '" per day' : p.kind === 'seconds' ? ' s per session' : p.kind === 'db' ? ' rep-steps per session' : ' reps per session';
  return `<p class="warn">⚠ This date needs about +${num(p.warn.perSession)}${unit}, which is aggressive.` +
    (p.warn.suggestDate ? ` A safer date is ${fmtDateLong(p.warn.suggestDate)}.` : '') + `</p>`;
}

// ---------- render ----------
function render() {
  const today = todayStr();
  $nav.hidden = !state.setup;
  if (!state.setup) return renderSetup(today);
  if (normalize(state, today)) save(state);
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  ({ today: renderToday, goals: renderGoals, history: renderHistory, settings: renderSettings }[tab])(today);
}

// ---------- first-run setup ----------
function inp(label, name, value, attrs = '') {
  return `<label>${label}<input name="${name}" data-f="${name}" value="${value ?? ''}" inputmode="decimal" ${attrs}></label>`;
}

const defaultAnswer = (id, date) => {
  const d = DEFAULT_GOALS[id];
  return { mode: EXERCISES[id].kind === 'inches' ? 'known' : 'test', sw: d.startWeight, sr: d.startReps, gw: d.goalWeight, gr: d.goalReps, start: d.start, goal: d.goal, date };
};
const isKnown = (id, a) => a.mode === 'known' || EXERCISES[id].kind === 'inches';

function buildGoal(id, a, today) {
  const ex = EXERCISES[id], v = k => parseFloat(a[k]);
  if (ex.kind === 'db') {
    const t = { targetWeight: v('gw'), targetReps: v('gr') };
    return isKnown(id, a) ? makeGoal(id, { startWeight: v('sw'), startReps: v('sr'), ...t, targetDate: a.date }, today)
      : makePendingGoal(id, t, a.date, today);
  }
  return isKnown(id, a) ? makeGoal(id, { start: v('start'), target: v('goal'), targetDate: a.date }, today)
    : makePendingGoal(id, { target: v('goal') }, a.date, today);
}

function validateAnswer(id, a) {
  const ex = EXERCISES[id], today = todayStr(), n = k => parseFloat(a[k]);
  if (!a.date || a.date <= today) return 'Pick a target date in the future';
  const known = isKnown(id, a);
  if (ex.kind === 'db') {
    if ([n('gw'), n('gr')].some(Number.isNaN) || n('gw') <= 0 || n('gr') < 1) return 'Enter your goal weight and reps';
    if (known && ([n('sw'), n('sr')].some(Number.isNaN) || n('sw') <= 0 || n('sr') < 1)) return 'Enter the weight and reps you do now';
  } else {
    if (Number.isNaN(n('goal'))) return 'Enter your goal';
    if (known && Number.isNaN(n('start'))) return 'Enter where you are now';
  }
  if (known) { const g = buildGoal(id, a, today); if (g.target <= g.start) return 'Your goal must be higher than where you are now'; }
  return null;
}

function readWizardStep() {
  const f = document.getElementById('wiz');
  if (!f || wizard.step < 1 || wizard.step > ORDER.length) return;
  const a = wizard.answers[ORDER[wizard.step - 1]];
  for (const el of f.elements) if (el.name) a[el.name] = el.value;
}

function renderSetup(today) {
  if (!wizard) wizard = { step: 0, date: addDays(today, DEFAULT_WEEKS * 7), answers: null };
  const n = ORDER.length;
  if (wizard.step === 0) {
    $view.innerHTML = `<h2>Welcome 💪</h2>
      <p class="muted">Let's set up your plan. For each of your ${n} exercises you'll tell me where you want to get to. Then either enter what you can do now, or let your first session measure it with one all-out set. The app paces every session to reach your goals on time and adjusts to what you log.</p>
      <section class="card"><label>Reach my goals by<input type="date" id="master-date" value="${wizard.date}"></label>
      <p class="muted">You can change the date for any exercise on the next screens, or later.</p></section>
      <button class="primary wide" data-action="wizStart">Let's go</button>`;
  } else if (wizard.step <= n) {
    wizardExercise(ORDER[wizard.step - 1], wizard.step, n);
  } else {
    wizardSummary(today);
  }
}

function wizardExercise(id, i, n) {
  const ex = EXERCISES[id], a = wizard.answers[id], known = isKnown(id, a);
  let start, goal;
  if (ex.kind === 'db') {
    start = `<div class="grid2">${inp('Weight you use now (lb)', 'sw', a.sw, 'type="number" step="1" min="0"')}${inp('Reps you can do', 'sr', a.sr, 'type="number" step="1" min="1"')}</div>`;
    goal = `<div class="grid2">${inp('Goal weight (lb)', 'gw', a.gw, 'type="number" step="1" min="0"')}${inp('Goal reps', 'gr', a.gr, 'type="number" step="1" min="1"')}</div>
      <p class="muted">Tracked in a ${ex.lo}–${ex.hi} rep range. Weight goes up in ${ex.wstep} lb steps.</p>`;
  } else if (ex.kind === 'inches') {
    start = inp('Current reach (inches)', 'start', a.start, 'type="number" step="0.5"');
    goal = inp('Goal reach (inches)', 'goal', a.goal, 'type="number" step="0.5"');
  } else {
    start = inp('Your max in one set', 'start', a.start, 'type="number" step="1" min="0"');
    goal = inp('Goal (reps in one set)', 'goal', a.goal, 'type="number" step="1" min="1"');
  }
  $view.innerHTML = `<form id="wiz" onsubmit="return false">
    <div class="wizbar"><span style="width:${Math.round((i / (n + 1)) * 100)}%"></span></div>
    <p class="muted">Exercise ${i} of ${n}</p>
    <h2>${ex.name}</h2>
    <p class="tip">💡 ${TIPS[id]}</p>
    ${ex.kind === 'inches' ? '' : `<div class="seg">
      <button type="button" class="${known ? '' : 'on'}" data-action="wizMode" data-mode="test">Test me in my first session</button>
      <button type="button" class="${known ? 'on' : ''}" data-action="wizMode" data-mode="known">I know my numbers</button></div>`}
    ${known ? `<section class="card"><h3>Where you are now</h3>${start}</section>`
      : `<p class="muted">At your first ${ex.name.toLowerCase()} session you'll do one all-out set. That becomes your starting point, and the plan is built from there.</p>`}
    <section class="card"><h3>Where you want to be</h3>${goal}
      <label>By<input type="date" name="date" data-f="date" value="${a.date}"></label></section>
    <div class="row"><button type="button" class="secondary" data-action="wizBack">Back</button>
      <button type="button" class="primary" data-action="wizNext">Next</button></div></form>`;
}

function wizardSummary(today) {
  const rows = ORDER.map(id => {
    const g = buildGoal(id, wizard.answers[id], today);
    const body = g.pending ? `max test first session → ${pendingTarget(g)}` : `${valStr(g, 'start')} → ${valStr(g, 'target')}`;
    return `<div class="log"><strong>${EXERCISES[id].name}</strong><br><span class="muted">${body} · by ${fmtDateLong(g.targetDate)}</span></div>`;
  }).join('');
  $view.innerHTML = `<div class="wizbar"><span style="width:100%"></span></div>
    <h2>Your plan</h2><p class="muted">Check it over. You can edit any goal later from the Goals tab.</p>${rows}
    <div class="row"><button class="secondary" data-action="wizBack">Back</button><button class="primary" data-action="wizFinish">Start training</button></div>`;
}

function wizardGo(delta) {
  wizard.step += delta;
  render();
  window.scrollTo(0, 0);
}

function onWizNext() {
  readWizardStep();
  const id = ORDER[wizard.step - 1], err = validateAnswer(id, wizard.answers[id]);
  if (err) return toast(`${EXERCISES[id].name}: ${err}`);
  wizardGo(1);
}

function onWizFinish() {
  const today = todayStr(), goals = {};
  for (const id of ORDER) goals[id] = buildGoal(id, wizard.answers[id], today);
  state = { ...defaultState(), setup: true, goals, anchorDate: today };
  state.reaches.push({ date: today, inches: goals.stretch.start });
  wizard = null;
  save(state);
  tab = 'today';
  render();
  window.scrollTo(0, 0);
}

// ---------- today ----------
function exerciseCard(p) {
  if (p.pending) {
    const row = p.kind === 'db'
      ? `<div class="set"><span>Test</span><input type="number" inputmode="decimal" data-f="weight" value="${p.sets[0].weight}" step="1" aria-label="Weight"><em>lb ×</em><input type="number" inputmode="numeric" data-f="reps" placeholder="reps" step="1" aria-label="Reps"></div>`
      : `<div class="set"><span>Test</span><input type="number" inputmode="numeric" data-f="reps" placeholder="max reps" step="1"><em>reps</em></div>`;
    return `<section class="card ex" data-ex="${p.id}">
      <h3>${p.name} <span class="badge">🧪 Max test</span></h3>
      <p class="target"><strong>One all-out set</strong>, then rest.</p>
      <p class="muted">${TIPS[p.id]}</p>
      <p class="muted">Goal: ${pendingTarget(p.g)} by ${fmtDateLong(p.g.targetDate)}</p>${row}</section>`;
  }
  const rows = p.sets.map((s, i) => p.kind === 'db'
    ? `<div class="set" data-set="${i}"><span>Set ${i + 1}</span>
        <input type="number" inputmode="decimal" data-f="weight" value="${s.weight}" step="1" aria-label="Weight"><em>lb ×</em>
        <input type="number" inputmode="numeric" data-f="reps" value="${s.reps}" step="1" aria-label="Reps"></div>`
    : `<div class="set" data-set="${i}"><span>Set ${i + 1}</span>
        <input type="number" inputmode="numeric" data-f="${p.kind === 'seconds' ? 'seconds' : 'reps'}" value="${p.kind === 'seconds' ? s.seconds : s.reps}" step="1"><em>${p.kind === 'seconds' ? 'sec' : 'reps'}</em></div>`).join('');
  const g = p.g;
  return `<section class="card ex" data-ex="${p.id}">
    <h3>${p.name} ${p.reached ? '' : ''}${chip(p.status)}</h3>
    <p class="target">Today: <strong>${setSummary(p)}</strong></p>
    <p class="muted">Now ${valStr(g, 'current')} → goal ${valStr(g, 'target')} by ${fmtDateLong(g.targetDate)}</p>
    ${warnHTML(p)}${rows}</section>`;
}

function stretchCard(today) {
  const g = state.goals.stretch;
  const p = planFor(state, 'stretch', today);
  const done = state.stretchDone.includes(today);
  const last = state.reaches[state.reaches.length - 1];
  const due = !last || diffDays(last.date, today) >= 7;
  return `<section class="card">
    <h3>Daily stretching ${chip(p.status)}</h3>
    <ul class="plain">${STRETCHES.map(s => `<li>${s}: 2 × ${p.hold} s</li>`).join('')}</ul>
    <button class="${done ? 'secondary' : 'primary'}" data-action="stretchDone">${done ? 'Stretching done ✓ (tap to undo)' : 'Mark stretching done'}</button>
    ${due ? `<div class="reach"><p><strong>Weekly reach check.</strong> Sit, reach for your toes, and measure how far your fingertips are from them (negative = short, 0 = touching).</p>
      <div class="row"><input type="number" id="reach-input" inputmode="decimal" step="0.5" placeholder="${g.current}"><button class="primary" data-action="saveReach">Save reach</button></div></div>` : ''}
  </section>`;
}

function renderToday(today) {
  const cur = currentEntry(state, today);
  const isRest = cur.entry === 'R';
  const doneToday = state.logs.some(l => l.date === today && l.status === 'done');
  const pushedToday = !doneToday && state.logs.some(l => l.date === today && l.status === 'pushed');
  let html = `<h2>${fmtDate(today)}</h2>`;
  const showWorkout = !isRest && (cur.status !== 'later' || doAnyway);

  if (isRest && cur.status !== 'later') {
    html += `<section class="card center"><h3>Rest day 😴</h3><p class="muted">Recover. Just stretch today.</p></section>`;
  } else if (showWorkout) {
    const w = WORKOUTS[cur.entry];
    if (cur.status === 'pending') html += `<p class="banner">Your ${w.name} workout was scheduled for ${fmtDate(cur.date)} and is still waiting. Do it now or push it to tomorrow.</p>`;
    html += `<h3 class="wk">Workout ${cur.entry}: ${w.name} <span class="muted">≈ ${estimateMinutes(w.exercises)} min</span></h3>`;
    html += w.exercises.map(id => exerciseCard(planFor(state, id, today))).join('');
    html += `<div class="row sticky"><button class="primary" data-action="complete">Complete workout</button>${cur.status !== 'later' ? '<button class="secondary" data-action="push">Push to tomorrow</button>' : ''}</div>`;
  } else {
    const nextName = isRest ? 'Rest day' : `Workout ${cur.entry}: ${WORKOUTS[cur.entry].name}`;
    html += `<section class="card center"><h3>${doneToday ? 'Workout done ✓' : pushedToday ? 'Pushed to tomorrow' : 'Nothing scheduled today'}</h3>
      <p class="muted">Next up: ${nextName} on ${fmtDate(cur.date)}.</p>
      ${!isRest && !doneToday ? '<button class="secondary" data-action="doAnyway">Do it today anyway</button>' : ''}</section>`;
  }
  html += stretchCard(today);
  $view.innerHTML = html;
}

const readNum = el => { const v = parseFloat(el.value); return Number.isNaN(v) ? 0 : v; };
function collectSets(card) {
  return [...card.querySelectorAll('.set')].map(row => {
    const o = {};
    row.querySelectorAll('input').forEach(i => { o[i.dataset.f] = readNum(i); });
    return o;
  });
}

function onComplete() {
  const today = todayStr();
  const cur = currentEntry(state, today);
  const w = WORKOUTS[cur.entry];
  const plans = Object.fromEntries(w.exercises.map(id => [id, planFor(state, id, today)]));
  const sets = {}, results = {}, reachedNow = [], tested = [];
  document.querySelectorAll('.ex').forEach(card => { sets[card.dataset.ex] = collectSets(card); });
  for (const id of w.exercises) {
    const p = plans[id], g = state.goals[id];
    if (g.pending) {
      const ng = resolveTest(g, sets[id] || [], today);
      if (!ng) continue;
      state.goals[id] = ng;
      results[id] = { prescribed: null, actual: ng.current, y: ng.kind === 'db' ? dbEquivLb(ng, ng.current) : ng.current };
      tested.push(EXERCISES[id].name);
      if (isReached(ng)) reachedNow.push(EXERCISES[id].name);
      continue;
    }
    const a = actualOf(g, sets[id] || []);
    if (!a) continue;
    applyResult(g, p.P, a, p.r);
    results[id] = { prescribed: p.P, actual: a.value, y: g.kind === 'db' ? dbEquivLb(g, a.value) : a.value };
    if (!p.reached && g.current >= g.target - 1e-9) reachedNow.push(EXERCISES[id].name);
  }
  state.logs.push({ date: today, workoutId: cur.entry, status: 'done', sets, results });
  completeEntry(state, today);
  doAnyway = false;
  save(state);
  if (reachedNow.length) { tab = 'goals'; toast(`🎉 Goal reached: ${reachedNow.join(', ')}. Set a new goal below.`); }
  else if (tested.length) toast(`Max test saved for ${tested.join(', ')}. Your plan starts from there next session.`);
  else toast('Workout saved. Nice work 💪');
  render();
}

function onPush() {
  const today = todayStr();
  const cur = currentEntry(state, today);
  state.logs.push({ date: today, workoutId: cur.entry, status: 'pushed' });
  pushEntry(state, today);
  save(state);
  toast(`Pushed to ${fmtDate(state.anchorDate)}. Everything after it shifts a day.`);
  render();
}

function saveReach(value) {
  const today = todayStr();
  if (Number.isNaN(value)) return toast('Enter a number, e.g. -4');
  const g = state.goals.stretch;
  const was = g.current >= g.target - 1e-9;
  state.reaches = state.reaches.filter(r => r.date !== today);
  state.reaches.push({ date: today, inches: value });
  logReach(g, value);
  save(state);
  if (!was && g.current >= g.target - 1e-9) { tab = 'goals'; toast('🎉 Toe-touch goal reached!'); } else toast('Reach saved');
  render();
}

// ---------- goals ----------
function newGoalForm(id, g) {
  const ex = EXERCISES[id];
  const date = addDays(todayStr(), DEFAULT_WEEKS * 7);
  const fields = ex.kind === 'db'
    ? `<div class="grid2"><label>New goal weight (lb)<input type="number" data-f="gw" value="${g.targetWeight + ex.wstep}" step="1" inputmode="decimal"></label>
       <label>New goal reps<input type="number" data-f="gr" value="${g.targetReps}" step="1" inputmode="numeric"></label></div>`
    : `<label>New goal<input type="number" data-f="goal" value="${g.target + (g.kind === 'inches' ? 1 : g.kind === 'seconds' ? 30 : Math.max(5, Math.round(g.target * 0.25)))}" step="${stepFor(g.kind)}" inputmode="decimal"></label>`;
  return `<div class="newgoal" data-id="${id}"><p><strong>Set your next goal</strong></p>${fields}
    <label>New target date<input type="date" data-f="date" value="${date}"></label>
    <button class="primary" data-action="newGoal" data-id="${id}">Start new goal</button></div>`;
}

function editForm(id, g) {
  const ex = EXERCISES[id], pend = !!g.pending;
  const num1 = v => (Number.isFinite(v) ? num(v) : '');
  let fields;
  if (ex.kind === 'db') {
    fields = `<div class="grid2">${inp('Weight you use now (lb)', 'sw', pend ? '' : g.last.weight, 'type="number" step="1" min="0"')}${inp('Reps you can do', 'sr', pend ? '' : g.last.reps, 'type="number" step="1" min="1"')}
      ${inp('Goal weight (lb)', 'gw', pend ? g.tgt.targetWeight : g.targetWeight, 'type="number" step="1" min="0"')}${inp('Goal reps', 'gr', pend ? g.tgt.targetReps : g.targetReps, 'type="number" step="1" min="1"')}</div>`;
  } else {
    const st = ex.kind === 'inches' ? '0.5' : '1';
    fields = `<div class="grid2">${inp('Where you are now', 'start', pend ? '' : num1(g.current), `type="number" step="${st}"`)}${inp('Goal', 'goal', pend ? g.tgt.target : num1(g.target), `type="number" step="${st}"`)}</div>`;
  }
  return `<div class="editbox" data-id="${id}"><p><strong>Edit goal</strong></p>
    <p class="muted">${pend ? 'Leave "now" empty to keep the max test for your next session.' : 'Saving restarts the pacing from the numbers below. Your history is kept.'}</p>
    ${fields}
    <label>Target date<input type="date" data-f="date" value="${g.targetDate}"></label>
    <div class="row"><button class="primary" data-action="saveEdit" data-id="${id}">Save</button><button class="secondary" data-action="cancelEdit">Cancel</button></div>
    ${!pend && ex.kind !== 'inches' ? `<button class="secondary wide" data-action="retest" data-id="${id}">Re-test my max at the next session</button>` : ''}</div>`;
}

function renderGoals(today) {
  let html = '<h2>Goals</h2>';
  for (const id of ORDER) {
    const g = state.goals[id];
    if (!g) continue;
    const p = planFor(state, id, today);
    const editBtn = editing === id ? editForm(id, g) : `<button class="secondary wide" data-action="editGoal" data-id="${id}">Edit goal</button>`;
    if (g.pending) {
      html += `<section class="card" data-id="${id}">
        <h3>${p.name} ${chip(p.status)}</h3>
        <p>Goal: <strong>${pendingTarget(g)}</strong> by ${fmtDateLong(g.targetDate)}</p>
        <p class="muted">Your starting level will be measured with one all-out set at your next ${p.name.toLowerCase()} session.</p>
        <label>Target date<input type="date" value="${g.targetDate}" data-action="setDate" data-id="${id}"></label>
        ${editBtn}</section>`;
      continue;
    }
    const span = g.target - g.start;
    const pct = p.reached ? 100 : span > 0 ? Math.round(Math.min(1, Math.max(0, (g.current - g.start) / span)) * 100) : 0;
    html += `<section class="card" data-id="${id}">
      <h3>${p.name} ${chip(p.status)}</h3>
      <div class="trio"><div><small>Start</small>${valStr(g, 'start')}</div><div><small>Now</small><strong>${valStr(g, 'current')}</strong></div><div><small>Goal</small>${valStr(g, 'target')}</div></div>
      <div class="bar"><span style="width:${pct}%"></span></div>
      <p class="muted">${pct}% there${p.reached ? '' : ` · ${p.left} session${p.left === 1 ? '' : 's'} left`}</p>
      <label>Target date<input type="date" value="${g.targetDate}" data-action="setDate" data-id="${id}"></label>
      ${warnHTML(p)}
      ${id === 'stretch' ? `<div class="row"><input type="number" id="reach-input" inputmode="decimal" step="0.5" placeholder="Reach today (inches)"><button class="secondary" data-action="saveReach">Log reach</button></div>` : ''}
      ${p.reached ? newGoalForm(id, g) : ''}
      ${editBtn}
    </section>`;
  }
  $view.innerHTML = html;
}

function onSaveEdit(id) {
  const box = document.querySelector(`.editbox[data-id="${id}"]`);
  const f = n => { const el = box.querySelector(`[data-f="${n}"]`); return el ? parseFloat(el.value) : NaN; };
  const targetDate = box.querySelector('[data-f="date"]').value, today = todayStr();
  if (!targetDate || targetDate <= today) return toast('Pick a target date in the future');
  const old = state.goals[id], ex = EXERCISES[id];
  let ng;
  if (ex.kind === 'db') {
    const t = { targetWeight: f('gw'), targetReps: f('gr') };
    if (Number.isNaN(t.targetWeight) || Number.isNaN(t.targetReps) || t.targetWeight <= 0 || t.targetReps < 1) return toast('Enter your goal weight and reps');
    const blank = Number.isNaN(f('sw')) || Number.isNaN(f('sr'));
    if (blank && !old.pending) return toast('Enter the weight and reps you do now');
    ng = blank ? makePendingGoal(id, t, targetDate, today) : makeGoal(id, { startWeight: f('sw'), startReps: f('sr'), ...t, targetDate }, today);
  } else {
    if (Number.isNaN(f('goal'))) return toast('Enter your goal');
    const blank = Number.isNaN(f('start'));
    if (blank && !old.pending) return toast('Enter where you are now');
    ng = blank ? makePendingGoal(id, { target: f('goal') }, targetDate, today) : makeGoal(id, { start: f('start'), target: f('goal'), targetDate }, today);
  }
  if (!ng.pending && ng.target <= ng.start) return toast('Your goal must be higher than where you are now');
  state.goalHistory.push({ ...old, editedDate: today });
  state.goals[id] = ng;
  if (id === 'stretch') {
    state.reaches = state.reaches.filter(r => r.date !== today);
    state.reaches.push({ date: today, inches: ng.start });
  }
  editing = null;
  save(state);
  toast(ng.pending ? 'Goal saved. Max test at your next session.' : 'Goal updated. Pacing restarted from your new numbers.');
  render();
}

function onRetest(id) {
  const old = state.goals[id], today = todayStr();
  if (old.targetDate <= today) return toast('Set a future target date first');
  const t = old.kind === 'db' ? { targetWeight: old.targetWeight, targetReps: old.targetReps } : { target: old.target };
  state.goalHistory.push({ ...old, editedDate: today });
  state.goals[id] = makePendingGoal(id, t, old.targetDate, today);
  editing = null;
  save(state);
  toast('Okay, your next session starts with a max test.');
  render();
}

function onSetDate(id, value) {
  const today = todayStr();
  if (!value || value <= today) { toast('Pick a date in the future'); return render(); }
  state.goals[id].targetDate = value;
  save(state);
  toast('Target date updated. Pacing recalculated.');
  render();
}

function onNewGoal(id) {
  const box = document.querySelector(`.newgoal[data-id="${id}"]`);
  const f = n => parseFloat(box.querySelector(`[data-f="${n}"]`).value);
  const targetDate = box.querySelector('[data-f="date"]').value;
  const today = todayStr();
  const old = state.goals[id];
  if (!targetDate || targetDate <= today) return toast('Pick a date in the future');
  const input = old.kind === 'db'
    ? { startWeight: old.last.weight, startReps: old.last.reps, targetWeight: f('gw'), targetReps: f('gr'), targetDate }
    : { start: old.current, target: f('goal'), targetDate };
  if (Object.values(input).some(v => typeof v === 'number' && Number.isNaN(v))) return toast('Fill in the goal');
  const g = makeGoal(id, input, today);
  if (g.target <= g.start) return toast('The new goal must be higher than where you are now');
  state.goalHistory.push({ ...old, reachedDate: today });
  state.goals[id] = g;
  save(state);
  toast('New goal set 🎯');
  render();
}

// ---------- history ----------
function lineChart(points, goalY, fmtY) {
  if (!points.length) return '<p class="muted">No data yet. Log a workout to see your progress.</p>';
  const W = 320, H = 190, L = 40, R = 10, T = 12, B = 26;
  const ys = points.map(p => p.y).concat(goalY ?? []);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.1; min -= pad; max += pad;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const X = t => L + (t1 === t0 ? (W - L - R) / 2 : ((t - t0) / (t1 - t0)) * (W - L - R));
  const Y = y => T + (1 - (y - min) / (max - min)) * (H - T - B);
  const line = points.map(p => `${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const ticks = [min + pad, (min + max) / 2, max - pad];
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Progress chart">
    ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${L - 4}" y="${Y(v) + 4}" text-anchor="end">${fmtY(v)}</text>`).join('')}
    ${goalY != null ? `<line x1="${L}" x2="${W - R}" y1="${Y(goalY)}" y2="${Y(goalY)}" class="goalline"/><text x="${W - R}" y="${Y(goalY) - 4}" text-anchor="end" class="goaltxt">goal</text>` : ''}
    <polyline points="${line}" class="series"/>
    ${points.map(p => `<circle cx="${X(p.t)}" cy="${Y(p.y)}" r="3.5" class="dot"/>`).join('')}
    <text x="${L}" y="${H - 6}">${points[0].label}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${points[points.length - 1].label}</text>
  </svg>`;
}

function renderHistory() {
  const g = state.goals[histEx];
  const short = s => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const t = s => new Date(s + 'T00:00:00').getTime();
  let points;
  if (histEx === 'stretch') points = state.reaches.map(r => ({ t: t(r.date), y: r.inches, label: short(r.date) }));
  else points = state.logs.filter(l => l.status === 'done' && l.results?.[histEx]).map(l => ({ t: t(l.date), y: l.results[histEx].y, label: short(l.date) }));
  const goalY = g.pending ? null : g.kind === 'db' ? dbEquivLb(g, g.target) : g.target;
  const fmtY = v => (g.kind === 'db' ? `${Math.round(v)}lb` : g.kind === 'inches' ? `${num(v)}"` : Math.round(v));
  const note = g.kind === 'db' ? 'Weight-equivalent: lifting heavier or doing more reps both move the line up.' : '';
  const recent = [...state.logs].reverse().slice(0, 25);
  $view.innerHTML = `<h2>History</h2>
    <section class="card"><label>Exercise<select id="hist-ex">${ORDER.map(id => `<option value="${id}" ${id === histEx ? 'selected' : ''}>${EXERCISES[id].name}</option>`).join('')}</select></label>
    ${lineChart(points, goalY, fmtY)}<p class="muted">${note}</p></section>
    <h3>Recent sessions</h3>
    ${recent.length ? recent.map(l => l.status === 'pushed'
      ? `<div class="log pushed"><strong>${fmtDate(l.date)}</strong> · ${WORKOUTS[l.workoutId].name} pushed to the next day</div>`
      : `<div class="log"><strong>${fmtDate(l.date)}</strong> · ${WORKOUTS[l.workoutId].name}<br><span class="muted">${Object.entries(l.sets).map(([id, ss]) => `${EXERCISES[id]?.name ?? id}: ${ss.map(s => s.weight ? `${s.weight}×${s.reps}` : s.seconds ?? s.reps).join(', ')}`).join(' · ')}</span></div>`).join('') : '<p class="muted">Nothing logged yet.</p>'}`;
}

// ---------- settings ----------
function renderSettings() {
  $view.innerHTML = `<h2>Settings</h2>
    <section class="card"><h3>Rotation</h3>
      <p class="muted">One entry per day, repeating: A = ${WORKOUTS.A.name}, B = ${WORKOUTS.B.name}, R = rest.</p>
      <textarea id="rotation" rows="2">${state.rotation.join(' ')}</textarea>
      <button class="primary" data-action="saveRotation">Save rotation</button></section>
    <section class="card"><h3>Backup</h3>
      <p class="muted">Your data lives only on this phone. Export a backup now and then.</p>
      <div class="row"><button class="secondary" data-action="export">Export backup</button>
      <label class="btn secondary">Import backup<input type="file" id="import-file" accept="application/json" hidden></label></div></section>
    <section class="card"><h3>Reset</h3><button class="danger" data-action="reset">Erase all data</button></section>`;
}

function onSaveRotation() {
  try {
    state.rotation = parseRotation(document.getElementById('rotation').value);
    state.queueIndex = 0;
    state.anchorDate = todayStr();
    save(state);
    toast('Rotation saved. The queue restarts today.');
  } catch (e) { toast(e.message); }
  render();
}

function onExport() {
  const blob = new Blob([exportJSON(state)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `workout-backup-${todayStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function onImport(file) {
  try {
    state = parseImport(await file.text());
    save(state);
    toast('Backup restored');
    render();
  } catch (e) { toast(e.message); }
}

// ---------- events ----------
document.addEventListener('click', e => {
  const tabBtn = e.target.closest('#nav button');
  if (tabBtn) { tab = tabBtn.dataset.tab; doAnyway = false; editing = null; return render(); }
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case 'wizStart': {
      if (!wizard.date || wizard.date <= todayStr()) return toast('Pick a date in the future');
      wizard.answers = Object.fromEntries(ORDER.map(x => [x, defaultAnswer(x, wizard.date)]));
      return wizardGo(1);
    }
    case 'wizNext': return onWizNext();
    case 'wizBack': readWizardStep(); return wizardGo(-1);
    case 'wizMode': { readWizardStep(); wizard.answers[ORDER[wizard.step - 1]].mode = el.dataset.mode; return render(); }
    case 'wizFinish': return onWizFinish();
    case 'editGoal': editing = id; return render();
    case 'cancelEdit': editing = null; return render();
    case 'saveEdit': return onSaveEdit(id);
    case 'retest': return onRetest(id);
    case 'complete': return onComplete();
    case 'push': return onPush();
    case 'doAnyway': doAnyway = true; return render();
    case 'stretchDone': {
      const today = todayStr(), i = state.stretchDone.indexOf(today);
      if (i >= 0) state.stretchDone.splice(i, 1); else state.stretchDone.push(today);
      save(state); return render();
    }
    case 'saveReach': return saveReach(parseFloat(document.getElementById('reach-input').value));
    case 'newGoal': return onNewGoal(id);
    case 'saveRotation': return onSaveRotation();
    case 'export': return onExport();
    case 'reset':
      if (confirm('Erase all workouts, goals and history on this device?')) { clearAll(); state = defaultState(); tab = 'today'; render(); }
      return;
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'master-date') wizard.date = t.value;
  else if (t.id === 'hist-ex') { histEx = t.value; render(); }
  else if (t.id === 'import-file' && t.files[0]) onImport(t.files[0]);
  else if (t.dataset.action === 'setDate') onSetDate(t.dataset.id, t.value);
});

// Re-evaluate when the app is reopened on a new day.
document.addEventListener('visibilitychange', () => { if (!document.hidden && !document.activeElement?.matches?.('input, textarea')) render(); });

navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
render();

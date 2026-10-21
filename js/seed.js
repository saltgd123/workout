// Fixed exercise set, workouts and defaults. Everything else is derived from these.
// rest = seconds of rest between sets (used for the session time estimate).
export const EXERCISES = {
  pushup:   { name: 'Push-ups',                kind: 'reps', rest: 75 },
  dip:      { name: 'Dips (bench/chair)',      kind: 'reps', rest: 75 },
  press:    { name: 'Shoulder press',          kind: 'db', lo: 8, hi: 12, wstep: 5, rest: 90 },
  pullup:   { name: 'Pull-ups',                kind: 'reps', rest: 90 },
  curl:     { name: 'Bicep curls',             kind: 'db', lo: 8, hi: 12, wstep: 5, rest: 60 },
  squat:    { name: 'Squats',                  kind: 'reps', rest: 75 },
  crunch:   { name: 'Weighted crunches',       kind: 'db', lo: 10, hi: 15, wstep: 5, rest: 45 },
  rollout:  { name: 'Ab rollout',              kind: 'reps', rest: 45 },
  legraise: { name: 'Lying leg raises',        kind: 'reps', rest: 45 },
  stretch:  { name: 'Toe-touch reach',         kind: 'inches' },
};

// Display order on the Goals tab and setup screen.
export const ORDER = ['pushup', 'dip', 'press', 'pullup', 'curl', 'squat', 'crunch', 'rollout', 'legraise', 'stretch'];

// Abs are done in every workout.
export const WORKOUTS = {
  A: { name: 'Push + Abs',        exercises: ['pushup', 'dip', 'press', 'crunch', 'rollout', 'legraise'] },
  B: { name: 'Pull + Legs + Abs', exercises: ['pullup', 'curl', 'squat', 'crunch', 'rollout', 'legraise'] },
};

// 14-day queue: 10 training days + 4 rest days = 5 sessions per week on average.
export const DEFAULT_ROTATION = ['A', 'B', 'A', 'B', 'A', 'R', 'R', 'B', 'A', 'B', 'A', 'B', 'R', 'R'];

// Done every day (rest days included).
export const STRETCHES = ['Seated forward fold', 'Standing forward fold', 'Hamstring stretch (each leg)'];

export const DEFAULT_WEEKS = 12;

// Suggested starting points / goals shown in first-run setup.
export const DEFAULT_GOALS = {
  pushup:   { start: 10, goal: 40 },
  dip:      { start: 8,  goal: 25 },
  press:    { startWeight: 15, startReps: 10, goalWeight: 30, goalReps: 10 },
  pullup:   { start: 3,  goal: 10 },
  curl:     { startWeight: 15, startReps: 10, goalWeight: 30, goalReps: 10 },
  squat:    { start: 20, goal: 60 },
  crunch:   { startWeight: 10, startReps: 12, goalWeight: 30, goalReps: 12 },
  rollout:  { start: 5,  goal: 15 },
  legraise: { start: 10, goal: 25 },
  stretch:  { start: -6, goal: 0 },
};

// One-line "how to test your max" shown in setup and on a first-session test card.
export const TIPS = {
  pushup:   'Strict reps: chest down to about a fist from the floor, body in a straight line. Stop at your first sloppy rep.',
  dip:      'Hands on a bench or chair behind you, lower until your elbows reach about 90°, press back up. Stop when form breaks.',
  press:    'Pick a dumbbell weight you can press 8–12 times, with the last rep hard. Go to near-failure.',
  pullup:   'Start from a full hang and get your chin over the bar. If you cannot do one yet, choose "I know my numbers" and enter 0.',
  curl:     'Pick a dumbbell weight you can curl 8–12 times with strict form, with the last rep hard.',
  squat:    'Bodyweight squats to parallel at a steady pace. Stop when depth or form slips.',
  crunch:   'Hold a dumbbell on your chest. Pick a weight you can crunch 10–15 times with control.',
  rollout:  'Kneeling, roll out as far as you can with a flat back, then pull back in. Count clean reps only.',
  legraise: 'Lie flat with straight legs, lift to vertical and lower slowly without arching your back.',
  stretch:  'Sit with legs straight, reach for your toes and measure how far your fingertips are from them. Negative = short of your toes, 0 = touching, positive = past them.',
};

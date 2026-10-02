// settings.js — player settings as sim actions (pure).
// Implements ARCHITECTURE.md "State" › settings and the Settings screen rows.
// The UI never writes state directly; it calls game.act(setSetting, {key, value}).

export const SETTING_KEYS = Object.freeze({
  sound: 'boolean',
  haptics: 'boolean',
  colorblind: 'boolean',
  notifyHunters: 'boolean',
  notifyVats: 'boolean',
  reducedMotion: ['system', 'on', 'off'],
  notation: ['short', 'sci'],
  disabledQuestTypes: 'array',
});

export const PUZZLE_TIER_IDS = Object.freeze(['relaxed', 'steady', 'tricky', 'master']);

function ensure(state) {
  if (!state.settings || typeof state.settings !== 'object') state.settings = {};
  if (!state.settings.puzzleTier || typeof state.settings.puzzleTier !== 'object') state.settings.puzzleTier = { grading: 'relaxed' };
  return state.settings;
}

/** setSetting(state, {key, value}) -> {ok, value}. Unknown keys and bad values are refused. */
export function setSetting(state, args = {}) {
  const s = ensure(state);
  const type = SETTING_KEYS[args.key];
  if (!type) return { ok: false, reason: 'key' };
  let v = args.value;
  if (type === 'boolean') v = !!v;
  else if (type === 'array') {
    if (!Array.isArray(v)) return { ok: false, reason: 'value' };
    v = [...new Set(v.filter((x) => typeof x === 'string'))];
  } else if (Array.isArray(type) && !type.includes(v)) return { ok: false, reason: 'value' };
  s[args.key] = v;
  return { ok: true, value: v };
}

/** setPuzzleTier(state, {puzzle:'grading'|…, tier}) -> {ok}. Remembers her choice per board type. */
export function setPuzzleTier(state, args = {}) {
  const s = ensure(state);
  const puzzle = typeof args.puzzle === 'string' && args.puzzle ? args.puzzle : 'grading';
  if (!PUZZLE_TIER_IDS.includes(args.tier)) return { ok: false, reason: 'tier' };
  s.puzzleTier[puzzle] = args.tier;
  return { ok: true, tier: args.tier };
}

/** Toggle one quest type on/off (Settings › disabled quest types). */
export function toggleQuestType(state, args = {}) {
  const s = ensure(state);
  const list = Array.isArray(s.disabledQuestTypes) ? s.disabledQuestTypes : [];
  const on = list.includes(args.id);
  s.disabledQuestTypes = on ? list.filter((x) => x !== args.id) : [...list, args.id];
  return { ok: true, disabled: !on };
}

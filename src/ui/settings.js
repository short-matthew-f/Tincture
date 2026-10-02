/**
 * settings.js: the Settings screen.
 *
 * Owns: sound, haptics, reduced motion, colorblind, number notation, quest
 * type opt-outs, the two notification toggles, "Check for updates", "Add to
 * home screen", export / import / reset, and the credits line. Implements
 * ARCHITECTURE.md "UI" and "PWA and updates" and DESIGN.md "UX, notifications
 * and accessibility".
 *
 * Contract with game.js: every change calls `ctx.game.setSetting(key, value)`
 * (game.js MUST provide it: set state.settings[key] = value, then emit
 * 'change'). If it is missing but `ctx.sim.setSetting` exists, the change goes
 * through `ctx.game.act(ctx.sim.setSetting, {key, value})` instead.
 * Also needed from game.js: `exportSave() -> string|object`,
 * `importSave(text) -> true | {ok:boolean, error?:string} (or throws)`, `reset()`.
 *
 * Side effects applied here (and by `applySettings`, which app.js should also
 * call once at boot): audio.setEnabled, haptics.setEnabled,
 * html[data-motion] = system | reduced | full, html[data-colorblind] = on | off.
 * Back button: handles `[data-back]` itself via `ctx.back()` if present, else
 * `ctx.navigate('workshop')`.
 */

import { h, raw, backButton, button } from './kit.js';
import { audio as defaultAudio } from './audio.js';
import { haptics as defaultHaptics } from './haptics.js';
import { APP_VERSION, checkForUpdates, applyUpdate, isUpdateReady, onUpdateReady,
  getInstallPrompt, promptInstall, onInstallChange } from '../pwa.js';

const MOTION_ATTR = { system: 'system', on: 'reduced', off: 'full' };

/** Apply the DOM/audio/haptic side effects of a settings object. Idempotent. */
export function applySettings(settings = {}, ctx = {}) {
  const a = ctx.audio || defaultAudio;
  const hp = ctx.haptics || defaultHaptics;
  if (a && a.setEnabled) a.setEnabled(settings.sound !== false);
  if (hp && hp.setEnabled) hp.setEnabled(settings.haptics !== false);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.setAttribute('data-motion', MOTION_ATTR[settings.reducedMotion] || 'system');
    root.setAttribute('data-colorblind', settings.colorblind ? 'on' : 'off');
  }
}

// ---------------------------------------------------------------------------
// Quest type list: tolerate arrays of ids, arrays of objects, or id -> object maps.
// ---------------------------------------------------------------------------

const pretty = (id) => String(id).replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

function questTypeList(content) {
  const qt = content && content.QUEST_TYPES;
  if (!qt) return [];
  const entries = Array.isArray(qt) ? qt.map((v) => [null, v]) : Object.entries(qt);
  return entries.map(([k, v]) => {
    if (typeof v === 'string') return { id: v, label: pretty(v) };
    const id = (v && (v.id || v.type || v.key)) || k;
    const label = (v && (v.name || v.label || v.title)) || pretty(id);
    return { id, label };
  }).filter((q) => q.id);
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let root = null;
let ctx = null;
let lastSig = '';
const ui = {
  update: { status: 'idle', latest: '' },   // idle | checking | up-to-date | update-ready | downloading | offline | unsupported
  confirm: null,                            // null | 'reset' | 'import'
  pendingImport: null,                      // text of a chosen file awaiting confirm
  message: '',                              // inline one-line note under export/import
  notifNote: '',
  canInstall: false,
};

const settingsOf = (state) => (state && state.settings) || (ctx && ctx.game && ctx.game.state && ctx.game.state.settings) || {};

function setSetting(key, value) {
  const g = ctx.game;
  if (g && typeof g.setSetting === 'function') g.setSetting(key, value);
  else if (ctx.sim && typeof ctx.sim.setSetting === 'function' && g && typeof g.act === 'function') g.act(ctx.sim.setSetting, { key, value });
  else console.warn('[settings] game.setSetting is missing; cannot save', key);
  // Apply immediately; game.setSetting's change event re-renders us too.
  applySettings({ ...settingsOf(g && g.state), [key]: value }, ctx);
  render();
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

function toggleRow(key, label, hint, on, extra = '') {
  return h`<div class="setting">
    <div class="grow"><div class="label">${label}</div>${hint ? h`<div class="hint">${hint}</div>` : ''}</div>
    <button type="button" class="switch" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${label}" data-tap data-toggle="${key}"${raw(extra)}></button>
  </div>`;
}

function segRow(key, label, hint, options, current) {
  return h`<div class="setting stacked">
    <div><div class="label">${label}</div>${hint ? h`<div class="hint">${hint}</div>` : ''}</div>
    <div class="seg-control" role="group" aria-label="${label}">
      ${options.map(([value, text]) => h`<button type="button" data-tap data-seg="${key}" data-value="${value}" aria-pressed="${current === value ? 'true' : 'false'}">${text}</button>`)}
    </div>
  </div>`;
}

function updateBlock() {
  const u = ui.update;
  const ready = u.status === 'update-ready' || isUpdateReady();
  let line = '';
  if (ready) line = 'Update ready';
  else if (u.status === 'checking') line = 'Checking…';
  else if (u.status === 'up-to-date') line = 'Up to date';
  else if (u.status === 'downloading') line = 'Downloading the update…';
  else if (u.status === 'offline') line = "You're offline";
  else if (u.status === 'unsupported') line = 'Updates are not available in this browser';
  return h`<div class="setting stacked">
    <div class="row between">
      <div class="grow"><div class="label">Version ${APP_VERSION}</div>
        <div class="hint" data-update-line aria-live="polite">${line || 'Tincture updates itself quietly when you restart.'}</div></div>
      ${ready
        ? button('Restart', { variant: 'primary', small: true, attrs: { 'data-action': 'apply-update' } })
        : button('Check for updates', { small: true, attrs: { 'data-action': 'check-update' }, disabled: u.status === 'checking' })}
    </div>
  </div>`;
}

function confirmBlock(kind) {
  if (ui.confirm !== kind) return '';
  if (kind === 'reset') {
    return h`<div class="card flat" role="alertdialog" aria-label="Confirm reset">
      <div class="label">Start over from the beginning?</div>
      <div class="hint">This erases your workshop, catalog and everything else saved on this device. You may want to export a save first.</div>
      <div class="row">
        ${button('Keep playing', { block: true, cls: 'grow', attrs: { 'data-action': 'cancel-confirm' } })}
        ${button('Erase everything', { variant: 'primary', block: true, cls: 'grow', attrs: { 'data-action': 'confirm-reset' } })}
      </div>
    </div>`;
  }
  return h`<div class="card flat" role="alertdialog" aria-label="Confirm import">
    <div class="label">Replace your game with this save?</div>
    <div class="hint">Your current game on this device will be replaced. Exporting first keeps a copy.</div>
    <div class="row">
      ${button('Keep my game', { block: true, cls: 'grow', attrs: { 'data-action': 'cancel-confirm' } })}
      ${button('Use this save', { variant: 'primary', block: true, cls: 'grow', attrs: { 'data-action': 'confirm-import' } })}
    </div>
  </div>`;
}

function body(settings) {
  const s = settings;
  const quests = questTypeList(ctx.content);
  const disabled = new Set(s.disabledQuestTypes || []);
  const canVibrate = defaultHaptics.isSupported();
  const notifSupported = typeof Notification !== 'undefined';

  return h`
  <div class="card">
    <div class="card-title">Feel</div>
    ${toggleRow('sound', 'Sound', 'Soft notes for every color', s.sound !== false)}
    ${toggleRow('haptics', 'Haptics', canVibrate ? 'Gentle taps on supported phones' : 'This device does not offer vibration', s.haptics !== false)}
    ${segRow('reducedMotion', 'Reduced motion', 'Swaps movement for short fades; keeps sound and haptics',
      [['system', 'Follow phone'], ['on', 'On'], ['off', 'Off']], s.reducedMotion || 'system')}
  </div>

  <div class="card">
    <div class="card-title">Reading and playing</div>
    ${toggleRow('colorblind', 'Colorblind aids', 'Adds symbols to grading tiles and patterns to tubes and crates', !!s.colorblind)}
    ${segRow('notation', 'Number style', null, [['short', '1.2K'], ['sci', '1.2e3']], s.notation || 'short')}
  </div>

  <div class="card">
    <div class="card-title">Daily quests</div>
    <div class="hint">Untick any kind of quest you would rather not be offered.</div>
    ${quests.length
      ? quests.map((q) => h`<label class="check"><input type="checkbox" data-quest="${q.id}" ${raw(disabled.has(q.id) ? '' : 'checked')}><span class="grow">${q.label}</span></label>`)
      : h`<div class="hint">Quest types appear here once quests are unlocked.</div>`}
  </div>

  <div class="card">
    <div class="card-title">Notifications</div>
    <div class="hint">Off by default. Never about quests, events or anything else.</div>
    ${toggleRow('notifyHunters', 'Your hunters are back', null, !!s.notifyHunters)}
    ${toggleRow('notifyVats', 'Your vats are full', null, !!s.notifyVats)}
    ${!notifSupported ? h`<div class="hint">Notifications are not available in this browser.</div>` : ''}
    ${ui.notifNote ? h`<div class="hint" role="status">${ui.notifNote}</div>` : ''}
  </div>

  <div class="card">
    <div class="card-title">App</div>
    ${updateBlock()}
    ${ui.canInstall ? h`<div class="setting">
      <div class="grow"><div class="label">Add to home screen</div><div class="hint">Opens full screen and works offline</div></div>
      ${button('Add', { small: true, attrs: { 'data-action': 'install' } })}
    </div>` : ''}
  </div>

  <div class="card">
    <div class="card-title">Your save</div>
    <div class="hint">Everything is stored on this device. Export a copy to keep it safe or move to another phone.</div>
    <div class="row wrap">
      ${button('Export save', { icon: 'check', attrs: { 'data-action': 'export' } })}
      ${button('Import save', { attrs: { 'data-action': 'import' } })}
    </div>
    <input type="file" accept="application/json,.json" data-file hidden>
    ${ui.message ? h`<div class="hint" role="status">${ui.message}</div>` : ''}
    ${confirmBlock('import')}
    <hr class="divider">
    <div class="row between">
      <div class="grow"><div class="label">Reset game</div><div class="hint">Begin again with an empty workshop</div></div>
      ${ui.confirm === 'reset' ? '' : button('Reset…', { small: true, attrs: { 'data-action': 'reset' } })}
    </div>
    ${confirmBlock('reset')}
  </div>

  <p class="center muted small" style="padding:6px 0 2px">Tincture ${APP_VERSION}. Papercut art, Young Serif and Figtree type, and a note for every color.</p>`;
}

function shell() {
  return h`
    <header class="screen-head">
      ${backButton('Back')}
      <div class="titles"><div class="title">Settings</div></div>
      <div class="spacer"></div>
    </header>
    <div class="screen-body" data-settings-body></div>`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render(state) {
  if (!root || !ctx) return;
  const settings = settingsOf(state);
  const sig = JSON.stringify([settings, ui.update, ui.confirm, ui.message, ui.notifNote, ui.canInstall, isUpdateReady()]);
  if (sig === lastSig) return;
  lastSig = sig;
  const bodyEl = root.querySelector('[data-settings-body]');
  if (!bodyEl) return;
  const scroll = bodyEl.scrollTop;
  bodyEl.innerHTML = String(body(settings));
  bodyEl.scrollTop = scroll;
  applySettings(settings, ctx);
}

const refresh = () => { lastSig = ''; render(); };

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function toggleNotification(key, on) {
  ui.notifNote = '';
  if (!on) { setSetting(key, false); return; }
  if (typeof Notification === 'undefined') {
    ui.notifNote = 'This browser does not support notifications.';
    refresh();
    return;
  }
  let perm = Notification.permission;
  if (perm === 'default') {
    try { perm = await Notification.requestPermission(); } catch (e) { perm = 'denied'; }
  }
  if (perm === 'granted') setSetting(key, true);
  else {
    ui.notifNote = 'Notifications are switched off for this site in your browser settings. Turn them on there, then try again.';
    refresh();
  }
}

async function runCheck() {
  ui.update = { status: 'checking', latest: '' };
  refresh();
  let r;
  try { r = await checkForUpdates(); } catch (e) { r = { status: 'offline', latest: '' }; }
  ui.update = { status: r.status, latest: r.latest };
  refresh();
}

function downloadSave() {
  let data;
  try { data = ctx.game.exportSave(); } catch (e) { data = null; }
  if (data === null || data === undefined) { ui.message = 'Nothing to export yet.'; refresh(); return; }
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  a.href = url;
  a.download = `tincture-save-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  ui.message = 'Save exported.';
  refresh();
}

function doImport() {
  const text = ui.pendingImport;
  ui.confirm = null;
  ui.pendingImport = null;
  let res;
  try { res = ctx.game.importSave(text); } catch (e) { res = { ok: false, error: e && e.message }; }
  const ok = res === undefined || res === true || (res && res.ok !== false);
  ui.message = ok ? 'Save imported. Welcome back.' : "That file didn't look like a Tincture save, so nothing was changed.";
  if (ctx.toast) ctx.toast(ok ? 'Save imported' : 'That file is not a Tincture save. Your game is unchanged.');
  refresh();
}

function onClick(e) {
  const t = e.target.closest('button, [data-action]');
  if (!t || !root.contains(t)) return;

  if (t.hasAttribute('data-back')) {
    e.stopPropagation();
    if (typeof ctx.back === 'function') ctx.back();
    else ctx.navigate('workshop');
    return;
  }
  if (t.dataset.toggle) {
    const key = t.dataset.toggle;
    const on = t.getAttribute('aria-checked') !== 'true';
    if (key === 'notifyHunters' || key === 'notifyVats') toggleNotification(key, on);
    else setSetting(key, on);
    return;
  }
  if (t.dataset.seg) { setSetting(t.dataset.seg, t.dataset.value); return; }

  switch (t.dataset.action) {
    case 'check-update': runCheck(); break;
    case 'apply-update': applyUpdate(); break;
    case 'install':
      promptInstall().then(() => { ui.canInstall = !!getInstallPrompt(); refresh(); });
      break;
    case 'export': downloadSave(); break;
    case 'import': ui.message = ''; root.querySelector('[data-file]').click(); break;
    case 'confirm-import': doImport(); break;
    case 'reset': ui.confirm = 'reset'; ui.message = ''; refresh(); break;
    case 'confirm-reset':
      ui.confirm = null;
      try { ctx.game.reset(); ui.message = 'Fresh start. Your workshop is waiting.'; } catch (err) { ui.message = 'Reset did not complete.'; }
      refresh();
      break;
    case 'cancel-confirm': ui.confirm = null; ui.pendingImport = null; refresh(); break;
    default: break;
  }
}

function onChange(e) {
  const t = e.target;
  if (t.matches('[data-quest]')) {
    const s = settingsOf(ctx.game && ctx.game.state);
    const list = new Set(s.disabledQuestTypes || []);
    if (t.checked) list.delete(t.dataset.quest);
    else list.add(t.dataset.quest);
    setSetting('disabledQuestTypes', [...list]);
  } else if (t.matches('[data-file]')) {
    const file = t.files && t.files[0];
    t.value = '';
    if (!file) return;
    file.text().then((text) => {
      ui.pendingImport = text;
      ui.confirm = 'import';
      ui.message = '';
      refresh();
    }, () => {
      ui.message = "That file couldn't be read.";
      if (ctx.toast) ctx.toast("That file couldn't be read. Your game is unchanged.");
      refresh();
    });
  }
}

// ---------------------------------------------------------------------------
// Screen module
// ---------------------------------------------------------------------------

const screen = {
  id: 'settings',

  mount(rootEl, context) {
    root = rootEl;
    ctx = context;
    root.innerHTML = String(shell());
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    ui.canInstall = !!getInstallPrompt();
    onInstallChange((avail) => { ui.canInstall = avail; refresh(); });
    onUpdateReady(() => refresh());
    lastSig = '';
    render(ctx.game && ctx.game.state);
  },

  show() {
    if (!root) return;
    root.hidden = false;
    ui.confirm = null;
    ui.pendingImport = null;
    ui.canInstall = !!getInstallPrompt();
    refresh();
    const b = root.querySelector('[data-settings-body]');
    if (b) b.scrollTop = 0;
  },

  hide() {
    if (!root) return;
    ui.confirm = null;
    ui.pendingImport = null;
    root.hidden = true;
  },

  render,
};

export default screen;
export const id = screen.id;
export const mount = screen.mount;
export const show = screen.show;
export const hide = screen.hide;
export { render };

/**
 * pwa.js: service-worker registration, update checks and the install prompt.
 *
 * Owns: registerSW, checkForUpdates, applyUpdate, isUpdateReady,
 * getInstallPrompt, promptInstall and two tiny subscriptions used by Settings
 * (onUpdateReady, onInstallChange). Implements ARCHITECTURE.md "PWA and
 * updates". The page never reloads by itself: a new worker waits until the
 * player taps Restart, which posts SKIP_WAITING and reloads on controllerchange.
 *
 * Works with no service worker at all (file://, unsupported browsers): the
 * functions resolve to null / 'unsupported' instead of throwing.
 */

import { APP_VERSION } from './version.js';

export { APP_VERSION };

const hasWindow = typeof window !== 'undefined';
const swSupported = () =>
  hasWindow && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol);

let registration = null;
let updateReady = false;
let reloading = false;
const updateListeners = new Set();

let deferredPrompt = null;
const installListeners = new Set();

// The install prompt event can fire before the app boots, so capture it at import.
if (hasWindow) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installListeners.forEach((fn) => fn(true));
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installListeners.forEach((fn) => fn(false));
  });
}

function markReady(cb) {
  if (updateReady) return;
  updateReady = true;
  if (cb) cb();
  updateListeners.forEach((fn) => fn());
}

/**
 * Register ./sw.js. `onUpdateReady` fires once when a new version has finished
 * installing behind a running one (Settings shows "Update ready: Restart").
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
export async function registerSW({ onUpdateReady } = {}) {
  if (!swSupported()) return null;
  try {
    registration = await navigator.serviceWorker.register('./sw.js');
  } catch (e) {
    return null;
  }
  if (!registration) return null; // some hosts (automation, locked-down browsers) resolve to nothing
  const watch = (worker) => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) markReady(onUpdateReady);
    });
  };
  if (registration.waiting && navigator.serviceWorker.controller) markReady(onUpdateReady);
  watch(registration.installing);
  registration.addEventListener('updatefound', () => watch(registration.installing));
  return registration;
}

/** True once a new worker is installed and waiting. */
export function isUpdateReady() {
  return updateReady || !!(registration && registration.waiting && navigator.serviceWorker.controller);
}

/** Subscribe to "an update became ready"; returns an unsubscribe function. */
export function onUpdateReady(fn) {
  updateListeners.add(fn);
  return () => updateListeners.delete(fn);
}

function cmpVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ask the network whether a newer build exists.
 * @returns {Promise<{status:'up-to-date'|'update-ready'|'downloading'|'offline'|'unsupported', current:string, latest:string}>}
 */
export async function checkForUpdates() {
  const current = APP_VERSION;
  if (!swSupported() || !registration) {
    return { status: 'unsupported', current, latest: current };
  }
  let latest = current;
  try {
    const res = await fetch('./version.json?ts=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('version.json ' + res.status);
    const j = await res.json();
    if (j && typeof j.version === 'string') latest = j.version;
  } catch (e) {
    return { status: 'offline', current, latest: current };
  }
  try {
    await registration.update();
  } catch (e) {
    return { status: 'offline', current, latest };
  }
  // Give a freshly found worker up to 4 s to finish installing.
  const deadline = Date.now() + 4000;
  while (!registration.waiting && registration.installing && Date.now() < deadline) {
    await sleep(150);
  }
  if (registration.waiting && navigator.serviceWorker.controller) {
    markReady();
    return { status: 'update-ready', current, latest };
  }
  if (registration.installing) return { status: 'downloading', current, latest };
  if (cmpVersion(latest, current) > 0) return { status: 'update-ready', current, latest };
  return { status: 'up-to-date', current, latest };
}

/**
 * Activate the waiting worker and reload once it takes control. With no waiting
 * worker (version.json is newer but the worker has not installed yet) it just
 * reloads, since code is served network-first.
 */
export function applyUpdate() {
  if (!hasWindow) return;
  const reload = () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  };
  const waiting = registration && registration.waiting;
  if (swSupported() && waiting) {
    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
    waiting.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(reload, 3000); // safety net if controllerchange never fires
  } else {
    reload();
  }
}

/** The captured `beforeinstallprompt` event, or null when installing is not on offer. */
export function getInstallPrompt() {
  return deferredPrompt;
}

/** Subscribe to install availability changes (true = available); returns unsubscribe. */
export function onInstallChange(fn) {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

/** Show the browser's install dialog. @returns {Promise<'accepted'|'dismissed'|'unavailable'>} */
export async function promptInstall() {
  const p = deferredPrompt;
  if (!p) return 'unavailable';
  deferredPrompt = null; // a prompt event can only be used once
  try {
    p.prompt();
    const choice = await p.userChoice;
    installListeners.forEach((fn) => fn(false));
    return choice && choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch (e) {
    installListeners.forEach((fn) => fn(false));
    return 'dismissed';
  }
}

/** True when running as an installed app (standalone display mode). */
export function isStandalone() {
  return hasWindow && (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
}

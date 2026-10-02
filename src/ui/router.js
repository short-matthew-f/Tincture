/**
 * router.js: the screen stack, tab bar state, overlay stacking, back handling
 * and rAF-throttled rendering. Implements docs/UI-CONTRACT.md `ctx.navigate` /
 * `ctx.back` and ARCHITECTURE.md "UI" (tabs replace the stack; overlays stack
 * as <section>s with a back button).
 *
 *   const router = createRouter({ screens, root, tabbar, onChange, overlay })
 *   router.navigate(id, params)   tab -> stack = [id]; other -> push (or bring to top)
 *   router.back()                 modal first, then pop; on a non-workshop tab -> workshop
 *   router.current()              {id, params} on top
 *   router.stack()                copy of the stack
 *   router.isOpen(id)             id is somewhere on the stack
 *   router.requestRender(state)   rAF-throttled render of the visible screens
 *   router.renderNow(state)
 *
 * `screens` maps id -> {module, section}. Optional module flags the router
 * reads: `transparent` (the screen below stays visible and keeps rendering),
 * `fullscreen` (hides the tab bar; also `params.fullscreen`), `enter: 'fade'`
 * (no slide-up), and `reveal(state)` (called instead of render when an overlay
 * above it closes). show(params) runs each time a screen is navigated to,
 * including re-navigating to the top screen with new params; it does NOT run
 * again when an overlay above it closes (that calls reveal/render).
 *
 * Phone back button: the router keeps `history` entries in step with the stack
 * (pushState per overlay level), so popstate pops the stack.
 */

export const TABS = Object.freeze(['workshop', 'orders', 'puzzles', 'map', 'catalog']);

/** Screens that always hide the tab bar (their own bottom controls need the room). */
export const FULLSCREEN_IDS = Object.freeze(['matching', 'bench', 'commissions', 'grading', 'purify', 'packing',
  'paint', 'naming', 'phase-beat']);

export function createRouter({
  screens, root = null, tabbar = null, onChange = null, overlay = null, afterRender = null,
  tabs = TABS, home = 'workshop', history: hist = (typeof window !== 'undefined' ? window.history : null),
} = {}) {
  let stack = [];
  const errorsAt = new Map(); // screen id -> last logged error time

  const isTab = (id) => tabs.includes(id);
  const entry = (id) => screens[id];
  const mod = (id) => (entry(id) && entry(id).module) || {};

  function safe(id, method, ...args) {
    const m = mod(id);
    if (typeof m[method] !== 'function') return undefined;
    try {
      return m[method](...args);
    } catch (e) {
      const now = Date.now();
      const key = id + ':' + method;
      if (!errorsAt.has(key) || now - errorsAt.get(key) > 10e3) {
        errorsAt.set(key, now);
        console.error(`[router] ${id}.${method}() failed`, e);
      }
      return undefined;
    }
  }

  // ---------------------------------------------------------------- layout

  function layout(enteringId) {
    const ids = new Set(stack.map((s) => s.id));
    for (const [id, e] of Object.entries(screens)) {
      const sec = e.section;
      if (!sec) continue;
      const i = stack.findIndex((s) => s.id === id);
      if (i < 0) {
        sec.hidden = true;
        sec.classList.remove('is-overlay', 'is-entering', 'is-top');
        sec.style.zIndex = '';
        continue;
      }
      sec.hidden = false;
      sec.classList.toggle('is-overlay', i > 0 || !isTab(id));
      sec.classList.toggle('is-top', i === stack.length - 1);
      sec.style.zIndex = String(i === 0 ? 1 : 5 + i);
      sec.setAttribute('aria-hidden', i === stack.length - 1 ? 'false' : 'true');
      if (id === enteringId && i > 0) {
        const fade = mod(id).enter === 'fade';
        sec.classList.remove('is-entering');
        if (!fade) {
          void sec.offsetWidth;
          sec.classList.add('is-entering');
          setTimeout(() => sec.classList.remove('is-entering'), 260);
        }
      }
    }
    void ids;
    // Tab bar: current tab + hidden for fullscreen overlays.
    if (tabbar) {
      const base = stack[0] ? stack[0].id : home;
      tabbar.querySelectorAll('[data-tab]').forEach((b) => {
        if (b.dataset.tab === base) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
      });
      const full = stack.some((s) => (s.params && s.params.fullscreen) || mod(s.id).fullscreen
        || FULLSCREEN_IDS.includes(s.id));
      tabbar.hidden = !!full;
    }
  }

  function visibleIds() {
    // The top screen, plus the ones below it while the screens above are transparent.
    const out = [];
    for (let i = stack.length - 1; i >= 0; i--) {
      out.push(stack[i].id);
      if (!mod(stack[i].id).transparent) break;
    }
    return out;
  }

  // ---------------------------------------------------------------- history

  let hDepth = 0;   // entries we pushed above the base entry
  let ignore = 0;   // popstate events we caused ourselves
  let ignoreTimer = null;

  function desiredDepth() {
    const base = stack[0] ? stack[0].id : home;
    return Math.max(0, stack.length - 1) + (base !== home ? 1 : 0);
  }

  function syncHistory() {
    if (!hist || typeof hist.pushState !== 'function') return;
    if (ignore > 0) return; // a traversal is still in flight; sync when it lands
    const want = desiredDepth();
    try {
      while (hDepth < want) { hDepth++; hist.pushState({ tincture: hDepth }, ''); }
      if (hDepth > want) {
        const n = hDepth - want;
        hDepth = want;
        ignore++;
        clearTimeout(ignoreTimer);
        ignoreTimer = setTimeout(() => { ignore = 0; syncHistory(); }, 600);
        hist.go(-n);
      }
    } catch (e) { /* history unavailable (sandboxed frames): the in-app back still works */ }
  }

  function onPopState() {
    if (ignore > 0) {
      ignore--;
      if (!ignore) { clearTimeout(ignoreTimer); syncHistory(); }
      return;
    }
    hDepth = Math.max(0, hDepth - 1);
    backInternal();
    syncHistory();
  }
  if (typeof window !== 'undefined' && hist) window.addEventListener('popstate', onPopState);

  // ---------------------------------------------------------------- navigation

  function changed(enteringId) {
    layout(enteringId);
    syncHistory();
    if (onChange) { try { onChange(current(), stack.slice()); } catch (e) { console.error('[router] onChange failed', e); } }
  }

  function navigate(id, params = {}) {
    if (!entry(id)) {
      console.warn('[router] unknown screen', id);
      return false;
    }
    const p = params || {};
    const top = stack[stack.length - 1];
    if (isTab(id)) {
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].id !== id) safe(stack[i].id, 'hide');
      const wasBase = stack.length && stack[0].id === id;
      stack = [{ id, params: p }];
      changed(wasBase ? null : id);
      safe(id, 'show', p);
      renderNow();
      return true;
    }
    if (top && top.id === id) {
      top.params = p;
      changed(null);
      safe(id, 'show', p);
      renderNow();
      return true;
    }
    const at = stack.findIndex((s) => s.id === id);
    if (at >= 0) stack.splice(at, 1); // bring an open screen to the top
    if (!stack.length) stack.push({ id: home, params: {} });
    stack.push({ id, params: p });
    changed(id);
    safe(id, 'show', p);
    renderNow();
    return true;
  }

  function pop() {
    if (stack.length <= 1) return false;
    const leaving = stack.pop();
    safe(leaving.id, 'hide');
    changed(null);
    const top = stack[stack.length - 1];
    const state = lastState;
    if (typeof mod(top.id).reveal === 'function') safe(top.id, 'reveal', state);
    else if (state) safe(top.id, 'render', state);
    renderNow();
    return true;
  }

  /** Close one screen by id (wherever it is on the stack). */
  function close(id) {
    const i = stack.findIndex((s) => s.id === id);
    if (i < 0) return false;
    if (i === stack.length - 1) return pop();
    if (i === 0) return false;
    const [leaving] = stack.splice(i, 1);
    safe(leaving.id, 'hide');
    changed(null);
    return true;
  }

  function backInternal() {
    if (overlay && overlay.dismissTop && overlay.dismissTop()) return true;
    if (pop()) return true;
    if (stack[0] && stack[0].id !== home) { navigate(home); return true; }
    return false;
  }

  /** In-app back: modal first, then the top overlay, then home. */
  function back() {
    return backInternal();
  }

  function current() {
    const top = stack[stack.length - 1];
    return top ? { id: top.id, params: top.params } : null;
  }

  // ---------------------------------------------------------------- rendering

  let lastState = null;
  let rafId = 0;
  const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));

  function renderNow(state = lastState) {
    if (state) lastState = state;
    if (!lastState) return;
    for (const id of visibleIds()) safe(id, 'render', lastState);
    if (afterRender) { try { afterRender(lastState, current()); } catch (e) { console.error('[router] afterRender failed', e); } }
  }

  function requestRender(state) {
    if (state) lastState = state;
    if (rafId) return;
    rafId = raf(() => {
      rafId = 0;
      if (typeof document !== 'undefined' && document.hidden) return;
      renderNow();
    });
  }

  return {
    navigate,
    back,
    pop,
    close,
    current,
    stack: () => stack.map((s) => ({ id: s.id, params: s.params })),
    isOpen: (id) => stack.some((s) => s.id === id),
    isTab,
    requestRender,
    renderNow,
    visibleIds,
    tabs,
    root,
  };
}

export default createRouter;

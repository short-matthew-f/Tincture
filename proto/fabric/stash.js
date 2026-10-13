// stash.js — the shared fabric stash for the fiber prototypes.
//
// CONTRACT (shared by the Dye Studio, proto/dye/, and the Quilt Designer,
// proto/quilt/; keep it stable):
//
//   localStorage['tincture.proto.stash'] = { v: 1, fabrics: [Fabric] }
//
//   Fabric = {
//     id: string,            // unique
//     name: string,          // "Indigo shibori", "Madder batik no. 3"
//     base: string,          // a BASES id from textures.js (quilting-cotton, batik-cotton, linen, ...)
//     kind: string,          // how it was made: 'solid' | 'ombre' | 'print' | 'batik' | 'shibori'
//                            //   | 'tiedye' | 'ice' | 'marbled' | 'block' | 'woven'
//     color: '#rrggbb',      // dominant color, for sorting and for value/contrast checks
//     colors: ['#rrggbb'],   // the dyes/inks used (may be one)
//     img: 'data:image/...', // a square tile of the fabric (JPEG, about 384 px)
//     inches: number,        // how many inches the tile covers (so prints and batik scale
//                            //   correctly when cut into quilt pieces); default 8
//     repeat: boolean,       // true if the tile repeats seamlessly; false = a one-off piece
//                            //   (the quilt designer then mirrors/offsets it to avoid seams)
//     starter: boolean,      // part of the starter stash (can be hidden but comes back)
//     createdAt: number,     // ms since epoch (UI code only; pure modules never call Date.now)
//   }
//
// Both apps read the stash on load and listen for the 'storage' event, so a
// fabric dyed in one tab shows up in the quilt designer in another.

import { starterFabrics } from './textures.js';

export const STASH_KEY = 'tincture.proto.stash';
export const STASH_MAX = 60;

function read() {
  try {
    const s = JSON.parse(localStorage.getItem(STASH_KEY) || 'null');
    if (s && s.v === 1 && Array.isArray(s.fabrics)) return s;
  } catch { /* storage may be blocked or corrupt */ }
  return { v: 1, fabrics: [] };
}

function write(s) {
  // Keep under the browser quota: drop the oldest non-starter fabrics first.
  for (let tries = 0; tries < 30; tries++) {
    try { localStorage.setItem(STASH_KEY, JSON.stringify(s)); return true; } catch {
      const i = s.fabrics.findIndex((f) => !f.starter);
      if (i < 0) return false;
      s.fabrics.splice(i, 1);
    }
  }
  return false;
}

export function loadStash() { return read(); }

export function fabrics() { return read().fabrics; }

export function getFabric(id) { return read().fabrics.find((f) => f.id === id) || null; }

/** Adds (or replaces, by id) a fabric. Returns the stored fabric. */
export function addFabric(fabric) {
  const s = read();
  const f = { inches: 8, repeat: true, starter: false, colors: [fabric.color], ...fabric };
  const i = s.fabrics.findIndex((x) => x.id === f.id);
  if (i >= 0) s.fabrics[i] = f; else s.fabrics.push(f);
  while (s.fabrics.filter((x) => !x.starter).length > STASH_MAX) {
    const j = s.fabrics.findIndex((x) => !x.starter);
    s.fabrics.splice(j, 1);
  }
  write(s);
  return f;
}

export function removeFabric(id) {
  const s = read();
  s.fabrics = s.fabrics.filter((f) => f.id !== id);
  write(s);
}

export function renameFabric(id, name) {
  const s = read();
  const f = s.fabrics.find((x) => x.id === id);
  if (f) { f.name = name; write(s); }
}

/** Calls fn() whenever another tab changes the stash. Returns an unsubscribe function. */
export function onStashChange(fn) {
  const h = (e) => { if (e.key === STASH_KEY) fn(read()); };
  window.addEventListener('storage', h);
  return () => window.removeEventListener('storage', h);
}

export function newId(prefix = 'f') {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Makes sure the starter fabrics are in the stash (call once on load in either app). */
export function ensureStarters() {
  const s = read();
  if (s.fabrics.some((f) => f.starter)) return s;
  s.fabrics = [...starterFabrics(), ...s.fabrics];
  write(s);
  return s;
}

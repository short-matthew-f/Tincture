/**
 * version.js: the single source of the shipped app version.
 *
 * Owned by tools/bump-version.js, which rewrites this line together with
 * version.json and the CACHE_VERSION + SHELL list in sw.js. Lives here (not in
 * app.js) so pwa.js, settings.js and app.js can all import it.
 */
export const APP_VERSION = '0.1.1';

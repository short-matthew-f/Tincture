/**
 * garden-art.js: The Dye Garden's small papercut drawings shared with other
 * screens (no imports, so workshop.js can draw the unlock sheet without a cycle).
 *
 *  - artGardenBasket(filterId): the unlock sheet's drawing (viewBox '0 0 120 104'):
 *    a woven basket of dye plants by a garden gate.
 *  - gardenIcon(size): a tiny basket for the Map card and the hub card.
 */

/** The unlock sheet's drawing: a gate, and a basket brimming with marigolds, woad and madder. */
export const artGardenBasket = (f) => `<g filter="url(#${f})">
<rect x="4" y="94" width="112" height="7" rx="2" fill="#7B9A58"/>
<rect x="10" y="34" width="6" height="62" rx="2" fill="#9A6A47"/><rect x="104" y="34" width="6" height="62" rx="2" fill="#9A6A47"/>
<path d="M16 46 H104 M16 80 H104" stroke="#B98E64" stroke-width="5" fill="none"/>
<path d="M22 46 V80 M34 46 V80 M86 46 V80 M98 46 V80" stroke="#C9A277" stroke-width="3" fill="none"/>
</g>
<g filter="url(#${f})">
<path d="M34 60 C34 30 86 30 86 60" stroke="#8C6512" stroke-width="5" fill="none"/>
<circle cx="44" cy="58" r="9" fill="#E89A2C"/><circle cx="44" cy="58" r="3.5" fill="#B8642F"/>
<circle cx="60" cy="54" r="10" fill="#4F7BAE"/><circle cx="60" cy="54" r="3.5" fill="#2E3F6E"/>
<circle cx="76" cy="58" r="9" fill="#B8433A"/><circle cx="76" cy="58" r="3.5" fill="#7B2A24"/>
<circle cx="52" cy="62" r="7" fill="#E0B43C"/><circle cx="68" cy="63" r="7" fill="#DCC236"/>
<path d="M30 62 H90 L84 94 H36 Z" fill="#C99A5A"/>
<path d="M32 70 H88 M34 78 H86 M35 86 H85" stroke="#A87449" stroke-width="2.4" fill="none"/>
<path d="M44 62 V94 M56 62 V94 M68 62 V94 M80 62 V94" stroke="#B98552" stroke-width="1.6" fill="none"/>
</g>`;

/** A small basket icon (inline SVG string). */
export function gardenIcon(size = 28) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 28 28" aria-hidden="true">
<path d="M8 13 C8 5 20 5 20 13" stroke="#8C6512" stroke-width="2" fill="none"/>
<circle cx="10.5" cy="12" r="3" fill="#E89A2C"/><circle cx="14" cy="11" r="3.2" fill="#4F7BAE"/><circle cx="17.5" cy="12" r="3" fill="#B8433A"/>
<path d="M6 13 H22 L20 23 H8 Z" fill="#C99A5A"/><path d="M7 17 H21 M7.6 20 H20.4" stroke="#A87449" stroke-width="1.2" fill="none"/>
</svg>`;
}

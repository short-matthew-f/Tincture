// names.js — suggested color names, customer names and visitor comments (pure).
// Implements docs/DESIGN.md "Discovery and the catalog › Discovery moment"
// (name a new color or accept a suggestion), "Active play › Matching"
// (customers on order cards) and "The Gallery › The gallery walls" (visitor
// comments that use the names she gave her colors).

import { hexToOklch, hueFamily } from '../color.js';

// ---------------------------------------------------------------------------
// Word lists
// ---------------------------------------------------------------------------

/** Nouns by hue family and lightness band. */
const NOUNS = {
  red: {
    dark: ['Garnet', 'Wine', 'Cherry', 'Brick', 'Rosehip', 'Ember'],
    mid: ['Rose', 'Poppy', 'Brick', 'Berry', 'Clay', 'Radish', 'Cranberry'],
    light: ['Rose', 'Shell', 'Blush', 'Petal', 'Coral', 'Rosewater'],
  },
  orange: {
    dark: ['Rust', 'Copper', 'Chestnut', 'Cinnamon', 'Terracotta'],
    mid: ['Marigold', 'Apricot', 'Copper', 'Persimmon', 'Ginger', 'Pumpkin', 'Clay'],
    light: ['Peach', 'Apricot', 'Melon', 'Biscuit', 'Nectar'],
  },
  yellow: {
    dark: ['Ochre', 'Bronze', 'Mustard', 'Olive', 'Brass'],
    mid: ['Honey', 'Ochre', 'Saffron', 'Straw', 'Mustard', 'Gorse', 'Quince'],
    light: ['Butter', 'Cream', 'Primrose', 'Straw', 'Custard', 'Candle'],
  },
  green: {
    dark: ['Fern', 'Moss', 'Pine', 'Ivy', 'Holly', 'Forest'],
    mid: ['Sage', 'Fern', 'Moss', 'Willow', 'Clover', 'Lichen', 'Thyme'],
    light: ['Mint', 'Pear', 'Sprout', 'Celery', 'Pistachio', 'Meadow'],
  },
  teal: {
    dark: ['Tide', 'Spruce', 'Juniper', 'Deep Pool', 'Kelp'],
    mid: ['Teal', 'Lagoon', 'Tide', 'Harbor', 'Verdigris', 'Eucalyptus'],
    light: ['Seafoam', 'Surf', 'Mist', 'Spindrift', 'Sea Spray'],
  },
  blue: {
    dark: ['Ink', 'Navy', 'Indigo', 'Night', 'Storm', 'Deep Water'],
    mid: ['Harbor', 'Sky', 'Slate', 'Cornflower', 'Delft', 'Woad', 'River'],
    light: ['Sky', 'Ice', 'Powder', 'Cloud', 'Forget-me-not', 'Frost'],
  },
  violet: {
    dark: ['Plum', 'Damson', 'Dusk', 'Aubergine', 'Elderberry'],
    mid: ['Lilac', 'Plum', 'Heather', 'Iris', 'Violet', 'Thistle'],
    light: ['Lavender', 'Lilac', 'Thistle', 'Wisteria', 'Orchid'],
  },
  pink: {
    dark: ['Mulberry', 'Berry', 'Beetroot', 'Raspberry'],
    mid: ['Rose', 'Peony', 'Clover', 'Foxglove', 'Rhubarb'],
    light: ['Blossom', 'Petal', 'Blush', 'Sweet Pea', 'Candyfloss'],
  },
  neutral: {
    dark: ['Ink', 'Soot', 'Iron', 'Slate', 'Charcoal', 'Peat'],
    mid: ['Slate', 'Stone', 'Pewter', 'Flint', 'Ash', 'Driftwood', 'Pebble'],
    light: ['Linen', 'Chalk', 'Bone', 'Pearl', 'Dove', 'Oatmeal', 'Fog'],
  },
};

/** Adjectives by lightness band and chroma band. */
const ADJECTIVES = {
  dark: {
    muted: ['Deep', 'Smoky', 'Quiet', 'Old', 'Shadow', 'Night', 'Cellar', 'Velvet'],
    vivid: ['Deep', 'Rich', 'Royal', 'Velvet', 'Jewel', 'Midnight', 'Bold'],
  },
  mid: {
    muted: ['Dusty', 'Faded', 'Weathered', 'Quiet', 'Soft', 'Worn', 'Harbor', 'Moss', 'Field'],
    vivid: ['Bright', 'Warm', 'Bold', 'Festival', 'Meadow', 'Candle', 'Market', 'Lucky'],
  },
  light: {
    muted: ['Pale', 'Misty', 'Chalk', 'Morning', 'Linen', 'Whisper', 'Hazy', 'Quiet'],
    vivid: ['Sunny', 'Fresh', 'Sweet', 'Spring', 'Petal', 'Glad', 'Clear'],
  },
};

/** Family-flavored adjectives, mixed into the band adjectives. */
const FAMILY_ADJECTIVES = {
  red: ['Warm', 'Ember', 'Hearth'],
  orange: ['Warm', 'Harvest', 'Hearth'],
  yellow: ['Golden', 'Candle', 'Honey'],
  green: ['Meadow', 'Moss', 'Garden'],
  teal: ['Harbor', 'Tidal', 'Sea'],
  blue: ['Harbor', 'Tide', 'River'],
  violet: ['Plum', 'Dusk', 'Evening'],
  pink: ['Rosy', 'Orchard', 'Garden'],
  neutral: ['Stone', 'Quarry', 'Attic'],
};

/** Place words for the "Place Noun" pattern ("Abbey Marigold", "Quarry Slate"). */
const PLACE_WORDS = ['Abbey', 'Orchard', 'Market', 'Quarry', 'Lantern', 'Attic', 'Ferry', 'Garden', 'Mill', 'Lighthouse'];

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const NAME_RE = /^[A-Za-z][A-Za-z '\-]*$/;

/** A player-given or suggested color name: 1-24 characters of letters,
 *  spaces, apostrophes and hyphens, starting with a letter. */
export function isNameOk(s) {
  if (typeof s !== 'string') return false;
  if (s.length < 1 || s.length > 24) return false;
  if (s.trim() !== s || /\s{2,}/.test(s)) return false;
  return NAME_RE.test(s);
}

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
function roman(n) {
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out;
}

const pickFrom = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

function bands(hex) {
  const { L, C } = hexToOklch(hex);
  const family = hueFamily(hex);
  const light = L < 0.45 ? 'dark' : L > 0.75 ? 'light' : 'mid';
  const chroma = family === 'neutral' || C < 0.07 ? 'muted' : 'vivid';
  return { family, light, chroma };
}

function candidate(hex, rng) {
  const { family, light, chroma } = bands(hex);
  const nouns = NOUNS[family][light];
  const adjs = [...ADJECTIVES[light][chroma], ...FAMILY_ADJECTIVES[family]];
  const r = rng();
  if (r < 0.55) {
    // "Adj Noun"
    let adj = pickFrom(rng, adjs);
    const noun = pickFrom(rng, nouns);
    if (noun.split(' ').includes(adj)) adj = pickFrom(rng, ADJECTIVES[light][chroma]);
    return adj + ' ' + noun;
  }
  if (r < 0.75) return pickFrom(rng, nouns); // "Noun"
  const noun = pickFrom(rng, nouns);
  const place = pickFrom(rng, PLACE_WORDS);
  return noun.split(' ').includes(place) ? noun : place + ' ' + noun; // "Place Noun"
}

/**
 * suggestName(hex, rng, {taken}) -> a fresh name for a color.
 * Builds names from word lists keyed by hue family, lightness band
 * (dark/mid/light) and chroma band (muted/vivid) with three patterns
 * ("Adj Noun", "Noun", "Place Noun"). Never returns a name in `taken`
 * (compared case-insensitively): retries, then appends a roman numeral.
 */
export function suggestName(hex, rng, { taken } = {}) {
  const used = new Set();
  if (taken) for (const t of taken) used.add(String(t).toLowerCase());
  const free = (s) => isNameOk(s) && !used.has(s.toLowerCase());
  let first = null;
  for (let i = 0; i < 24; i++) {
    const s = candidate(hex, rng);
    if (!first && isNameOk(s)) first = s;
    if (free(s)) return s;
  }
  const base = first || 'New Color';
  for (let n = 2; ; n++) {
    const numeral = roman(n);
    let s = base + ' ' + numeral;
    if (s.length > 24) s = base.slice(0, 24 - numeral.length - 1).trimEnd() + ' ' + numeral;
    if (free(s)) return s;
  }
}

// ---------------------------------------------------------------------------
// Customers and visitors
// ---------------------------------------------------------------------------

/** Who orders paint (order cards, routes, commissions flavor). */
export const CUSTOMER_NAMES = Object.freeze([
  'Harbor Town', 'The Abbey', 'Master Weaver Lin', 'Widow Hollis', 'The Lighthouse Keeper',
  'Mill Lane Bakery', 'Captain Orla', 'The Village School', 'Brother Ambrose', 'The Potter\'s Guild',
  'Old Man Feeney', 'Dyer\'s Row', 'The Inn at the Ford', 'Signwriter Pell', 'The Glassworks',
  'Sister Maud', 'The Ropewalk', 'Farmer Ashby', 'The Toy Maker', 'Mapmaker Quill',
  'The Boatyard', 'Lady Ferrers', 'The Puppet Theatre', 'Miss Tamsin\'s Hats', 'The Chandlery',
  'Bookbinder Hale', 'The Harvest Fair', 'Bellringer Coyle', 'The Orchard House', 'Young Pip',
]);

/** Places that visitor comments compare her colors to. */
export const COMMENT_PLACES = Object.freeze([
  'the harbor', 'the meadow', 'the old quarry', 'the coast road', 'the jungle river', 'the volcano',
  'my grandmother\'s kitchen', 'the abbey garden', 'the orchard', 'the market square',
]);

/** Visitor comment templates; fill {color} with her name for a color and
 *  {place} with a COMMENT_PLACES entry (see fillComment). */
export const VISITOR_COMMENTS = Object.freeze([
  'The {color} reminds me of {place} at dawn.',
  'I could look at that {color} all afternoon.',
  'That {color} is exactly the color of {place} after rain.',
  'My daughter says the {color} is her new favorite.',
  'Who knew {color} could feel so calm?',
  'The {color} makes me want to go back to {place}.',
  'I came for the {color} and stayed for the whole wall.',
  'Such a brave use of {color}.',
  'The {color} glows when the sun comes through the window.',
  'It smells like {place} in here, somehow. Must be the {color}.',
  'I\'d paint my front door that {color} if I were braver.',
  'The {color} sits so happily next to its neighbors.',
  'That {color} is how I remember {place}.',
  'Grandfather stood in front of the {color} for ten minutes.',
  'The {color} feels like a warm cup of tea.',
  'I didn\'t know a {color} like that existed.',
  'This {color} belongs in {place}.',
  'The {color} corner is the best spot in the gallery.',
  'My dog sat down in front of the {color} and wouldn\'t move.',
  'The {color} is quiet, but it stays with you.',
  'Is that {color} a wild hue? It looks like {place}.',
  'I\'m going to dream about that {color} tonight.',
  'The {color} makes the whole room feel like {place}.',
  'Every time I visit, the {color} looks a little different.',
]);

/** Fill a VISITOR_COMMENTS template. */
export function fillComment(template, { color, place }) {
  return template.replace(/\{color\}/g, color).replace(/\{place\}/g, place);
}

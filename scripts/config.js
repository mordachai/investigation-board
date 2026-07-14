export const MODULE_ID = 'investigation-board';
export const DEFAULT_CONNECTION_LINE_WIDTH = 7;
export const DEFAULT_STAMP_TINT = '#990000';
export const DEFAULT_PIN_FOLDER = 'modules/investigation-board/assets/pins';
export const PIN_COLORS = [
  'redPin.webp',
  'bluePin.webp',
  'yellowPin.webp',
  'greenPin.webp',
];

export const DEFAULT_STAMP_FOLDER = 'modules/investigation-board/assets/stamps';
export const STAMP_IMAGES = [
  'classified.webp',
  'deceased.webp',
  'evidence.webp',
  'missing.webp',
  'redacted.webp',
  'x-mark.webp',
];
export const SOCKET_NAME = `module.${MODULE_ID}`;

/**
 * Single source of truth for the module's font list. `widthFactor` is the average
 * character width as a fraction of font size (used to estimate text-wrap capacity).
 * `custom: true` marks the four bundled @font-face webfonts that need to be
 * explicitly force-loaded via document.fonts.load() before PIXI can use them —
 * see MODULE_FONTS below and the `ready`/`init` hooks in main.js.
 * `file` (custom fonts only) is the module-relative asset path — used to embed the
 * font directly into PIXI.HTMLText's generated SVG via HTMLTextStyle.loadFont().
 * Without that, a document note's rasterized SVG has no @font-face of its own and
 * silently falls back to a generic font for painting (even though measurement,
 * which runs in the page's own DOM, correctly used the real font) — the fallback's
 * different line-height then overflows the box that was sized for the real font,
 * and the excess is clipped with no error. See custom-drawing.js's document body
 * rendering for where this gets called.
 */
export const FONTS = [
  { name: "Rock Salt",            widthFactor: 0.72, custom: true, file: "rock_salt.ttf" },
  { name: "Caveat",               widthFactor: 0.50, custom: true, file: "caveat.ttf" },
  { name: "Courier New",          widthFactor: 0.60, custom: false },
  { name: "Times New Roman",      widthFactor: 0.55, custom: false },
  { name: "Signika",              widthFactor: 0.55, custom: false },
  { name: "Arial",                widthFactor: 0.55, custom: false },
  { name: "Typewriter Condensed", widthFactor: 0.45, custom: true, file: "typewcond_regular.otf" },
  { name: "IB Special Elite",     widthFactor: 0.68, custom: true, file: "SpecialElite-Regular.ttf" },
];

/** Bundled custom webfonts that need explicit document.fonts.load() force-loading. */
export const MODULE_FONTS = FONTS.filter(f => f.custom).map(f => f.name);

export const STICKY_TINTS = {
  white: '#ffffff',
  lightRed: '#ffcccc',
  blue: '#99ccff',
  green: '#99ff99',
  yellow: '#ffff99',
  orange: '#ffcc99',
};

export const INK_COLORS = {
  black: '#000000',
  red: '#cc0000',
  green: '#006600',
  blue: '#0000cc',
};

// Media note — canvas sprite images
export const CASSETTE_IMAGES = [
  'cassette1.webp',
  'cassette2.webp',
  'cassette3.webp',
];
export const VIDEO_IMAGES = ['video1.webp', 'video2.webp', 'video3.webp'];

// File extensions treated as video (webp on a media note is always treated as video)
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'webp'];

export const DOC_BACKGROUNDS = {
  parchment: {
    label: 'Parchment',
    path: 'modules/investigation-board/assets/doc_parchment.webp',
  },
  oldpaper: {
    label: 'Old Paper',
    path: 'modules/investigation-board/assets/doc_old.webp',
  },
  whitepaper: {
    label: 'White Paper',
    path: 'modules/investigation-board/assets/doc_white.webp',
  },
};

/**
 * Video player window formats.
 *
 * Each entry defines:
 *   aspectRatio   — video element aspect ratio (width / height)
 *   padding       — space (px) reserved around the video for the future format frame image
 *   mechanicalSfx — asset path for the "open" sound effect
 *
 * When format frame images are ready, add:
 *   backgroundImage — "modules/investigation-board/assets/formats/<key>.webp"
 *   screen          — { x, y, w, h } as fractions of the background image dimensions,
 *                     defining the exact viewport rectangle within the frame art.
 */
// Single source of truth for videoEffects fallback values — used by the sheet's getData(),
// the submit handler, and _readEffectsFromForm(). These previously drifted (8/20/13/#00e040
// vs 2/4/30/#008425), so a hidden field (e.g. no FILES_BROWSE) could silently change a note's
// stored effect values between a read and a write.
export const EFFECT_DEFAULTS = {
  filmGrainIntensity: 0.15,
  glitchIntervalMin: 2,
  glitchIntervalMax: 4,
  timestampFontSize: 30,
  timestampColor: '#008425',
};

export const VIDEO_FORMATS = {
  cctv: {
    label: 'CCTV Footage',
    icon: 'fas fa-camera-cctv',
    aspectRatio: 4 / 3,
    padding: { top: 40, right: 30, bottom: 30, left: 30 },
    defaultEffects: {
      rollingShutter: false,
      mechanicalSound: false,
      trackingGlitch: true,
      filmGrain: true,
      timestampEnabled: true,
    },
  },
  crt: {
    label: 'CRT Monitor',
    icon: 'fas fa-tv',
    aspectRatio: 4 / 3,
    padding: { top: 40, right: 30, bottom: 30, left: 30 },
    mechanicalSfx: 'modules/investigation-board/assets/crt-turn-on-off.ogg',
    defaultEffects: {
      rollingShutter: false,
      mechanicalSound: true,
      trackingGlitch: true,
      filmGrain: false,
      timestampEnabled: false,
    },
  },
  flatscreen: {
    label: 'Flat Screen',
    icon: 'fas fa-display',
    aspectRatio: 16 / 9,
    padding: { top: 20, right: 20, bottom: 20, left: 20 },
    mechanicalSfx: 'modules/investigation-board/assets/vcr-tape-insert.mp3',
    defaultEffects: {
      rollingShutter: false,
      mechanicalSound: true,
      trackingGlitch: false,
      filmGrain: false,
      timestampEnabled: false,
    },
  },
  filmProjector: {
    label: 'Film Projector',
    icon: 'fas fa-film',
    aspectRatio: 4 / 3,
    padding: { top: 50, right: 40, bottom: 50, left: 40 },
    mechanicalSfx: 'modules/investigation-board/assets/film-projector-start.mp3',
    defaultEffects: {
      rollingShutter: true,
      mechanicalSound: true,
      trackingGlitch: false,
      filmGrain: true,
      timestampEnabled: false,
    },
  },
  cellphone: {
    label: 'Cellphone',
    icon: 'fas fa-mobile-screen',
    aspectRatio: 9 / 16,
    padding: { top: 60, right: 20, bottom: 80, left: 20 },
    defaultEffects: {
      rollingShutter: false,
      mechanicalSound: false,
      trackingGlitch: false,
      filmGrain: false,
      timestampEnabled: false,
    },
  },
};

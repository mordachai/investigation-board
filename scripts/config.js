export const MODULE_ID = "investigation-board";
export const BASE_FONT_SIZE = 15;
export const DEFAULT_PIN_FOLDER = "modules/investigation-board/assets/pins";
export const PIN_COLORS = ["redPin.webp", "bluePin.webp", "yellowPin.webp", "greenPin.webp"];
export const SOCKET_NAME = `module.${MODULE_ID}`;

export const STICKY_TINTS = {
  white: "#ffffff",
  lightRed: "#ffcccc",
  blue: "#99ccff",
  green: "#99ff99",
  yellow: "#ffff99",
  orange: "#ffcc99"
};

export const INK_COLORS = {
  black: "#000000",
  red: "#cc0000",
  green: "#006600",
  blue: "#0000cc"
};

// Media note — canvas sprite images
export const CASSETTE_IMAGES = ["cassette1.webp", "cassette2.webp", "cassette3.webp"];
export const VIDEO_IMAGES    = ["video1.webp", "video2.webp", "video3.webp"];

// File extensions treated as video (webp on a media note is always treated as video)
export const VIDEO_EXTENSIONS = ["mp4", "webm", "webp"];

/**
 * Video player window formats.
 *
 * Each entry defines:
 *   windowWidth   — outer ApplicationV2 window width in px
 *   aspectRatio   — video element aspect ratio (width / height)
 *   padding       — space (px) reserved around the video for the future format frame image
 *   mechanicalSfx — asset path for the "open" sound effect
 *
 * When format frame images are ready, add:
 *   backgroundImage — "modules/investigation-board/assets/formats/<key>.webp"
 *   screen          — { x, y, w, h } as fractions of the background image dimensions,
 *                     defining the exact viewport rectangle within the frame art.
 */
export const VIDEO_FORMATS = {
  crt: {
    label: "CRT Monitor",
    icon: "fas fa-tv",
    windowWidth: 640,
    aspectRatio: 4 / 3,
    padding: { top: 40, right: 30, bottom: 30, left: 30 },
    mechanicalSfx: "modules/investigation-board/assets/crt-turn-on-off.ogg",
  },
  flatscreen: {
    label: "Flat Screen",
    icon: "fas fa-display",
    windowWidth: 720,
    aspectRatio: 16 / 9,
    padding: { top: 20, right: 20, bottom: 20, left: 20 },
    mechanicalSfx: "modules/investigation-board/assets/vcr-tape-insert.mp3",
  },
  filmProjector: {
    label: "Film Projector",
    icon: "fas fa-film",
    windowWidth: 640,
    aspectRatio: 4 / 3,
    padding: { top: 50, right: 40, bottom: 50, left: 40 },
    mechanicalSfx: "modules/investigation-board/assets/film-projector-start.mp3",
  },
  cellphone: {
    label: "Cellphone",
    icon: "fas fa-mobile-screen",
    windowWidth: 360,
    aspectRatio: 9 / 16,
    padding: { top: 60, right: 20, bottom: 80, left: 20 },
    mechanicalSfx: "modules/investigation-board/assets/vcr-tape-insert.mp3",
  },
};

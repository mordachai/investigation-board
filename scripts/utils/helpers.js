import { MODULE_ID, BASE_FONT_SIZE, DEFAULT_PIN_FOLDER, PIN_COLORS } from "../config.js";

// ---------------------------------------------------------------------------
// Pin image helpers
// ---------------------------------------------------------------------------

let _pinFilesCache = null;
let _pinFolderCache = null;

/**
 * Bust the cached pin file list. Call this when pinImagesFolder setting changes.
 */
export function invalidatePinFilesCache() {
  _pinFilesCache = null;
  _pinFolderCache = null;
}

/**
 * Returns the full URL for a bare pin filename, resolved against the
 * configured (or default) pin images folder.
 * @param {string} filename  e.g. "redPin.webp"
 * @returns {string}         e.g. "modules/investigation-board/assets/pins/redPin.webp"
 */
export function resolvePinImage(filename) {
  const folder = game.settings.get(MODULE_ID, "pinImagesFolder") || DEFAULT_PIN_FOLDER;
  return `${folder}/${filename}`;
}

/**
 * Scans the configured pin images folder and returns the list of available
 * filenames (.webp / .png). Results are cached per-folder until
 * invalidatePinFilesCache() is called.
 *
 * Falls back to PIN_COLORS (the built-in list) when the folder cannot be
 * read (e.g. players without FILES_BROWSE permission).
 *
 * @returns {Promise<string[]>}  Array of bare filenames, e.g. ["redPin.webp", ...]
 */
export async function getAvailablePinFiles() {
  const FilePicker = foundry.applications.apps.FilePicker.implementation;
  const folder = game.settings.get(MODULE_ID, "pinImagesFolder") || DEFAULT_PIN_FOLDER;

  if (_pinFolderCache === folder && _pinFilesCache !== null) {
    return _pinFilesCache;
  }

  try {
    const result = await FilePicker.browse("data", folder);
    _pinFilesCache = result.files
      .filter(f => /\.(webp|png)$/i.test(f))
      .map(f => f.split("/").pop());
    _pinFolderCache = folder;
  } catch {
    // No FILES_BROWSE permission or folder doesn't exist — use built-in list
    _pinFilesCache = [...PIN_COLORS];
    _pinFolderCache = folder;
  }

  return _pinFilesCache;
}

export function getBaseCharacterLimits() {
  return game.settings.get(MODULE_ID, "baseCharacterLimits") || {
    sticky: 60,
    photo: 15,
    index: 200,
  };
}

export function getDynamicCharacterLimits(font, noteType, currentFontSize) {
  const baseLimits = getBaseCharacterLimits();
  const scaleFactor = BASE_FONT_SIZE / currentFontSize;
  const fontLimits = baseLimits[font] || baseLimits["Arial"] || { sticky: 200, photo: 30, index: 650 };
  return {
    sticky: Math.round(fontLimits.sticky * scaleFactor),
    photo: Math.round(fontLimits.photo * scaleFactor),
    index: Math.round(fontLimits.index * scaleFactor),
  };
}

/**
 * Helper to resolve actor display name based on characterNameKey setting.
 */
export function getActorDisplayName(actor) {
  const keyPath = game.settings.get(MODULE_ID, "characterNameKey") || "prototypeToken.name";

  // Navigate the key path (e.g., "prototypeToken.name" or "system.alias")
  const keys = keyPath.split(".");
  let value = actor;
  for (const key of keys) {
    value = value?.[key];
    if (value === undefined) break;
  }

  // Fallback to actor name if path doesn't resolve
  return value || actor.name || "Unknown";
}

/**
 * Calculates the effective scale for investigation board elements.
 * Honors both the autoScale setting and the manual multiplier.
 * @returns {number}
 */
export function getEffectiveScale() {
  const baseScale = game.settings.get(MODULE_ID, "sceneScale") || 1.0;
  const isAuto = game.settings.get(MODULE_ID, "autoScale");
  
  if (!isAuto || !canvas.scene) return baseScale;

  const width = canvas.scene.width;
  // Formula optimized for: 1280px -> ~0.4, 3376px -> ~1.1, 4000px -> ~1.3
  const autoFactor = width / 3070;
  
  // Return combined scale, clamped to reasonable range
  return Math.clamp(baseScale * autoFactor, 0.1, 5.0);
}

export function truncateText(text, font, noteType, currentFontSize) {
    const limits = getDynamicCharacterLimits(font, noteType, currentFontSize);
    const charLimit = limits[noteType] || 100;
    return text.length <= charLimit ? text : text.slice(0, charLimit).trim() + "...";
}

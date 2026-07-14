import { MODULE_ID, DEFAULT_PIN_FOLDER, PIN_COLORS, DEFAULT_STAMP_FOLDER, STAMP_IMAGES, FONTS } from "../config.js";

// ---------------------------------------------------------------------------
// Folder-backed image sources (pins, stamps) — a GM-configurable world setting
// points at a folder; bare filenames stored in flags are resolved against it at
// render time so the whole set can be swapped without touching note data.
// ---------------------------------------------------------------------------

/**
 * Builds the {resolve, getAvailableFiles, invalidateCache} trio for a folder-backed
 * image source. Both the pin and stamp image pickers are the same shape: a world
 * setting holds the folder path, results are cached per-folder, and a built-in
 * fallback list is used when the folder can't be browsed (e.g. no FILES_BROWSE).
 * @param {string} settingKey    World setting name holding the folder path
 * @param {string} defaultFolder Folder path used when the setting is unset
 * @param {string[]} fallbackList Built-in filenames to use if browsing fails
 */
function makeFolderImageSource(settingKey, defaultFolder, fallbackList) {
  let filesCache = null;
  let folderCache = null;

  function currentFolder() {
    return game.settings.get(MODULE_ID, settingKey) || defaultFolder;
  }

  return {
    invalidateCache() {
      filesCache = null;
      folderCache = null;
    },
    /** Full URL for a bare filename, e.g. "redPin.webp" → ".../pins/redPin.webp" */
    resolve(filename) {
      return `${currentFolder()}/${filename}`;
    },
    /**
     * Scans the configured folder and returns the list of available filenames
     * (.webp / .png), cached per-folder until invalidateCache() is called.
     * @returns {Promise<string[]>}
     */
    async getAvailableFiles() {
      const FilePicker = foundry.applications.apps.FilePicker.implementation;
      const folder = currentFolder();

      if (folderCache === folder && filesCache !== null) {
        return filesCache;
      }

      try {
        const result = await FilePicker.browse("data", folder);
        filesCache = result.files
          .filter(f => /\.(webp|png)$/i.test(f))
          .map(f => f.split("/").pop())
          .sort();
      } catch {
        // No FILES_BROWSE permission or folder doesn't exist — use built-in list
        filesCache = [...fallbackList].sort();
      }
      folderCache = folder;

      return filesCache;
    },
  };
}

// ---------------------------------------------------------------------------
// Pin image helpers
// ---------------------------------------------------------------------------

const pinImageSource = makeFolderImageSource("pinImagesFolder", DEFAULT_PIN_FOLDER, PIN_COLORS);

/** Bust the cached pin file list. Call this when pinImagesFolder setting changes. */
export function invalidatePinFilesCache() {
  pinImageSource.invalidateCache();
}

/**
 * Returns the full URL for a bare pin filename, resolved against the
 * configured (or default) pin images folder.
 * @param {string} filename  e.g. "redPin.webp"
 * @returns {string}         e.g. "modules/investigation-board/assets/pins/redPin.webp"
 */
export function resolvePinImage(filename) {
  return pinImageSource.resolve(filename);
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
  return pinImageSource.getAvailableFiles();
}

/**
 * Deterministically pick a pin file for a drawing so every client resolves
 * the same "random" pin without needing a flag write to land first.
 * Hashes the drawing ID into an index over the sorted file list.
 *
 * @param {string} drawingId
 * @param {string[]} files  Sorted list of bare filenames
 * @returns {string|undefined}
 */
export function pickPinFileForDrawing(drawingId, files) {
  if (!files?.length) return undefined;
  let hash = 0;
  for (let i = 0; i < drawingId.length; i++) {
    hash = (hash * 31 + drawingId.charCodeAt(i)) >>> 0;
  }
  return files[hash % files.length];
}

// ---------------------------------------------------------------------------
// Stamp image helpers
// ---------------------------------------------------------------------------

const stampImageSource = makeFolderImageSource("stampImagesFolder", DEFAULT_STAMP_FOLDER, STAMP_IMAGES);

export function invalidateStampFilesCache() {
  stampImageSource.invalidateCache();
}

export function resolveStampImage(filename) {
  return stampImageSource.resolve(filename);
}

export async function getAvailableStampFiles() {
  return stampImageSource.getAvailableFiles();
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

/**
 * Average character width as a fraction of fontSize, per font family, derived from
 * the module's single FONTS list (config.js). Used to estimate how many characters
 * fit on a single wrapped line.
 */
const FONT_WIDTH_FACTORS = Object.fromEntries(FONTS.map(f => [f.name, f.widthFactor]));

/**
 * Compute how many characters fit inside a note given its rendered dimensions.
 *
 * For photo notes only the caption strip at the bottom counts as usable height.
 * A small floor is enforced so very small notes always show something.
 *
 * @param {string} font
 * @param {string} noteType
 * @param {number} fontSize   Rendered font size in px
 * @param {number} width      Actual note width in world px
 * @param {number} height     Actual note height in world px
 * @returns {number}
 */
function _computeCharLimit(font, noteType, fontSize, width, height) {
  const widthFactor = FONT_WIDTH_FACTORS[font] ?? 0.6;
  const charWidth   = fontSize * widthFactor;
  const lineHeight  = fontSize * 1.4;

  const usableW = Math.max(width - 20, 0);
  // Photo notes: text is only the caption strip (~20 % of height, capped 30–70 px)
  const usableH = noteType === "photo"
    ? Math.max(Math.min(height * 0.20, 70), 30)
    : Math.max(height - 60, 0);

  const charsPerLine = Math.floor(usableW / charWidth);
  const lines        = Math.max(Math.floor(usableH / lineHeight), 1);
  return Math.max(charsPerLine * lines, 20);
}

/**
 * Truncate text so it fits inside the note's rendered area.
 * Uses a geometric estimate based on actual note dimensions rather than
 * fixed per-font constants, so scaled notes automatically get more characters.
 *
 * @param {string} text
 * @param {string} font
 * @param {string} noteType
 * @param {number} fontSize   Rendered font size in px
 * @param {number} width      Actual note width in world px
 * @param {number} height     Actual note height in world px
 * @returns {string}
 */
export function truncateText(text, font, noteType, fontSize, width, height) {
  const charLimit = _computeCharLimit(font, noteType, fontSize, width, height);
  return text.length <= charLimit ? text : text.slice(0, charLimit).trim() + "...";
}

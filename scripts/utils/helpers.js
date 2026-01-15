import { MODULE_ID, BASE_FONT_SIZE } from "../config.js";

export function getBaseCharacterLimits() {
  return game.settings.get(MODULE_ID, "baseCharacterLimits") || {
    sticky: 60,
    photo: 15,
    index: 200,
  };
}

export function getDynamicCharacterLimits(noteType, currentFontSize) {
  const baseLimits = getBaseCharacterLimits();
  const scaleFactor = BASE_FONT_SIZE / currentFontSize;
  const limits = baseLimits[noteType] || { sticky: 60, photo: 15, index: 200 };
  return {
    sticky: Math.round(limits.sticky * scaleFactor),
    photo: Math.round(limits.photo * scaleFactor),
    index: Math.round(limits.index * scaleFactor),
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

export function truncateText(text, font, noteType, currentFontSize) {
    const limits = getDynamicCharacterLimits(noteType, currentFontSize);
    const charLimit = limits[noteType] || 100;
    return text.length <= charLimit ? text : text.slice(0, charLimit).trim() + "...";
}

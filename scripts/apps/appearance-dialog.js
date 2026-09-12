import { MODULE_ID, DEFAULT_PIN_FOLDER, DEFAULT_STAMP_FOLDER, DEFAULT_STAMP_TINT, DEFAULT_BOARD_THEME, FONTS, THEME_ASSETS } from "../config.js";
import { invalidatePinFilesCache, getActiveTheme } from "../utils/helpers.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Font select options are name → name (identity label); sourced from the module's
// single FONTS list (config.js) so it can't drift from the other font-consuming code.
const FONT_CHOICES = Object.fromEntries(FONTS.map(f => [f.name, f.name]));

const PIN_COLOR_CHOICES = {
  random: "Random",
  none:   "No Pins (disables yarn connections)"
};

const BOARD_THEME_CHOICES = Object.fromEntries(
  Object.entries(THEME_ASSETS).map(([key, theme]) => [key, theme.label])
);

const CONNECTION_LINE_STYLE_CHOICES = {
  yarn:    "Yarn (sagging string)",
  circuit: "Circuit (glowing routed line)"
};

export class AppearanceDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ib-appearance",
    tag: "div",
    classes: ["ib-appearance-app"],
    window: {
      title: "Investigation Board: Appearance",
      resizable: false,
    },
    position: {
      width: 440,
      height: "auto"
    }
  };

  static PARTS = {
    content: {
      template: "modules/investigation-board/templates/appearance-dialog.html"
    }
  };

  async _prepareContext(options) {
    const currentFont        = game.settings.get(MODULE_ID, "font");
    const currentNoteColor   = game.settings.get(MODULE_ID, "defaultNoteColor");
    const currentInkColor    = game.settings.get(MODULE_ID, "defaultInkColor");
    const currentPinColor    = game.settings.get(MODULE_ID, "pinColor");
    const currentPinFolder   = game.settings.get(MODULE_ID, "pinImagesFolder") || DEFAULT_PIN_FOLDER;
    const currentStampFolder = game.settings.get(MODULE_ID, "stampImagesFolder") || DEFAULT_STAMP_FOLDER;
    const currentStampTint   = game.settings.get(MODULE_ID, "stampTint") || DEFAULT_STAMP_TINT;
    const currentBoardTheme  = game.settings.get(MODULE_ID, "boardTheme");
    const currentLineStyle   = game.settings.get(MODULE_ID, "connectionLineStyle");

    return {
      // Current values
      font:               currentFont,
      baseFontSize:       game.settings.get(MODULE_ID, "baseFontSize"),
      defaultNoteColor:   currentNoteColor,
      defaultInkColor:    currentInkColor,
      pinColor:           currentPinColor,
      pinImagesFolder:    currentPinFolder,
      stampImagesFolder:  currentStampFolder,
      stampTint:          currentStampTint,
      connectionLineWidth: game.settings.get(MODULE_ID, "connectionLineWidth"),
      boardTheme:          currentBoardTheme,
      connectionLineStyle: currentLineStyle,

      // Choices for selects
      fontChoices: Object.entries(FONT_CHOICES).map(([value, label]) => ({
        value, label, selected: value === currentFont
      })),
      noteColorChoices: Object.entries(getActiveTheme().stickyTints).map(([key, value]) => ({
        value, label: key.charAt(0).toUpperCase() + key.slice(1), selected: value === currentNoteColor
      })),
      inkColorChoices: Object.entries(getActiveTheme().inkColors).map(([key, value]) => ({
        value, label: key.charAt(0).toUpperCase() + key.slice(1), selected: value === currentInkColor
      })),
      pinColorChoices: Object.entries(PIN_COLOR_CHOICES).map(([value, label]) => ({
        value, label, selected: value === currentPinColor
      })),
      boardThemeChoices: Object.entries(BOARD_THEME_CHOICES).map(([value, label]) => ({
        value, label, selected: value === currentBoardTheme
      })),
      connectionLineStyleChoices: Object.entries(CONNECTION_LINE_STYLE_CHOICES).map(([value, label]) => ({
        value, label, selected: value === currentLineStyle
      }))
    };
  }

  _onRender(context, options) {
    const html = this.element;
    const FilePicker = foundry.applications.apps.FilePicker.implementation;

    html.querySelector('[data-action="save"]')?.addEventListener("click", async () => {
      await this._save();
      this.close();
    });

    html.querySelector('[data-action="cancel"]')?.addEventListener("click", () => {
      this.close();
    });

    // Rebuilds a color <select>'s <option> list from a theme's color map (key → hex).
    // Needed (not just setting .value) because the note-color/ink-color selects are
    // rendered with the PREVIOUS theme's options — the new theme's hex almost certainly
    // isn't one of them yet, so a plain .value assignment would silently no-op and
    // Save would persist the stale color.
    const rebuildColorSelect = (select, colorMap, selectedValue) => {
      if (!select) return;
      select.innerHTML = "";
      for (const [key, value] of Object.entries(colorMap)) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = key.charAt(0).toUpperCase() + key.slice(1);
        if (value === selectedValue) opt.selected = true;
        select.appendChild(opt);
      }
    };

    // Live preview: switching the Board Theme dropdown updates the folder/style/color
    // inputs below it immediately (not yet saved), so the Save handler's form-read
    // picks up the theme's values instead of stale ones and doesn't need a second
    // guess at what changed.
    html.querySelector('[name="boardTheme"]')?.addEventListener("change", (event) => {
      const theme = THEME_ASSETS[event.target.value] || THEME_ASSETS[DEFAULT_BOARD_THEME];
      const pinInput = html.querySelector('[name="pinImagesFolder"]');
      const stampInput = html.querySelector('[name="stampImagesFolder"]');
      const lineStyleSelect = html.querySelector('[name="connectionLineStyle"]');
      const noteColorSelect = html.querySelector('[name="defaultNoteColor"]');
      const inkColorSelect = html.querySelector('[name="defaultInkColor"]');
      const fontSelect = html.querySelector('[name="font"]');
      if (pinInput) pinInput.value = theme.pinFolder;
      if (stampInput) stampInput.value = theme.stampFolder;
      if (lineStyleSelect) lineStyleSelect.value = event.target.value === "scifi" ? "circuit" : "yarn";
      if (fontSelect && theme.defaultFont) fontSelect.value = theme.defaultFont;
      rebuildColorSelect(noteColorSelect, theme.stickyTints, theme.stickyTints.white ?? Object.values(theme.stickyTints)[0]);
      rebuildColorSelect(inkColorSelect, theme.inkColors, theme.defaultInk);
    });

    html.querySelector('[data-action="browse-pins"]')?.addEventListener("click", () => {
      const input = html.querySelector('[name="pinImagesFolder"]');
      new FilePicker({
        type: "folder",
        current: input?.value || DEFAULT_PIN_FOLDER,
        callback: (path) => {
          if (input) input.value = path;
        }
      }).browse();
    });

    html.querySelector('[data-action="browse-stamps"]')?.addEventListener("click", () => {
      const input = html.querySelector('[name="stampImagesFolder"]');
      new FilePicker({
        type: "folder",
        current: input?.value || DEFAULT_STAMP_FOLDER,
        callback: (path) => {
          if (input) input.value = path;
        }
      }).browse();
    });
  }

  async _save() {
    const html = this.element;
    const getStr = (name) => html.querySelector(`[name="${name}"]`)?.value ?? null;
    const getNum = (name) => {
      const val = parseInt(html.querySelector(`[name="${name}"]`)?.value);
      return isNaN(val) ? null : val;
    };

    // boardTheme is handled separately, and only written when it actually changed:
    // its onChange cascades to overwrite pinImagesFolder/stampImagesFolder, which would
    // silently stomp a GM's manually-set custom folder on every save otherwise.
    const strKeys = ["font", "defaultNoteColor", "defaultInkColor", "pinColor", "pinImagesFolder", "stampImagesFolder", "stampTint", "connectionLineStyle"];
    const numKeys = ["baseFontSize", "connectionLineWidth"];

    const newBoardTheme = getStr("boardTheme");
    if (newBoardTheme !== null && newBoardTheme !== game.settings.get(MODULE_ID, "boardTheme")) {
      await game.settings.set(MODULE_ID, "boardTheme", newBoardTheme);
    }

    for (const key of strKeys) {
      const val = getStr(key);
      if (val !== null) await game.settings.set(MODULE_ID, key, val);
    }
    for (const key of numKeys) {
      const val = getNum(key);
      if (val !== null) await game.settings.set(MODULE_ID, key, val);
    }
  }
}

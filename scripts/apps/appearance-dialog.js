import { MODULE_ID, STICKY_TINTS, INK_COLORS, DEFAULT_PIN_FOLDER } from "../config.js";
import { invalidatePinFilesCache } from "../utils/helpers.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const FONT_CHOICES = {
  "Rock Salt":            "Rock Salt",
  "Caveat":               "Caveat",
  "Courier New":          "Courier New",
  "Times New Roman":      "Times New Roman",
  "Signika":              "Signika",
  "Arial":                "Arial",
  "Typewriter Condensed": "Typewriter Condensed",
  "IB Special Elite":     "IB Special Elite"
};

const PIN_COLOR_CHOICES = {
  random: "Random",
  none:   "No Pins (disables yarn connections)"
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

    return {
      // Current values
      font:               currentFont,
      baseFontSize:       game.settings.get(MODULE_ID, "baseFontSize"),
      defaultNoteColor:   currentNoteColor,
      defaultInkColor:    currentInkColor,
      pinColor:           currentPinColor,
      pinImagesFolder:    currentPinFolder,
      connectionLineWidth: game.settings.get(MODULE_ID, "connectionLineWidth"),

      // Choices for selects
      fontChoices: Object.entries(FONT_CHOICES).map(([value, label]) => ({
        value, label, selected: value === currentFont
      })),
      noteColorChoices: Object.entries(STICKY_TINTS).map(([key, value]) => ({
        value, label: key.charAt(0).toUpperCase() + key.slice(1), selected: value === currentNoteColor
      })),
      inkColorChoices: Object.entries(INK_COLORS).map(([key, value]) => ({
        value, label: key.charAt(0).toUpperCase() + key.slice(1), selected: value === currentInkColor
      })),
      pinColorChoices: Object.entries(PIN_COLOR_CHOICES).map(([value, label]) => ({
        value, label, selected: value === currentPinColor
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
  }

  async _save() {
    const html = this.element;
    const getStr = (name) => html.querySelector(`[name="${name}"]`)?.value ?? null;
    const getNum = (name) => {
      const val = parseInt(html.querySelector(`[name="${name}"]`)?.value);
      return isNaN(val) ? null : val;
    };

    const strKeys = ["font", "defaultNoteColor", "defaultInkColor", "pinColor", "pinImagesFolder"];
    const numKeys = ["baseFontSize", "connectionLineWidth"];

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

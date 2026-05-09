import { MODULE_ID, DEFAULT_PIN_FOLDER } from "./config.js";
import { invalidatePinFilesCache } from "./utils/helpers.js";
import { NoteDefaultsDialog } from "./apps/note-defaults-dialog.js";
import { AppearanceDialog } from "./apps/appearance-dialog.js";

export const registerSettings = function() {

  const refreshAllDrawings = () => {
    if (canvas.drawings) {
      canvas.drawings.placeables.forEach(drawing => {
        if (drawing.document.flags[MODULE_ID]) {
          drawing.refresh();
        }
      });
    }
  };

  // -------------------------------------------------------------------------
  // Dialog buttons
  // -------------------------------------------------------------------------
  game.settings.registerMenu(MODULE_ID, "appearanceDefaults", {
    name: "Appearance",
    label: "Configure Appearance",
    hint: "Set font, colors, pin style, and connection line width.",
    icon: "fas fa-palette",
    type: AppearanceDialog,
    restricted: false
  });

  game.settings.registerMenu(MODULE_ID, "noteDefaults", {
    name: "Note Defaults",
    label: "Configure Note Defaults",
    hint: "Set default dimensions and placeholder text for each note type.",
    icon: "fas fa-sliders",
    type: NoteDefaultsDialog,
    restricted: true
  });

  // -------------------------------------------------------------------------
  // Scale & Layout
  // -------------------------------------------------------------------------
  game.settings.register(MODULE_ID, "autoScale", {
    name: "Automatic Scale per Scene",
    hint: "If enabled, the module automatically calculates the ideal scale based on map width. The 'Scene Scale' slider then acts as a global multiplier.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshAllDrawings()
  });

  game.settings.register(MODULE_ID, "sceneScale", {
    name: "Scene Scale / Multiplier",
    hint: "The fixed scale for notes (if Auto-Scale is OFF) or a global multiplier (if Auto-Scale is ON).",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0.3, max: 2.5, step: 0.1 },
    default: 1.0,
    onChange: () => refreshAllDrawings()
  });

  // -------------------------------------------------------------------------
  // Appearance — managed via the Appearance dialog
  // -------------------------------------------------------------------------
  game.settings.register(MODULE_ID, "font", {
    name: "Font",
    scope: "world",
    config: false,
    type: String,
    default: "Rock Salt",
    onChange: () => refreshAllDrawings()
  });

  game.settings.register(MODULE_ID, "baseFontSize", {
    name: "Base Font Size",
    scope: "world",
    config: false,
    type: Number,
    default: 16,
    onChange: () => refreshAllDrawings()
  });

  game.settings.register(MODULE_ID, "defaultNoteColor", {
    name: "Default Note Color (Sticky)",
    scope: "client",
    config: false,
    type: String,
    default: "#ffffff"
  });

  game.settings.register(MODULE_ID, "defaultInkColor", {
    name: "Default Ink Color",
    scope: "client",
    config: false,
    type: String,
    default: "#000000"
  });

  game.settings.register(MODULE_ID, "pinColor", {
    name: "Pin Visibility",
    scope: "world",
    config: false,
    type: String,
    default: "random",
    onChange: () => {
      if (canvas.drawings) {
        canvas.drawings.placeables.forEach(drawing => drawing.refresh());
      }
    }
  });

  game.settings.register(MODULE_ID, "pinImagesFolder", {
    name: "Pin Images Folder",
    hint: "Path to a folder containing .webp or .png pin images. Change this to switch the entire pin set (e.g. from pins to nails).",
    scope: "world",
    config: false,
    type: String,
    default: DEFAULT_PIN_FOLDER,
    onChange: () => {
      invalidatePinFilesCache();
      refreshAllDrawings();
    }
  });

  game.settings.register(MODULE_ID, "connectionLineWidth", {
    name: "Connection Line Width",
    scope: "world",
    config: false,
    type: Number,
    default: 7,
    onChange: () => refreshAllDrawings()
  });

  // -------------------------------------------------------------------------
  // Selection & Interaction
  // -------------------------------------------------------------------------
  game.settings.register(MODULE_ID, "showSelectionControls", {
    name: "Show Selection Controls",
    hint: "When enabled, selecting a note shows its bounding box and rotation handle. Has no effect on handout or pin notes.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => refreshAllDrawings()
  });

  game.settings.register(MODULE_ID, "allowScaling", {
    name: "Allow Scaling",
    hint: "When enabled (and Show Selection Controls is on), the scale handle is also visible, allowing notes to be resized by dragging.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => refreshAllDrawings()
  });

  // -------------------------------------------------------------------------
  // Advanced
  // -------------------------------------------------------------------------
  game.settings.register(MODULE_ID, "characterNameKey", {
    name: "Character Name Key",
    hint: "Specify the key path to retrieve the name (e.g., 'prototypeToken.name' or 'system.alias' for Blades in the Dark). If empty, defaults to 'name'.",
    scope: "world",
    config: true,
    default: "prototypeToken.name",
    type: String,
  });

  game.settings.register(MODULE_ID, "showSetupWarning", {
    name: "Show Setup Warning",
    hint: "Whether to show the setup warning for GMs about player permissions.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // -------------------------------------------------------------------------
  // Hidden — managed via the Note Defaults dialog
  // -------------------------------------------------------------------------
  game.settings.register(MODULE_ID, "stickyNoteWidth", {
    name: "Sticky Note Width",
    scope: "world",
    config: false,
    type: Number,
    default: 200,
    onChange: () => refreshAllDrawings()
  });

  game.settings.register(MODULE_ID, "photoNoteWidth", {
    name: "Photo Note Width",
    scope: "world",
    config: false,
    type: Number,
    default: 225,
    onChange: () => refreshAllDrawings()
  });

  game.settings.register(MODULE_ID, "indexNoteWidth", {
    name: "Index Note Width",
    scope: "world",
    config: false,
    type: Number,
    default: 600,
    onChange: () => refreshAllDrawings()
  });

  game.settings.register(MODULE_ID, "handoutNoteWidth", {
    name: "Handout Note Width",
    scope: "world",
    config: false,
    type: Number,
    default: 400,
    onChange: () => refreshAllDrawings()
  });

  game.settings.register(MODULE_ID, "handoutNoteHeight", {
    name: "Handout Note Height",
    scope: "world",
    config: false,
    type: Number,
    default: 400,
    onChange: () => refreshAllDrawings()
  });

  game.settings.register(MODULE_ID, "stickyNoteDefaultText", {
    name: "Default Sticky Note Text",
    scope: "world",
    config: false,
    type: String,
    default: "Clue"
  });

  game.settings.register(MODULE_ID, "photoNoteDefaultText", {
    name: "Default Photo Note Text",
    scope: "world",
    config: false,
    type: String,
    default: "Suspect/Place"
  });

  game.settings.register(MODULE_ID, "indexNoteDefaultText", {
    name: "Default Index Note Text",
    scope: "world",
    config: false,
    type: String,
    default: "Notes"
  });

  game.settings.register(MODULE_ID, "mediaNoteDefaultText", {
    name: "Default Media Note Text",
    scope: "world",
    config: false,
    type: String,
    default: "Audio Recording"
  });

  // -------------------------------------------------------------------------
  // Hidden — internal
  // -------------------------------------------------------------------------
  game.settings.register(MODULE_ID, "baseCharacterLimits", {
    name: "Base Character Limits",
    hint: "The base character limits for each font and note type.",
    scope: "world",
    config: false,
    type: Object,
    default: {
      "Rock Salt":             { sticky: 90,  photo: 20, index: 210  },
      "Caveat":                { sticky: 150, photo: 25, index: 400  },
      "Courier New":           { sticky: 250, photo: 30, index: 580  },
      "Times New Roman":       { sticky: 200, photo: 30, index: 800  },
      "Signika":               { sticky: 200, photo: 30, index: 650  },
      "Arial":                 { sticky: 200, photo: 30, index: 650  },
      "Typewriter Condensed":  { sticky: 320, photo: 48, index: 1000 },
      "IB Special Elite":      { sticky: 130, photo: 18, index: 320  }
    }
  });

  // -------------------------------------------------------------------------
  // Section headers injected into the settings config UI
  // -------------------------------------------------------------------------
  Hooks.on("renderSettingsConfig", (_app, html) => {
    if (!html) return;
    const inject = (settingKey, label) => {
      const el = html.querySelector(`[data-setting-id="${MODULE_ID}.${settingKey}"]`);
      if (!el) return;
      const h = document.createElement("h3");
      h.className = "ib-settings-header";
      h.textContent = label;
      el.before(h);
    };
    inject("autoScale",             "Scale & Layout");
    inject("showSelectionControls", "Selection & Interaction");
    inject("characterNameKey",      "Advanced");
  });
};

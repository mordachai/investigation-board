import { MODULE_ID } from "./config.js";

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
        range: {
            min: 0.3,
            max: 2.5,
            step: 0.1
        },
        default: 1.0,
        onChange: () => refreshAllDrawings()
    });
  
    // Update the pinColor setting to include a "No Pins" option.
    game.settings.register(MODULE_ID, "pinColor", {
      name: "Pin Color",
      hint: "Choose the color of the pin for notes. Selecting 'Random' will randomly assign a pin color. Select 'No Pins' to disable pin display.",
      scope: "world",
      config: true,
      type: String,
      choices: {
        random: "Random",
        red: "Red",
        blue: "Blue",
        yellow: "Yellow",
        green: "Green",
        none: "No Pins"
      },
      default: "random",
      onChange: () => {
        if (canvas.drawings) {
          canvas.drawings.placeables.forEach(drawing => drawing.refresh());
        }
      }
    });

    game.settings.register(MODULE_ID, "connectionLineWidth", {
      name: "Connection Line Width",
      hint: "The width (in pixels) of the connection lines between notes (default: 7).",
      scope: "world",
      config: true,
      type: Number,
      default: 7,
      onChange: () => refreshAllDrawings()
    });

    // Register existing settings
    game.settings.register(MODULE_ID, "stickyNoteWidth", {
        name: "Sticky Note Width",
        hint: "The width (in pixels) for all newly created sticky notes (default: 200).",
        scope: "world",
        config: true,
        type: Number,
        default: 200,
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "photoNoteWidth", {
        name: "Photo Note Width",
        hint: "The width (in pixels) for all newly created photo notes (default: 225).",
        scope: "world",
        config: true,
        type: Number,
        default: 225,
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "indexNoteWidth", {
        name: "Index Note Width",
        hint: "The width (in pixels) for all newly created index cards (default: 600).",
        scope: "world",
        config: true,
        type: Number,
        default: 600,
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "handoutNoteWidth", {
        name: "Handout Note Width",
        hint: "The default width (in pixels) for newly created handout notes (default: 400).",
        scope: "world",
        config: true,
        type: Number,
        default: 400,
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "handoutNoteHeight", {
        name: "Handout Note Height",
        hint: "The default height (in pixels) for newly created handout notes (default: 400).",
        scope: "world",
        config: true,
        type: Number,
        default: 400,
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "baseFontSize", {
        name: "Base Font Size",
        hint: "The font size (in pixels) for text when the note width is at its default size (default: 16).",
        scope: "world",
        config: true,
        type: Number,
        default: 16,
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "font", {
        name: "Font",
        hint: "Choose the font to be used in notes.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            "Rock Salt": "Rock Salt",
            "Caveat": "Caveat",
            "Courier New": "Courier New",
            "Times New Roman": "Times New Roman",
            "Signika": "Signika",
            "Arial": "Arial"
        },
        default: "Rock Salt",
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "characterNameKey", {
        name: "Character Name Key",
        hint: "Specify the key path to retrieve the name (e.g., 'prototypeToken.name' or 'system.alias' for Blades in the Dark). If empty, defaults to 'name'.",
        scope: "world",
        config: true,
        default: "prototypeToken.name",
        type: String,
      });

    game.settings.register(MODULE_ID, "stickyNoteDefaultText", {
        name: "Default Sticky Note Text",
        hint: "The default text to use for new sticky notes.",
        scope: "world",
        config: true,
        type: String,
        default: "Clue",
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "photoNoteDefaultText", {
        name: "Default Photo Note Text",
        hint: "The default text to use for new photo notes.",
        scope: "world",
        config: true,
        type: String,
        default: "Suspect/Place",
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "indexNoteDefaultText", {
        name: "Default Index Note Text",
        hint: "The default text to use for new index notes.",
        scope: "world",
        config: true,
        type: String,
        default: "Notes",
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "mediaNoteDefaultText", {
        name: "Default Media Note Text",
        hint: "The default text to use for new media notes.",
        scope: "world",
        config: true,
        type: String,
        default: "Audio Recording",
        onChange: () => refreshAllDrawings()
    });

    // Register base font size and character limits
    game.settings.register(MODULE_ID, "baseCharacterLimits", {
        name: "Base Character Limits",
        hint: "The base character limits for each font and note type. Edit this JSON to customize.",
        scope: "world",
        config: false, // Hidden from the settings UI
        type: Object,
        default: {
            "Rock Salt": { sticky: 90, photo: 20, index: 210 },
            "Caveat": { sticky: 150, photo: 25, index: 400 },
            "Courier New": { sticky: 250, photo: 30, index: 580 },
            "Times New Roman": { sticky: 200, photo: 30, index: 800 },
            "Signika": { sticky: 200, photo: 30, index: 650 },
            "Arial": { sticky: 200, photo: 30, index: 650 }
        }
    });

    game.settings.register(MODULE_ID, "showSetupWarning", {
        name: "Show Setup Warning",
        hint: "Whether to show the setup warning for GMs about player permissions.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });
};

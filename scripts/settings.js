export const MODULE_ID = "investigation-board";

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
  
    // Register a new setting for board mode selection.
    game.settings.register(MODULE_ID, "boardMode", {
      name: "Board Mode",
      hint: "Select the board mode to change the styling of notes.",
      scope: "world",
      config: true,
      type: String,
      choices: {
        modern: "Modern",
        futuristic: "Futuristic",
        custom: "Custom"
      },
      default: "modern",
      onChange: () => refreshAllDrawings()
    });

    // Connection line settings
    game.settings.register(MODULE_ID, "connectionLineColor", {
      name: "Connection Line Color",
      hint: "The color of the connection lines between notes (default: #FF0000).",
      scope: "world",
      config: true,
      type: String,
      default: "#FF0000",
      onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "connectionLineWidth", {
      name: "Connection Line Width",
      hint: "The width (in pixels) of the connection lines between notes (default: 3).",
      scope: "world",
      config: true,
      type: Number,
      default: 6,
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

    // Register base font size and character limits
    game.settings.register(MODULE_ID, "baseCharacterLimits", {
        name: "Base Character Limits",
        hint: "The base character limits for each font and note type. Edit this JSON to customize.",
        scope: "world",
        config: false, // Hidden from the settings UI
        type: Object,
        default: {
            "Rock Salt": { sticky: 90, photo: 20, index: 210 },
            "Courier New": { sticky: 250, photo: 30, index: 580 },
            "Times New Roman": { sticky: 200, photo: 30, index: 800 },
            "Signika": { sticky: 200, photo: 30, index: 650 },
            "Arial": { sticky: 200, photo: 30, index: 650 }
        }
    });
};

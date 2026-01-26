import { MODULE_ID, STICKY_TINTS, INK_COLORS } from "./config.js";

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
        name: game.i18n.localize("investigation-board.settings.autoScale"),
        hint: game.i18n.localize("investigation-board.settings.autoScaleHint"),
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "sceneScale", {
        name: game.i18n.localize("investigation-board.settings.sceneScale"),
        hint: game.i18n.localize("investigation-board.settings.sceneScaleHint"),
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
      name: game.i18n.localize("investigation-board.settings.pinColor"),
      hint: game.i18n.localize("investigation-board.settings.pinColorHint"),
      scope: "world",
      config: true,
      type: String,
      choices: {
        random: game.i18n.localize("investigation-board.settings.color.random"),
        red: game.i18n.localize("investigation-board.settings.color.red"),
        blue: game.i18n.localize("investigation-board.settings.color.blue"),
        yellow: game.i18n.localize("investigation-board.settings.color.yellow"),
        green: game.i18n.localize("investigation-board.settings.color.green"),
        none: game.i18n.localize("investigation-board.settings.color.none")
      },
      default: "random",
      onChange: () => {
        if (canvas.drawings) {
          canvas.drawings.placeables.forEach(drawing => drawing.refresh());
        }
      }
    });

    game.settings.register(MODULE_ID, "connectionLineWidth", {
      name: game.i18n.localize("investigation-board.settings.connectionLineWidth"),
      hint: game.i18n.localize("investigation-board.settings.connectionLineWidthHint"),
      scope: "world",
      config: true,
      type: Number,
      default: 7,
      onChange: () => refreshAllDrawings()
    });

    // Register existing investigation-board.settings
    game.settings.register(MODULE_ID, "stickyNoteWidth", {
        name: game.i18n.localize("investigation-board.settings.stickyNoteWidth"),
        hint: game.i18n.localize("investigation-board.settings.stickyNoteWidthHint"),
        scope: "world",
        config: true,
        type: Number,
        default: 200,
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "photoNoteWidth", {
        name: game.i18n.localize("investigation-board.settings.photoNoteWidth"),
        hint: game.i18n.localize("investigation-board.settings.photoNoteWidthHint"),
        scope: "world",
        config: true,
        type: Number,
        default: 225,
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "indexNoteWidth", {
        name: game.i18n.localize("investigation-board.settings.indexNoteWidth"),
        hint: game.i18n.localize("investigation-board.settings.indexNoteWidthHint"),
        scope: "world",
        config: true,
        type: Number,
        default: 600,
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "handoutNoteWidth", {
        name: game.i18n.localize("investigation-board.settings.handoutNoteWidth"),
        hint: game.i18n.localize("investigation-board.settings.handoutNoteWidthHint"),
        scope: "world",
        config: true,
        type: Number,
        default: 400,
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "handoutNoteHeight", {
        name: game.i18n.localize("investigation-board.settings.handoutNoteHeight"),
        hint: game.i18n.localize("investigation-board.settings.handoutNoteHeightHint"),
        scope: "world",
        config: true,
        type: Number,
        default: 400,
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "baseFontSize", {
        name: game.i18n.localize("investigation-board.settings.baseFontSize"),
        hint: game.i18n.localize("investigation-board.settings.baseFontSizeHint"),
        scope: "world",
        config: true,
        type: Number,
        default: 16,
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "font", {
        name: game.i18n.localize("investigation-board.settings.font"),
        hint: game.i18n.localize("investigation-board.settings.fontHint"),
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
        name: game.i18n.localize("investigation-board.settings.characterNameKey"),
        hint: game.i18n.localize("investigation-board.settings.characterNameKeyHint"),
        scope: "world",
        config: true,
        default: "prototypeToken.name",
        type: String,
      });

    game.settings.register(MODULE_ID, "stickyNoteDefaultText", {
        name: game.i18n.localize("investigation-board.settings.stickyNoteDefaultText"),
        hint: game.i18n.localize("investigation-board.settings.stickyNoteDefaultTextHint"),
        scope: "world",
        config: true,
        type: String,
        default: "Clue",
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "photoNoteDefaultText", {
        name: game.i18n.localize("investigation-board.settings.photoNoteDefaultText"),
        hint: game.i18n.localize("investigation-board.settings.photoNoteDefaultTextHint"),
        scope: "world",
        config: true,
        type: String,
        default: "Suspect/Place",
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "indexNoteDefaultText", {
        name: game.i18n.localize("investigation-board.settings.indexNoteDefaultText"),
        hint: game.i18n.localize("investigation-board.settings.indexNoteDefaultTextHint"),
        scope: "world",
        config: true,
        type: String,
        default: "Notes",
        onChange: () => refreshAllDrawings()
    });

    game.settings.register(MODULE_ID, "mediaNoteDefaultText", {
        name: game.i18n.localize("investigation-board.settings.mediaNoteDefaultText"),
        hint: game.i18n.localize("investigation-board.settings.mediaNoteDefaultTextHint"),
        scope: "world",
        config: true,
        type: String,
        default: "Audio Recording",
        onChange: () => refreshAllDrawings()
    });

    // Register base font size and character limits
    game.settings.register(MODULE_ID, "baseCharacterLimits", {
        name: game.i18n.localize("investigation-board.settings.baseCharacterLimits"),
        hint: game.i18n.localize("investigation-board.settings.baseCharacterLimitsHint"),
        scope: "world",
        config: false, // Hidden from the investigation-board.settings UI
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
        name: game.i18n.localize("investigation-board.settings.showSetupWarning"),
        hint: game.i18n.localize("investigation-board.settings.showSetupWarningHint"),
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, "defaultNoteColor", {
        name: game.i18n.localize("investigation-board.settings.defaultNoteColor"),
        hint: game.i18n.localize("investigation-board.settings.defaultNoteColorHint"),
        scope: "client",
        config: true,
        type: String,
        choices: Object.keys(STICKY_TINTS).reduce((acc, key) => {
            acc[STICKY_TINTS[key]] = game.i18n.localize("investigation-board.settings.color." + key);
            // acc[STICKY_TINTS[key]] = game.i18n.localize("investigation-board.settings.color." + key.charAt(0).toUpperCase() + key.slice(1));
            return acc;
        }, {}),
        default: "#ffffff"
    });

    game.settings.register(MODULE_ID, "defaultInkColor", {
        name: game.i18n.localize("investigation-board.settings.defaultInkColor"),
        hint: game.i18n.localize("investigation-board.settings.defaultInkColorHint"),
        scope: "client",
        config: true,
        type: String,
        choices: Object.keys(INK_COLORS).reduce((acc, key) => {
            acc[INK_COLORS[key]] = key.charAt(0).toUpperCase() + key.slice(1);
            return acc;
        }, {}),
        default: "#000000"
    });
};

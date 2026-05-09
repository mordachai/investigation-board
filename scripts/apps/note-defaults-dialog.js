import { MODULE_ID } from "../config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class NoteDefaultsDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ib-note-defaults",
    tag: "div",
    classes: ["ib-note-defaults-app"],
    window: {
      title: "Investigation Board: Note Defaults",
      resizable: false,
    },
    position: {
      width: 440,
      height: "auto"
    }
  };

  static PARTS = {
    content: {
      template: "modules/investigation-board/templates/note-defaults-dialog.html"
    }
  };

  async _prepareContext(options) {
    return {
      stickyNoteWidth:       game.settings.get(MODULE_ID, "stickyNoteWidth"),
      photoNoteWidth:        game.settings.get(MODULE_ID, "photoNoteWidth"),
      indexNoteWidth:        game.settings.get(MODULE_ID, "indexNoteWidth"),
      handoutNoteWidth:      game.settings.get(MODULE_ID, "handoutNoteWidth"),
      handoutNoteHeight:     game.settings.get(MODULE_ID, "handoutNoteHeight"),
      stickyNoteDefaultText: game.settings.get(MODULE_ID, "stickyNoteDefaultText"),
      photoNoteDefaultText:  game.settings.get(MODULE_ID, "photoNoteDefaultText"),
      indexNoteDefaultText:  game.settings.get(MODULE_ID, "indexNoteDefaultText"),
      mediaNoteDefaultText:  game.settings.get(MODULE_ID, "mediaNoteDefaultText"),
    };
  }

  _onRender(context, options) {
    const html = this.element;

    html.querySelector('[data-action="save"]')?.addEventListener("click", async () => {
      await this._save();
      this.close();
    });

    html.querySelector('[data-action="cancel"]')?.addEventListener("click", () => {
      this.close();
    });
  }

  async _save() {
    const html = this.element;
    const getNum = (name) => {
      const val = parseInt(html.querySelector(`[name="${name}"]`)?.value);
      return isNaN(val) ? null : val;
    };
    const getStr = (name) => html.querySelector(`[name="${name}"]`)?.value ?? null;

    const numKeys = ["stickyNoteWidth", "photoNoteWidth", "indexNoteWidth", "handoutNoteWidth", "handoutNoteHeight"];
    const strKeys = ["stickyNoteDefaultText", "photoNoteDefaultText", "indexNoteDefaultText", "mediaNoteDefaultText"];

    for (const key of numKeys) {
      const val = getNum(key);
      if (val !== null) await game.settings.set(MODULE_ID, key, val);
    }
    for (const key of strKeys) {
      const val = getStr(key);
      if (val !== null) await game.settings.set(MODULE_ID, key, val);
    }
  }
}

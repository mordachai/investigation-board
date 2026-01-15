const MODULE_ID = "investigation-board";

// v13 namespaced import
const BasePlaceableHUD = foundry.applications.hud.BasePlaceableHUD;
const HandlebarsApplicationMixin = foundry.applications.api.HandlebarsApplicationMixin;

/**
 * Custom HUD for Investigation Board notes
 * Provides quick editing controls for selected notes
 */
export class InvestigationBoardHUD extends HandlebarsApplicationMixin(BasePlaceableHUD) {

  static DEFAULT_OPTIONS = {
    id: "investigation-board-hud",
    classes: ["investigation-board-hud"],
    window: {
      minimizable: false,
      resizable: false
    }
  };

  static PARTS = {
    main: {
      template: "modules/investigation-board/templates/hud.html"
    }
  };

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "investigation-board-hud",
      template: "modules/investigation-board/templates/hud.html",
      classes: ["investigation-board-hud"],
      minimizable: false,
      resizable: false
    });
  }

  /**
   * Prepare data for the HUD template (v2)
   */
  async _prepareContext(options) {
    const context = await super._prepareContext?.(options) || {};
    const drawing = this.object;

    if (!drawing) return context;

    const noteData = drawing.document.flags[MODULE_ID];

    return {
      ...context,
      noteType: noteData?.type || "sticky",
      text: noteData?.text || "",
      hasConnections: (noteData?.connections?.length || 0) > 0,
      canEdit: drawing.document.testUserPermission(game.user, "OWNER")
    };
  }

  /**
   * Prepare data for the HUD template (v1 compatibility)
   */
  async getData(options = {}) {
    return this._prepareContext(options);
  }

  /**
   * Activate event listeners for HUD controls (v2)
   */
  _onRender(context, options) {
    super._onRender?.(context, options);

    const html = this.element;

    // Edit button - opens full CustomDrawingSheet dialog
    html.querySelector(".edit-note")?.addEventListener("click", (event) => {
      event.preventDefault();
      this.object.document.sheet.render(true);
    });

    // Delete button
    html.querySelector(".delete-note")?.addEventListener("click", async (event) => {
      event.preventDefault();

      const confirm = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Delete Note" },
        content: "<p>Are you sure you want to delete this note?</p>",
        rejectClose: false,
        modal: true
      });

      if (confirm) {
        await this.object.document.delete();
        this.clear();
      }
    });

    // Remove connections button
    html.querySelector(".remove-connections")?.addEventListener("click", (event) => {
      event.preventDefault();

      // Call the showRemoveConnectionDialog function from investigation-board.js
      // This function should be available in the global scope
      if (typeof showRemoveConnectionDialog === "function") {
        showRemoveConnectionDialog(this.object);
      }
    });

    // Quick text input - saves on change
    const textarea = html.querySelector("textarea[name='quickText']");
    textarea?.addEventListener("change", async (event) => {
      const newText = event.target.value;
      await this.object.document.update({
        [`flags.${MODULE_ID}.text`]: newText
      });
    });
  }

  /**
   * Activate event listeners for HUD controls (v1 compatibility)
   */
  activateListeners(html) {
    super.activateListeners?.(html);

    // For v1, convert jQuery to element
    const element = html[0] || html;
    this._onRender({}, {});
  }

  /**
   * Position the HUD adjacent to the selected note
   */
  setPosition(options = {}) {
    const { object } = this;
    if (!object) return super.setPosition(options);

    // Get note dimensions and position
    const noteX = object.document.x;
    const noteY = object.document.y;
    const noteWidth = object.document.shape.width;

    // Position HUD to the right of the note with a 10px gap
    const position = {
      width: 220,
      height: "auto",
      left: noteX + noteWidth + 10,
      top: noteY
    };

    return super.setPosition(position);
  }

  /**
   * Clear the HUD when note is deselected
   */
  clear() {
    if (this.rendered) {
      this.close();
    }
    return this;
  }
}

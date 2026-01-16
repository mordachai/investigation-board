import { MODULE_ID } from "../config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class SetupWarningDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ib-setup-warning",
    tag: "div",
    classes: ["ib-setup-warning-app"],
    window: {
      title: "Investigation Board: Setup Recommended",
      resizable: false,
      minimizable: false,
    },
    position: {
      width: 500,
      height: "auto"
    }
  };

  static PARTS = {
    content: {
      template: "modules/investigation-board/templates/setup-warning.html"
    }
  };

  async _prepareContext(options) {
    const users = game.users.filter(u => !u.isGM);
    const playerRoles = [...new Set(users.map(u => u.role))];
    if (playerRoles.length === 0) playerRoles.push(1);

    const drawingPerm = playerRoles.every(role => game.permissions.DRAWING_CREATE.includes(role));
    const browsePerm = playerRoles.every(role => game.permissions.FILES_BROWSE.includes(role));
    const uploadPerm = playerRoles.every(role => game.permissions.FILES_UPLOAD.includes(role));

    const roleNames = {
        1: "Player",
        2: "Trusted Player",
        3: "Assistant GM"
    };

    const missingUsers = users.map(u => {
        const canDraw = game.permissions.DRAWING_CREATE.includes(u.role);
        const canBrowse = game.permissions.FILES_BROWSE.includes(u.role);
        const canUpload = game.permissions.FILES_UPLOAD.includes(u.role);

        return {
            name: u.name,
            roleName: roleNames[u.role] || "Unknown",
            canDraw,
            canBrowse,
            canUpload
        };
    });

    return {
      drawingPerm,
      browsePerm,
      uploadPerm,
      missingUsers
    };
  }

  _onRender(context, options) {
    const html = this.element;
    
    html.querySelector('[data-action="ok"]')?.addEventListener("click", () => {
      this.close();
    });

    html.querySelector('[data-action="disable"]')?.addEventListener("click", async () => {
      await game.settings.set(MODULE_ID, "showSetupWarning", false);
      this.close();
    });
  }
}

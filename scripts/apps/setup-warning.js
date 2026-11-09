import { MODULE_ID } from "../config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Roles a permission switch applies to: Player, Trusted Player, Assistant GM.
// (Foundry permission lists are per-exact-role, so a switch has to write all three.)
const PLAYER_ROLES = [
  CONST.USER_ROLES.PLAYER,
  CONST.USER_ROLES.TRUSTED,
  CONST.USER_ROLES.ASSISTANT,
];

/**
 * The permissions this dialog manages. `recommended` ones are applied by the
 * "Apply recommended" button; the rest are opt-in and never touched by it.
 */
const PERMISSIONS = [
  {
    key: "DRAWING_CREATE",
    label: "Use Drawing Tools",
    hint: "Create, move, edit and connect notes. Safe.",
    recommended: true,
  },
  {
    key: "FILES_BROWSE",
    label: "Browse Files",
    hint: "Pick any file on your server. Leave off unless needed.",
    recommended: false,
    risky: true,
  },
  {
    key: "FILES_UPLOAD",
    label: "Upload Files",
    hint: "Paste or drop own images. Writes to your server.",
    recommended: false,
    risky: true,
  },
];

/** Roles Foundry grants a permission by default (what the core Permissions screen assumes when unset). */
function defaultRoles(key) {
  const def = CONST.USER_PERMISSIONS[key]?.defaultRole ?? CONST.USER_ROLES.GAMEMASTER;
  return Array.fromRange(CONST.USER_ROLES.GAMEMASTER + 1).slice(def);
}

/**
 * Read the live permission table from the world setting, filling in Foundry's
 * defaults for any managed permission that was never customised.
 */
function readPermissions() {
  const perms = foundry.utils.deepClone(game.settings.get("core", "permissions")) ?? {};
  for (const { key } of PERMISSIONS) perms[key] ??= defaultRoles(key);
  return perms;
}

function nonGMUsers() {
  return game.users.filter(u => !u.isGM);
}

export class SetupWarningDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ib-setup-warning",
    tag: "div",
    classes: ["ib-setup-warning-app"],
    window: {
      title: "Investigation Board: Player Setup",
      resizable: false,
      minimizable: false,
    },
    position: {
      width: 380,
      height: "auto"
    },
    actions: {
      dismiss: SetupWarningDialog.#onDismiss,
      disableWarning: SetupWarningDialog.#onDisableWarning,
    }
  };

  static PARTS = {
    content: {
      template: "modules/investigation-board/templates/setup-warning.html"
    }
  };

  /**
   * True when the one permission the board actually needs (Use Drawing Tools) is
   * missing for some player role. File permissions are optional and never trigger the dialog.
   */
  static needsAttention() {
    const perms = readPermissions();
    const roles = [...new Set(nonGMUsers().map(u => u.role))];
    if (roles.length === 0) roles.push(CONST.USER_ROLES.PLAYER);
    return !roles.every(role => perms.DRAWING_CREATE.includes(role));
  }

  async _prepareContext(options) {
    const perms = readPermissions();

    const permissions = PERMISSIONS.map(p => {
      const enabled = PLAYER_ROLES.every(role => perms[p.key]?.includes(role));
      return { ...p, enabled };
    });

    return { permissions };
  }

  _onRender(context, options) {
    // Attach to the checkboxes directly: AppV2 intercepts bubbled change events.
    this.element.querySelectorAll("input[data-permission]").forEach(input => {
      input.addEventListener("change", async () => {
        try {
          await SetupWarningDialog.#setPermission(input.dataset.permission, input.checked);
        } catch (err) {
          console.error("Investigation Board: could not change permission", err);
          ui.notifications.error(`Investigation Board: could not change permission (${err.message})`);
        }
        this.render();
      });
    });
  }

  /** Add or remove all player roles for a single permission. */
  static async #setPermission(key, enabled) {
    if (!game.user.isGM) return;
    const perms = readPermissions();
    const current = new Set(perms[key] ?? []);
    for (const role of PLAYER_ROLES) enabled ? current.add(role) : current.delete(role);
    current.add(CONST.USER_ROLES.GAMEMASTER); // GMs always keep it (read-only in core's screen)
    perms[key] = [...current].sort();
    await game.settings.set("core", "permissions", perms);
    if (!game.settings.get("core", "permissions")[key]?.includes(PLAYER_ROLES[0]) === enabled) {
      throw new Error("the world did not accept the change");
    }
  }

  /**
   * First time the module runs in a world: turn on the recommended permissions
   * automatically. Returns true when it ran (so the caller can show the dialog once).
   */
  static async firstRunSetup() {
    if (!game.user.isGM || game.settings.get(MODULE_ID, "setupInitialized")) return false;
    for (const p of PERMISSIONS.filter(p => p.recommended)) {
      await SetupWarningDialog.#setPermission(p.key, true);
    }
    await game.settings.set(MODULE_ID, "setupInitialized", true);
    return true;
  }

  static #onDismiss() {
    this.close();
  }

  static async #onDisableWarning() {
    await game.settings.set(MODULE_ID, "showSetupWarning", false);
    this.close();
  }
}

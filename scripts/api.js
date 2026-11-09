import { MODULE_ID } from "./config.js";
import { CaseFiles } from "./apps/case-files.js";
import { BatchEditDialog } from "./apps/batch-edit-dialog.js";
import { createNoteFromEntry } from "./utils/creation-utils.js";
import {
  getEntries, getEntry, getGroups, findEntryBySource, discoveryOf,
  addDocuments, removeEntry, setDiscovery, discoverDocuments, hideDocuments,
  exportCaseFiles, importCaseFiles,
} from "./utils/case-files.js";

/**
 * Public API — for macros and other modules.
 *
 *   investigationBoard.open.caseFiles();
 *   game.modules.get("investigation-board").api.caseFiles.discover("Actor.abc123", "partial");
 *
 * Anything that changes Case Files is GM-only (it silently does nothing for players),
 * like the UI. Reads work for everyone — the data is a world setting every client has.
 *
 * A "target" can be a Case Files entry (or its id), a Document, or a document UUID.
 */

const LEVELS = ["hidden", "partial", "full"];
const clone = x => foundry.utils.deepClone(x);

/** Entry for a target, or null. */
function entryOf(target) {
  if (!target) return null;
  if (typeof target === "object" && !target.documentName) return getEntry(target.id);
  if (typeof target === "object") return findEntryBySource(target.uuid);
  return getEntry(target) ?? findEntryBySource(target);
}

/** Document for a target that is a Document or a UUID, or null. */
async function docOf(target) {
  if (target?.documentName) return target;
  if (typeof target === "string" && target.includes(".")) return fromUuid(target);
  return null;
}

const many = targets => [].concat(targets ?? []);

/** Group id from an id or a group name (case-insensitive), or null. */
function groupIdOf(group) {
  if (!group) return null;
  const groups = getGroups();
  const g = groups.find(x => x.id === group)
    ?? groups.find(x => x.name.toLowerCase() === String(group).toLowerCase());
  return g?.id ?? null;
}

const caseFiles = {
  /** Open (or bring to front) the Case Files window. GM only. */
  open: () => CaseFiles.open(),

  /** Close the window if it's open. */
  close: () => foundry.applications.instances.get(CaseFiles.DEFAULT_OPTIONS.id)?.close(),

  /** @returns {object[]} Copies of all entries, in display order. */
  entries: () => clone(getEntries()),

  /** @returns {object|null} A copy of one entry (by entry, entry id, Document or UUID). */
  entry: target => clone(entryOf(target)),

  /** @returns {object[]} Copies of all groups, in display order. */
  groups: () => clone(getGroups()),

  /**
   * How far players have discovered a target.
   * @returns {"hidden"|"partial"|"full"|null} null when it isn't in Case Files
   */
  status(target) {
    const e = entryOf(target);
    return e ? discoveryOf(e) : null;
  },

  /**
   * Add documents (Documents or UUIDs; Journals and Folders expand) to Case Files.
   * @param {Document|string|Array} targets
   * @param {{group?: string}} [options] - group id or name to add them to
   * @returns {Promise<number>} How many entries were added
   */
  async add(targets, { group = null } = {}) {
    const docs = (await Promise.all(many(targets).map(docOf))).filter(Boolean);
    return addDocuments(docs, groupIdOf(group), { quiet: true });
  },

  /** Remove targets from Case Files. Their notes stay on the board. */
  async remove(targets) {
    for (const t of many(targets)) {
      const e = entryOf(t);
      if (e) await removeEntry(e.id);
    }
  },

  /**
   * Set how far players have discovered targets. A Document/UUID not in Case Files yet
   * is added first (same as the sidebar menu). "partial" only applies to actors.
   * @param {*} targets
   * @param {"full"|"partial"|"hidden"} [level="full"]
   */
  async discover(targets, level = "full") {
    if (!LEVELS.includes(level)) throw new Error(`Investigation Board: unknown discovery level "${level}"`);
    const ids = [];
    const docs = [];
    for (const t of many(targets)) {
      const e = entryOf(t);
      if (e) ids.push(e.id);
      else {
        const doc = await docOf(t);
        if (doc) docs.push(doc);
      }
    }
    if (ids.length) await setDiscovery(ids, level);
    if (docs.length) await (level === "hidden" ? hideDocuments(docs) : discoverDocuments(docs, level));
  },

  /** Hide targets from players (their notes are hidden on every scene). */
  hide: targets => caseFiles.discover(targets, "hidden"),

  /**
   * Put a note for an entry on the current scene.
   * @param {*} target
   * @param {{x?: number, y?: number}} [at] - world coordinates (default: view centre)
   * @returns {Promise<DrawingDocument|undefined>}
   */
  async place(target, at = {}) {
    if (!game.user.isGM) return;
    const e = entryOf(target);
    return e ? createNoteFromEntry(e, at) : undefined;
  },

  /** Download all of Case Files as JSON. GM only. */
  export: () => exportCaseFiles(),

  /**
   * Merge a Case Files export (JSON string or parsed object). Never overwrites.
   * @returns {Promise<{added: number, skipped: number, groups: number}>}
   */
  import: data => importCaseFiles(typeof data === "string" ? data : JSON.stringify(data)),
};

export const api = Object.freeze({
  open: Object.freeze({
    caseFiles: () => caseFiles.open(),
    batchEdit: () => new BatchEditDialog().render(true),
  }),
  caseFiles: Object.freeze(caseFiles),
});

/** Expose the API on the module and as the `investigationBoard` global. */
export function registerApi() {
  game.modules.get(MODULE_ID).api = api;
  globalThis.investigationBoard = api;
  Hooks.callAll("investigationBoard.apiReady", api);
}

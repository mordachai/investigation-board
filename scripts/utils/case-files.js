import { MODULE_ID } from "../config.js";
import { getActorDisplayName } from "./helpers.js";
import { stripHtml, composeEntryText } from "./creation-utils.js";

/**
 * Case Files — the GM's organizer for investigation assets.
 *
 * GMs (and Assistant GMs) drop Actors, Items, Scenes, journal pages (a Journal or a
 * Folder expands into its contents) into the Case Files window. Each entry keeps a
 * player-facing label, a thumbnail, a GM comment and a `revealed` switch; entries can be
 * sorted into groups that carry their own comment.
 *
 * `revealed` drives board visibility: every IB note made from the entry (`flags.revealId`)
 * or linked to its source (`flags.linkedObject`) is hidden/shown across all scenes.
 *
 * Stored in the world setting `caseFiles` = { entries: {id: entry}, groups: {id: group} }.
 * Like every world setting it is sent to all clients — the window is GM-only, but the
 * data (including comments) is readable from the console. UI-hidden, not secret.
 */

const SETTING = "caseFiles";
const LEGACY_SETTING = "revealedAssets";
const SKIP = Symbol("skip-save");

export const KIND_ICONS = {
  image: "fa-image",
  text: "fa-file-lines",
  actor: "fa-user",
  item: "fa-suitcase",
  scene: "fa-map",
};

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

function read() {
  const d = game.settings.get(MODULE_ID, SETTING) ?? {};
  return { entries: d.entries ?? {}, groups: d.groups ?? {} };
}

const bySort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0);

/** @returns {object[]} All entries, in display order within their group. */
export function getEntries() {
  return Object.values(read().entries).sort(bySort);
}

export function getEntry(id) {
  return read().entries[id] ?? null;
}

/** @returns {object[]} All groups, in display order. */
export function getGroups() {
  return Object.values(read().groups).sort(bySort);
}

/** Entry whose source is the given document UUID, or null. */
export function findEntryBySource(uuid) {
  if (!uuid) return null;
  return getEntries().find(e => e.sourceUuid === uuid) ?? null;
}

function linkedUuid(flags) {
  return flags?.linkedObject?.match(/@UUID\[([^\]]+)\]/)?.[1] ?? null;
}

/**
 * How far players have discovered an entry: "hidden" (notes hidden), "partial" (actors
 * only: notes shown, name withheld as "???") or "full".
 * @param {object|null} entry
 */
export function discoveryOf(entry) {
  if (!entry?.revealed) return "hidden";
  return entry.kind === "actor" && entry.unnamed ? "partial" : "full";
}

/**
 * Every IB note made from, or linked to, the given entries — across all scenes.
 * @param {object[]} [entries]
 * @returns {Map<string, {scene: Scene, drawing: DrawingDocument}[]>} keyed by entry id
 */
export function collectNotes(entries = getEntries()) {
  const byId = new Map(entries.map(e => [e.id, []]));
  const byUuid = new Map(entries.filter(e => e.sourceUuid).map(e => [e.sourceUuid, e.id]));
  for (const scene of game.scenes) {
    for (const drawing of scene.drawings) {
      const flags = drawing.flags?.[MODULE_ID];
      if (!flags?.type) continue;
      const id = byId.has(flags.revealId) ? flags.revealId : byUuid.get(linkedUuid(flags));
      if (id) byId.get(id).push({ scene, drawing });
    }
  }
  return byId;
}

/* -------------------------------------------- */
/*  Writing                                     */
/* -------------------------------------------- */

// Read-modify-write on one setting: serialize so overlapping edits never drop each other.
let queue = Promise.resolve();
function mutate(fn) {
  const run = queue.then(async () => {
    const data = foundry.utils.deepClone(read());
    const result = await fn(data);
    if (result === SKIP) return undefined;
    await game.settings.set(MODULE_ID, SETTING, data);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

const nextSort = list => list.reduce((m, x) => Math.max(m, x.sort ?? 0), 0) + 10;
const inGroup = (data, groupId) => Object.values(data.entries).filter(e => (e.groupId ?? null) === groupId);
const isGM = () => game.user.isGM;
const isActiveGM = () => game.users.activeGM?.id === game.user.id;

/* -------------------------------------------- */
/*  Sources                                     */
/* -------------------------------------------- */

function kindOf(doc) {
  switch (doc?.documentName) {
    case "Actor": return "actor";
    case "Item": return "item";
    case "Scene": return "scene";
    case "JournalEntryPage": return ["image", "text"].includes(doc.type) ? doc.type : null;
    default: return null;
  }
}

function usablePages(journal) {
  return journal.pages.contents.filter(p => kindOf(p)).sort(bySort);
}

/** Image path an entry should show for its source. */
function sourceImage(entry, source) {
  switch (entry.kind) {
    case "actor": return (entry.portrait === "token" ? source.prototypeToken?.texture?.src : source.img) || source.img;
    case "item": return source.img;
    case "scene": return source.thumb || source.background?.src;
    case "image": return source.src;
    default: return null;
  }
}

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return String(h);
}

/**
 * Refresh an entry's content from its source. Mutates `entry`.
 * @returns {Promise<boolean>} Whether anything changed
 */
async function applySource(entry, source = null) {
  source ??= fromUuidSync(entry.sourceUuid, { strict: false });
  if (!source) return false;

  if (entry.kind === "text") {
    const text = stripHtml(source.text?.content || "");
    const key = hash(text);
    if (entry.sourceKey === key) return false;
    entry.text = text;
    entry.sourceKey = key;
    return true;
  }

  const path = sourceImage(entry, source);
  if (!path) return false;
  const key = hash(path);
  if (entry.sourceKey === key && entry.image) return false;
  entry.image = path;
  entry.sourceKey = key;
  return true;
}

/* -------------------------------------------- */
/*  Entries                                     */
/* -------------------------------------------- */

/**
 * Add documents to Case Files. Journals expand into their image/text pages and Folders
 * into their contents; either becomes its own group when it yields several entries
 * (unless a target group was given). Sources already in Case Files are skipped.
 * New entries start revealed only if they already have notes on the board, all visible,
 * and an actor starts unnamed if all its photo notes already read "???".
 * @param {Document[]} docs
 * @param {string|null} [groupId]
 * @param {{quiet?: boolean}} [options] - quiet: no "nothing added" notifications
 * @returns {Promise<number>} How many entries were added
 */
export async function addDocuments(docs, groupId = null, { quiet = false } = {}) {
  if (!isGM()) return 0;

  const sources = [];
  let groupName = null;
  const expand = doc => {
    if (doc?.documentName === "JournalEntry") {
      const pages = usablePages(doc);
      if (pages.length > 1) groupName ??= doc.name;
      sources.push(...pages);
    } else if (doc) sources.push(doc);
  };
  for (const doc of docs) {
    if (doc?.documentName === "Folder") {
      groupName ??= doc.name;
      doc.contents.forEach(expand);
    } else expand(doc);
  }

  const built = [];
  for (const src of sources) {
    const kind = kindOf(src);
    if (!kind) continue;
    const entry = {
      id: foundry.utils.randomID(),
      kind,
      sourceUuid: src.uuid,
      label: (kind === "actor" ? getActorDisplayName(src) : src.name) || "Untitled",
      comment: "",
      revealed: false,
      addedAt: Date.now(),
      by: game.user.id,
    };
    if (kind === "actor") entry.portrait = "img";
    try {
      await applySource(entry, src);
    } catch (err) {
      console.error(`Investigation Board: could not read "${src.name}"`, err);
      continue;
    }
    built.push(entry);
  }
  if (!built.length) {
    if (!quiet) ui.notifications.warn("Investigation Board: drop Actors, Items, Scenes, Journals or image/text pages.");
    return 0;
  }

  const notes = collectNotes(built);
  for (const e of built) {
    const list = notes.get(e.id);
    e.revealed = list.length > 0 && list.every(n => !n.drawing.hidden);
    if (e.kind === "actor") {
      const photos = list.filter(n => n.drawing.flags[MODULE_ID].type === "photo");
      e.unnamed = photos.length > 0 && photos.every(n => (n.drawing.flags[MODULE_ID].text ?? "").trim() === UNKNOWN);
    }
  }

  const added = await mutate(data => {
    const known = new Set(Object.values(data.entries).map(e => e.sourceUuid));
    const fresh = built.filter(e => !known.has(e.sourceUuid));
    if (!fresh.length) return SKIP;

    let gid = groupId && data.groups[groupId] ? groupId : null;
    if (!gid && groupName && fresh.length > 1) {
      gid = foundry.utils.randomID();
      data.groups[gid] = { id: gid, name: groupName, comment: "", collapsed: false, sort: nextSort(Object.values(data.groups)) };
    }
    let sort = nextSort(inGroup(data, gid));
    for (const e of fresh) {
      e.groupId = gid;
      e.sort = sort;
      sort += 10;
      data.entries[e.id] = e;
    }
    return fresh.length;
  });

  if (!added && !quiet) ui.notifications.info("Investigation Board: already in Case Files.");
  return added ?? 0;
}

/** Edit an entry's label and/or GM comment. A new label is written into its notes. */
export async function updateEntry(id, { label, comment } = {}) {
  const renamed = await mutate(data => {
    const e = data.entries[id];
    if (!e) return SKIP;
    let renamed = null;
    const l = label === undefined ? "" : String(label).trim();
    if (l && l !== e.label) {
      e.label = l;
      e.labelAt = Date.now();
      renamed = e;
    }
    if (comment !== undefined) e.comment = String(comment);
    return renamed;
  });
  if (renamed) await pushLabel(renamed);
}

/* -------------------------------------------- */
/*  Name sync (entry label <-> note text)       */
/* -------------------------------------------- */

// The note type that carries an entry's name: photo caption, or an index card's first
// paragraph. Handouts (image pages) show no name.
const NAMED_NOTE = { actor: "photo", item: "photo", scene: "photo", text: "index" };
const UNKNOWN = "???";

/**
 * Notes whose text carries the entry's name: made from the entry, or linked to its
 * source, and of the matching type. Notes reading "???" are deliberately unknown and
 * never synced either way, so a rename can't leak a name players shouldn't have yet.
 * A partially discovered actor (`unnamed`) syncs nothing at all, for the same reason.
 */
function namedNotes(entry) {
  const type = NAMED_NOTE[entry.kind];
  if (!type || entry.unnamed) return [];
  return (collectNotes([entry]).get(entry.id) ?? []).filter(({ drawing }) => {
    const flags = drawing.flags[MODULE_ID];
    return flags.type === type && (flags.text ?? "").trim() !== UNKNOWN;
  });
}

/** Name an entry would get from a note's text, or null. */
function labelFromText(entry, text) {
  // An unnamed actor's notes may hold players' guesses — never adopt those as the name.
  if (!NAMED_NOTE[entry.kind] || entry.unnamed || typeof text !== "string") return null;
  const t = text.trim();
  if (!t || t === UNKNOWN) return null;
  return entry.kind === "text" ? t.split(/\n\s*\n/)[0].trim() || null : t;
}

/** Note text with the entry's label swapped in, keeping an index card's body. */
function textWithLabel(entry, text = "") {
  if (entry.kind !== "text") return entry.label;
  const gap = text.match(/\n\s*\n/);
  return gap ? entry.label + text.slice(gap.index) : composeEntryText(entry);
}

/** Write the entry's label into every note that shows its name. */
async function pushLabel(entry) {
  const perScene = new Map();
  for (const { scene, drawing } of namedNotes(entry)) {
    const current = drawing.flags[MODULE_ID].text ?? "";
    const text = textWithLabel(entry, current);
    if (text === current) continue;
    if (!perScene.has(scene)) perScene.set(scene, []);
    perScene.get(scene).push({ _id: drawing.id, [`flags.${MODULE_ID}.text`]: text });
  }
  for (const [scene, updates] of perScene) {
    await scene.updateEmbeddedDocuments("Drawing", updates, { ibCaseLabel: true });
  }
}

/** Entry a note's flags belong to (made from it, or linked to its source), or null. */
function entryOf(flags) {
  if (!flags?.type) return null;
  return (flags.revealId && getEntry(flags.revealId)) || findEntryBySource(linkedUuid(flags));
}

/** Entry whose name a note shows (matching note type), or null. */
function entryForNote(drawing) {
  const flags = drawing.flags?.[MODULE_ID];
  const entry = entryOf(flags);
  return entry && NAMED_NOTE[entry.kind] === flags.type ? entry : null;
}

/** A note's text was edited (by anyone) → adopt its name; updateEntry pushes it to the rest. */
function onNoteTextEdited(drawing, changes, options) {
  if (!isActiveGM() || options?.ibCaseLabel) return;
  const text = foundry.utils.getProperty(changes, `flags.${MODULE_ID}.text`);
  if (text === undefined) return;
  const entry = entryForNote(drawing);
  const label = entry && labelFromText(entry, text);
  if (label && label !== entry.label) updateEntry(entry.id, { label });
}

/**
 * Notes edited while no GM was online: if a named note changed after the entry's last
 * rename and shows a different name, the most recent such edit wins.
 */
async function adoptOfflineLabel(entry) {
  const since = entry.labelAt ?? entry.addedAt ?? 0;
  let best = null;
  for (const { drawing } of namedNotes(entry)) {
    const at = drawing._stats?.modifiedTime ?? 0;
    const label = labelFromText(entry, drawing.flags[MODULE_ID].text);
    if (at > since && label && label !== entry.label && (!best || at > best.at)) best = { at, label };
  }
  if (best) await updateEntry(entry.id, { label: best.label });
}

/** Remove an entry. Notes on the board stay but stop syncing. */
export function removeEntry(id) {
  return mutate(data => {
    if (!data.entries[id]) return SKIP;
    delete data.entries[id];
  });
}

/**
 * Move an entry into a group (null = ungrouped), optionally before another entry.
 */
export function moveEntry(id, groupId = null, beforeId = null) {
  return mutate(data => {
    const entry = data.entries[id];
    if (!entry || id === beforeId) return SKIP;
    const gid = groupId && data.groups[groupId] ? groupId : null;
    const list = inGroup(data, gid).filter(e => e.id !== id).sort(bySort);
    const at = beforeId ? list.findIndex(e => e.id === beforeId) : -1;
    list.splice(at < 0 ? list.length : at, 0, entry);
    entry.groupId = gid;
    list.forEach((e, i) => { e.sort = (i + 1) * 10; });
  });
}

/**
 * Reveal or hide entries, and show/hide every note made from or linked to them.
 * @param {string|string[]} ids
 * @param {boolean} revealed
 */
export async function setRevealed(ids, revealed) {
  if (!isGM()) return;
  ids = [].concat(ids);
  const changed = await mutate(data => {
    const list = ids.map(id => data.entries[id]).filter(Boolean);
    for (const e of list) e.revealed = revealed;
    return list.length ? list : SKIP;
  });
  if (!changed?.length) return;
  await syncNoteVisibility(changed);
  await syncPageAccess(changed);
}

/** Bring note `hidden` state in line with each entry's `revealed`. */
async function syncNoteVisibility(entries) {
  const notes = collectNotes(entries);
  const perScene = new Map();
  for (const entry of entries) {
    const hidden = !entry.revealed;
    for (const { scene, drawing } of notes.get(entry.id) ?? []) {
      if (drawing.hidden === hidden) continue;
      if (!perScene.has(scene)) perScene.set(scene, []);
      perScene.get(scene).push({ _id: drawing.id, hidden });
    }
  }
  for (const [scene, updates] of perScene) {
    await scene.updateEmbeddedDocuments("Drawing", updates);
  }
}

/**
 * Set how far players have discovered entries ("hidden" | "partial" | "full").
 * "partial" only means something for actors; other kinds treat it as "full".
 * Names are written before notes are shown, so a partial reveal never flashes the name.
 * @param {string|string[]} ids
 * @param {"hidden"|"partial"|"full"} level
 */
export async function setDiscovery(ids, level) {
  if (!isGM()) return;
  ids = [].concat(ids);
  const changed = await mutate(data => {
    const list = ids.map(id => data.entries[id]).filter(Boolean);
    for (const e of list) {
      e.revealed = level !== "hidden";
      if (e.kind === "actor" && level !== "hidden") e.unnamed = level === "partial";
    }
    return list.length ? list : SKIP;
  });
  if (!changed?.length) return;
  if (level !== "hidden") {
    for (const e of changed) if (e.kind === "actor") await syncNoteNames(e);
  }
  await syncNoteVisibility(changed);
  await syncPageAccess(changed);
}

/**
 * Let players open the journal pages behind entries: revealed → Observer, hidden → None.
 * A discovered page then shows in their Journal sidebar, and its notes' "Open" item works.
 *
 * Only `ownership.default` is touched (per-user overrides are left alone). The sidebar
 * lists a journal only at Observer, and pages inherit the journal's level, so when a
 * journal has to be raised its other inheriting pages are first pinned to the old level
 * (they stay hidden). The old level is kept in a flag and given back once none of the
 * journal's pages is visible any more. Compendium pages are skipped.
 * @param {object[]} entries
 */
async function syncPageAccess(entries) {
  const { NONE, OBSERVER, INHERIT } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const byJournal = new Map();
  for (const e of entries) {
    if (e.kind !== "image" && e.kind !== "text") continue;
    const page = fromUuidSync(e.sourceUuid, { strict: false });
    if (page?.documentName !== "JournalEntryPage" || page.pack || !page.parent) continue;
    if (!byJournal.has(page.parent)) byJournal.set(page.parent, new Map());
    byJournal.get(page.parent).set(page.id, e.revealed ? OBSERVER : NONE);
  }

  for (const [journal, wanted] of byJournal) {
    const current = journal.ownership.default;
    const prior = journal.getFlag(MODULE_ID, "priorDefault") ?? null;
    const target = new Map(journal.pages.contents.map(p => [
      p, wanted.get(p.id) ?? (p.ownership.default === INHERIT ? current : p.ownership.default),
    ]));
    const anyVisible = [...target.values()].some(l => l >= OBSERVER);

    let next = current;
    const journalUpdate = {};
    if (anyVisible && current < OBSERVER) {
      next = OBSERVER;
      journalUpdate[`flags.${MODULE_ID}.priorDefault`] = current;
    } else if (!anyVisible && prior !== null) {
      next = prior;
      journalUpdate[`flags.${MODULE_ID}.priorDefault`] = null;
    }
    if (next !== current) journalUpdate.ownership = { ...journal.ownership, default: next };

    const pageUpdates = [];
    for (const [p, level] of target) {
      const d = p.ownership.default;
      if (d === INHERIT ? level === next : d === level) continue;
      pageUpdates.push({ _id: p.id, ownership: { ...p.ownership, default: level } });
    }

    // Pages first, so raising the journal never flashes the pages that should stay hidden.
    if (pageUpdates.length) await journal.updateEmbeddedDocuments("JournalEntryPage", pageUpdates);
    if (Object.keys(journalUpdate).length) await journal.update(journalUpdate);
  }
}

/** Withhold (or give) an actor entry's name on the board, without changing visibility. */
export async function setNameHidden(id, unnamed) {
  if (!isGM()) return;
  const entry = await mutate(data => {
    const e = data.entries[id];
    if (!e || e.kind !== "actor") return SKIP;
    e.unnamed = !!unnamed;
    return e;
  });
  if (entry) await syncNoteNames(entry);
}

/**
 * Every photo note of an actor entry shows "???" (unnamed) or its label — including
 * notes that read "???" today: a full reveal is the moment players learn the name.
 */
async function syncNoteNames(entry) {
  const name = entry.unnamed ? UNKNOWN : entry.label;
  const perScene = new Map();
  for (const { scene, drawing } of collectNotes([entry]).get(entry.id) ?? []) {
    const flags = drawing.flags[MODULE_ID];
    if (flags.type !== "photo" || flags.text === name) continue;
    const u = { _id: drawing.id, [`flags.${MODULE_ID}.text`]: name };
    if (flags.linkedObject) u[`flags.${MODULE_ID}.linkedObject`] = relabelLink(flags.linkedObject, name);
    if (!perScene.has(scene)) perScene.set(scene, []);
    perScene.get(scene).push(u);
  }
  for (const [scene, updates] of perScene) {
    await scene.updateEmbeddedDocuments("Drawing", updates, { ibCaseLabel: true });
  }
}

/** `@UUID[x]{Old}` → `@UUID[x]{name}`, so the link label doesn't carry a withheld name. */
function relabelLink(link, name) {
  const uuid = link.match(/@UUID\[([^\]]+)\]/)?.[1];
  return uuid ? `@UUID[${uuid}]{${name}}` : link;
}

/** Docs a context-menu action applies to: a Journal stands for its image/text pages. */
function discoverable(docs) {
  return docs.flatMap(d => d?.documentName === "JournalEntry" ? usablePages(d) : (kindOf(d) ? [d] : []));
}

/** Discover documents from a context menu, adding them to Case Files first if needed. */
export async function discoverDocuments(docs, level) {
  await addDocuments(docs, null, { quiet: true });
  const ids = discoverable(docs).map(d => findEntryBySource(d.uuid)?.id).filter(Boolean);
  if (ids.length) await setDiscovery(ids, level);
}

/** Hide documents from players (only those already in Case Files). */
export async function hideDocuments(docs) {
  const ids = discoverable(docs).map(d => findEntryBySource(d.uuid)?.id).filter(Boolean);
  if (ids.length) await setDiscovery(ids, "hidden");
}

/* -------------------------------------------- */
/*  Groups                                      */
/* -------------------------------------------- */

/** @returns {Promise<string>} The new group's id */
export function createGroup(name = "New Group") {
  return mutate(data => {
    const id = foundry.utils.randomID();
    data.groups[id] = { id, name, comment: "", collapsed: false, sort: nextSort(Object.values(data.groups)) };
    return id;
  });
}

export function updateGroup(id, { name, comment, collapsed } = {}) {
  return mutate(data => {
    const g = data.groups[id];
    if (!g) return SKIP;
    if (name !== undefined) g.name = String(name).trim() || g.name;
    if (comment !== undefined) g.comment = String(comment);
    if (collapsed !== undefined) g.collapsed = !!collapsed;
  });
}

/** Delete a group; its entries become ungrouped. */
export function removeGroup(id) {
  return mutate(data => {
    if (!data.groups[id]) return SKIP;
    delete data.groups[id];
    let sort = nextSort(inGroup(data, null));
    for (const e of Object.values(data.entries)) {
      if (e.groupId !== id) continue;
      e.groupId = null;
      e.sort = sort;
      sort += 10;
    }
  });
}

/* -------------------------------------------- */
/*  Export / import                             */
/* -------------------------------------------- */

const EXPORT_FORMAT = "investigation-board.case-files";

/** Download every entry and group as a JSON file. */
export function exportCaseFiles() {
  if (!isGM()) return;
  const { entries, groups } = read();
  const payload = {
    format: EXPORT_FORMAT,
    version: 1,
    module: game.modules.get(MODULE_ID)?.version ?? null,
    world: game.world.id,
    exportedAt: new Date().toISOString(),
    groups, entries,
  };
  const stamp = new Date().toISOString().slice(0, 10);
  foundry.utils.saveDataToFile(JSON.stringify(payload, null, 2), "application/json",
    `case-files-${game.world.id}-${stamp}.json`);
}

/**
 * Merge an exported file into Case Files. Nothing is overwritten: entries whose source
 * is already in Case Files are skipped, so importing the same file twice is harmless.
 * Imported entries then bring their notes on this world's board in line (names first,
 * then visibility) and refresh from their sources where those exist here.
 * @param {string} json
 * @returns {Promise<{added: number, skipped: number, groups: number}>}
 */
export async function importCaseFiles(json) {
  if (!isGM()) return { added: 0, skipped: 0, groups: 0 };
  let payload;
  try { payload = JSON.parse(json); } catch { payload = null; }
  if (payload?.format !== EXPORT_FORMAT || typeof payload.entries !== "object") {
    throw new Error("Not a Case Files export.");
  }
  const inEntries = Object.values(payload.entries ?? {}).filter(e => e?.kind && KIND_ICONS[e.kind]);
  const inGroups = Object.values(payload.groups ?? {}).filter(g => g?.id);

  const result = await mutate(data => {
    const known = new Set(Object.values(data.entries).map(e => e.sourceUuid).filter(Boolean));
    const fresh = inEntries.filter(e => !e.sourceUuid || !known.has(e.sourceUuid));
    const skipped = inEntries.length - fresh.length;

    // Groups: reuse one with the same id; otherwise create it if it gets entries (or was empty).
    const groupMap = new Map();
    let groupSort = nextSort(Object.values(data.groups));
    let newGroups = 0;
    for (const g of inGroups.sort(bySort)) {
      if (data.groups[g.id]) { groupMap.set(g.id, g.id); continue; }
      const used = fresh.some(e => e.groupId === g.id);
      const wasEmpty = !inEntries.some(e => e.groupId === g.id);
      if (!used && !wasEmpty) continue;
      data.groups[g.id] = {
        id: g.id, name: String(g.name || "Imported"), comment: String(g.comment ?? ""),
        collapsed: !!g.collapsed, sort: groupSort,
      };
      groupSort += 10;
      groupMap.set(g.id, g.id);
      newGroups++;
    }

    const added = [];
    const sorts = new Map();
    for (const e of fresh.sort(bySort)) {
      const gid = groupMap.get(e.groupId) ?? null;
      if (!sorts.has(gid)) sorts.set(gid, nextSort(inGroup(data, gid)));
      const id = data.entries[e.id] ? foundry.utils.randomID() : (e.id || foundry.utils.randomID());
      const entry = { ...e, id, groupId: gid, sort: sorts.get(gid), comment: String(e.comment ?? ""), revealed: !!e.revealed };
      sorts.set(gid, entry.sort + 10);
      data.entries[id] = entry;
      added.push(entry);
    }
    if (!added.length && !newGroups) return SKIP;
    return { added, skipped, groups: newGroups };
  });
  if (!result) return { added: 0, skipped: inEntries.length, groups: 0 };

  for (const e of result.added) if (e.kind === "actor") await syncNoteNames(e);
  await syncNoteVisibility(result.added);
  // Only grant, never take away: an import shouldn't hide pages this world already shows.
  await syncPageAccess(result.added.filter(e => e.revealed));
  for (const e of result.added) await syncEntry(e.id);
  return { added: result.added.length, skipped: result.skipped, groups: result.groups };
}

/* -------------------------------------------- */
/*  Hot sync (active GM client only)            */
/* -------------------------------------------- */

/** Push an entry's current content into every note made from it. */
async function propagate(entry) {
  for (const scene of game.scenes) {
    const updates = [];
    for (const drawing of scene.drawings) {
      if (drawing.flags?.[MODULE_ID]?.revealId !== entry.id) continue;
      const u = { _id: drawing.id };
      if (entry.kind === "text") u[`flags.${MODULE_ID}.text`] = composeEntryText(entry);
      else if (entry.image) u[`flags.${MODULE_ID}.image`] = entry.image;
      updates.push(u);
    }
    if (updates.length) await scene.updateEmbeddedDocuments("Drawing", updates, { ibReveal: true });
  }
}

/** Re-sync one entry from its source, and update its notes if it changed. */
async function syncEntry(entryId) {
  let changedEntry = null;
  try {
    changedEntry = await mutate(async data => {
      const entry = data.entries[entryId];
      if (!entry || !(await applySource(entry))) return SKIP;
      return entry;
    });
  } catch (err) {
    console.error("Investigation Board: case file sync failed", err);
    return;
  }
  if (changedEntry) await propagate(changedEntry);
}

/** Reconcile every entry with its source — catches edits made while no GM was online. */
export async function reconcileCaseFiles() {
  if (!isActiveGM()) return;
  await migrateLegacy();
  for (const entry of getEntries()) {
    await syncEntry(entry.id);
    await adoptOfflineLabel(getEntry(entry.id) ?? entry);
  }
}

/** One-time move of the old "Discovered" entries (all were revealed) into Case Files. */
async function migrateLegacy() {
  const legacy = game.settings.get(MODULE_ID, LEGACY_SETTING) ?? {};
  const old = Object.values(legacy);
  if (!old.length) return;
  await mutate(data => {
    let sort = nextSort(inGroup(data, null));
    for (const e of old) {
      if (data.entries[e.id]) continue;
      data.entries[e.id] = { ...e, comment: "", revealed: true, groupId: null, sort, addedAt: e.revealedAt ?? Date.now() };
      sort += 10;
    }
  });
  await game.settings.set(MODULE_ID, LEGACY_SETTING, {});
}

/* -------------------------------------------- */
/*  Markers                                     */
/* -------------------------------------------- */

const MARKERS = {
  hidden: { icon: "fa-box-archive", cls: "", title: "In Case Files · not discovered" },
  partial: { icon: "fa-user-secret", cls: " is-partial", title: "Partially discovered · name hidden" },
  full: { icon: "fa-eye", cls: " is-revealed", title: "Discovered by players" },
};

// Clicking a marker steps the entry to its next level: actors cycle hidden → partial →
// full → hidden, everything else toggles hidden ↔ full.
function nextLevel(entry) {
  const level = discoveryOf(entry);
  if (entry.kind === "actor") return { hidden: "partial", partial: "full", full: "hidden" }[level];
  return level === "hidden" ? "full" : "hidden";
}
const NEXT_HINT = { hidden: "hide from players", partial: "partially discover", full: "discover" };

/** Make a marker a one-click toggle that doesn't also open/select the row under it. */
function asToggle(el, onToggle) {
  el.classList.add("ib-case-toggle");
  el.setAttribute("role", "button");
  el.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  });
  // Swallow the double-click too, so a quick second click never opens the sheet.
  el.addEventListener("dblclick", event => { event.preventDefault(); event.stopPropagation(); });
  return el;
}

/**
 * How an entry's discovery marker looks and what clicking it does — shared by the
 * directory/TOC markers and the Case Files window, so both read the same.
 * @returns {{level: string, next: string, icon: string, cls: string, title: string, hint: string}}
 */
export function markerInfo(entry) {
  const level = discoveryOf(entry);
  const next = nextLevel(entry);
  const m = MARKERS[level];
  return { level, next, ...m, hint: `${m.title} · click to ${NEXT_HINT[next]}` };
}

/** Step an entry to its next discovery level (see `nextLevel`). */
export function cycleDiscovery(id) {
  const entry = getEntry(id);   // fresh, in case the UI hasn't re-rendered yet
  if (entry) return setDiscovery(entry.id, nextLevel(entry));
}

function marker(entry) {
  const el = document.createElement("i");
  const { icon, cls, hint } = markerInfo(entry);
  el.className = `fa-solid ${icon} ib-case-marker${cls}`;
  el.dataset.tooltip = hint;
  el.setAttribute("aria-label", hint);
  return asToggle(el, () => cycleDiscovery(entry.id));
}

const entriesByUuid = () => new Map(getEntries().map(e => [e.sourceUuid, e]));

/** Re-render the Case Files window and every place that shows markers. */
export function refreshCaseUI() {
  if (!isGM()) return;
  foundry.applications.instances.get("ib-case-files")?.render();
  for (const app of foundry.applications.instances.values()) {
    if ((app.document ?? app.entry)?.documentName === "JournalEntry") app.render();
  }
  ui.journal?.render();
  ui.actors?.render();
  ui.items?.render();
  ui.scenes?.render();
}

function markPages(app) {
  const journal = app.document ?? app.entry;
  if (!isGM() || !journal?.pages) return;
  const map = entriesByUuid();
  app.element.querySelectorAll(".toc li[data-page-id]").forEach(li => {
    li.querySelector(".ib-case-marker")?.remove();
    const entry = map.get(journal.pages.get(li.dataset.pageId)?.uuid);
    if (entry) li.querySelector(".page-heading")?.append(marker(entry));
  });
}

/** Journal directory: "n/m" pages-in-Case-Files badge. */
function markJournalDirectory(app, html) {
  if (!isGM()) return;
  const root = html instanceof HTMLElement ? html : app.element;
  const perJournal = new Map();
  for (const e of getEntries()) {
    const id = e.sourceUuid?.match(/^JournalEntry\.([^.]+)\.JournalEntryPage\./)?.[1];
    if (!id) continue;
    const c = perJournal.get(id) ?? { count: 0, revealed: 0, ids: [] };
    c.count++;
    c.ids.push(e.id);
    if (e.revealed) c.revealed++;
    perJournal.set(id, c);
  }
  root.querySelectorAll("li.directory-item.entry[data-entry-id]").forEach(li => {
    li.querySelector(".ib-case-count")?.remove();
    const c = perJournal.get(li.dataset.entryId);
    if (!c) return;
    const total = game.journal.get(li.dataset.entryId)?.pages.size ?? c.count;
    const all = c.revealed === c.count;
    const badge = document.createElement("span");
    badge.className = `ib-case-count${all ? " is-revealed" : c.revealed ? " is-partial" : ""}`;
    badge.dataset.tooltip = `${c.count} of ${total} pages in Case Files · ${c.revealed} revealed`
      + ` · click to ${all ? "hide them all" : "discover them all"}`;
    badge.innerHTML = `<i class="fa-solid ${all ? "fa-eye" : "fa-box-archive"}"></i> ${c.count}/${total}`;
    asToggle(badge, () => setDiscovery(c.ids, all ? "hidden" : "full"));
    li.querySelector(".entry-name, .entry-title, a")?.after(badge);
  });
}

function markDirectory(collection) {
  return (app, html) => {
    if (!isGM()) return;
    const root = html instanceof HTMLElement ? html : app.element;
    const map = entriesByUuid();
    root.querySelectorAll("li.directory-item.entry[data-entry-id]").forEach(li => {
      li.querySelector(".ib-case-marker")?.remove();
      const entry = map.get(collection()?.get(li.dataset.entryId)?.uuid);
      if (entry) li.querySelector(".entry-name, .entry-title, a")?.after(marker(entry));
    });
  };
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

function docFromLi(li, collection) {
  const el = li instanceof HTMLElement ? li : li?.[0];
  const t = el?.closest?.("[data-entry-id],[data-document-id],[data-scene-id]") ?? el;
  const id = t?.dataset?.entryId ?? t?.dataset?.documentId ?? t?.dataset?.sceneId;
  return id ? collection.get(id) : null;
}

/**
 * Discovery items on a directory's context menu. One click, no prompt; a document not
 * yet in Case Files is added on its first discovery. Actors offer partial/full; other
 * documents a single "Discovered by Players". A Journal acts on all its image/text pages.
 */
function discoveryMenu(hook, resolve, { actor = false } = {}) {
  Hooks.on(hook, (app, options) => {
    const docOf = li => (isGM() && resolve(li, app)) || null;
    // Every level present among the document's entries (a Journal can be mixed).
    const levels = li => {
      const doc = docOf(li);
      if (!doc) return null;
      const pages = discoverable([doc]);
      return pages.length ? new Set(pages.map(p => discoveryOf(findEntryBySource(p.uuid)))) : null;
    };
    const unlessOnly = level => li => {
      const l = levels(li);
      return !!l && !(l.size === 1 && l.has(level));
    };
    const discover = level => (event, li) => {
      const doc = docOf(li);
      if (doc) return discoverDocuments([doc], level);
    };

    const items = actor ? [
      { label: "Partially Discovered", icon: "fa-solid fa-user-secret", visible: unlessOnly("partial"), onClick: discover("partial") },
      { label: "Fully Discovered", icon: "fa-solid fa-id-card", visible: unlessOnly("full"), onClick: discover("full") },
    ] : [
      { label: "Discovered by Players", icon: "fa-solid fa-eye", visible: unlessOnly("full"), onClick: discover("full") },
    ];
    items.push({
      label: "Hide from Players",
      icon: "fa-solid fa-eye-slash",
      visible: li => !!levels(li) && [...levels(li)].some(l => l !== "hidden"),
      onClick: (event, li) => {
        const doc = docOf(li);
        if (doc) return hideDocuments([doc]);
      },
    });
    options.push(...items);
  });
}

export function registerCaseHooks() {
  discoveryMenu("getActorContextOptions", li => docFromLi(li, game.actors), { actor: true });
  discoveryMenu("getItemContextOptions", li => docFromLi(li, game.items));
  discoveryMenu("getSceneContextOptions", li => docFromLi(li, game.scenes));
  discoveryMenu("getJournalEntryContextOptions", li => docFromLi(li, game.journal));
  discoveryMenu("getJournalEntryPageContextOptions", (li, app) => {
    const el = li instanceof HTMLElement ? li : li?.[0];
    const pageId = el?.dataset?.pageId ?? el?.closest?.("[data-page-id]")?.dataset.pageId;
    const page = (app.document ?? app.entry)?.pages?.get(pageId);
    return kindOf(page) ? page : null;
  });

  // A journal Case Files raised to Observer (to list one discovered page) must not show
  // pages added to it later: they start at the journal's own level instead of inheriting.
  Hooks.on("preCreateJournalEntryPage", (page, data) => {
    const prior = page.parent?.getFlag(MODULE_ID, "priorDefault") ?? null;
    if (prior === null) return;
    const { INHERIT } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    if ((data.ownership?.default ?? INHERIT) !== INHERIT) return;
    page.updateSource({ ownership: { ...page.ownership, default: prior } });
  });

  // Notes the GM makes for a Case Files source (e.g. an actor dragged onto the board)
  // follow the entry: hidden until discovered, "???" while an actor is partially known.
  // Players' own notes are left alone.
  Hooks.on("preCreateDrawing", (drawing, data, options, userId) => {
    if (!game.users.get(options.ibRequestingUser ?? userId)?.isGM) return;
    const flags = drawing.flags?.[MODULE_ID];
    const entry = entryOf(flags);
    if (!entry) return;
    const update = {};
    if (!("hidden" in data)) update.hidden = !entry.revealed;
    if (entry.unnamed && flags.type === "photo" && flags.text !== UNKNOWN) {
      update[`flags.${MODULE_ID}.text`] = UNKNOWN;
      if (flags.linkedObject) update[`flags.${MODULE_ID}.linkedObject`] = relabelLink(flags.linkedObject, UNKNOWN);
    }
    if (Object.keys(update).length) drawing.updateSource(update);
  });

  // Markers
  Hooks.on("renderJournalEntrySheet", app => markPages(app));
  Hooks.on("renderJournalDirectory", markJournalDirectory);
  Hooks.on("renderActorDirectory", markDirectory(() => game.actors));
  Hooks.on("renderItemDirectory", markDirectory(() => game.items));
  Hooks.on("renderSceneDirectory", markDirectory(() => game.scenes));

  // Hot sync — only the active GM writes, so two GMs don't double-update notes.
  const watch = (hook, keys) => Hooks.on(hook, (doc, changes) => {
    if (!isActiveGM() || !keys.some(k => k in changes)) return;
    const entry = findEntryBySource(doc.uuid);
    if (entry) syncEntry(entry.id);
  });
  watch("updateJournalEntryPage", ["src", "text"]);
  watch("updateActor", ["img", "prototypeToken"]);
  watch("updateItem", ["img"]);
  watch("updateScene", ["thumb", "background"]);

  // Note counts in the window follow the board.
  const rerender = foundry.utils.debounce(() => {
    foundry.applications.instances.get("ib-case-files")?.render();
  }, 150);
  const onNoteChange = (drawing, changes) => {
    if (!isGM() || !drawing.flags?.[MODULE_ID]) return;
    if (changes && !("hidden" in changes) && !changes.flags?.[MODULE_ID]) return;
    rerender();
  };
  Hooks.on("createDrawing", d => onNoteChange(d));
  Hooks.on("deleteDrawing", d => onNoteChange(d));
  Hooks.on("updateDrawing", (d, changes) => onNoteChange(d, changes));

  // Names follow note edits, whoever made them (players' edits arrive via the GM socket).
  Hooks.on("updateDrawing", onNoteTextEdited);
}

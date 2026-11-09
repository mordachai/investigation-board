import { createNoteFromEntry } from "../utils/creation-utils.js";
import {
  KIND_ICONS, getEntries, getEntry, getGroups, collectNotes,
  addDocuments, updateEntry, removeEntry, moveEntry, setRevealed, markerInfo, cycleDiscovery,
  exportCaseFiles, importCaseFiles,
  createGroup, updateGroup, removeGroup,
} from "../utils/case-files.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const TextEditor = () => foundry.applications.ux.TextEditor.implementation;

/** Drag payload type for a Case Files row (to the canvas or to another group). */
export const CASE_ENTRY_DRAG = "IBCaseEntry";

const DROPPABLE = ["Actor", "Item", "Scene", "JournalEntry", "JournalEntryPage", "Folder"];

/**
 * Row order inside each group. Groups themselves always stay (in the GM's order);
 * only "manual" lets rows be dragged into place — the others are computed.
 */
const SORT_MODES = [
  { id: "manual", icon: "fa-grip-lines", tooltip: "GM order (drag to reorder)" },
  { id: "kind", icon: "fa-shapes", tooltip: "By type, then A–Z" },
  { id: "alpha", icon: "fa-arrow-down-a-z", tooltip: "Alphabetical" },
];

const KIND_ORDER = ["actor", "item", "scene", "image", "text"];

const byLabel = (a, b) => (a.label ?? "").localeCompare(b.label ?? "", game.i18n.lang, { sensitivity: "base", numeric: true });
const byKind = (a, b) => (KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)) || byLabel(a, b);
const SORTERS = { kind: byKind, alpha: byLabel };

/**
 * Case Files — GM-only organizer. Drop documents in, sort them into groups, keep GM
 * comments, flip "revealed" to show/hide their notes on the board, and drag a row onto
 * the canvas to make a note.
 */
export class CaseFiles extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ib-case-files",
    tag: "div",
    classes: ["ib-case-files-app"],
    window: {
      title: "Case Files",
      icon: "fa-solid fa-box-archive",
      resizable: true,
      minimizable: true,
    },
    position: { width: 460, height: 560 },
    actions: {
      addGroup: CaseFiles.#onAddGroup,
      removeGroup: CaseFiles.#onRemoveGroup,
      toggleCollapse: CaseFiles.#onToggleCollapse,
      toggleComment: CaseFiles.#onToggleComment,
      placeEntry: CaseFiles.#onPlaceEntry,
      openSource: CaseFiles.#onOpenSource,
      removeEntry: CaseFiles.#onRemoveEntry,
      panTo: CaseFiles.#onPanTo,
      cycleDiscovery: CaseFiles.#onCycleDiscovery,
      toggleGroupDiscovery: CaseFiles.#onToggleGroupDiscovery,
      exportFiles: () => exportCaseFiles(),
      importFiles: CaseFiles.#onImport,
      setSort: CaseFiles.#onSetSort,
    },
  };

  static PARTS = {
    content: {
      template: "modules/investigation-board/templates/case-files.html",
      scrollable: [".ib-case-body"],
    },
  };

  /** Open (or focus) the singleton window. GM / Assistant GM only. */
  static open() {
    if (!game.user.isGM) return;
    const existing = foundry.applications.instances.get(CaseFiles.DEFAULT_OPTIONS.id);
    if (existing) return existing.render({ force: true });
    return new CaseFiles().render({ force: true });
  }

  /** Comment boxes opened by the GM that are still empty. */
  #openComments = new Set();
  /** Whether "Ungrouped" is collapsed — not a real group, so local to this window. */
  #ungroupedCollapsed = false;
  #filter = "";
  #focusAfterRender = null;
  #panIndex = new Map();

  /* -------------------------------------------- */

  async _prepareContext() {
    const entries = getEntries();
    const notes = collectNotes(entries);
    const mode = CaseFiles.#sortMode();
    const order = list => (SORTERS[mode] ? [...list].sort(SORTERS[mode]) : list);
    const view = e => {
      const missing = !fromUuidSync(e.sourceUuid, { strict: false });
      return {
        ...e,
        icon: KIND_ICONS[e.kind] ?? "fa-file",
        noteCount: notes.get(e.id)?.length ?? 0,
        partial: e.kind === "actor" && e.revealed && !!e.unnamed,
        marker: markerInfo(e),
        missing,
        showComment: !!e.comment || this.#openComments.has(e.id),
        search: `${e.label} ${e.comment ?? ""}`.toLowerCase(),
      };
    };
    const section = (group, list) => ({
      ...group,
      entries: order(list).map(view),
      count: list.length,
      revealedCount: list.filter(e => e.revealed).length,
      allRevealed: list.length > 0 && list.every(e => e.revealed),
      showComment: !!group.comment || this.#openComments.has(`group:${group.id}`),
    });

    const groups = getGroups().map(g => section(g, entries.filter(e => e.groupId === g.id)));
    const loose = entries.filter(e => !e.groupId || !groups.some(g => g.id === e.groupId));
    const sections = [];
    if (loose.length) {
      sections.push({
        ...section({ id: "", name: "Ungrouped", comment: "" }, loose),
        ungrouped: true,
        collapsed: this.#ungroupedCollapsed,
      });
    }
    sections.push(...groups);

    return {
      sections,
      sorts: SORT_MODES.map(m => ({ ...m, active: m.id === mode })),
      empty: entries.length === 0 && groups.length === 0,
      filter: this.#filter,
    };
  }

  static #sortMode() {
    const m = game.settings.get("investigation-board", "caseFilesView");
    return SORT_MODES.some(v => v.id === m) ? m : "manual";
  }

  /* -------------------------------------------- */

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const el = this.element;
    el.addEventListener("change", this.#onChange.bind(this));
    el.addEventListener("input", this.#onInput.bind(this));
    el.addEventListener("keydown", this.#onKeyDown.bind(this));
    el.addEventListener("focusout", this.#onFocusOut.bind(this));
    el.addEventListener("dragstart", this.#onDragStart.bind(this));
    el.addEventListener("dragover", this.#onDragOver.bind(this));
    el.addEventListener("dragleave", this.#onDragLeave.bind(this));
    el.addEventListener("drop", this.#onDrop.bind(this));
  }

  /** Remember what the GM was typing in, so a re-render (from any GM's edit) doesn't eat it. */
  async _preRender(context, options) {
    await super._preRender(context, options);
    const active = document.activeElement;
    if (!this.#focusAfterRender && active?.dataset?.focusKey && this.element?.contains(active)) {
      this.#focusAfterRender = {
        key: active.dataset.focusKey,
        value: active.value,
        start: active.selectionStart,
        end: active.selectionEnd,
      };
    }
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#applyFilter();
    const f = this.#focusAfterRender;
    this.#focusAfterRender = null;
    if (!f) return;
    const field = this.element.querySelector(`[data-focus-key="${CSS.escape(f.key)}"]`);
    if (!field) return;
    if (f.value !== undefined) field.value = f.value;
    field.focus();
    if (f.select) field.select();
    else if (f.start != null) field.setSelectionRange?.(f.start, f.end);
  }

  /* -------------------------------------------- */
  /*  Fields                                      */
  /* -------------------------------------------- */

  #onInput(event) {
    const t = event.target;
    if (t.matches(".ib-case-filter")) {
      this.#filter = t.value;
      this.#applyFilter();
    } else if (t.tagName === "TEXTAREA") {
      this.#autosize(t);
    }
  }

  #onKeyDown(event) {
    // Enter commits a name field; Escape reverts it.
    const t = event.target;
    if (t.tagName !== "INPUT" || t.type !== "text") return;
    if (event.key === "Enter") { event.preventDefault(); t.blur(); }
    else if (event.key === "Escape") { event.preventDefault(); t.value = t.defaultValue; t.blur(); }
  }

  /** An opened comment box left empty closes again (after any click in flight lands). */
  #onFocusOut(event) {
    const t = event.target;
    if (t.tagName !== "TEXTAREA" || t.value.trim()) return;
    const entryId = t.closest("[data-entry-id]")?.dataset.entryId;
    const key = entryId ?? `group:${t.closest("[data-group-id]")?.dataset.groupId}`;
    if (!this.#openComments.has(key)) return;
    setTimeout(() => {
      if (document.activeElement === t || !this.#openComments.delete(key)) return;
      this.render();
    }, 200);
  }

  async #onChange(event) {
    const t = event.target;
    const entryId = t.closest("[data-entry-id]")?.dataset.entryId;
    const groupId = t.closest("[data-group-id]")?.dataset.groupId;
    switch (t.name) {
      case "label": return updateEntry(entryId, { label: t.value });
      case "comment":
        if (!t.value.trim()) this.#openComments.delete(entryId);
        return updateEntry(entryId, { comment: t.value.trim() ? t.value : "" });
      case "groupName": return updateGroup(groupId, { name: t.value });
      case "groupComment":
        if (!t.value.trim()) this.#openComments.delete(`group:${groupId}`);
        return updateGroup(groupId, { comment: t.value.trim() ? t.value : "" });
    }
  }

  #isKnownGroup(id) {
    return !!id && getGroups().some(g => g.id === id);
  }

  #applyFilter() {
    const q = this.#filter.trim().toLowerCase();
    for (const row of this.element.querySelectorAll(".ib-case-entry")) {
      row.hidden = !!q && !row.dataset.search.includes(q);
    }
    for (const sec of this.element.querySelectorAll(".ib-case-group")) {
      const name = sec.querySelector(".ib-case-group-name")?.value ?? "";
      const anyRow = sec.querySelector(".ib-case-entry:not([hidden])");
      sec.classList.toggle("is-filtered-out", !!q && !anyRow && !name.toLowerCase().includes(q));
    }
    this.element.querySelectorAll("textarea").forEach(t => this.#autosize(t));
  }

  #autosize(t) {
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight + 2}px`;
  }

  /* -------------------------------------------- */
  /*  Drag & drop                                 */
  /* -------------------------------------------- */

  #onDragStart(event) {
    const handle = event.target.closest?.(".ib-case-thumb");
    const entryId = handle?.closest("[data-entry-id]")?.dataset.entryId;
    if (!entryId) return;
    event.dataTransfer.setData("text/plain", JSON.stringify({ type: CASE_ENTRY_DRAG, entryId }));
    event.dataTransfer.effectAllowed = "copyMove";
  }

  #dropTarget(event) {
    return event.target.closest?.(".ib-case-entry, .ib-case-group, .ib-case-body");
  }

  #onDragOver(event) {
    const target = this.#dropTarget(event);
    if (!target) return;
    event.preventDefault();
    this.element.querySelectorAll(".is-drop-target").forEach(el => el !== target && el.classList.remove("is-drop-target"));
    target.classList.add("is-drop-target");
  }

  #onDragLeave(event) {
    const target = this.#dropTarget(event);
    if (target && !target.contains(event.relatedTarget)) target.classList.remove("is-drop-target");
  }

  async #onDrop(event) {
    const target = this.#dropTarget(event);
    this.element.querySelectorAll(".is-drop-target").forEach(el => el.classList.remove("is-drop-target"));
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();

    const groupId = target.closest("[data-group-id]")?.dataset.groupId || null;
    const beforeId = target.matches(".ib-case-entry") ? target.dataset.entryId : null;
    const data = TextEditor().getDragEventData(event);

    if (data?.type === CASE_ENTRY_DRAG) {
      // Moving between groups works in every sort; the position inside a group only
      // matters in GM order (type/A–Z order is computed), so there it lands at the end.
      const manual = CaseFiles.#sortMode() === "manual";
      if (!manual && (getEntry(data.entryId)?.groupId ?? null) === groupId) return; // keep GM order
      return moveEntry(data.entryId, groupId, manual ? beforeId : null);
    }
    if (!data?.uuid || !DROPPABLE.includes(data.type)) {
      return ui.notifications.warn("Investigation Board: drop Actors, Items, Scenes, Journals, pages or Folders.");
    }
    const doc = await fromUuid(data.uuid);
    if (doc) await addDocuments([doc], groupId);
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static async #onAddGroup() {
    const id = await createGroup();
    // Land in the new name field, text selected, ready to type — no prompt.
    this.#focusAfterRender = { key: `gname:${id}`, select: true };
    this.render();
  }

  static async #onRemoveGroup(event, target) {
    await removeGroup(target.closest("[data-group-id]")?.dataset.groupId);
  }

  static async #onToggleCollapse(event, target) {
    const sec = target.closest(".ib-case-group");
    const id = sec?.dataset.groupId;
    if (id) return updateGroup(id, { collapsed: !sec.classList.contains("collapsed") });
    // Ungrouped isn't a real group: remember locally so a re-render keeps it.
    if (!sec) return;
    this.#ungroupedCollapsed = !this.#ungroupedCollapsed;
    sec.classList.toggle("collapsed", this.#ungroupedCollapsed);
  }

  static #onSetSort(event, target) {
    const mode = target.dataset.mode;
    if (mode) game.settings.set("investigation-board", "caseFilesView", mode);
  }

  static #onToggleComment(event, target) {
    const entryId = target.closest("[data-entry-id]")?.dataset.entryId;
    const key = entryId ?? `group:${target.closest("[data-group-id]")?.dataset.groupId}`;
    const box = target.closest(entryId ? ".ib-case-entry" : ".ib-case-group")
      .querySelector(entryId ? "textarea[name=comment]" : ":scope > textarea[name=groupComment]");
    if (box) return box.focus();
    this.#openComments.add(key);
    this.#focusAfterRender = { key: entryId ? `comment:${entryId}` : `gcomment:${key.slice(6)}` };
    this.render();
  }

  static async #onPlaceEntry(event, target) {
    const entry = getEntry(target.closest("[data-entry-id]")?.dataset.entryId);
    if (entry) await createNoteFromEntry(entry);
  }

  static async #onOpenSource(event, target) {
    const entry = getEntry(target.closest("[data-entry-id]")?.dataset.entryId);
    const doc = entry && await fromUuid(entry.sourceUuid);
    if (!doc) return ui.notifications.warn("Investigation Board: the source document no longer exists.");
    if (doc.documentName === "JournalEntryPage") return doc.parent.sheet.render(true, { pageId: doc.id });
    doc.sheet.render(true);
  }

  /**
   * Pick an exported JSON file with Foundry's FilePicker (any source the GM can browse:
   * user data, S3, Forge…) and merge it in — no dialog beyond the picker.
   */
  static #onImport() {
    const FilePicker = foundry.applications.apps.FilePicker.implementation;
    new FilePicker({
      type: "text",   // includes .json
      callback: async path => {
        try {
          const res = await fetch(path, { cache: "no-store" });
          if (!res.ok) throw new Error(`could not read ${path} (${res.status}).`);
          const { added, skipped, groups } = await importCaseFiles(await res.text());
          const parts = [`${added} entr${added === 1 ? "y" : "ies"} added`];
          if (groups) parts.push(`${groups} group${groups === 1 ? "" : "s"}`);
          if (skipped) parts.push(`${skipped} already present`);
          ui.notifications.info(`Investigation Board: Case Files import — ${parts.join(", ")}.`);
        } catch (err) {
          console.error("Investigation Board: Case Files import failed", err);
          ui.notifications.error(`Investigation Board: ${err.message || "import failed."}`);
        }
      },
    }).render({ force: true });
  }

  /** Same cycle as the directory markers: actors hidden → partial → full, others hidden ↔ full. */
  static async #onCycleDiscovery(event, target) {
    await cycleDiscovery(target.closest("[data-entry-id]")?.dataset.entryId);
  }

  /**
   * Group badge: reveal every entry, or hide them all once all are revealed. Uses plain
   * reveal (not full discovery), so a partially discovered actor keeps its name withheld.
   */
  static async #onToggleGroupDiscovery(event, target) {
    const groupId = target.closest("[data-group-id]")?.dataset.groupId || "";
    const list = getEntries().filter(e => groupId
      ? e.groupId === groupId
      : !this.#isKnownGroup(e.groupId));
    if (!list.length) return;
    await setRevealed(list.map(e => e.id), !list.every(e => e.revealed));
  }

  static async #onRemoveEntry(event, target) {
    await removeEntry(target.closest("[data-entry-id]")?.dataset.entryId);
  }

  /** Pan to the entry's notes, cycling through them on repeated clicks (current scene first). */
  static async #onPanTo(event, target) {
    const entryId = target.closest("[data-entry-id]")?.dataset.entryId;
    const entry = getEntry(entryId);
    if (!entry) return;
    const list = (collectNotes([entry]).get(entryId) ?? [])
      .sort((a, b) => (b.scene === canvas.scene) - (a.scene === canvas.scene));
    if (!list.length) return;
    const i = (this.#panIndex.get(entryId) ?? -1) + 1;
    this.#panIndex.set(entryId, i);
    const { scene, drawing } = list[i % list.length];
    if (scene !== canvas.scene) await scene.view();
    const { width = 0, height = 0 } = drawing.shape ?? {};
    canvas.animatePan({ x: drawing.x + width / 2, y: drawing.y + height / 2 });
  }
}

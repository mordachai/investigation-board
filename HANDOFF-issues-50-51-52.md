# Handoff — GitHub issues 50, 51, 52 (investigation-board)

Repo: `mordachai/investigation-board` (remote alias `github.com-mordachai` — use
`gh issue view N --repo mordachai/investigation-board`, not `git remote get-url` parsing).

## Status

- **Issue 50** (drawing `name` not set → sidebar shows raw ID) — **DONE, verified live.**
- **Issue 52** (changing color wipes unsaved text) — **DONE, verified live.**
- **Issue 51** (CSS global scope leaks into other modules' forms, e.g. pf2e) — **NOT STARTED.**
- Nothing committed yet. Current uncommitted diff (`git status --short`):
  ```
  M scripts/apps/drawing-sheet.js
  M scripts/config.js
  M scripts/utils/creation-utils.js
  M scripts/utils/socket-handler.js
  ```
  (`module.json` was already modified before this work started — unrelated, pre-existing.)
  User wants issues done **one at a time** — ask before batching/committing.

## What changed (issues 50 + 52)

**Issue 50** — mirror note text (or `title` for document notes) into the top-level
`DrawingDocument.name` field so Foundry's sidebar/list shows real names instead of IDs.
- `scripts/config.js` — added `NOTE_TYPE_LABELS` map (fallback label per note type for
  handout/pin, which have no text field, and for empty text).
- `scripts/utils/creation-utils.js` — `buildNoteCreateData()` (the single skeleton used
  by all ~12 create-note call sites) now derives `name` from `flags.text`/`flags.title`.
- `scripts/apps/drawing-sheet.js` — submit handler now also sets `updates.name` from the
  same data used for `flags.text`/`flags.title`.
- `scripts/utils/socket-handler.js` — added `"name"` to `SOCKET_UPDATE_ALLOWED_KEYS` so
  player (non-GM) saves routed through the socket don't get `name` stripped.

**Issue 52** — root cause: AppV2's `DocumentSheetV2` auto-re-renders the open sheet on
*any* document update, including the module's own "live update before Save" calls
(color swatch, image pick, etc.). `_prepareContext` then reads `text`/`title` fresh from
the document (still old/unsaved) and repopulates the form, wiping whatever the user had
typed but not yet saved.
- `scripts/apps/drawing-sheet.js` — added `_captureUnsavedTextFields()` (reads current
  `[name='text']`/`[name='title']` DOM values) and spread its result into every
  pre-Save `collaborativeUpdate()` call that wasn't the final submit: image picker
  (handout resize branch + photo branch), color-swatch click, linked-object drop,
  remove-link button, media-mode radio toggle. 6 call sites total.

## Issue 51 plan (not started)

Confirmed root cause: `styles/style.css` has ~15+ generic, unscoped selectors
(`.button-group`, `.form-group`, `.save-button`, `.cancel-button`, `.color-option`,
`.connections-section`, `.connection-*`, `.file-picker*`, `.font-settings`,
`.size-input-group`, etc.) that match by class name **anywhere in the DOM** — Foundry
has no CSS isolation (no Shadow DOM), so these bleed into unrelated modules' forms
(reported concretely: pf2e actor sheets, via `.button-group`).

All 7 IB app templates already have a unique root class:
| Template | Root class |
|---|---|
| `drawing-sheet.html` | `.ib-note-config-form` (on the `<form>`) |
| `appearance-dialog.html` | `.ib-appearance` |
| `note-defaults-dialog.html` | `.ib-note-defaults` |
| `batch-edit-dialog.html` | `.ib-batch-edit-content` |
| `note-preview.html` | `.ib-note-preview` |
| `setup-warning.html` | `.ib-setup-warning` |
| `video-player.html` | `.ib-video-player-content` |

Plan:
1. Add a shared marker class `ib-dialog` to all 7 template roots (alongside their
   existing class) — small HTML edit, 7 files.
2. In `styles/style.css`, prefix every generic/collision-risk selector with
   `.ib-dialog ` as an ancestor combinator. Mechanical rewrite, roughly 100–150 of the
   file's 2291 lines (drawing-sheet.html's dialog rules are the bulk of it — that's the
   confirmed pf2e-conflict source).
3. Watch `.theme-dark X` combo rules — must become `.theme-dark .ib-dialog X` (order
   matters if `.theme-dark` is applied to an ancestor further up, e.g. `<body>`).
4. **No build step** — CSS is not compiled, edits apply on Foundry reload (per user's
   global CLAUDE.md: don't try to compile/rebuild CSS).
5. Found during audit but **out of scope for issue 51** — genuinely dead CSS rules with
   no matching class in any template or script (only false-positive grep hits on
   FontAwesome icon names like `fa-sticky-note`): `.sticky-note`, `.photo-note`,
   `.custom-drawing-text`, `.size-controls`, `.aspect-ratio-lock`. Mention to user
   separately; don't fold into this fix.
6. Per project CLAUDE.md: this is exactly the kind of change that should be checked in
   a live Foundry client rather than blind, since it's ~150 lines of CSS touching every
   dialog's visual layout — verify each dialog still looks correct after the change (see
   test setup below), not just "no console errors."

## Live Foundry test setup (works, use this pattern)

- Foundry running at `http://localhost:30014`, world already active, scene
  "Investigation Board" is the current scene, module `investigation-board` active.
- Login: **username field is free text, not a dropdown.** Fill `#join-username` with
  `Gamemaster` (capital G — lowercase `gamemaster` fails with "User does not exist").
  No password. Submit via `form[name="join"] button[type="submit"]`.
- Viewport must be ≥1366×768 or Foundry shows a blocking resolution warning banner —
  use `newPage({ viewport: { width: 1600, height: 900 } })`.
- Wait for readiness with
  `page.waitForFunction(() => typeof game !== 'undefined' && game.ready, { timeout: 20000 })`.
- Playwright skill install lives at
  `C:\Users\Gus\.claude\plugins\marketplaces\playwright-skill\skills\playwright-skill`.
  Run scripts with `node run.js <script-path>` from that directory (the inline `-e`
  flag was unreliable in this session — write a `.js` file instead).
- To activate the Drawings control + create a note like the toolbar would:
  ```js
  ui.controls.activate({ control: 'drawings', tool: 'select' });
  // then click the scene control button, e.g.:
  await page.locator('[data-tool="createStickyNote"]').click();
  ```
  The edit dialog auto-opens on creation; textarea is `textarea[name='text']`, Save
  button is `.save-button`.
- Inspect/clean up drawings via console:
  ```js
  canvas.scene.drawings.contents
    .filter(d => d.flags['investigation-board']?.type)
    .map(d => ({ id: d.id, name: d.name, text: d.flags['investigation-board']?.text }));
  // delete test notes:
  await canvas.scene.deleteEmbeddedDocuments('Drawing', [id, ...], { ibDelete: true });
  ```
- Always clean up any test notes created during verification (done for both issue 50
  and 52 test notes already — scene should currently be clean of test artifacts).

## Delete this file

This file is a session handoff note, not permanent project documentation — delete it
once issue 51 is done (or fold anything still relevant into CLAUDE.md/commit messages).

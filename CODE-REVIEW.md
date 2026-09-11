# Investigation Board — Code Review (v5.8.3, Foundry v14)

Full review of `scripts/`, `templates/`, `styles/style.css`, `module.json`, and asset references.
Per agreement: **v13 migrations stay** (worlds upgrading from v13 must keep working); only truly dead v13 branches are flagged.

Severity order: Critical → High → Medium → Low, then Performance, Permissions & Security, Simplification & Dedup, Dead Code, Documentation Drift. UI/UX suggestions are separate at the end.

Nothing has been changed. Each item has a proposed fix — approve/reject per item.

---

## 🔴 Critical

### C1. `_convertToNoteType` deletes the pin before the replacement exists — data loss path
`scripts/canvas/custom-drawing.js:1656-1694`
Order is: delete pin → `createNote()` → restore connections. Two failure modes:
1. If `createNote()` throws or returns nothing, the pin and all its connections are gone permanently.
2. For a player **without** `DRAWING_CREATE`, `collaborativeCreate()` routes through the socket and returns `[]` (see C3). `newDoc` is undefined → the pin was already deleted, outgoing connections and incoming re-mapping are silently lost.

**Fix:** invert the order — create the new note first, re-map connections, delete the pin last. If `createNote` returned nothing (socket path), abort with a notification instead of deleting.

### C2. GM socket handlers execute unvalidated requests
`scripts/utils/socket-handler.js:270-323`
- `deleteDrawing`: does **not** check the target is an IB note. Any connected client can emit `{ action: "deleteDrawing", sceneId, drawingId }` and the GM client will delete **any drawing on any scene** (map annotations included).
- `createDrawing` / `createManyDrawings`: don't validate `createData` — a client can have the GM create arbitrary drawings with arbitrary flags/ownership.
- `updateDrawing`: verifies IB note but applies **any** field — a player can set `hidden: false` (revealing GM-hidden notes), `locked`, `ownership`, etc.

**Fix:** in the GM handler: (a) `deleteDrawing` — require `drawing.flags[MODULE_ID]?.type`; (b) create actions — require `createData.flags?.[MODULE_ID]?.type` (and force `type: "r"`); (c) `updateDrawing` — strip a denylist at minimum (`hidden`, `locked`, `ownership`, `author`) or whitelist known fields (`x`, `y`, `rotation`, `shape.*`, `flags.investigation-board.*`, `fillAlpha`).

### C3. `collaborativeCreate` socket path returns `[]` — every "create then use the result" flow silently breaks for players
`scripts/utils/socket-handler.js:67-92`
Callers that need the created document: `createNote()` (returns `created?.[0]`), `onCanvasClick` (pin-under-yarn creation), `onCanvasRightClick` (create connected note), `_convertToNoteType`. For a player whose creation routes via socket, all of these get `undefined` → connection never created, connection mode resets, convert loses data (C1).
This only bites in worlds where the GM did **not** grant `DRAWING_CREATE` — exactly the misconfigured worlds the setup warning exists for.

**Fix options** (pick one):
- GM handler echoes back a `drawingCreated` socket message with the new ID + a request nonce; requesting client resumes the flow; or
- Detect the socket path in these flows up-front and show "requires Drawing-creation permission" instead of half-working; or
- Have the GM handler itself perform the follow-up (pass intent, e.g. `connectFrom: sourceId`, in the socket payload).

---

## 🟠 High

### H1. Connection-mode dead end after dismissing the right-click "create connected note" menu
`scripts/canvas/connection-manager.js:836-851`
`onCanvasRightClick` runs `canvas.stage.off('click', onCanvasClick)` and its own `once('rightclick')` is consumed. If the user closes the menu without picking (click elsewhere), connection mode is still active: preview line follows the cursor, but left-click on canvas does nothing and right-click won't reopen the menu. Only Escape or clicking another pin escapes. The code comment even says "we should probably reset connection state… but let's keep it dragging".

**Fix:** in `closeMenu`, call `resetPinConnectionState()` (or re-arm both stage listeners).

### H2. Pin-drag bypasses `document.locked`
`scripts/canvas/connection-manager.js:519-555`
Body dragging respects lock via `_canDrag()`, but the pin sprite has its own drag implementation (`onPinPointerDown` → `pinDragState`) with no lock check — a locked note can still be moved by dragging its pin.

**Fix:** early-return in `onPinPointerDown` drag setup when `drawing.document.locked`.

### H3. Cleared note text resurrects as literal "Default Text"
`scripts/apps/drawing-sheet.js:177` — `text: ibFlags.text || 'Default Text'`
If the user clears the text and saves (`text = ""`), reopening the sheet shows **"Default Text" as the actual textarea value**; saving again persists that string onto the note.

**Fix:** `text: ibFlags.text ?? ''` (placeholder belongs in the template `placeholder` attribute, which already exists).

### H4. `parseFloat(...) ?? fallback` never falls back — NaN can be persisted
`scripts/apps/drawing-sheet.js:808` (`timestampY: parseFloat(...) ?? -1`) and `:925-926` in `_readEffectsFromForm`.
`parseFloat` returns `NaN`, never `null`/`undefined`, so `?? -1` is dead and `NaN` flows into flags / `updateTimestampStyle` → `el.style.bottom = "NaN%"`.

**Fix:** helper `num(v, d) => Number.isFinite(parseFloat(v)) ? parseFloat(v) : d` and use it for every numeric effect field. (Also unifies the inconsistent fallbacks, see M6.)

### H5. Four creation paths still write `fillAlpha: 0` — the exact value the module migrates away from
- `createHandoutNoteFromPage` — `scripts/utils/creation-utils.js:404`
- `importFolderAsNotes` (playlist branch) — `:698`
- `importPlaylistAsNotes` — `:810`
- `createHandoutNoteFromImage` — `:883`

CLAUDE.md's own rule: "When creating new notes always use `fillAlpha: 0.001`". These notes are created broken, then patched later by the `canvasReady` migration or the `collaborativeUpdate` band-aid — churn and a window where updates can fail validation.

**Fix:** `0.001` in all four (mechanical change).

### H6. `showConnectionNumbers` computes sizes from settings × sceneScale instead of the document shape
`scripts/canvas/connection-manager.js:397-410`
Violates the module's own coordinate rule ("never multiply shape.width by sceneScale"). Consequences: numbers are misplaced on any resized/scaled note, and media/document/handout/pin targets fall into the sticky branch (completely wrong dimensions).

**Fix:** `width = targetDrawing.document.shape.width; height = targetDrawing.document.shape.height;` — no sceneScale, no per-type branching.

### H7. More sceneScale-on-shape violations in connection mode
- `_startConnectionMode` highlight rect: `(shape.width||40) * sceneScale` — `scripts/canvas/connection-manager.js:633-634`. Highlight is wrong-sized whenever effective scale ≠ 1.
- `onCanvasClick` pin centering: `worldPos - (pinW * sceneScale)/2` — `:707-708`. New pin is off-center under the cursor at scale ≠ 1.

**Fix:** drop the `sceneScale` factor in both.

---

## 🟡 Medium

### M1. `drawAllConnectionLines` "safety check" makes `updatePins()` run on nearly every call — including 60 fps animation
`scripts/canvas/connection-manager.js:299-302`
The check compares `pinsContainer.children.length` against **all** IB notes, but notes with `pinColor: "none"` and video-media notes have no pinSprite. One such note on the scene → permanent mismatch → `updatePins()` (removeChildren + `removeAllListeners()` + re-add + listener re-registration for every note) executes on every redraw, including **every ticker frame** while an edit dialog is open (`startConnectionAnimation`).

**Fix:** compare against `placeables.filter(d => flags && d.pinSprite).length`, or track a dirty flag and drop the count heuristic.

### M2. Double/triple global redraws per update
- `updateDrawing` hook (`scripts/main.js:590-609`) awaits `placeable.refresh()` — which **already** runs `updatePins()` + `drawAllConnectionLines()` (`custom-drawing.js:905-916`) — then calls both again.
- On `canvasReady` / bulk import, each note's `draw()` triggers a **global** pins+lines redraw → O(N²) work for N notes.

**Fix:** remove the pins/lines calls from `CustomDrawing.draw()`/`refresh()` (let hooks own global redraws), or debounce `drawAllConnectionLines`/`updatePins` through a single `requestAnimationFrame`-batched scheduler.

### M3. Video broadcast state is memory-only on the GM client
`scripts/utils/socket-handler.js:6`, `scripts/apps/video-player.js`
GM reload/crash during a broadcast: players keep synced windows, GM loses `activeVideoBroadcasts` → context menu shows "Open for All" again; "Stop Broadcast" path via menu only works if the GM's player app is open. Late-joining players never receive `openVideoPlayer`.

**Fix (optional):** persist active broadcast in a scene/world flag, or accept and document the limitation.

### M4. Paste handler jQuery-ism can throw
`scripts/main.js:335` — `(e.clipboardData || e.originalEvent.clipboardData)`. Native paste events have no `originalEvent`; if `clipboardData` is ever null this is a TypeError.
**Fix:** `if (!e.clipboardData) return;` and drop `originalEvent`.

### M5. `_uploadImageHandout` hardcodes the `"data"` source and world-root `assets/` folder
`scripts/main.js:435-456`
Breaks on The Forge (assets bucket), S3 storage, and pollutes the user-data root rather than a module/world-scoped folder.
**Fix:** use `FilePicker.uploadPersistent(MODULE_ID, ...)` (module storage) or detect the active storage source; at minimum make the folder configurable.

### M6. Video-effect fallback values disagree between read and write paths
`scripts/apps/drawing-sheet.js` — getData base: `glitchIntervalMin/Max 2/4`, `timestampFontSize 30`, `timestampColor #008425`; submit handler and `_readEffectsFromForm`: `8/20`, `13`, `#00e040`. Values drift whenever a field is hidden/missing (e.g. players without FILES_BROWSE saving a media note).
**Fix:** one `EFFECT_DEFAULTS` const in `config.js`, used by all three sites (also fixes H4 with the shared `num()` helper).

### M7. Sheet submit rewrites the whole `connections` array on every save
`scripts/apps/drawing-sheet.js:874-884`
Colors are merged into the array as read at render time; another user's connection added/removed while the dialog is open gets clobbered on save.
**Fix:** only write `connections` when a color input actually changed, and re-read `this.document.flags[...].connections` at submit time (it already does the re-read — just make the write conditional).

### M8. Reverse-duplicate connections allowed
`scripts/canvas/connection-manager.js:492-516` — duplicate check only looks at source→target; creating B→A when A→B exists draws two overlapping yarns.
**Fix:** also check the target note's connections for the reverse edge.

### M9. `ownership: { default: 3 }` on every created drawing — verify it does anything
All create payloads in `creation-utils.js`. DrawingDocuments have historically used author-based permissions, not an `ownership` field. If v14 strips it, player edits **always** route through the socket (works, but the field is misleading dead weight). If v14 honors it, every player is OWNER of every note and can hard-delete via Foundry UI (bulk-delete guard is then the only protection).
**Action:** verify in v14 and either remove the field or document the real permission model.

### M10. `applyTapeEffectToElement` marks itself applied before trying
`scripts/utils/audio-utils.js:101` — `_ibTapeEffectApplied = true` is set before the try block; a failure (e.g. context not resumed yet) permanently prevents retry for that element.
**Fix:** set the flag after success.

### M11. `activeGlobalSounds` cleanup heuristic leaks for looping/long audio
`scripts/utils/socket-handler.js:182-187` — cleanup is a one-shot `setTimeout(duration + 1s)`; if duration is unavailable it's 5 s, and a re-triggered/looping sound keeps a stale Map entry.
**Fix:** prefer `sound.addEventListener("end"/"stop", ...)` (Foundry Sound emits events) over timers.

### M12. Timestamp date-format value mismatch: `"intl"` vs `"eu"`
Template radio (`templates/drawing-sheet.html:381`) submits `"intl"`; code and CLAUDE.md use `"us" | "eu"`, and `_updateTimestamp` only compares `=== 'us'` — works by accident. Pick one token.

---

## 🟢 Low

- **L1.** `VideoPlayer._syncInterval` is cleared in several places but never assigned — dead field. `scripts/apps/video-player.js`.
- **L2.** `VIDEO_FORMATS[*].windowWidth` never read — sizing uses `window.innerWidth * 0.6`. `scripts/config.js` / `video-player.js:91`.
- **L3.** Default-value drift: `baseFontSize` setting default **16** vs `BASE_FONT_SIZE` **15** vs previewer `|| 15`; `connectionLineWidth` default **7** vs fallbacks `|| 6` (createConnection) and `|| 3` (preview + sheet); `stampTint` default **#990000** vs code fallback **#cc0000** (two places). Pick one value each, source from `config.js`.
- **L4.** `noteTypes` built in `getData()` (`drawing-sheet.js:194-199`) is never used by the template.
- **L5.** `cassetteImages` unused variable — `creation-utils.js:625`.
- **L6.** Orphan assets: `assets/custom_photoFrame.webp`, `assets/futuristic_photoFrame.webp`, `assets/board01.webp` referenced nowhere.
- **L7.** No i18n: no `lang/` folder, every string hardcoded. Foundry convention is `languages` in module.json + `game.i18n.localize`. Big-ish task; listing it as a gap, not a must.
- **L8.** Two CSS classes for the same thing: `.ib-context-separator` (style.css:2073) and `.ib-context-menu-separator` (:660); code uses both.
- **L9.** Failed texture loads (`PIXI.Assets.load`) log `console.error` on **every** refresh of the affected note — noisy with a broken path. Cache failed paths, or log once.
- **L10.** `getRandomCassetteImage`/`getRandomVideoImage` hardcode the assets path while pins/stamps folders are configurable — inconsistent, fine if intentional.

---

## ⚡ Performance

(P1/P2 are the same defects as M1/M2, listed here for weight.)

1. **P1 = M1.** `updatePins()` per animation frame while an edit dialog is open. Worst hot spot in the module.
2. **P2 = M2.** O(N²) global redraws on canvasReady / bulk import; double redraw per update.
3. **P3.** `new PIXI.BlurFilter(...)` allocated on **every** `_doUpdateSprites()` for every shadow (media :1138, document :1240, standard :1477). Filters are GPU-backed objects; create once per sprite and reuse.
4. **P4.** `updatePins()` calls `removeAllListeners()` + `.on('pointerdown')` for every pin on every call — listener churn. Register once per sprite lifetime; keep only position updates in the loop.
5. **P5.** New `PIXI.TextStyle`/`HTMLTextStyle` object per refresh per text sprite — cheap but avoidable; mutate the existing style or cache by key.
6. **P6.** Polling loops: NotePreviewer 500 ms audio poll (`note-previewer.js:139`), sheet preview `checkEnd` 500 ms, previewer global `checkEnd` 1000 ms. Foundry `Sound` emits end/stop events — use them.
7. **P7.** Every world-setting change calls `refreshAllDrawings()` → each `refresh()` triggers a global pins+lines redraw (see P2) → N+1 global redraws per settings save (and the Appearance dialog saves up to 9 settings sequentially → up to 9× that).
8. **P8.** Batch operations issue sequential `collaborativeUpdate` awaits (batch-edit `_applyChanges`, Remove-All-Connections in both context menus, `_convertToNoteType` remap). For the GM these could be one `scene.updateEmbeddedDocuments("Drawing", updates)` batch; for players, one socket message with an array instead of N messages.
9. **P9.** Known limitation (accepted): pins repositioned globally on every redraw. If large boards become a target, update only the moved note's pin on drag.

---

## 🔒 Permissions & Security

1. **S1 = C2.** GM socket handlers must validate: IB-note-only delete, IB-flagged create, field-restricted update.
2. **S2.** All-client socket actions (`playAudio`, `stopAudio`, `openVideoPlayer`, `playVideo/pause/seek`, `stopVideoBroadcast`) are honored regardless of sender. The UI gates broadcast to GM, but any player can emit these from the console and blast audio / pop video windows on every client. Foundry sockets don't expose a verified sender, so a full fix means routing broadcasts through the GM (player asks GM → GM re-emits) or accepting the risk. **At minimum document it; recommended: ignore broadcast-type actions unless `data.gmUserId` matches a user who `isGM` AND that user is active** (weak but raises the bar).
3. **S3.** Socket `updateDrawing` lets players flip `hidden` on IB notes — undermines the GM hide/reveal feature (part of C2's fix: denylist `hidden`).
4. **S4.** `canViewSensitive` hides fields in templates, but the data itself is world-visible: `audioPath` ships in the preview's `<audio src>`, and all flags are readable via console. That's inherent to Foundry (players receive scene data); just don't promise more than "not shown in the UI" — CLAUDE.md wording is fine, README/docs should match.
5. **S5.** Inconsistent GM gating on creation entry points: ImagePopout header control is GM-only (`main.js:932`), while paste/drag-drop/scene-tools allow players. If intentional, fine — otherwise align (suggest: gate on `DRAWING_CREATE` like the drop handler does, not on isGM).
6. **S6.** `preDeleteDrawing` guard allows deletion when `placeable?.controlled` — since `_canControl` returns true for everyone, any player who selects a note and presses Delete deletes it (if they have any delete path). Combined with M9's ownership question, decide explicitly who may delete: currently "everyone, from module menus; keyboard depends on core permissions".

---

## 🧹 Simplification & Dedup

1. **D1. `creation-utils.js` is ~7 copies of the same create block.** `createNote`, `createPhotoNoteFromActor/Scene/Item`, `createMediaNoteFromSound`, `createHandoutNoteFromPage/FromImage`, `createTextIndexFromPage`, `createDocNoteFromPage` all repeat: settings lookup → viewport-center position → `collaborativeCreate({type:"r", ..., flags, core.sheetClass, ownership})` → identical 250 ms interactivity setTimeout. Extract:
   - `getNoteDimensions(type)` — single source for width/height/aspect (also used today, duplicated, in `onCanvasRightClick` and `showConnectionNumbers` and `_doUpdateSprites` fallbacks);
   - `buildNoteCreateData(type, {x, y, flags})` — the whole payload skeleton;
   - `postCreateFixup(created)` — the setTimeout block.
   Estimated ~350–450 lines removed.
2. **D2. Font list defined 5×:** 3 identical `<select name="font">` blocks in `drawing-sheet.html`, `FONT_CHOICES` in appearance-dialog.js, `FONT_WIDTH_FACTORS` keys in helpers.js, plus `moduleFonts` arrays twice in main.js (init + ready). Export one `FONTS` structure from `config.js` (name → widthFactor), generate selects from context, and register a Handlebars partial for the select.
3. **D3. `_showContextMenu` is ~600 lines of imperative DOM.** Extract `menuItem(icon, label, onClick, cls)` + `separator()` factories and a single shared `closeMenuOnOutsideClick(menu)` (currently duplicated twice with subtle differences — one forgets the wheel listener). The linked-object "Open" block and the Remove-All-Connections block are each duplicated verbatim between the pin branch and the normal branch.
4. **D4. Remove-all/remap incoming connections logic appears 3×** (pin menu, note menu, `_convertToNoteType`). One helper: `updateIncomingConnections(noteId, mapFn)`.
5. **D5. Pin and stamp helper pairs are copy-paste** (`_pinFilesCache`/`_stampFilesCache`, `resolvePinImage`/`resolveStampImage`, `getAvailablePinFiles`/`getAvailableStampFiles`). One generic `makeFolderImageSource(settingKey, defaultFolder, fallbackList)` factory.
6. **D6. `drawYarnLine` animated branch re-implements the bezier sampling** that `getQuadraticBezierPoints` already provides — use the helper in both branches.
7. **D7. Pin position math duplicated** between `_getPinPosition()` (custom-drawing.js:1620) and `updatePins()`/`onPinDragMove` (connection-manager). Make `updatePins` consume `_getPinPosition()` (adjusting for the 40 px sprite offset in one place).
8. **D8. `STAMP_LABELS`** in custom-drawing.js duplicates knowledge of `STAMP_IMAGES`; the fallback prettifier already produces the same labels — delete the table.
9. **D9. drawing-sheet.js V1 relics:** `static get defaultOptions()` (AppV2 ignores it), `_processFormData`, `_processSubmitData`, `_updateObject`, `activateListeners` — all no-ops. Delete.

---

## 💀 Dead Code (safe deletions)

| Item | Location | Evidence |
|---|---|---|
| `InvestigationBoardHUD` (entire file) | `scripts/apps/hud.js` | never imported anywhere |
| HUD template | `templates/hud.html` | only used by hud.js |
| HUD CSS (~60 lines) | `styles/style.css:197-250, 1112` | only used by hud.js |
| `onPinClick()` | `connection-manager.js:657-677` | exported, never imported ("kept for API compatibility" — nothing consumes it) |
| `getDynamicCharacterLimits` + `getBaseCharacterLimits` | `helpers.js:120-137` | only call each other; `truncateText` uses the geometric `_computeCharLimit` |
| `baseCharacterLimits` setting | `settings.js:284-300` | only consumed by the two dead functions above |
| `_syncInterval` field | `video-player.js` | cleared, never set |
| `VIDEO_FORMATS[*].windowWidth` | `config.js` | never read |
| `noteTypes` context entry | `drawing-sheet.js:194` | unused by template |
| `cassetteImages` var | `creation-utils.js:625` | unused |
| Orphan assets | `assets/custom_photoFrame.webp`, `futuristic_photoFrame.webp`, `board01.webp` | unreferenced |
| V1 app relics | `drawing-sheet.js` (D9), `hud.js` | AppV2 never calls them |

Note: the v13 **migrations** (`canvasReady` fillAlpha sweep, `collaborativeUpdate` fillAlpha patch, legacy `pinColor` setting migration, `mediaMode` derivation fallbacks) are **kept** per decision — they are live code, not dead.

---

## 📄 Documentation Drift (CLAUDE.md)

1. Entire **stamp system** undocumented (stamp flag shape, `stampTint`/`stampImagesFolder` settings, `_loadStampTexture`, context-menu submenu, `DEFAULT_STAMP_FOLDER`/`STAMP_IMAGES`).
2. **`BatchEditDialog`** + its toolbar button undocumented; toolbar list says "6 creation tools" — there are 7 tools now.
3. **`cancelConnection` keybinding** (Escape) undocumented.
4. `_convertToNoteType` documented as `(pinId, newType)` — actual signature is `(targetType)` on the instance; and the convert menu has **5** options (no Document Note), doc says six.
5. Media note: "plays lo-fi audio on click" — actual behavior is double-click → NotePreviewer (audio) / VideoPlayer (video).
6. `stripHtml()` / `sanitizeForPixiHtml()` described as exported from creation-utils — they are module-private.
7. `timestampDateFormat` documented as `"us" | "eu"` — template submits `"intl"` (M12).

---

## 🎨 UI/UX Suggestions (separate — no code implied)

1. **Connection mode discoverability:** when a pin is clicked, nothing tells the user they're in connection mode or that Escape cancels. A short `ui.notifications.info("Click another pin to connect — Esc to cancel")` or a cursor change would help; H1's stuck state is much worse because of this.
2. **Convert-to menu is missing Document Note** — batch edit and everything else treat it as a first-class type.
3. **"No Pins" silently disables connections** — the appearance dialog labels it, but a note-level `pinColor: "none"` in the edit sheet gives no such hint. Consider a tooltip on the "None" option.
4. **Setup warning could offer a one-click fix** — the GM can programmatically add `DRAWING_CREATE`/`FILES_BROWSE`/`FILES_UPLOAD` to the Player role; today the dialog only describes the problem.
5. **Batch edit scope preview** is good; consider adding font/ink-color batch fields since those are the most common bulk edits after pin color.
6. **Edit dialog on creation:** auto-focus the text field so the user can type immediately.
7. **Media note affordance:** users expect single-click on a cassette to play; today it's double-click. Even a hover cursor/tooltip ("double-click to open") would set expectations.
8. **Localization** (L7) — even shipping only `en.json` makes community translations possible.
9. **HUD decision:** either wire `InvestigationBoardHUD` up (it has a nice quick-text concept) or delete it; half-present code confuses contributors.
10. **Linked-object "Open"** without the document name is a privacy feature, but GMs could see the name — consider showing it for GMs only.

---

## Suggested fix order (if approved)

1. C2/S1 (socket validation) + H5 (fillAlpha 0.001) + H3/H4 (sheet value bugs) — small, isolated, high value.
2. C1/C3 (convert + socket-create round-trip) — needs a small design decision (pick a C3 option).
3. H1/H2/H6/H7 (connection-mode fixes) + M1/M2 (perf hot spots).
4. Dead-code sweep + D-items dedup (mechanical, big diff, zero behavior change — best as its own commit).
5. Everything else per taste.

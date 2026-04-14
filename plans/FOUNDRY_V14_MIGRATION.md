# Foundry VTT v13 → v14 Migration Guide

> **Scope:** This is a general reference guide for module and game system developers migrating from Foundry VTT Generation 13 (Build 351) to Generation 14 (Build 360). It covers breaking changes, deprecations, new APIs, and a checklist.
>
> **Sources:** Official Foundry release notes (builds 14.349–14.360), local codebase diff of v13 and v14 installations, Forge blog, and community resources.

---

## Table of Contents

1. [Environment Changes](#1-environment-changes)
2. [Installation Notes](#2-installation-notes)
3. [Module / System Manifest Changes](#3-module--system-manifest-changes)
4. [Five Architectural Pillars of v14](#4-five-architectural-pillars-of-v14)
5. [Document System Changes](#5-document-system-changes)
6. [Active Effects v2](#6-active-effects-v2)
7. [Scene Regions v2 — Measured Templates Removed](#7-scene-regions-v2--measured-templates-removed)
8. [ApplicationV2 Changes](#8-applicationv2-changes)
9. [HandlebarsApplicationMixin Changes](#9-handlebarsapplicationmixin-changes)
10. [Canvas & Placeables Changes](#10-canvas--placeables-changes)
11. [Token Changes](#11-token-changes)
12. [DataField & DataModel Changes](#12-datafield--datamodel-changes)
13. [Hooks Changes](#13-hooks-changes)
14. [CONST Changes](#14-const-changes)
15. [TinyMCE Removed — ProseMirror](#15-tinymce-removed--prosemirror)
16. [Global Namespace Changes](#16-global-namespace-changes)
17. [Deprecations (Removed in v14)](#17-deprecations-removed-in-v14)
18. [Deprecations (Scheduled for Future Removal)](#18-deprecations-scheduled-for-future-removal)
19. [What Did NOT Change](#19-what-did-not-change)
20. [Migration Checklist](#20-migration-checklist)

---

## 1. Environment Changes

### Node.js

| Version | Requirement |
|---------|-------------|
| v13 | `>=20.18.0 <23.0.0` |
| v14 | `>=24.13.1 <25.0.0` |

**Action:** Upgrade dev and production environments to Node.js 24 before running v14.

### Dependencies (server-side, affects module authors rarely)

| Package | v13 | v14 | Notes |
|---------|-----|-----|-------|
| `nedb` | `^1.8.0` | removed | |
| `nedb-promises` | — | `^6.2.3` | Promise-based API |
| `tinymce` | `^6.8.5` | removed | ProseMirror only |
| `express` | `^4.21.2` | `^5.2.1` | Major version; affects server code |
| `abstract-level` | `^2.0.2` | `^3.1.1` | |
| `classic-level` | `^2.0.0` | `^3.0.0` | |
| `chokidar` | `^4.0.3` | `^5.0.0` | |
| `animejs` | — | `^4.3.6` | New; available to modules |
| `nat-upnp` | `^1.1.1` | removed | |
| `@silentbot1/nat-api` | — | `^0.4.9` | Replaces nat-upnp |

---

## 2. Installation Notes

- **Cannot upgrade in-place.** You must uninstall v13 and do a clean install of v14.
- **Worlds are one-way.** Once a world is opened in v14, it cannot be used in v13.
- **Separate installations recommended.** Test with a dedicated v14 install and separate user data directory.
- **Disable all modules** when first booting a world in v14. Enable them one at a time after verifying compatibility.
- **Wait for system compatibility** before migrating production worlds.

---

## 3. Module / System Manifest Changes

### `compatibility` Object (stable since v11, now preferred)

```json
"compatibility": {
  "minimum": "14",
  "verified": "14.360"
}
```

- `minimumCoreVersion` and `compatibleCoreVersion` are **deprecated** — use `compatibility` object.
- `maximum` field enforced hard: a module with `maximum: 13` will **refuse to load** in v14.
- `minimum` field enforced hard: a module with `minimum: 14` will not appear in v13 package lists.
- v14 gracefully skips legacy key warnings if the modern equivalent is also present.

### `relationships` vs `dependencies`

- The `dependencies` field is deprecated. Use `relationships` instead:

```json
"relationships": {
  "requires": [
    { "id": "some-module", "type": "module", "compatibility": { "minimum": "2.0" } }
  ]
}
```

### `socket` Flag

Still required for modules that use `game.socket`:

```json
"socket": true
```

### Fonts

Do **not** use the `fonts` array in module.json. Declare fonts as `@font-face` in CSS and force-load via `document.fonts.load()` in the `ready` hook. This has always been the correct pattern and remains so in v14.

---

## 4. Five Architectural Pillars of v14

### A. Scene Levels — Multi-Level Maps

- Scenes now natively support multiple stacked layers at defined elevation ranges.
- New `Level` document type embedded in Scene (`scene.levels` collection).
- Tiles, lights, walls, and sounds can be tagged to appear on specific levels.
- Replaces the need for separate scenes per floor.
- See [Document System Changes](#5-document-system-changes) for the schema.

### B. Active Effects v2

- Effects can now live in compendiums as primary documents.
- Drag-and-drop effects onto tokens.
- Expanded duration, expiry events, and icon display control.
- Several field renames and type changes — see [Active Effects v2](#6-active-effects-v2).

### C. Scene Regions v2 — Measured Templates Removed

- **Measured Templates are gone.** This is the first time Foundry has removed a core document type.
- Cone and ray shapes added to Regions.
- New Ring and Emanation shapes.
- Regions can attach to tokens and move with them.
- See [Scene Regions v2](#7-scene-regions-v2--measured-templates-removed).

### D. ProseMirror — TinyMCE Fully Removed

- TinyMCE dependency completely dropped.
- ProseMirror is now the only built-in rich text editor.
- External integration API provided for re-introducing TinyMCE via a module.
- See [TinyMCE Removed](#15-tinymce-removed--prosemirror).

### E. Pop-out Applications (Detached Windows)

- ApplicationV2 now natively supports detaching any window into a separate browser window.
- New `DetachedWindowManager` at `foundry.applications.detached`.
- Default header controls now include Detach/Attach buttons.
- See [ApplicationV2 Changes](#8-applicationv2-changes).

---

## 5. Document System Changes

### New Document: `Level`

```javascript
// Schema fields (simplified)
{
  _id: DocumentIdField,
  name: StringField,
  sort: IntegerSortField,
  elevation: {
    bottom: NumberField,  // minimum elevation
    top: NumberField      // maximum elevation
  },
  background: TextureData,
  foreground: TextureData,
  fog: { ... }           // fog exploration settings
}
```

- Accessed via `scene.levels` embedded collection.
- Global ref: `foundry.documents.Level`.

### Drawing Document

New schema fields added:
- `name: StringField({ textSearch: true })` — drawings now have searchable names.
- `levels: SceneLevelsSetField()` — can assign drawings to scene levels.

Schema version bumped: `"13.341"` → `"14.355"`.

`getUserLevel()` behavior changed:

```javascript
// v14 behavior
getUserLevel(user) {
  if (this.pack) return this.compendium.getUserLevel(user);       // compendium support
  if (user.isGM || (user.id === this._source.author)) return OWNER;
  return NONE;
}
```

### MeasuredTemplate Document

- Marked `@deprecated since v14`.
- Still accessible at `foundry.documents.MeasuredTemplateDocument` with deprecation warning.
- See [Scene Regions v2](#7-scene-regions-v2--measured-templates-removed).

### Scene Document

- New embedded collection: `levels` (array of `Level` documents).
- New `Level` configuration tab in Scene Config.

---

## 6. Active Effects v2

### Field Renames / Type Changes

| Field | v13 | v14 | Notes |
|-------|-----|-----|-------|
| `ActiveEffect#changes` | array on root | `ActiveEffect#system#changes` | Moved to system |
| `ActiveEffect#origin` | `StringField` | `DocumentUUIDField` | Type changed |
| `EffectChangeData#mode` | number enum | `EffectChangeData#type` string | Renamed and type changed |
| `EffectChangeData#value` | string | JSON-parsed result | Deserialized automatically |

### New Fields

- `ActiveEffect#showIcon` — controls when status icon displays: `"always"`, `"never"`, or conditional.
- New duration time units beyond seconds (see `CONST.ACTIVE_EFFECT_TIME_DURATION_UNITS`).
- New expiry events (see `CONST.ACTIVE_EFFECT_EXPIRY_EVENTS`).
- New change application phases (see `CONST.ACTIVE_EFFECT_CHANGE_PHASES`).

### New Change Types

- `CONST.ACTIVE_EFFECT_CHANGE_TYPES` replaces the old `ACTIVE_EFFECT_MODES` structure.
- New `subtract` mode added.

### Removed

- `CONFIG.ActiveEffect.legacyTransferral` — deprecated since v11, **removed in v14 without replacement**.

### Performance

- Document construction: ~9.45% faster.
- Persisted creation: ~25.86% faster.

---

## 7. Scene Regions v2 — Measured Templates Removed

### MeasuredTemplate is Gone

`canvas.scene.createEmbeddedDocuments('MeasuredTemplate', ...)` will fail — the document type no longer exists.

Migration path: use Regions with behaviors instead.

```javascript
// v13 — creating a measured template
await canvas.scene.createEmbeddedDocuments('MeasuredTemplate', [{
  t: 'circle', x, y, distance: 30, user: game.user.id
}]);

// v14 — create a Region with a shape
await canvas.scene.createEmbeddedDocuments('Region', [{
  name: 'Spell Effect',
  shapes: [{ type: 'circle', x, y, radius: canvas.grid.size * 3 }],
  behaviors: []
}]);
```

### Region API Changes

| API | v13 | v14 |
|-----|-----|-----|
| `RegionDocument#attachedToken` | direct property | `RegionDocument#attachment.token` |
| `TeleportTokenRegionBehaviorType#destination` | single destination | deprecated → use `#destinations` |
| `TeleportTokenRegionBehaviorType#destinations` | — | array; supports multiple destinations |
| `TeleportTokenRegionBehaviorType#revealed` | — | new; if true, reveals destination names |

### New Region Features

- Cone and ray shapes.
- Ring and Emanation shape types.
- Regions can attach to tokens (`attachment.token`) and follow movement.
- Teleport behavior supports user-chosen or random destination selection.
- Teleport and Toggle behaviors now use relative UUIDs (portable across scene exports).
- Default visibility of measured-template-style regions changed from `OBSERVER` to `ALWAYS`.

### `CONST.MEASURED_TEMPLATE_TYPES`

- Deprecated in v14, proxied with console warnings.
- Will be removed in a future version.
- Do not use in new code.

---

## 8. ApplicationV2 Changes

### Default Header Controls

v14 adds Detach and Attach buttons to every ApplicationV2 window by default:

```javascript
// New entries in DEFAULT_OPTIONS.window.controls
{ action: "detach", icon: "fa-solid fa-arrow-up-right-from-square", label: "CONTROLS.Detach" },
{ action: "attach", icon: "fa-solid fa-arrow-down-to-square", label: "CONTROLS.Attach" }
```

These are hidden automatically when not applicable. No action required unless you override `window.controls` completely.

### `emittedEvents`

```javascript
// v13
["render", "close", "position"]

// v14 — added "prerender"
["prerender", "render", "close", "position"]
```

### `_insertElement` Signature Change

```javascript
// v13
_insertElement(element)

// v14 — now async, receives options
async _insertElement(element, options = {})
```

If you override this method, update your signature.

### `_renderFrame` Changes

- Now uses `options.window?.host?.document` instead of `document` to support detached windows.
- `<menu class="controls-dropdown">` removed from frame template.
- Uses `_loc()` helper instead of `game.i18n.localize()` internally.

### `_updateFrame` Changes

- Rewritten to handle detached window state.
- New check: `isPrimaryDetached = (window.detached === true) || (this.window.windowId === this.id)`.
- Resize handle toggled via `toggleAttribute`.
- Close button hidden when detached.

### `_configureRenderOptions` Changes

New detached window handling added. If you override this method, be aware:

```javascript
// v14 new logic in _configureRenderOptions
const changeWindow = options.window?.windowId && (options.window.windowId !== this.window.windowId);
if (("detached" in (options.window ?? {})) || changeWindow) {
  options.window.detach = options.window.detached || options.window.windowId;
  options.window.attach = !options.window.windowId && !options.window.detached;
  options.window.host = foundry.applications.detached.windows.get(options.window.windowId)?.window;
}
```

### `_canRender` Behavior Change

- `ApplicationV2#_canRender` no longer blocks render — returns early instead.
- If you relied on `_canRender` returning `false` to prevent rendering, test this behavior.

### New Static Methods

- `ApplicationV2.instances()` — static generator for all live application instances.

### New `preRenderApplication` Hook

```javascript
Hooks.on("preRenderApplication", (application, context, options) => {
  // Modify context or options before the app renders
});
```

### `DetachedWindowManager`

```javascript
// Open an app in a detached browser window
application.render({ window: { detach: true } });

// Listen for window events
Hooks.on("openDetachedWindow", (id, win) => { ... });
Hooks.on("closeDetachedWindow", (id, win) => { ... });

// Manager API
foundry.applications.detached.windows // Map of open detached windows
```

### `_renderHeaderControl` Changes

- Uses `this.element.ownerDocument` to support detached windows.

---

## 9. HandlebarsApplicationMixin Changes

### `_replaceHTML` — Two-Pass Rendering

Changed from a single pass to two passes for better state management (focus, scroll position, `<details>` open state):

```
v13: for each part → replace DOM → sync state immediately
v14: for each part → collect prior state → then replace DOM → then restore state
```

This is mostly transparent, but if you override `_replaceHTML`, update accordingly.

### `_preSyncPartState` Changes

- Focus detection improved: now traverses to `.closest("[name]")` parent if focused element has no `id`.
- New: tracks `<details>` element open states.

### `_syncPartState` Changes

- New: restores `<details>` element `open` property.
- **Required:** `<details>` elements that should preserve state must have `data-sync` attribute:

```html
<!-- v14: add data-sync to persist open/closed state across re-renders -->
<details data-sync>
  <summary>...</summary>
  ...
</details>
```

---

## 10. Canvas & Placeables Changes

### New Canvas Files

| File | Purpose |
|------|---------|
| `client/canvas/borders.mjs` | New border rendering system |
| `client/canvas/transition.mjs` | Scene transition effects |
| `client/canvas/vfx/` | Visual effects directory (particle systems, etc.) |

### Placeable Subdirectory Refactor

Shape-based placeables moved to subdirectories with dedicated `shape-controls.mjs` files:

```
v13: client/canvas/placeables/drawing.mjs (monolithic)
v14: client/canvas/placeables/drawings/shape-controls.mjs (DrawingShapeControls)
     client/canvas/placeables/lights/shape-controls.mjs
     client/canvas/placeables/tiles/shape-controls.mjs
     client/canvas/placeables/sounds/shape-controls.mjs
     client/canvas/placeables/regions/shape-controls.mjs
```

The `Drawing` class now uses `ShapeObjectMixin(PlaceableObject)` for shape inheritance.

**Impact on custom Drawing subclasses:** If you extend `Drawing`, test your subclass — the inheritance chain changed.

### `PlaceablesLayer` — Canvas Layer Options Moved

```javascript
// v13 — options on CanvasDocument
Drawing.prototype.confirmBeforeCreation
Drawing.prototype.renderSheetAfterCreation

// v14 — moved to PlaceablesLayer
canvas.drawings.options.confirmBeforeCreation
canvas.drawings.options.renderSheetAfterCreation
canvas.drawings.options.controlObjectAfterCreation
```

### `AmbientLight` Removals (no deprecation period)

These methods were removed without a deprecation warning:

- `AmbientLight#controlIcon`
- `AmbientLight#refreshControl`
- `AmbientLight#_refreshElevation`

If you interact with AmbientLight placeables and call these, update your code.

### New Light Coloration Techniques

- "Adaptive Attenuation"
- "Natural Attenuation"

These are cosmetic additions; no API breakage.

### `RectangleShapeData` Pivot Changed

```javascript
// v13 — pivot at center
pivot: (x + width/2, y + height/2)

// v14 — pivot at top-left; new anchor fields
pivot: (x, y)
anchorX: number  // new field
anchorY: number  // new field
```

**Impact:** Any code that positions or offsets rectangle-shaped placeables by center may need adjustment.

### Tile Mesh Positioning

Tile mesh `(x, y)` now equals the document's `(x, y)` position directly. New `anchorX`/`anchorY` options available in Tile Config. May require art/position adjustments for custom tile handling.

### New `ParticleGenerator` API

Full particle system available for visual effects:

```javascript
// Basic usage
const gen = new ParticleGenerator(canvas.stage, options);
gen.start();

// With mask
gen.mask = someDisplayObject;

// Callback
new ParticleGenerator(stage, {
  onUpdate: (particle, dt) => { ... }
});
```

See `VFXParticleGeneratorComponent`, `VFXEffect`, `VFXPointSourcePolygonField` for advanced usage.

### Context Menus for Placeables

```javascript
// v13 — type-specific hooks
Hooks.on("getDrawingContextOptions", ...)
Hooks.on("getTokenContextOptions", ...)

// v14 — single generic hook
Hooks.on("getPlaceableContextOptions", (application, menuItems) => {
  // menuItems is the array to modify
});
```

### Sidebar Restructuring

New per-document-type sidebar tabs replace monolithic directories:

```
client/applications/sidebar/filters/  (new)
  ambient-light-filter.mjs
  placeable-filter.mjs
  region-filter.mjs
  ...
client/applications/sidebar/tabs/    (new)
  ambient-light-tab.mjs
  drawing-tab.mjs
  token-tab.mjs
  ...
```

If you extend sidebar classes, check for structural changes.

---

## 11. Token Changes

### New Token Fields

| Field | Type | Notes |
|-------|------|-------|
| `depth` | `NumberField({ min: 0, initial: 1 })` | Token depth (z-like layering) |
| `level` | `DocumentIdField` | Which Level document this token belongs to |
| `_movementHistory[].subpathId` | `StringField` | Subpath tracking in movement history |

### `MOVEMENT_FIELDS` Constant

```javascript
// v13
["x", "y", "elevation", "width", "height", "shape"]

// v14
["x", "y", "elevation", "width", "height", "depth", "shape", "level"]
```

If you iterate `MOVEMENT_FIELDS` or check if a field is a movement field, update.

### `detectionModes` Field Type Change

```javascript
// v13 — ArrayField of objects with explicit id
detectionModes: ArrayField(SchemaField({
  id: StringField,
  enabled: BooleanField,
  range: NumberField
}))

// v14 — TypedObjectField (keys ARE the ids)
detectionModes: TypedObjectField(SchemaField({
  enabled: BooleanField,
  range: NumberField
}))
```

**Impact:** If you read/write `token.detectionModes` as an array and use the `id` field, restructure to use object key access.

### `TokenConstrainMovementPathOptions`

New options for token movement path constraints:

```javascript
{
  maxCost: number,      // maximum movement cost
  maxDistance: number   // maximum distance
}
```

### Token Movement Split Behavior

Default `TokenMovementAction#split` changed:

- v13: split based on prior logic
- v14: `false` only if no prior movement history, OR both previous and current movements used keyboard

### New Token Hooks

```javascript
Hooks.on("planToken", (document) => {
  // Fires when token movement is being planned
});
```

New protected method `TokenDocument#_onMovementPlanned` for custom token documents.

---

## 12. DataField & DataModel Changes

### New Field Types / Updated Types

| Type | Status | Notes |
|------|--------|-------|
| `SceneLevelsSetField` | New | For assigning documents to scene levels |
| `IntegerSortField` | New | For sort ordering in Level and other documents |
| `TypedObjectField` | Changed | Different implementation; used for detectionModes |
| `DocumentUUIDField` | Enhanced | New `relative` option for relative UUID references |

### Relative UUID Support

```javascript
// New option on DocumentUUIDField
new DocumentUUIDField({ relative: true })

// New utility
foundry.utils.buildRelativeUuid(uuid, baseUuid)
```

Use relative UUIDs for Region behaviors and any cross-document references that should survive scene exports/imports.

### `DataFieldOperator` Values

Special operation keys in `updateSource` are deprecated:

```javascript
// v13 — special string keys in update data
{ "-=fieldName": null }   // delete
{ "==fieldName": value }  // replace

// v14 — use DataFieldOperator values instead
// (exact API TBD — check foundry.data.operators)
```

### Batched Document Modifications

```javascript
// foundry.documents.modifyBatch parameter rename
// v13
{ documentType: "Actor", ... }

// v14
{ documentName: "Actor", ... }
```

Batched modifications are now broadcast to all connected clients (not just the originating client).

### `Document#persisted`

New boolean property:

```javascript
document.persisted  // true if document has a non-null UUID that resolves via fromUuid
```

---

## 13. Hooks Changes

### New Hooks

| Hook | Parameters | Notes |
|------|-----------|-------|
| `preRenderApplication` | `(application, context, options)` | Before ApplicationV2 render; can modify context/options |
| `getPlaceableContextOptions` | `(application, menuItems)` | Replaces per-type placeable context hooks |
| `openDetachedWindow` | `(id, win)` | Detached window opened |
| `closeDetachedWindow` | `(id, win)` | Detached window closed |
| `planToken` | `(document)` | Token movement being planned |
| `CalendarData#onUpdateWorldTime` | (awaited) | Before downstream `updateWorldTime`; new async workflow hook |

### Hook Parameter Changes

| Hook | v13 params | v14 params |
|------|-----------|-----------|
| `initializeEdges` | `()` | `(scene)` |

### Deprecated Hook (still fires, removed in v16)

| Hook | Notes |
|------|-------|
| `activateEditorLegacy` | `(editor, options, initialContent)` — fires when editor activation button pressed |

---

## 14. CONST Changes

### New Constants

```javascript
CONST.ACTIVE_EFFECT_TIME_DURATION_UNITS   // time units for effect duration
CONST.ACTIVE_EFFECT_DURATION_UNITS        // duration units enum
CONST.ACTIVE_EFFECT_EXPIRY_EVENTS         // when effects expire
CONST.ACTIVE_EFFECT_CHANGE_PHASES         // change application timing phases
CONST.ACTIVE_EFFECT_CHANGE_TYPES          // replaces parts of ACTIVE_EFFECT_MODES
CONST.ACTIVE_EFFECT_SHOW_ICON             // "always", "never", conditional
CONST.EDGE_DIRECTION_MODES
CONST.EDGE_DIRECTIONS
CONST.EDGE_RESTRICTION_TYPES
CONST.EDGE_SENSE_TYPES
CONST.FOG_EXPLORATION_MODES
CONST.TEXTURE_DATA_FIT_MODES              // ["fill", "contain", "cover", "width", "height"]
CONST.IDLE_THRESHOLD_MS
```

### Deprecated / Removed Constants

| Constant | Status | Replacement |
|----------|--------|-------------|
| `CONST.MEASURED_TEMPLATE_TYPES` | Deprecated (proxied) | Use Region system |
| `CONST.CHAT_MESSAGE_TYPES` | Deprecated | Use `CONST.CHAT_MESSAGE_STYLES` |

### New Document Types

`"Level"` added to document type lists. `"MeasuredTemplate"` deprecated.

---

## 15. TinyMCE Removed — ProseMirror

### What's Gone

- `tinymce` npm dependency removed entirely.
- Any code that instantiates or configures a TinyMCE editor will fail.
- The `TextEditor` `tinymce` option is removed.

### What Replaces It

ProseMirror is now the only built-in rich text editor. Improvements in v14:

- Image insert tool with optional caption support.
- Custom CSS classes on nodes/marks.
- Inline or block HTML template insertion via menu.
- Table section support (`@massifrg/prosemirror-tables-sections`).
- Font size and color customization.
- Collapsible text sections.

### Custom Template Insertion

```javascript
// Configure via CONFIG
CONFIG.TextEditor.inserts = [
  {
    label: "My Template",
    type: "block",   // or "inline"
    content: "<p>Template content with <selection> placeholder</p>"
  }
];
```

### External TinyMCE Re-Integration

Foundry provides an external integration API so a module can re-introduce TinyMCE if needed. Check the official docs for the integration API.

### `foundry.applications.ux.ProseMirrorEditor`

```javascript
// v13 (deprecated)
foundry.prosemirror.defaultPlugins

// v14
foundry.applications.ux.ProseMirrorEditor.buildDefaultPlugins()
```

### `htmlFields` in Systems

Systems using `htmlFields` in their data models should verify ProseMirror enrichment works correctly. The enrichment API itself (`TextEditor.enrichHTML`) is stable, but editor UI changes mean TinyMCE-specific markup or editor initialization code will break.

---

## 16. Global Namespace Changes

### New Globals

```javascript
_del       // ForcedDeletion operator instance
_replace   // ForcedReplacement.create method
_localize  // Alias for game.i18n.localize
```

### New Namespace Entries

```javascript
foundry.documents.Level                   // new Level document class
foundry.applications.detached            // DetachedWindowManager instance
foundry.applications.detached.windows   // Map of open detached windows
```

### Deprecated Namespace Entries

```javascript
foundry.documents.MeasuredTemplateDocument  // @deprecated since v14
foundry.prosemirror.defaultPlugins          // @deprecated; use ProseMirrorEditor.buildDefaultPlugins()
CONFIG.statusEffects                         // direct assignment deprecated; use property setter
```

### New Library

```javascript
// animejs is now bundled and available
import anime from "animejs";  // or via foundry bundle
```

---

## 17. Deprecations (Removed in v14)

These were deprecated in earlier versions and are **gone** in v14:

| Thing | Deprecated Since | Notes |
|-------|-----------------|-------|
| `CONFIG.ActiveEffect.legacyTransferral` | v11 | Removed without replacement |
| `TextureData#offsetX`, `#offsetY`, `#rotation` | v13 | Removed |
| Removed V12-era shims | v12 | All v12 deprecations removed |

---

## 18. Deprecations (Scheduled for Future Removal)

These still work in v14 but will break in a future version:

| Thing | Deprecated Since | Removal Target | Replacement |
|-------|-----------------|---------------|-------------|
| `Application` (AppV1) | v13 | v16 | `ApplicationV2` |
| `Dialog` (AppV1) | v13 | v16 | `DialogV2` |
| `FormApplication` (AppV1) | v13 | v16 | `ApplicationV2` |
| `DocumentSheet` (AppV1) | v13 | v16 | `DocumentSheetV2` |
| `activateEditorLegacy` hook | v14 | v16 | ProseMirror APIs |
| `CONST.MEASURED_TEMPLATE_TYPES` | v14 | future | Region system |
| `CONST.CHAT_MESSAGE_TYPES` | v14 | future | `CONST.CHAT_MESSAGE_STYLES` |
| `foundry.prosemirror.defaultPlugins` | v14 | future | `ProseMirrorEditor.buildDefaultPlugins()` |
| `minimumCoreVersion` / `compatibleCoreVersion` manifest fields | v10 | future | `compatibility` object |
| `dependencies` manifest field | v10 | future | `relationships` field |
| `foundry.documents.modifyBatch` `documentType` key | v14 | future | `documentName` |
| Special string operators (`-=`, `==`) in `updateSource` | v14 | future | `DataFieldOperator` values |
| `MeasuredTemplateDocument` | v14 | future | Regions |

---

## 19. What Did NOT Change

These patterns are stable — no migration needed:

- **Socket API:** `game.socket.on()`, `game.socket.emit()` — unchanged.
- **Hooks system:** `Hooks.on()`, `Hooks.once()`, `Hooks.call()`, `Hooks.callAll()` — unchanged. Most hook names unchanged unless noted in [Hooks Changes](#13-hooks-changes).
- **Flag system:** `document.getFlag()`, `document.setFlag()`, `document.unsetFlag()` — unchanged.
- **Settings API:** `game.settings.register()`, `game.settings.get()`, `game.settings.set()` — unchanged.
- **CRUD operations:** `Document.create()`, `document.update()`, `document.delete()`, `createEmbeddedDocuments()`, `updateEmbeddedDocuments()`, `deleteEmbeddedDocuments()` — unchanged.
- **ApplicationV2 / DialogV2 core API:** `render()`, `close()`, `_prepareContext()`, `_onRender()`, `_onClose()` — unchanged (new methods added, existing ones stable).
- **`foundry.applications.api.DialogV2`:** `confirm()`, `wait()`, `prompt()` — unchanged.
- **Handlebars:** `foundry.applications.handlebars.loadTemplates()` — unchanged.
- **`DocumentSheetConfig.registerSheet()`** — unchanged.
- **`TypeDataModel` subclasses** — unchanged.
- **PIXI.js:** pinned at `7.4.3` in both v13 and v14. PIXI API stable.
- **Canvas access:** `canvas.drawings`, `canvas.tokens`, `canvas.scene`, `canvas.stage` — unchanged.
- **Canvas methods:** `canvas.pan()`, `canvas.animatePan()` — unchanged.
- **`TextEditor.enrichHTML()`** — unchanged.
- **CONFIG document class registrations:** Pattern is the same; new classes available but registration unchanged.
- **Localization:** `game.i18n.localize()`, `game.i18n.format()` — unchanged.
- **Namespaced class references:**
  ```javascript
  foundry.applications.sheets.DrawingConfig         // stable
  foundry.applications.apps.FilePicker.implementation // stable
  foundry.applications.ux.TextEditor.implementation  // stable
  foundry.applications.apps.DocumentSheetConfig      // stable
  foundry.documents.DrawingDocument                  // stable
  foundry.applications.hud.BasePlaceableHUD           // stable
  foundry.canvas.placeables.Drawing                  // stable (though internals refactored)
  ```

---

## 20. Migration Checklist

### Environment

- [ ] Upgrade dev environment to Node.js 24.
- [ ] Install v14 to a separate directory; use separate user data path.
- [ ] Boot with all modules disabled first.

### Manifest (`module.json` / `system.json`)

- [ ] Add/update `compatibility` object with `minimum` and `verified`.
- [ ] Remove any `maximum` field (or update to `"14"`).
- [ ] Replace `minimumCoreVersion`/`compatibleCoreVersion` with `compatibility`.
- [ ] Replace `dependencies` with `relationships`.

### AppV1 — Remove Before v16

- [ ] Audit for `new Dialog({...})` — replace with `DialogV2`.
- [ ] Audit for `new Application({...})` — replace with `ApplicationV2`.
- [ ] Audit for `new FormApplication({...})` — replace with `ApplicationV2`.
- [ ] Audit for `extends Application`, `extends FormApplication`, `extends DocumentSheet` — replace with V2 equivalents.
- [ ] Audit for `foundry.appv1.*` imports — migrate to `foundry.applications.*`.

### Active Effects

- [ ] Remove any reference to `CONFIG.ActiveEffect.legacyTransferral`.
- [ ] Update code reading `effect.changes` → `effect.system.changes`.
- [ ] Update code reading `effect.origin` as a plain string → it is now a UUID field.
- [ ] Update `EffectChangeData#mode` (number) references → `EffectChangeData#type` (string).
- [ ] Use `CONST.ACTIVE_EFFECT_CHANGE_TYPES` instead of `ACTIVE_EFFECT_MODES` where applicable.

### Measured Templates → Regions

- [ ] Replace all `createEmbeddedDocuments('MeasuredTemplate', ...)` with Region creation.
- [ ] Remove all `canvas.scene.templates.get(id)` / `.delete()` calls.
- [ ] Replace `CONST.MEASURED_TEMPLATE_TYPES` references.
- [ ] Update `canvas.templates` layer usage if applicable.

### TinyMCE / ProseMirror

- [ ] Remove any TinyMCE editor initialization code.
- [ ] Remove `TextEditor` `tinymce` option.
- [ ] Test `htmlFields` enrichment with ProseMirror.
- [ ] Migrate `foundry.prosemirror.defaultPlugins` → `ProseMirrorEditor.buildDefaultPlugins()`.
- [ ] Add custom template insertions via `CONFIG.TextEditor.inserts` if needed.

### ApplicationV2 Subclasses

- [ ] If overriding `_insertElement`, update signature: `async _insertElement(element, options = {})`.
- [ ] If overriding `_renderFrame`, account for detached window `options.window?.host?.document`.
- [ ] Test that `_canRender` returning `false` still works as expected.
- [ ] Add `data-sync` attribute to `<details>` elements that should preserve open/closed state.
- [ ] Test pop-out/detach behavior — default header now has Detach/Attach buttons.

### Canvas & Placeables

- [ ] If extending `Drawing`, test custom subclass against new `ShapeObjectMixin` inheritance.
- [ ] Remove calls to `AmbientLight#controlIcon`, `#refreshControl`, `#_refreshElevation`.
- [ ] Update `PlaceablesLayer` option access: `confirmBeforeCreation`, etc. moved to layer options.
- [ ] Check `RectangleShapeData` usage — pivot changed from center to top-left; use new `anchorX/Y`.
- [ ] Update context menu hooks: `getDrawingContextOptions` etc. → `getPlaceableContextOptions`.

### Tokens

- [ ] Account for new token fields: `depth`, `level`, `subpathId`.
- [ ] Update `MOVEMENT_FIELDS` usage to include `depth` and `level`.
- [ ] Update `detectionModes` access: no longer an array with `id` field; use object key access.
- [ ] If constraining token movement paths, use new `maxCost`/`maxDistance` options.

### DataModel / Fields

- [ ] Replace `documentType` with `documentName` in `foundry.documents.modifyBatch` calls.
- [ ] Migrate special update operators (`-=`, `==`) to `DataFieldOperator` values.
- [ ] Use `document.persisted` for checking persistence instead of UUID null-checks.
- [ ] For cross-scene references in Region behaviors, use relative UUIDs.

### CONST

- [ ] Replace `CONST.CHAT_MESSAGE_TYPES` with `CONST.CHAT_MESSAGE_STYLES`.
- [ ] Remove `CONST.MEASURED_TEMPLATE_TYPES` usage.

### Hooks

- [ ] Update `initializeEdges` listeners to accept `(scene)` parameter.
- [ ] Migrate from per-type context menu hooks to `getPlaceableContextOptions`.
- [ ] Use `preRenderApplication` for pre-render context modification.
- [ ] Register `planToken` handler if processing token movement planning.

---

## Resources

- **Official Release Notes:** https://foundryvtt.com/releases/
- **API Documentation:** https://foundryvtt.com/api/
- **Migration Guide Index:** https://foundryvtt.com/article/migration/
- **Scene Regions:** https://foundryvtt.com/article/scene-regions/
- **Active Effects:** https://foundryvtt.com/article/active-effects/
- **Community Wiki (Dev):** https://foundryvtt.wiki/en/development/api
- **ApplicationV2 Conversion Guide:** https://foundryvtt.wiki/en/development/guides/applicationV2-conversion-guide
- **Active Effects Primer:** https://foundryvtt.wiki/en/development/guides/active-effects
- **Hooks Reference:** https://foundryvtt.com/api/modules/hookEvents.html

---
name: Pin sprite deletion — use setTimeout defer + placeables.find
description: How to reliably clean up pin sprites when a drawing is deleted
type: feedback
---

Use `setTimeout(0)` to defer `updatePins()` in the `deleteDrawing` hook. The hook fires mid-way through Foundry's deletion processing; deferring one event loop tick ensures the canvas layer has fully removed the placeable from `canvas.drawings.placeables` before rebuilding pins.

Also use `canvas.drawings.placeables.find(p => p.document.id === drawing.id)` instead of `canvas.drawings.get(drawing.id)` — the latter is unreliable in v14 when the placeable is being torn down.

**Why:** Pin sprites live in `pinsContainer` outside the drawing's own PIXI hierarchy. When a drawing is deleted, `updatePins()` called synchronously in the hook may still see the placeable in the collection and re-add the orphaned pin. Deferring solves this regardless of timing. `canvas.drawings.get()` was returning null even when the placeable was still accessible via `placeables.find()`.

**How to apply:** Any time you need to react to a drawing deletion and call `updatePins()`, wrap it in `setTimeout(() => { updatePins(); }, 0)`.

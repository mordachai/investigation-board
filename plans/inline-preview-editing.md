# Plan: Inline Text Editing in Note Previewer

**Target types:** sticky, index, photo (non-futuristic only)  
**Branch:** v14

---

## Goal

Allow users to edit note text directly inside the NotePreviewer window without opening the full drawing-sheet dialog.

---

## Affected Files

| File | Change |
|------|--------|
| `templates/note-preview.html` | Replace static text divs with `contenteditable` elements; add edit-mode attributes |
| `scripts/apps/note-previewer.js` | Bind save logic (blur + Ctrl+S); collaborative update; visual feedback |
| `styles/style.css` | Editable hover/focus styles; saved-flash animation |

---

## Template Changes (`note-preview.html`)

### sticky / index — `.preview-text` div
Replace:
```html
<div class="preview-text" style="...">{{text}}</div>
```
With:
```html
<div class="preview-text ib-editable-text"
     contenteditable="true"
     data-field="text"
     style="...">{{text}}</div>
```

### photo — `.photo-frame-text` div (non-futuristic only)
Replace:
```html
<div class="photo-frame-text {{fontClass}}" style="color: {{textColor}};">
    {{text}}
</div>
```
With:
```html
<div class="photo-frame-text {{fontClass}} ib-editable-text"
     contenteditable="true"
     data-field="text"
     style="color: {{textColor}};">{{text}}</div>
```

---

## JS Changes (`note-previewer.js`)

### New method: `_bindInlineEditing(html)`
Called from `_onRender`. Binds all `.ib-editable-text` elements.

```javascript
_bindInlineEditing(html) {
  const editables = html.querySelectorAll(".ib-editable-text");
  editables.forEach(el => {
    // Ctrl+S / Cmd+S → save without blur
    el.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "s") {
        ev.preventDefault();
        this._saveInlineText(el);
      }
      // Enter without Shift → save (for single-line feel on photo/sticky)
      // Index notes allow multi-line, so skip this for index
      const noteType = this.document.flags[MODULE_ID]?.type;
      if (ev.key === "Enter" && !ev.shiftKey && noteType !== "index") {
        ev.preventDefault();
        el.blur();
      }
    });

    // Blur → save
    el.addEventListener("blur", () => this._saveInlineText(el));

    // Prevent preview close when clicking inside editable
    el.addEventListener("mousedown", (ev) => ev.stopPropagation());
  });
}

async _saveInlineText(el) {
  const newText = el.innerText.trim();
  const field = el.dataset.field; // "text"
  const currentText = this.document.flags[MODULE_ID]?.[field] || "";

  if (newText === currentText) return; // no change

  const updateData = {
    [`flags.${MODULE_ID}.${field}`]: newText
  };

  await collaborativeUpdate(this.document.id, updateData);
  this._flashSaved(el);
}

_flashSaved(el) {
  el.classList.add("ib-saved-flash");
  setTimeout(() => el.classList.remove("ib-saved-flash"), 800);
}
```

### In `_onRender`:
Add call after existing setup:
```javascript
this._bindInlineEditing(html);
```

### Import `collaborativeUpdate` at top:
```javascript
import { socket, activeGlobalSounds, collaborativeUpdate } from "../utils/socket-handler.js";
```

---

## CSS Changes

```css
/* Editable text fields in previewer */
.ib-editable-text {
  cursor: text;
  border-radius: 3px;
  outline: none;
  transition: box-shadow 0.15s ease;
  min-height: 1em;
}

.ib-editable-text:hover {
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.2);
}

.ib-editable-text:focus {
  box-shadow: inset 0 0 0 2px rgba(80, 120, 200, 0.5);
}

/* Saved flash */
@keyframes ib-save-flash {
  0%   { box-shadow: inset 0 0 0 2px rgba(60, 180, 60, 0.8); }
  100% { box-shadow: none; }
}

.ib-editable-text.ib-saved-flash {
  animation: ib-save-flash 0.8s ease-out forwards;
}
```

---

## Behavior Notes

- **Save triggers:** `blur` (click away) and `Ctrl+S` / `Cmd+S`
- **Enter key:** For sticky/photo — submits (calls blur). For index — allows multi-line (Shift+Enter always available for multi-line)
- **No save if unchanged:** guard with `newText === currentText`
- **Collaborative:** routes through `collaborativeUpdate` — works for non-owners via socket
- **No full re-render after save:** text already in DOM from user typing; just flash saved indicator. Canvas note re-renders automatically via existing `updateDrawing` hook.
- **Photo futuristic mode:** `identityName` field is not editable here (different field, different flow). Only `text` field.
- **Character limits:** Not enforced at input time (matches drawing-sheet behavior). Truncation only happens on canvas sprite render.

---

## Steps

1. [ ] Add `collaborativeUpdate` import to `note-previewer.js`
2. [ ] Add `_bindInlineEditing` and `_saveInlineText` and `_flashSaved` methods
3. [ ] Call `_bindInlineEditing(html)` in `_onRender`
4. [ ] Update `note-preview.html` — sticky/index `.preview-text`
5. [ ] Update `note-preview.html` — photo `.photo-frame-text` (non-futuristic block only)
6. [ ] Add CSS for editable states and save flash
7. [ ] Test sticky, index, photo (normal mode)
8. [ ] Test collaborative update as non-owner player
9. [ ] Test Ctrl+S shortcut
10. [ ] Test Enter key behavior per type

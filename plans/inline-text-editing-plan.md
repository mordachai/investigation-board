# Inline Text Editing for Investigation Board Notes - Implementation Plan

## Overview
Enable direct text editing both on the canvas notes themselves AND within the note preview window for sticky notes, index cards, and photo notes. The text should remain visually styled as note text (no input field decorations) and save automatically or on explicit save actions.

## Editing Modes
1. **Canvas Inline Editing** (Primary): Click directly on note text on the canvas to edit
2. **Preview Window Editing** (Secondary): Edit text within the note preview dialog

## Current State Analysis

### Affected Note Types
- **Sticky Notes**: Text displayed with paper texture background and custom fonts
- **Index Cards**: Text on lined paper background with larger format
- **Photo Notes**: Text overlay at bottom of polaroid frame

## Current State Analysis

### Affected Note Types
- **Sticky Notes**: Text displayed with paper texture background and custom fonts
- **Index Cards**: Text on lined paper background with larger format  
- **Photo Notes**: Text overlay at bottom of polaroid frame

### Current Canvas Architecture
- Text rendered as `PIXI.Text` objects on canvas using `this.noteText`
- Text positioned and styled based on note type (sticky, index, photo)
- Text truncated using `truncateText()` function for canvas display
- Click events handled by `CustomDrawing` class methods

### Current Preview Architecture
- `NotePreviewer` class extends `ApplicationV2` with Handlebars template
- Text rendered as static `<div class="preview-text">` with styling
- Edit button opens separate configuration dialog
- Close button saves and closes preview

## Implementation Plan

## Implementation Plan

### Phase 1: Canvas Inline Editing (Primary Feature)

#### 1.1 Canvas Text Interaction System (`scripts/canvas/custom-drawing.js`)

**New Properties for CustomDrawing:**
```javascript
constructor(...args) {
  super(...args);
  // ... existing properties ...
  this.isEditingText = false;
  this.textEditOverlay = null;
  this.originalText = "";
}
```

**Enhanced Click Handling:**
```javascript
/**
 * Override click handling to detect text area clicks
 */
_onClickLeft(event) {
  const noteData = this.document.flags?.[MODULE_ID];
  if (!noteData?.type || !this.noteText) {
    return super._onClickLeft(event);
  }

  // Check if click is on text area
  const localPoint = event.data.getLocalPosition(this);
  const textBounds = this.noteText.getBounds();
  
  if (this._isPointInTextArea(localPoint, textBounds)) {
    event.stopPropagation();
    this._startTextEditing();
    return;
  }
  
  return super._onClickLeft(event);
}

/**
 * Check if click point is within text area
 */
_isPointInTextArea(point, textBounds) {
  const noteData = this.document.flags[MODULE_ID];
  
  // Expand clickable area based on note type
  const padding = noteData.type === "photo" ? 10 : 20;
  
  return point.x >= textBounds.x - padding &&
         point.x <= textBounds.x + textBounds.width + padding &&
         point.y >= textBounds.y - padding &&
         point.y <= textBounds.y + textBounds.height + padding;
}
```

#### 1.2 HTML Text Overlay System

**Text Editing Overlay Creation:**
```javascript
/**
 * Start text editing by creating HTML overlay
 */
_startTextEditing() {
  if (this.isEditingText) return;
  
  this.isEditingText = true;
  this.originalText = this.document.flags[MODULE_ID].text || "";
  
  // Hide PIXI text while editing
  this.noteText.visible = false;
  
  // Create HTML overlay
  this._createTextEditOverlay();
}

/**
 * Create HTML text input overlay positioned over canvas text
 */
_createTextEditOverlay() {
  const noteData = this.document.flags[MODULE_ID];
  
  // Calculate screen position of text
  const textBounds = this.noteText.getBounds();
  const canvasRect = canvas.app.view.getBoundingClientRect();
  
  // Create textarea element
  this.textEditOverlay = document.createElement('textarea');
  this.textEditOverlay.className = 'ib-canvas-text-editor';
  this.textEditOverlay.value = this.originalText;
  
  // Style to match PIXI text appearance
  const textStyle = this.noteText.style;
  Object.assign(this.textEditOverlay.style, {
    position: 'absolute',
    left: `${canvasRect.left + textBounds.x}px`,
    top: `${canvasRect.top + textBounds.y}px`,
    width: `${textBounds.width}px`,
    height: `${textBounds.height}px`,
    fontFamily: textStyle.fontFamily,
    fontSize: `${textStyle.fontSize}px`,
    color: textStyle.fill,
    textAlign: textStyle.align,
    background: 'transparent',
    border: '2px solid rgba(255, 215, 0, 0.7)',
    borderRadius: '4px',
    outline: 'none',
    resize: 'none',
    zIndex: '10000',
    padding: '4px'
  });
  
  // Add to document
  document.body.appendChild(this.textEditOverlay);
  
  // Focus and select text
  this.textEditOverlay.focus();
  this.textEditOverlay.select();
  
  // Add event listeners
  this._setupTextEditListeners();
}

/**
 * Setup event listeners for text editing
 */
_setupTextEditListeners() {
  if (!this.textEditOverlay) return;
  
  // Save on Enter (with Ctrl/Cmd) or blur
  this.textEditOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this._saveTextEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this._cancelTextEdit();
    }
  });
  
  // Save on blur (clicking elsewhere)
  this.textEditOverlay.addEventListener('blur', () => {
    // Small delay to allow other interactions
    setTimeout(() => {
      if (this.isEditingText) {
        this._saveTextEdit();
      }
    }, 100);
  });
  
  // Auto-resize textarea
  this.textEditOverlay.addEventListener('input', () => {
    this._autoResizeTextarea();
  });
  
  // Handle window resize/scroll
  this._resizeHandler = () => this._updateOverlayPosition();
  window.addEventListener('resize', this._resizeHandler);
  window.addEventListener('scroll', this._resizeHandler);
}

/**
 * Auto-resize textarea to fit content
 */
_autoResizeTextarea() {
  if (!this.textEditOverlay) return;
  
  this.textEditOverlay.style.height = 'auto';
  this.textEditOverlay.style.height = `${this.textEditOverlay.scrollHeight}px`;
}

/**
 * Update overlay position (for window resize/scroll)
 */
_updateOverlayPosition() {
  if (!this.textEditOverlay || !this.noteText) return;
  
  const textBounds = this.noteText.getBounds();
  const canvasRect = canvas.app.view.getBoundingClientRect();
  
  this.textEditOverlay.style.left = `${canvasRect.left + textBounds.x}px`;
  this.textEditOverlay.style.top = `${canvasRect.top + textBounds.y}px`;
}

/**
 * Save text changes
 */
async _saveTextEdit() {
  if (!this.textEditOverlay || !this.isEditingText) return;
  
  const newText = this.textEditOverlay.value.trim();
  
  if (newText !== this.originalText) {
    // Use collaborative update
    await collaborativeUpdate(this.document.id, {
      [`flags.${MODULE_ID}.text`]: newText
    });
    
    ui.notifications.info("Note text updated.");
  }
  
  this._endTextEditing();
}

/**
 * Cancel text editing
 */
_cancelTextEdit() {
  this._endTextEditing();
}

/**
 * End text editing and cleanup
 */
_endTextEditing() {
  if (!this.isEditingText) return;
  
  this.isEditingText = false;
  
  // Remove overlay
  if (this.textEditOverlay) {
    this.textEditOverlay.remove();
    this.textEditOverlay = null;
  }
  
  // Remove event listeners
  if (this._resizeHandler) {
    window.removeEventListener('resize', this._resizeHandler);
    window.removeEventListener('scroll', this._resizeHandler);
    this._resizeHandler = null;
  }
  
  // Show PIXI text again
  if (this.noteText) {
    this.noteText.visible = true;
  }
}
```

#### 1.3 CSS Styling for Canvas Text Editor

**New CSS (`styles/style.css`):**
```css
/* Canvas text editor overlay */
.ib-canvas-text-editor {
  font-family: inherit !important;
  background: rgba(255, 255, 255, 0.95) !important;
  border: 2px solid rgba(255, 215, 0, 0.8) !important;
  border-radius: 4px !important;
  outline: none !important;
  resize: none !important;
  padding: 4px !important;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3) !important;
  backdrop-filter: blur(2px) !important;
}

.ib-canvas-text-editor:focus {
  border-color: rgba(255, 215, 0, 1) !important;
  box-shadow: 0 0 10px rgba(255, 215, 0, 0.5) !important;
}

/* Cursor indication for editable text areas */
.drawing[data-investigation-note="true"]:hover {
  cursor: pointer;
}

.drawing[data-investigation-note="true"].text-editable:hover {
  cursor: text;
}
```

### Phase 2: Enhanced Canvas Integration

#### 2.1 Visual Feedback System
```javascript
/**
 * Add hover effects for editable text
 */
_onHover(event, hovered) {
  super._onHover(event, hovered);
  
  const noteData = this.document.flags?.[MODULE_ID];
  if (!noteData?.type || !this.noteText) return;
  
  if (hovered) {
    // Add subtle glow to indicate text is editable
    this.noteText.filters = [new PIXI.filters.GlowFilter({
      color: 0xFFD700,
      outerStrength: 1,
      innerStrength: 0,
      distance: 5
    })];
    
    // Change cursor
    canvas.app.view.style.cursor = 'text';
  } else {
    this.noteText.filters = [];
    canvas.app.view.style.cursor = '';
  }
}
```

#### 2.2 Text Truncation Handling
```javascript
/**
 * Handle text that exceeds display limits
 */
_handleTextTruncation(fullText) {
  const noteData = this.document.flags[MODULE_ID];
  const limits = getDynamicCharacterLimits(noteData.font, noteData.type);
  
  if (fullText.length > limits.max) {
    // Show warning during editing
    ui.notifications.warn(`Text is long and may be truncated on canvas. Consider using shorter text or the preview window for longer content.`);
  }
  
  return truncateText(fullText, noteData.font, noteData.type, this.noteText.style.fontSize);
}
```

### Phase 3: Preview Window Editing (Secondary Feature)

#### 3.1 Template Modifications (`templates/note-preview.html`)
**Changes needed:**
- Add `contenteditable="true"` to text containers
- Add data attributes for tracking edit state
- Maintain existing CSS classes for visual consistency
- Add invisible textarea for better mobile support

**Implementation:**
```html
<!-- For sticky/index notes -->
<div class="preview-text editable-text" 
     contenteditable="true" 
     data-original-text="{{text}}"
     data-note-type="{{noteType}}"
     style="font-size: {{previewFontSize}}px; color: {{textColor}};">{{text}}</div>

<!-- For photo notes -->
<div class="photo-frame-text {{fontClass}} editable-text" 
     contenteditable="true"
     data-original-text="{{text}}"
     data-note-type="photo"
     style="color: {{textColor}};">{{text}}</div>
```

#### 3.2 CSS Enhancements (`styles/style.css`)
**New styles needed:**
```css
/* Remove contenteditable styling while preserving note appearance */
.editable-text {
  outline: none !important;
  border: none !important;
  background: transparent !important;
  resize: none !important;
}

.editable-text:focus {
  outline: 2px solid rgba(255, 215, 0, 0.5) !important;
  outline-offset: 2px;
  background: rgba(255, 255, 255, 0.1) !important;
}

/* Cursor indication */
.editable-text:hover {
  cursor: text;
}

/* Preserve text styling during editing */
.editable-text * {
  font-family: inherit !important;
  font-size: inherit !important;
  color: inherit !important;
}
```

### Phase 4: JavaScript Implementation for Preview Window

#### 4.1 NotePreviewer Class Modifications (`scripts/apps/note-previewer.js`)

**New Properties:**
```javascript
constructor(document, options = {}) {
  // ... existing code ...
  this.isEditing = false;
  this.originalText = "";
  this.hasUnsavedChanges = false;
}
```

**New Methods:**
```javascript
/**
 * Initialize inline text editing functionality
 */
_initializeInlineEditing(html) {
  const editableElements = html.querySelectorAll('.editable-text');
  
  editableElements.forEach(element => {
    this._setupEditableElement(element);
  });
}

/**
 * Setup individual editable element
 */
_setupEditableElement(element) {
  const originalText = element.dataset.originalText || "";
  
  // Store original text
  element.addEventListener('focus', (e) => {
    this.isEditing = true;
    this.originalText = element.textContent;
    element.classList.add('editing');
  });
  
  // Track changes
  element.addEventListener('input', (e) => {
    this.hasUnsavedChanges = element.textContent !== this.originalText;
    this._updateControlsState();
  });
  
  // Handle keyboard shortcuts
  element.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      this._cancelEditing(element);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      this._saveAndClose();
    }
  });
  
  // Handle blur (focus lost)
  element.addEventListener('blur', (e) => {
    // Small delay to allow clicking save/cancel buttons
    setTimeout(() => {
      if (!this.element.contains(document.activeElement)) {
        this.isEditing = false;
        element.classList.remove('editing');
      }
    }, 100);
  });
}

/**
 * Cancel editing and restore original text
 */
_cancelEditing(element) {
  element.textContent = this.originalText;
  element.blur();
  this.hasUnsavedChanges = false;
  this.isEditing = false;
  this._updateControlsState();
}

/**
 * Save changes and close preview
 */
async _saveAndClose() {
  if (this.hasUnsavedChanges) {
    await this._saveTextChanges();
  }
  this.close();
}

/**
 * Save text changes to document
 */
async _saveTextChanges() {
  const editableElement = this.element.querySelector('.editable-text');
  if (!editableElement) return;
  
  const newText = editableElement.textContent.trim();
  const noteData = this.document.flags[MODULE_ID];
  
  if (newText !== noteData.text) {
    // Use collaborative update for multi-user support
    await collaborativeUpdate(this.document.id, {
      [`flags.${MODULE_ID}.text`]: newText
    });
    
    ui.notifications.info("Note text updated.");
  }
}

/**
 * Update control buttons based on edit state
 */
_updateControlsState() {
  const saveBtn = this.element.querySelector('.save-changes-btn');
  const cancelBtn = this.element.querySelector('.cancel-changes-btn');
  const closeBtn = this.element.querySelector('.close-preview-btn');
  
  if (this.hasUnsavedChanges) {
    if (saveBtn) saveBtn.style.display = 'flex';
    if (cancelBtn) cancelBtn.style.display = 'flex';
    if (closeBtn) closeBtn.textContent = 'Close Without Saving';
  } else {
    if (saveBtn) saveBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (closeBtn) closeBtn.textContent = 'Close';
  }
}
```

#### 4.2 Enhanced Control System

**Modified `_onRender` method:**
```javascript
_onRender(context, options) {
  super._onRender(context, options);
  
  const html = this.element;
  
  // Initialize inline editing
  this._initializeInlineEditing(html);
  
  // Enhanced close button behavior
  html.querySelector(".close-preview-btn")?.addEventListener("click", async () => {
    if (this.hasUnsavedChanges) {
      const confirm = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Unsaved Changes" },
        content: `<p>You have unsaved text changes. Do you want to save them?</p>`,
        rejectClose: false,
        modal: true
      });
      
      if (confirm) {
        await this._saveTextChanges();
      }
    }
    this.close();
  });
  
  // Save changes button (initially hidden)
  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-changes-btn';
  saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
  saveBtn.style.display = 'none';
  saveBtn.addEventListener('click', async () => {
    await this._saveTextChanges();
    this.hasUnsavedChanges = false;
    this._updateControlsState();
  });
  
  // Cancel changes button (initially hidden)
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'cancel-changes-btn';
  cancelBtn.innerHTML = '<i class="fas fa-undo"></i> Cancel';
  cancelBtn.style.display = 'none';
  cancelBtn.addEventListener('click', () => {
    const editableElement = this.element.querySelector('.editable-text');
    if (editableElement) {
      this._cancelEditing(editableElement);
    }
  });
  
  // Add buttons to controls
  const controls = html.querySelector('.preview-controls');
  if (controls) {
    controls.insertBefore(saveBtn, controls.firstChild);
    controls.insertBefore(cancelBtn, controls.firstChild);
  }
  
  // ... rest of existing _onRender code ...
}
```

### Phase 5: Enhanced User Experience

#### 5.1 Visual Feedback Improvements
- **Focus indicators**: Subtle glow around editable text
- **Edit mode indicators**: Small edit icon or tooltip
- **Character limits**: Visual feedback for text length limits
- **Auto-resize**: Text container adjusts to content

#### 5.2 Advanced Features
- **Undo/Redo**: Browser native undo support
- **Text formatting**: Preserve basic formatting (bold, italic)
- **Auto-save**: Optional periodic saving during editing
- **Collaborative editing**: Real-time updates when multiple users edit

### Phase 6: Integration & Polish

#### 6.1 Desktop Optimization
- **Precise cursor positioning**: Accurate text cursor placement
- **Keyboard shortcuts**: Full desktop keyboard support (Ctrl+A, Ctrl+Z, etc.)
- **Mouse interaction**: Proper text selection and cursor behavior

#### 6.2 Accessibility
- **Screen reader support**: Proper ARIA labels
- **Keyboard navigation**: Full keyboard accessibility
- **High contrast**: Support for accessibility themes

## Technical Considerations

### Canvas-Specific Challenges
- **PIXI.js Integration**: Seamless transition between PIXI.Text and HTML textarea
- **Coordinate Mapping**: Accurate positioning of HTML overlay over canvas text
- **Event Handling**: Proper click detection on text areas vs. note areas
- **Performance**: Efficient overlay creation/destruction during editing

### Text Truncation Handling
- Current system truncates text based on note type and font
- Need to handle dynamic truncation during editing
- Show full text during editing, truncate on save/display

### Font and Styling Consistency
- Maintain exact font rendering between edit and display modes
- Handle different font families (Rock Salt, Caveat, etc.)
- Preserve text color and size calculations

### Performance Optimization
- Debounce input events to avoid excessive updates
- Efficient DOM manipulation during editing
- Memory management for event listeners

### Error Handling
- Network failures during save operations
- Concurrent editing conflicts
- Invalid text content handling

## Testing Strategy

### Unit Tests
- Text editing state management
- Save/cancel functionality
- Event handling edge cases

### Integration Tests
- Multi-user editing scenarios
- Different note types and fonts
- Mobile device compatibility

### User Acceptance Tests
- Intuitive editing experience
- Visual consistency during editing
- Proper save/cancel behavior

## Implementation Timeline

### Week 1: Canvas Inline Editing Core
- Canvas click detection and text area identification
- HTML overlay creation and positioning system
- Basic save/cancel functionality for canvas editing

### Week 2: Canvas Polish & Preview Integration
- Visual feedback and hover effects for canvas
- Preview window inline editing implementation
- Cross-system consistency and testing

### Week 3: Enhanced Features & Desktop Polish
- Auto-resize and advanced text handling
- Desktop-specific optimizations (keyboard shortcuts, precise positioning)
- Accessibility improvements

### Week 4: Integration & Testing
- Comprehensive testing across note types
- Performance optimization
- Documentation and final polish

## Success Criteria

1. **Canvas Direct Editing**: Click on any note text on canvas to edit inline
2. **Seamless Visual Transition**: HTML overlay matches PIXI text appearance exactly
3. **Intuitive Interaction**: Clear visual feedback for editable text areas
4. **Reliable Persistence**: Changes save correctly and sync across users
5. **Performance**: No lag during overlay creation or text updates
6. **Desktop-Optimized**: Excellent desktop experience with proper keyboard/mouse support
7. **Fallback Support**: Preview window editing as secondary option

## Future Enhancements (Lower Priority)

- **Mobile support**: Touch-optimized editing for tablets
- **Rich text editing**: Bold, italic, underline support
- **Collaborative cursors**: Show other users' editing positions
- **Version history**: Track and restore previous text versions
- **Text templates**: Quick insertion of common investigation terms
- **Voice-to-text**: Speech recognition for hands-free note taking

## Risk Mitigation

### Technical Risks
- **Browser compatibility**: Test across major browsers
- **Mobile limitations**: Fallback for limited mobile support
- **Performance issues**: Optimize for large amounts of text

### User Experience Risks
- **Accidental edits**: Clear visual indicators and confirmation dialogs
- **Data loss**: Auto-save and recovery mechanisms
- **Learning curve**: Intuitive design and helpful tooltips

This plan provides a comprehensive roadmap for implementing inline text editing while maintaining the immersive, styled appearance of the investigation board notes.
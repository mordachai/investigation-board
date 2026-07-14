import { MODULE_ID } from '../config.js';
import { getAvailablePinFiles, resolvePinImage } from '../utils/helpers.js';
import { collaborativeUpdate } from '../utils/socket-handler.js';
import { drawAllConnectionLines } from '../canvas/connection-manager.js';

const ApplicationV2 = foundry.applications.api.ApplicationV2;
const HandlebarsApplicationMixin = foundry.applications.api.HandlebarsApplicationMixin;

export class BatchEditDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: 'ib-batch-edit',
    tag: 'div',
    classes: ['investigation-board-dialog', 'ib-batch-edit-dialog'],
    window: {
      title: 'Batch Edit Notes',
      resizable: false,
      minimizable: false,
      icon: 'fas fa-layer-group',
    },
    position: { width: 460, height: 'auto' },
  };

  static PARTS = {
    content: {
      template: 'modules/investigation-board/templates/batch-edit-dialog.html',
    },
  };

  // null  = "keep current" (don't touch this field)
  // ''    = random/auto
  // 'foo' = specific filename
  #pinColor = null;

  // null   = keep current
  // '#hex' = apply this colour
  #connColor = null;

  // ──────────────────────────────────────────────────────────────────────────────
  // Rendering
  // ──────────────────────────────────────────────────────────────────────────────

  async _prepareContext(options) {
    const pinFiles = await getAvailablePinFiles();

    const noteTypes = [
      { id: 'sticky',   label: 'Sticky Notes' },
      { id: 'photo',    label: 'Photo Notes' },
      { id: 'index',    label: 'Index Cards' },
      { id: 'handout',  label: 'Handouts' },
      { id: 'media',    label: 'Media Notes' },
      { id: 'pin',      label: 'Pins' },
      { id: 'document', label: 'Document Notes' },
    ];

    const pinFileList = pinFiles.map(f => ({
      filename: f,
      src: resolvePinImage(f),
      label: f.replace(/\.[^.]+$/, ''),
    }));

    return { noteTypes, pinFileList };
  }

  _onRender(context, options) {
    const html = this.element;

    // ── Scope ──────────────────────────────────────────────────────────────────
    html.querySelectorAll('input[name="scope"]').forEach(radio => {
      radio.addEventListener('change', () => this._syncScopeUI());
    });
    html.querySelector('[name="scopeType"]')?.addEventListener('change', () => this._updatePreview());
    this._syncScopeUI();

    // ── Pin colour swatches ────────────────────────────────────────────────────
    html.querySelectorAll('.ib-batch-pin-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        html.querySelectorAll('.ib-batch-pin-swatch, .ib-batch-pin-keep').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        this.#pinColor = swatch.dataset.filename ?? null;
        this._updatePreview();
      });
    });

    const keepBtn = html.querySelector('.ib-batch-pin-keep');
    keepBtn?.addEventListener('click', () => {
      html.querySelectorAll('.ib-batch-pin-swatch, .ib-batch-pin-keep').forEach(s => s.classList.remove('active'));
      keepBtn.classList.add('active');
      this.#pinColor = null;
      this._updatePreview();
    });
    keepBtn?.classList.add('active');

    // ── Connection colour ──────────────────────────────────────────────────────
    const connCheck = html.querySelector('#ib-batch-conn-enable');
    const connInput = html.querySelector('[name="connColor"]');
    connCheck?.addEventListener('change', () => {
      if (connInput) connInput.disabled = !connCheck.checked;
      this.#connColor = connCheck?.checked ? (connInput?.value ?? '#FF0000') : null;
      this._updatePreview();
    });
    connInput?.addEventListener('input', () => {
      if (connCheck?.checked) this.#connColor = connInput.value;
      this._updatePreview();
    });

    // ── Buttons ────────────────────────────────────────────────────────────────
    html.querySelector('#ib-batch-apply')?.addEventListener('click', () => this._applyChanges());
    html.querySelector('#ib-batch-cancel')?.addEventListener('click', () => this.close());

    this._updatePreview();
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Scope helpers
  // ──────────────────────────────────────────────────────────────────────────────

  _syncScopeUI() {
    const html = this.element;
    const mode = html.querySelector('input[name="scope"]:checked')?.value ?? 'selected';
    html.querySelector('[name="scopeType"]').disabled = (mode !== 'type');
    this._updatePreview();
  }

  _getScope() {
    const html = this.element;
    const mode = html.querySelector('input[name="scope"]:checked')?.value ?? 'selected';
    const value = mode === 'type' ? (html.querySelector('[name="scopeType"]')?.value ?? 'sticky') : null;
    return { mode, value };
  }

  _allNotes() {
    return canvas.drawings?.placeables.filter(d => d.document.flags[MODULE_ID]?.type) ?? [];
  }

  _selectedNotes() {
    return canvas.drawings?.controlled.filter(d => d.document.flags[MODULE_ID]?.type) ?? [];
  }

  _getTargetNotes(scope) {
    const all = this._allNotes();
    if (scope.mode === 'selected') return this._selectedNotes();
    if (scope.mode === 'all') return all;
    return all.filter(d => d.document.flags[MODULE_ID].type === scope.value);
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Preview counter
  // ──────────────────────────────────────────────────────────────────────────────

  _updatePreview() {
    const scope = this._getScope();
    const targets = this._getTargetNotes(scope);
    const el = this.element?.querySelector('#ib-batch-preview');
    if (!el) return;

    let connCount = 0;
    if (this.#connColor !== null) {
      const targetIds = new Set(targets.map(n => n.document.id));
      // Outgoing from each target note
      connCount += targets.reduce((sum, n) =>
        sum + (n.document.flags[MODULE_ID]?.connections?.length ?? 0), 0);
      // Incoming from notes outside the target set
      for (const note of this._allNotes()) {
        if (targetIds.has(note.document.id)) continue;
        connCount += (note.document.flags[MODULE_ID]?.connections ?? [])
          .filter(c => targetIds.has(c.targetId)).length;
      }
    }

    const nLabel = `<strong>${targets.length}</strong> note${targets.length !== 1 ? 's' : ''}`;
    const pinPart = this.#pinColor !== null ? ' · pin colour' : '';
    const connPart = this.#connColor !== null
      ? ` · <strong>${connCount}</strong> connection${connCount !== 1 ? 's' : ''}`
      : '';

    el.innerHTML = targets.length
      ? `Will affect ${nLabel}${pinPart}${connPart}`
      : `<em>No notes match this scope.</em>`;
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Apply
  // ──────────────────────────────────────────────────────────────────────────────

  async _applyChanges() {
    if (this.#pinColor === null && this.#connColor === null) {
      ui.notifications.warn("Investigation Board: Select at least one change to apply.");
      return;
    }

    const scope = this._getScope();
    const targets = this._getTargetNotes(scope);
    if (!targets.length) {
      ui.notifications.warn("Investigation Board: No notes matched the selected scope.");
      return;
    }

    const targetIds = new Set(targets.map(n => n.document.id));
    let pinCount = 0;
    let connCount = 0;

    // First pass — target notes: pin colour + outgoing connection colour.
    // Updates target independent notes, so fire them concurrently rather than
    // serializing one DB/socket round trip at a time.
    const firstPassUpdates = [];
    for (const note of targets) {
      const update = {};
      const flags = note.document.flags[MODULE_ID];

      const isVideoMedia = flags.type === 'media' && (flags.mediaMode === 'video' || !!flags.videoPath);
      if (this.#pinColor !== null && flags.type !== 'handout' && !isVideoMedia) {
        update[`flags.${MODULE_ID}.pinColor`] = this.#pinColor;
        pinCount++;
      }

      if (this.#connColor !== null) {
        const conns = flags.connections ?? [];
        if (conns.length) {
          update[`flags.${MODULE_ID}.connections`] = conns.map(c => ({ ...c, color: this.#connColor }));
          connCount += conns.length;
        }
      }

      if (Object.keys(update).length) firstPassUpdates.push(collaborativeUpdate(note.document.id, update));
    }
    await Promise.all(firstPassUpdates);

    // Second pass — notes outside the target set that have connections pointing INTO a target
    if (this.#connColor !== null) {
      const secondPassUpdates = [];
      for (const note of this._allNotes()) {
        if (targetIds.has(note.document.id)) continue;
        const conns = note.document.flags[MODULE_ID]?.connections ?? [];
        const changed = conns.filter(c => targetIds.has(c.targetId));
        if (!changed.length) continue;
        const updated = conns.map(c =>
          targetIds.has(c.targetId) ? { ...c, color: this.#connColor } : c
        );
        secondPassUpdates.push(collaborativeUpdate(note.document.id, { [`flags.${MODULE_ID}.connections`]: updated }));
        connCount += changed.length;
      }
      await Promise.all(secondPassUpdates);
    }

    drawAllConnectionLines();

    const parts = [];
    if (pinCount)  parts.push(`${pinCount} pin${pinCount !== 1 ? 's' : ''}`);
    if (connCount) parts.push(`${connCount} connection${connCount !== 1 ? 's' : ''}`);
    ui.notifications.info(`Investigation Board: Updated ${parts.join(' and ')}.`);
    this.close();
  }
}

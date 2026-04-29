import { MODULE_ID, SOCKET_NAME, VIDEO_EXTENSIONS, DOC_BACKGROUNDS } from "../config.js";
import { InvestigationBoardState } from "../state.js";
import { collaborativeUpdate, collaborativeDelete, socket, activeGlobalSounds, activeVideoBroadcasts } from "../utils/socket-handler.js";
import { truncateText, resolvePinImage, getAvailablePinFiles } from "../utils/helpers.js";
import { NotePreviewer } from "../apps/note-previewer.js";
import { VideoPlayer } from "../apps/video-player.js";
import { drawAllConnectionLines } from "./connection-manager.js";

// v13 namespaced imports
const Drawing = foundry.canvas.placeables.Drawing;

export class CustomDrawing extends Drawing {
  constructor(...args) {
    super(...args);
    this.bgSprite = null;
    this.bgShadow = null;
    this.pinSprite = null;
    this.noteText = null;
    this.docTitleText = null;
    this.docBodyText = null;
    this.photoImageSprite = null;
    this.photoMask = null;
  }

  /**
   * Override _canControl to allow all users to select investigation board notes.
   * This enables collaborative selection regardless of who created the note.
   */
  _canControl(user, event) {
    // Check if this is an investigation board note
    const noteData = this.document.flags?.[MODULE_ID];
    if (noteData?.type) {
      // Allow all users to control investigation board notes
      return true;
    }
    // Fall back to default behavior for regular drawings
    return super._canControl(user, event);
  }

  /**
   * Override _canDrag to allow all users to drag investigation board notes.
   * This enables collaborative movement regardless of who created the note.
   */
  _canDrag(user, event) {
    // Check if this is an investigation board note
    const noteData = this.document.flags?.[MODULE_ID];
    if (noteData?.type) {
      // Allow all users to drag investigation board notes (unless locked)
      return !this.document.locked;
    }
    // Fall back to default behavior for regular drawings
    return super._canDrag(user, event);
  }

  /**
   * Override _canView to allow all users to view/edit investigation board notes.
   * This enables opening the edit dialog regardless of who created the note.
   */
  _canView(user, event) {
    // Check if this is an investigation board note
    const noteData = this.document.flags?.[MODULE_ID];
    if (noteData?.type) {
      // Hidden notes are invisible to non-GM users
      if (this.document.hidden && !user.isGM) return false;
      return true;
    }
    // Fall back to default behavior for regular drawings
    return super._canView?.(user, event) ?? true;
  }

  /**
   * Override canUserModify to allow all users to 'update' investigation board notes.
   * This is crucial for Foundry's MouseInteractionManager to permit right-click and other interactions.
   */
  canUserModify(user, action) {
    const noteData = this.document.flags?.[MODULE_ID];
    if (noteData?.type) {
      return true;
    }
    return super.canUserModify(user, action);
  }

  /**
   * Override testUserPermission to grant all players 'UPDATE' permission for investigation notes.
   * This is the lowest-level way to ensure Foundry's interaction managers permit right-click.
   */
  testUserPermission(user, permission, {exact=false}={}) {
    const noteData = this.document.flags?.[MODULE_ID];
    if (noteData?.type) {
      // Treat all users as having at least UPDATE permission for context menus and dragging
      const levels = foundry.CONST.DOCUMENT_OWNERSHIP_LEVELS;
      const targetLevel = typeof permission === "string" ? levels[permission] : permission;
      
      if (targetLevel <= levels.OWNER) return true;
    }
    return super.testUserPermission(user, permission, {exact});
  }

  /**
   * Override _canConfigure to allow all users to access the configuration and context menus.
   */
  _canConfigure(user, event) {
    const noteData = this.document.flags?.[MODULE_ID];
    if (noteData?.type) {
      return true;
    }
    return super._canConfigure(user, event);
  }

  /**
   * Override _getTargetAlpha so Foundry's _refreshState() dims hidden IB notes for the GM.
   * _refreshState() calls this.alpha = this._getTargetAlpha() every render tick, so this is
   * the correct hook point — setting this.alpha manually elsewhere gets overridden each frame.
   */
  _getTargetAlpha() {
    const noteData = this.document.flags?.[MODULE_ID];
    if (noteData?.type && this.document.hidden && game.user.isGM) return 0.4;
    return super._getTargetAlpha();
  }

  /**
   * Override _refreshState to hide selection handles for all non-handout IB notes.
   * In v14, Drawing uses DrawingShapeControls (this.controls) for selection/resize handles.
   * _refreshFrame() was deprecated in v14 and no longer called automatically.
   */
  _refreshState() {
    super._refreshState();
    const noteData = this.document.flags?.[MODULE_ID];
    if (!noteData?.type) return;

    // Handout keeps full controls — leave Foundry's defaults untouched.
    if (noteData.type === "handout") return;

    // Pin notes never show a bounding box regardless of settings.
    if (noteData.type === "pin") {
      if (this.controls) this.controls.visible = false;
      return;
    }

    if (!this.controls) return;

    const showControls = game.settings.get(MODULE_ID, "showSelectionControls");
    if (!showControls) {
      // Default behaviour: no bounding box or handles for IB notes
      this.controls.visible = false;
      return;
    }

    // Let Foundry's super manage controls.visible (hover/selected state).
    // Per-handle filtering is enforced by the patch in draw() so it survives
    // any subsequent controls._refresh() calls triggered by position/rotation changes.
    this._applyHandleVisibility();
  }

  /**
   * Hides scale and translate handles, leaving only the rotate handle visible.
   * Also hides scale handles when allowScaling is off.
   * Called from _refreshState and from the patched controls._refresh.
   */
  _applyHandleVisibility() {
    if (!this.controls?.handles) return;
    const allowScaling = game.settings.get(MODULE_ID, "allowScaling");
    for (const handle of this.controls.handles.children) {
      switch (handle.name) {
        case "rotate":
          handle.visible = true;
          handle.cursor = 'pointer';
          break;
        case "scale":
        case "scaleX":
        case "scaleY":
          handle.visible = allowScaling;
          handle.cursor = 'pointer';
          break;
        default: // "translate" and anything else
          handle.visible = false;
          break;
      }
    }
  }


  /**
   * Override activateListeners to ensure the MouseInteractionManager is configured
   * to allow right-click events even for non-owners.
   */
  activateListeners() {
    super.activateListeners();
    // Only override right-click permissions for IB notes. Applying this to
    // regular drawings changes their context-menu behavior unexpectedly.
    if (this.document.flags[MODULE_ID]?.type && this.mouseInteractionManager) {
      this.mouseInteractionManager.permissions.clickRight = () => true;
      this.mouseInteractionManager.permissions.clickRight2 = () => true;
    }
  }

  /**
   * Override double-click to open the larger preview instead of the edit sheet.
   */
  _onClickLeft2(event) {
    const noteData = this.document.flags?.[MODULE_ID];
    if (noteData?.type === "pin") return;
    if (noteData?.type) {
      // Route video media notes to VideoPlayer, everything else to NotePreviewer
      if (noteData.type === "media" && noteData.videoPath) {
        new VideoPlayer(this.document).render(true);
      } else {
        new NotePreviewer(this.document).render(true);
      }
      return;
    }
    return super._onClickLeft2(event);
  }

  /**
   * Explicit override for single right-click.
   */
  _onClickRight(event) {
    if (!InvestigationBoardState.isActive) return super._onClickRight(event);
    const noteData = this.document.flags?.[MODULE_ID];
    if (!noteData?.type) return super._onClickRight(event);

    event.stopPropagation();
    this._showContextMenu(event);
  }

  /**
   * Explicit override for double right-click.
   * This prevents Foundry from opening the default config sheet on a right double-click.
   */
  _onClickRight2(event) {
    if (!InvestigationBoardState.isActive) return super._onClickRight2(event);
    const noteData = this.document.flags?.[MODULE_ID];
    if (!noteData?.type) return super._onClickRight2(event);

    event.stopPropagation();
    this._showContextMenu(event);
  }

  /**
   * Show a custom context menu at the mouse position.
   */
  _showContextMenu(event) {
    const noteData = this.document.flags?.[MODULE_ID];
    if (!noteData) return;

    // Extract screen coordinates — handle both Foundry-wrapped events (interactionData.originalEvent)
    // and raw PIXI FederatedPointerEvents from pin sprite listeners (nativeEvent).
    const data = event.data || event.interactionData;
    const originalEvent = data?.originalEvent ?? event.nativeEvent ?? event;
    const x = originalEvent.clientX ?? 0;
    const y = originalEvent.clientY ?? 0;

    // Remove any existing custom context menus
    document.querySelectorAll('.ib-context-menu').forEach(el => el.remove());

    const menu = document.createElement('div');
    menu.classList.add('ib-context-menu');
    menu.style.position = 'fixed';
    menu.style.top = `${y}px`;
    menu.style.left = `${x}px`;
    menu.style.zIndex = '10000';

    if (noteData.type === "pin") {
       // Edit option — kept for potential future use
       // const editOption = document.createElement('div');
       // editOption.innerHTML = '<i class="fas fa-edit"></i> Edit';
       // editOption.classList.add('ib-context-menu-item');
       // editOption.onclick = (e) => {
       //   e.stopPropagation();
       //   this.document.sheet.render(true);
       //   menu.remove();
       // };

       if (noteData.linkedObject) {
         const linkMatch = noteData.linkedObject.match(/\[([^\]]+)\]/);
         if (linkMatch) {
           const uuid = linkMatch[1];
           const linkOption = document.createElement('div');
           linkOption.innerHTML = `<i class="fas fa-link"></i> Open`;
           linkOption.classList.add('ib-context-menu-item');
           linkOption.onclick = async (e) => {
             e.stopPropagation();
             menu.remove();
             try {
               const doc = await fromUuid(uuid);
               if (doc) {
                 if (doc.testUserPermission(game.user, "LIMITED")) {
                   doc.sheet.render(true);
                 } else {
                   ui.notifications.warn(`You do not have permission to view ${doc.name}.`);
                 }
               } else {
                 ui.notifications.warn(`Could not find linked document.`);
               }
             } catch (err) {
               console.error("Investigation Board: Error opening linked document from menu", err);
             }
           };
           menu.appendChild(linkOption);
         }
       }

       // Convert-to options
       const convertTypes = [
         { id: 'sticky',  label: 'Sticky Note',  icon: 'fas fa-sticky-note' },
         { id: 'photo',   label: 'Photo Note',   icon: 'fa-solid fa-camera-polaroid' },
         { id: 'index',   label: 'Index Card',   icon: 'fa-regular fa-subtitles' },
         { id: 'handout', label: 'Handout',      icon: 'fas fa-image' },
         { id: 'media',   label: 'Media Note',   icon: 'fas fa-cassette-tape' },
       ];
       convertTypes.forEach(ct => {
         const convertOption = document.createElement('div');
         convertOption.innerHTML = `<i class="${ct.icon}"></i> Convert to ${ct.label}`;
         convertOption.classList.add('ib-context-menu-item');
         convertOption.onclick = (e) => {
           e.stopPropagation();
           menu.remove();
           this._convertToNoteType(ct.id);
         };
         menu.appendChild(convertOption);
       });

       const removeConnectionsOption = document.createElement('div');
       removeConnectionsOption.innerHTML = '<i class="fas fa-cut"></i> Remove Connections';
       removeConnectionsOption.classList.add('ib-context-menu-item');
       removeConnectionsOption.onclick = async (e) => {
         e.stopPropagation();
         menu.remove();
         const confirm = await foundry.applications.api.DialogV2.confirm({
           window: { title: "Remove All Connections" },
           content: `<p>Are you sure you want to remove ALL yarn connections connected to this note?</p>`,
           rejectClose: false,
           modal: true
         });
         if (confirm) {
           const noteId = this.document.id;
           await collaborativeUpdate(noteId, { [`flags.${MODULE_ID}.connections`]: [] });
           const otherNotesWithConnections = canvas.drawings.placeables.filter(d => {
             if (d.document.id === noteId) return false;
             const conns = d.document.flags[MODULE_ID]?.connections;
             return conns && conns.some(c => c.targetId === noteId);
           });
           for (let otherNote of otherNotesWithConnections) {
             const currentConns = otherNote.document.flags[MODULE_ID].connections;
             const updatedConns = currentConns.filter(c => c.targetId !== noteId);
             await collaborativeUpdate(otherNote.document.id, { [`flags.${MODULE_ID}.connections`]: updatedConns });
           }
           drawAllConnectionLines();
           ui.notifications.info("All related connections removed.");
         }
       };

       const deleteOption = document.createElement('div');
       deleteOption.innerHTML = '<i class="fas fa-trash"></i> Delete';
       deleteOption.classList.add('ib-context-menu-item');
       deleteOption.onclick = async (e) => {
         e.stopPropagation();
         menu.remove();
         const confirm = await foundry.applications.api.DialogV2.confirm({
           window: { title: "Delete Pin" },
           content: `<p>Are you sure you want to delete this pin?</p>`,
           rejectClose: false,
           modal: true
         });
         if (confirm) {
           await collaborativeDelete(this.document.id);
         }
       };

       menu.appendChild(removeConnectionsOption);
       menu.appendChild(deleteOption);
       document.body.appendChild(menu);
       const closeMenu = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', closeMenu); window.removeEventListener('wheel', closeMenu); } };
       setTimeout(() => { document.addEventListener('mousedown', closeMenu); window.addEventListener('wheel', closeMenu); }, 100);
       return;
    }

    const editOption = document.createElement('div');
    editOption.innerHTML = '<i class="fas fa-edit"></i> Edit';
    editOption.classList.add('ib-context-menu-item');
    editOption.onclick = (e) => {
      e.stopPropagation();
      this.document.sheet.render(true);
      menu.remove();
    };

    const isVideoMedia = noteData.type === "media" && !!noteData.videoPath;
    const isAudioMedia = noteData.type === "media" && !!noteData.audioPath;

    // Audio-media-specific options (existing cassette notes)
    if (isAudioMedia) {
      const appId = `note-preview-${this.document.id}`;
      const app = foundry.applications.instances.get(appId);
      const audioEl = app?.element?.querySelector('.local-audio-player');
      const isAppPlaying = audioEl && !audioEl.paused;
      const isLegacyPlaying = Array.from(game.audio.playing.values()).some(s => s.src === noteData.audioPath);
      const isPlaying = isAppPlaying || isLegacyPlaying;

      const playMeOption = document.createElement('div');
      if (isPlaying) {
        playMeOption.innerHTML = '<i class="fas fa-stop"></i> Stop for Me';
        playMeOption.onclick = (e) => {
          e.stopPropagation();
          if (audioEl) audioEl.pause();
          Array.from(game.audio.playing.values())
            .filter(s => s.src === noteData.audioPath)
            .forEach(s => s.stop());
          menu.remove();
        };
      } else {
        playMeOption.innerHTML = '<i class="fas fa-volume-up"></i> Play for Me';
        playMeOption.onclick = (e) => {
          e.stopPropagation();
          new NotePreviewer(this.document).render(true, { autoplay: true });
          menu.remove();
        };
      }
      playMeOption.classList.add('ib-context-menu-item');
      menu.appendChild(playMeOption);

      if (game.user.isGM) {
        const isGlobalActive = activeGlobalSounds.has(noteData.audioPath) && activeGlobalSounds.get(noteData.audioPath).playing;
        const playAllOption = document.createElement('div');
        if (isGlobalActive) {
          playAllOption.innerHTML = '<i class="fas fa-stop"></i> Stop for All';
          playAllOption.onclick = (e) => {
            e.stopPropagation();
            if (app) {
              const globalBtn = app.element.querySelector('.global-toggle');
              if (globalBtn?.classList.contains('active')) { globalBtn.click(); menu.remove(); return; }
            }
            if (socket) {
              socket.emit(SOCKET_NAME, { action: "stopAudio", audioPath: noteData.audioPath });
              const sound = activeGlobalSounds.get(noteData.audioPath);
              if (sound) { sound.stop(); activeGlobalSounds.delete(noteData.audioPath); }
            }
            menu.remove();
          };
        } else {
          playAllOption.innerHTML = '<i class="fas fa-broadcast-tower"></i> Play for All';
          playAllOption.onclick = (e) => {
            e.stopPropagation();
            new NotePreviewer(this.document).render(true, { autobroadcast: true });
            menu.remove();
          };
        }
        playAllOption.classList.add('ib-context-menu-item');
        menu.appendChild(playAllOption);
      }
    }

    // Video-media-specific options
    if (isVideoMedia) {
      const videoPlayOption = document.createElement('div');
      videoPlayOption.innerHTML = '<i class="fas fa-play"></i> Play Video';
      videoPlayOption.classList.add('ib-context-menu-item');
      videoPlayOption.onclick = (e) => {
        e.stopPropagation();
        new VideoPlayer(this.document).render(true);
        menu.remove();
      };
      menu.appendChild(videoPlayOption);

      if (game.user.isGM) {
        const isBroadcasting = activeVideoBroadcasts.has(this.document.id);
        const broadcastOption = document.createElement('div');
        if (isBroadcasting) {
          broadcastOption.innerHTML = '<i class="fas fa-stop"></i> Stop Broadcast';
          broadcastOption.onclick = (e) => {
            e.stopPropagation();
            const playerAppId = `video-player-${this.document.id}`;
            const playerApp = foundry.applications.instances.get(playerAppId);
            if (playerApp) playerApp._stopBroadcast();
            else if (socket) socket.emit(SOCKET_NAME, { action: "stopVideoBroadcast", drawingId: this.document.id });
            menu.remove();
          };
        } else {
          broadcastOption.innerHTML = '<i class="fas fa-broadcast-tower"></i> Open for All';
          broadcastOption.onclick = (e) => {
            e.stopPropagation();
            const playerApp = new VideoPlayer(this.document);
            playerApp.render(true);
            setTimeout(() => playerApp._startBroadcast(), 300);
            menu.remove();
          };
        }
        broadcastOption.classList.add('ib-context-menu-item');
        menu.appendChild(broadcastOption);
      }
    }

    const viewOption = document.createElement('div');
    viewOption.innerHTML = '<i class="fas fa-magnifying-glass"></i> View';
    viewOption.classList.add('ib-context-menu-item');
    viewOption.onclick = (e) => {
      e.stopPropagation();
      if (isVideoMedia) {
        new VideoPlayer(this.document).render(true);
      } else {
        new NotePreviewer(this.document).render(true);
      }
      menu.remove();
    };

    const removeConnectionsOption = document.createElement('div');
    removeConnectionsOption.innerHTML = '<i class="fas fa-cut"></i> Remove Connections';
    removeConnectionsOption.classList.add('ib-context-menu-item');
    removeConnectionsOption.onclick = async (e) => {
      e.stopPropagation();
      menu.remove();

      const confirm = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Remove All Connections" },
        content: `<p>Are you sure you want to remove ALL yarn connections connected to this note (incoming and outgoing)?</p>`,
        rejectClose: false,
        modal: true
      });

      if (confirm) {
        const noteId = this.document.id;
        
        // 1. Clear outgoing connections (from this note to others)
        await collaborativeUpdate(noteId, {
          [`flags.${MODULE_ID}.connections`]: []
        });

        // 2. Clear incoming connections (from other notes to this one)
        const otherNotesWithConnections = canvas.drawings.placeables.filter(d => {
          if (d.document.id === noteId) return false;
          const conns = d.document.flags[MODULE_ID]?.connections;
          return conns && conns.some(c => c.targetId === noteId);
        });

        for (let otherNote of otherNotesWithConnections) {
          const currentConns = otherNote.document.flags[MODULE_ID].connections;
          const updatedConns = currentConns.filter(c => c.targetId !== noteId);
          
          await collaborativeUpdate(otherNote.document.id, {
            [`flags.${MODULE_ID}.connections`]: updatedConns
          });
        }

        drawAllConnectionLines();
        ui.notifications.info("All related connections removed.");
      }
    };

    menu.appendChild(editOption);
    menu.appendChild(viewOption);

    if (game.user.isGM) {
      const isHidden = this.document.hidden;
      const toggleVisOption = document.createElement('div');
      toggleVisOption.innerHTML = isHidden
        ? '<i class="fas fa-eye"></i> Reveal to Players'
        : '<i class="fas fa-eye-slash"></i> Hide from Players';
      toggleVisOption.classList.add('ib-context-menu-item');
      toggleVisOption.onclick = async (e) => {
        e.stopPropagation();
        menu.remove();
        await this.document.update({ hidden: !isHidden });
      };
      menu.appendChild(toggleVisOption);
    }

    // Linked Object Option
    if (noteData.linkedObject) {
      const linkMatch = noteData.linkedObject.match(/\[([^\]]+)\]/);
      if (linkMatch) {
        const uuid = linkMatch[1];

        const linkOption = document.createElement('div');
        linkOption.innerHTML = `<i class="fas fa-link"></i> Open`;
        linkOption.classList.add('ib-context-menu-item');
        linkOption.onclick = async (e) => {
          e.stopPropagation();
          menu.remove();
          
          try {
            const doc = await fromUuid(uuid);
            if (doc) {
              if (doc.testUserPermission(game.user, "LIMITED")) {
                doc.sheet.render(true);
              } else {
                ui.notifications.warn(`You do not have permission to view ${doc.name}.`);
              }
            } else {
              ui.notifications.warn(`Could not find linked document.`);
            }
          } catch (err) {
            console.error("Investigation Board: Error opening linked document from menu", err);
          }
        };
        menu.appendChild(linkOption);
      }
    }

    const deleteOption = document.createElement('div');
    deleteOption.innerHTML = '<i class="fas fa-trash"></i> Delete';
    deleteOption.classList.add('ib-context-menu-item');
    deleteOption.onclick = async (e) => {
      e.stopPropagation();
      menu.remove();

      const confirm = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Delete Note" },
        content: `<p>Are you sure you want to delete this note?</p>`,
        rejectClose: false,
        modal: true
      });

      if (confirm) {
        await collaborativeDelete(this.document.id);
      }
    };

    menu.appendChild(removeConnectionsOption);
    menu.appendChild(deleteOption);
    document.body.appendChild(menu);

    // Close menu when clicking elsewhere or scrolling
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('mousedown', closeMenu);
        window.removeEventListener('wheel', closeMenu);
      }
    };
    
    // Delay adding the listener to avoid immediate closing if the right-click event bubbles
    setTimeout(() => {
      document.addEventListener('mousedown', closeMenu);
      window.addEventListener('wheel', closeMenu);
    }, 100);
  }

  // Ensure sprites are created when the drawing is first rendered.
  async draw() {
    await super.draw();
    // Only apply IB-specific rendering to IB notes. Regular drawings must not
    // have their rendering overridden by this module.
    if (!this.document.flags[MODULE_ID]?.type) return this;

    this.element?.setAttribute("data-investigation-note", "true");

    // Patch this.controls._refresh (created fresh each draw() by Foundry) so that
    // our per-handle visibility is reapplied after every Foundry controls refresh.
    // This prevents position/rotation updates from resetting handle visibility.
    const noteType = this.document.flags[MODULE_ID]?.type;
    if (this.controls && noteType && noteType !== "handout" && noteType !== "pin") {
      const originalRefresh = this.controls._refresh.bind(this.controls);
      const self = this;
      this.controls._refresh = function() {
        originalRefresh();
        if (game.settings.get(MODULE_ID, "showSelectionControls")) {
          self._applyHandleVisibility();
        }
      };
    }

    await this._updateSprites();
    import("./connection-manager.js").then(m => {
      m.updatePins();
      m.drawAllConnectionLines();
    });
    return this;
  }

  // Ensure sprites update correctly on refresh.
  async refresh() {
    await super.refresh();
    // Only apply IB-specific rendering to IB notes.
    if (!this.document.flags[MODULE_ID]?.type) return this;

    this.element?.setAttribute("data-investigation-note", "true");
    await this._updateSprites();
    import("./connection-manager.js").then(m => {
      m.updatePins();
      m.drawAllConnectionLines();
    });
    return this;
  }

  async _updateSprites() {
    // Guard against concurrent execution. If a call is already in progress, queue one
    // re-run for when it finishes so the latest data is always applied.
    if (this._spriteUpdateRunning) {
      this._spriteUpdateQueued = true;
      return;
    }
    this._spriteUpdateRunning = true;
    try {
      await this._doUpdateSprites();
    } finally {
      this._spriteUpdateRunning = false;
      if (this._spriteUpdateQueued) {
        this._spriteUpdateQueued = false;
        this._updateSprites();
      }
    }
  }

  /**
   * Load (or destroy) the pin sprite for this note.
   *
   * The global "pinColor" setting controls visibility:
   *   "none"   → destroy any existing sprite and bail out.
   *   "random" → pick a random image from the pin folder on first render,
   *              persist the choice to the note's flags so every client
   *              shows the same pin.
   *
   * The per-note flag `noteData.pinColor` stores the bare filename
   * (e.g. "redPin.webp").  resolvePinImage() prepends the configured
   * folder at render time, so switching the folder setting instantly
   * re-resolves every note without touching flag data.
   *
   * @param {object} noteData  The investigation-board flags for this drawing.
   */
  async _loadPinTexture(noteData) {
    const pinSetting = game.settings.get(MODULE_ID, "pinColor");

    // Global "none" OR per-note "none" — destroy sprite for this note
    if (pinSetting === "none" || noteData.pinColor === "none") {
      if (this.pinSprite) {
        if (this.pinSprite.parent) this.pinSprite.parent.removeChild(this.pinSprite);
        this.pinSprite.destroy();
        this.pinSprite = null;
      }
      return;
    }

    if (!this.pinSprite || this.pinSprite.destroyed) {
      if (this.pinSprite) this.pinSprite.destroy();
      this.pinSprite = new PIXI.Sprite();
    }

    let pinFilename = noteData.pinColor;
    if (!pinFilename) {
      const files = await getAvailablePinFiles();
      pinFilename = files[Math.floor(Math.random() * files.length)];
      await collaborativeUpdate(this.document.id, { [`flags.${MODULE_ID}.pinColor`]: pinFilename });
    }

    const pinImage = resolvePinImage(pinFilename);
    try {
      const texture = await PIXI.Assets.load(pinImage);
      if (texture && this.pinSprite && !this.pinSprite.destroyed) {
        this.pinSprite.texture = texture;
      }
    } catch (err) {
      console.error(`Investigation Board: Failed to load pin texture: ${pinImage}`, err);
    }
  }

  async _doUpdateSprites() {
    if (!this.shape) return;
    const noteData = this.document.flags[MODULE_ID];
    if (!noteData) return;

    // Destroy document-only sprites when the note is no longer a document note
    if (noteData.type !== "document") {
      if (this.docTitleText && !this.docTitleText.destroyed) {
        this.shape.removeChild(this.docTitleText);
        this.docTitleText.destroy();
        this.docTitleText = null;
      }
      if (this.docBodyText && !this.docBodyText.destroyed) {
        this.shape.removeChild(this.docBodyText);
        this.docBodyText.destroy();
        this.docBodyText = null;
      }
    }

    const isPhoto = noteData.type === "photo";
    const isIndex = noteData.type === "index";
    const isHandout = noteData.type === "handout";
    const isMedia = noteData.type === "media";

    // MEDIA NOTE LAYOUT (Cassette tape or VHS tape)
    if (isMedia) {
      const isVideo = isVideoMedia(noteData);
      const drawingWidth = this.document.shape.width || 400;
      // Audio cassette ratio: 0.74 (470×350) — VHS tape ratio: 0.571 (875×500)
      const drawingHeight = this.document.shape.height || Math.round(drawingWidth * (isVideo ? 0.571 : 0.74));

      // No background sprite for media (we use photoImageSprite for the cassette)
      if (this.bgSprite) {
        this.shape.removeChild(this.bgSprite);
        this.bgSprite.destroy();
        this.bgSprite = null;
      }

      if (!this.photoImageSprite || !this.photoImageSprite.parent) {
        if (this.photoImageSprite) this.photoImageSprite.destroy();
        this.photoImageSprite = new PIXI.Sprite();
        this.shape.addChild(this.photoImageSprite);
      }

      // --- Cassette Shadow ---
      if (!this.bgShadow) {
        this.bgShadow = new PIXI.Sprite();
        this.shape.addChildAt(this.bgShadow, 0); // Put it behind everything
      }

      const fallbackImage = isVideo ? "modules/investigation-board/assets/video1.webp"
                                     : "modules/investigation-board/assets/cassette1.webp";
      const imagePath = noteData.image || fallbackImage;
      try {
        const texture = await PIXI.Assets.load(imagePath);
        if (texture) {
          // Update shadow
          if (this.bgShadow) {
            this.bgShadow.texture = texture;
            this.bgShadow.width = drawingWidth;
            this.bgShadow.height = drawingHeight;
            try { this.bgShadow.tint = 0x000000; } catch(e) {}
            this.bgShadow.alpha = 0.4;
            this.bgShadow.position.set(6, 6); // Offset shadow
            this.bgShadow.filters = [new PIXI.BlurFilter(2)];
          }

          if (this.photoImageSprite && this.photoImageSprite.parent) {
            this.photoImageSprite.texture = texture;
            this.photoImageSprite.width = drawingWidth;
            this.photoImageSprite.height = drawingHeight;
            this.photoImageSprite.position.set(0, 0);
            
            this.photoImageSprite.mask = null;
            if (this.photoMask) this.photoMask.visible = false;
            this.photoImageSprite.visible = true;
            this.photoImageSprite.alpha = 1;
          }
        }
      } catch (err) {
        console.error(`Failed to load media image: ${imagePath}`, err);
      }

      // --- Pin Sprite (managed by updatePins, just load texture here) ---
      await this._loadPinTexture(noteData);

      // Hide text for media notes on canvas
      if (this.noteText) this.noteText.visible = false;
      if (this.futuristicText) this.futuristicText.visible = false;

      return; // Early exit for media notes
    }

    // DOCUMENT NOTE LAYOUT (A4-style parchment/paper with title + body text)
    if (noteData.type === "document") {
      const docW = this.document.shape.width || 595;
      const docH = this.document.shape.height || 842;
      const MARGIN = Math.round(docW * 0.105);

      // Destroy photo sprite if present from a previous type
      if (this.photoImageSprite) {
        if (this.photoImageSprite.parent) this.shape.removeChild(this.photoImageSprite);
        this.photoImageSprite.destroy();
        this.photoImageSprite = null;
      }
      if (this.photoMask) this.photoMask.visible = false;

      // Background + shadow
      const bgKey = noteData.docBackground || "parchment";
      const bgImage = (DOC_BACKGROUNDS[bgKey] || DOC_BACKGROUNDS.parchment).path;

      if (!this.bgSprite) {
        this.bgSprite = new PIXI.Sprite();
        this.shape.addChild(this.bgSprite);
      }
      if (!this.bgShadow) {
        this.bgShadow = new PIXI.Sprite();
        this.shape.addChildAt(this.bgShadow, 0);
      }

      try {
        const texture = await PIXI.Assets.load(bgImage);
        if (texture) {
          if (this.bgShadow && !this.bgShadow.destroyed) {
            this.bgShadow.texture = texture;
            this.bgShadow.width = docW;
            this.bgShadow.height = docH;
            try { this.bgShadow.tint = 0x000000; } catch(e) {}
            this.bgShadow.alpha = 0.35;
            this.bgShadow.position.set(8, 8);
            this.bgShadow.filters = [new PIXI.BlurFilter(4)];
          }
          if (this.bgSprite && !this.bgSprite.destroyed) {
            this.bgSprite.texture = texture;
            this.bgSprite.width = docW;
            this.bgSprite.height = docH;
            this.bgSprite.tint = 0xFFFFFF;
          }
        }
      } catch(err) {
        console.error(`Investigation Board: Failed to load document background: ${bgImage}`, err);
      }

      // Pin sprite
      await this._loadPinTexture(noteData);

      // Text setup
      const font = noteData.font || game.settings.get(MODULE_ID, "font");
      const textColor = noteData.textColor || "#000000";
      const titleFontSize = Math.round((docW / 595) * 28);
      const bodyFontSize = Math.round((docW / 595) * Math.max(8, noteData.fontSize || 14));
      const titleAreaHeight = titleFontSize * 3; // space reserved for the title zone

      // Title
      const titleStr = noteData.title || "";
      const titleStyle = new PIXI.TextStyle({
        fontFamily: font,
        fontSize: titleFontSize,
        fill: textColor,
        wordWrap: true,
        wordWrapWidth: docW - MARGIN * 2,
        align: "center",
      });
      if (!this.docTitleText || this.docTitleText.destroyed) {
        this.docTitleText = new PIXI.Text(titleStr, titleStyle);
        this.docTitleText.anchor.set(0.5, 0);
        this.shape.addChild(this.docTitleText);
      } else {
        this.docTitleText.style = titleStyle;
        this.docTitleText.text = titleStr;
      }
      this.docTitleText.anchor.set(0.5, 0);
      this.docTitleText.visible = !!titleStr;
      this.docTitleText.position.set(docW / 2, MARGIN);

      // Body (HTMLText so bold/italic/alignment from journal pages are preserved)
      const bodyStr = noteData.text || "";
      // HTMLTextStyle (not TextStyle) sets the SVG foreignObject width so <p> blocks wrap.
      // tagStyles locks the selected font on every inline tag — without this, <b> falls
      // back to the browser default bold font instead of inheriting the note's font.
      const HTMLTextStyle = PIXI.HTMLTextStyle ?? PIXI.TextStyle;
      const tagFont = { fontFamily: font };
      const bodyStyle = new HTMLTextStyle({
        fontFamily: font,
        fontSize: bodyFontSize,
        fill: textColor,
        wordWrap: true,
        wordWrapWidth: docW - MARGIN * 2,
        align: "left",
        tagStyles: {
          b:      { ...tagFont, fontWeight: 'bold' },
          strong: { ...tagFont, fontWeight: 'bold' },
          i:      { ...tagFont, fontStyle: 'italic' },
          em:     { ...tagFont, fontStyle: 'italic' },
          u:      tagFont,
          s:      tagFont,
          strike: tagFont,
          span:   tagFont,
          p:      tagFont,
        },
      });
      if (!this.docBodyText || this.docBodyText.destroyed) {
        this.docBodyText = new PIXI.HTMLText(bodyStr, bodyStyle);
        this.docBodyText.anchor.set(0, 0);
        this.shape.addChild(this.docBodyText);
      } else {
        this.docBodyText.style = bodyStyle;
        this.docBodyText.text = bodyStr;
      }
      this.docBodyText.anchor.set(0, 0);
      this.docBodyText.visible = true;
      this.docBodyText.position.set(MARGIN, MARGIN + (titleStr ? titleAreaHeight + 20 : 0));

      if (this.futuristicText) this.futuristicText.visible = false;

      return; // Early exit for document notes
    }

    // PIN ONLY LAYOUT
    if (noteData.type === "pin") {
      // No background for pin-only
      if (this.bgSprite) {
        this.shape.removeChild(this.bgSprite);
        this.bgSprite.destroy();
        this.bgSprite = null;
      }
      if (this.bgShadow) {
        this.shape.removeChild(this.bgShadow);
        this.bgShadow.destroy();
        this.bgShadow = null;
      }
      if (this.photoImageSprite) {
        this.shape.removeChild(this.photoImageSprite);
        this.photoImageSprite.destroy();
        this.photoImageSprite = null;
      }

      // --- Pin Sprite (managed by updatePins, just load texture here) ---
      await this._loadPinTexture(noteData);

      // Hide text
      if (this.noteText) this.noteText.visible = false;
      if (this.futuristicText) this.futuristicText.visible = false;

      return;
    }

    // HANDOUT NOTE LAYOUT (Image-only, transparent background)
    if (isHandout) {
      const drawingWidth = this.document.shape.width || 400;
      const drawingHeight = this.document.shape.height || 400;

      // No background sprite for handouts (transparent)
      if (this.bgSprite) {
        this.shape.removeChild(this.bgSprite);
        this.bgSprite.destroy();
        this.bgSprite = null;
      }

      // --- User Image (primary content) ---
      // Check if sprite exists and has a valid parent, recreate if orphaned
      if (!this.photoImageSprite || !this.photoImageSprite.parent) {
        // Destroy old sprite if it exists
        if (this.photoImageSprite) {
          try { this.photoImageSprite.destroy(); } catch(e) {}
          this.photoImageSprite = null;
        }
        this.photoImageSprite = new PIXI.Sprite();
        this.shape.addChild(this.photoImageSprite);
      }

      const imagePath = noteData.image || "modules/investigation-board/assets/newhandout.webp";
      try {
        const texture = await PIXI.Assets.load(imagePath);
        if (texture && this.photoImageSprite && this.photoImageSprite.parent) {
          this.photoImageSprite.texture = texture;

          // Scale image to fit drawing bounds while maintaining aspect ratio
          const textureRatio = texture.width / texture.height;
          const drawingRatio = drawingWidth / drawingHeight;

          if (textureRatio > drawingRatio) {
            // Image is wider - fit to width
            this.photoImageSprite.width = drawingWidth;
            this.photoImageSprite.height = drawingWidth / textureRatio;
          } else {
            // Image is taller - fit to height
            this.photoImageSprite.height = drawingHeight;
            this.photoImageSprite.width = drawingHeight * textureRatio;
          }

          // Center the image within the drawing bounds
          this.photoImageSprite.position.set(
            (drawingWidth - this.photoImageSprite.width) / 2,
            (drawingHeight - this.photoImageSprite.height) / 2
          );

          // Ensure mask is disabled for handouts
          this.photoImageSprite.mask = null;
          if (this.photoMask) this.photoMask.visible = false;

          // Ensure sprite is visible and has correct properties
          this.photoImageSprite.visible = true;
          this.photoImageSprite.alpha = 1;
          this.photoImageSprite.renderable = true;
        }
      } catch (err) {
        console.error(`Failed to load handout image: ${imagePath}`, err);
        if (this.photoImageSprite) {
          this.photoImageSprite.texture = PIXI.Texture.EMPTY;
        }
      }

      // --- Pin Sprite (managed by updatePins, just load texture here) ---
      await this._loadPinTexture(noteData);

      // Hide text sprites (handouts don't have text)
      if (this.noteText) this.noteText.visible = false;
      if (this.futuristicText) this.futuristicText.visible = false;

      return; // Early exit for handout notes
    }
    
    // STANDARD LAYOUT (Modern photo notes, sticky, index, etc.)
    // Use document shape dimensions as the authoritative size — they match the settings
    // at creation time and correctly reflect any subsequent scaling by the user.
    const width = this.document.shape.width
      || (isPhoto
        ? game.settings.get(MODULE_ID, "photoNoteWidth")
        : isIndex
          ? game.settings.get(MODULE_ID, "indexNoteWidth") || 600
          : game.settings.get(MODULE_ID, "stickyNoteWidth"));

    const height = this.document.shape.height
      || (isPhoto
        ? Math.round(width / (225 / 290))
        : isIndex
          ? Math.round(width / (600 / 400))
          : width);
    
    // Background Image: Always use modern mode assets
    const bgImage = isPhoto ? "modules/investigation-board/assets/photoFrame.webp" 
                  : isIndex ? "modules/investigation-board/assets/note_index.webp" 
                  : "modules/investigation-board/assets/note_white.webp";
    
    if (!this.bgSprite) {
      this.bgSprite = new PIXI.Sprite();
      this.shape.addChild(this.bgSprite);
    }

    // --- Background Shadow ---
    if (!this.bgShadow) {
      this.bgShadow = new PIXI.Sprite();
      this.shape.addChildAt(this.bgShadow, 0); // Behind the background
    }
    
    try {
      const texture = await PIXI.Assets.load(bgImage);
      if (texture) {
        // Update shadow
        if (this.bgShadow && !this.bgShadow.destroyed) {
          this.bgShadow.texture = texture;
          this.bgShadow.width = width;
          this.bgShadow.height = height;
          try { this.bgShadow.tint = 0x000000; } catch(e) {}
          this.bgShadow.alpha = 0.4;
          this.bgShadow.position.set(6, 6);
          this.bgShadow.filters = [new PIXI.BlurFilter(3)];
        }

        if (this.bgSprite && !this.bgSprite.destroyed) {
          this.bgSprite.texture = texture;
          this.bgSprite.width = width;
          this.bgSprite.height = height;

          // Apply tint for sticky notes
          if (noteData.type === "sticky") {
            const tintColor = noteData.tint || "#ffffff";
            try {
              this.bgSprite.tint = tintColor;
            } catch (e) {
              this.bgSprite.tint = 0xFFFFFF;
            }
          } else {
            this.bgSprite.tint = 0xFFFFFF;
          }
        }
      }
    } catch (err) {
      console.error(`Failed to load background texture: ${bgImage}`, err);
      if (this.bgSprite) {
        this.bgSprite.texture = PIXI.Texture.EMPTY;
      }
    }
    
    // --- Foreground (User-Assigned) Photo ---
    if (isPhoto) {
      const fgImage = noteData.image || "modules/investigation-board/assets/placeholder.webp";
      if (!this.photoImageSprite || this.photoImageSprite.destroyed) {
        if (this.photoImageSprite) this.photoImageSprite = null;
        this.photoImageSprite = new PIXI.Sprite();
        this.shape.addChild(this.photoImageSprite);
      }
      try {
        const texture = await PIXI.Assets.load(fgImage);
        if (texture && this.photoImageSprite && !this.photoImageSprite.destroyed) {
          this.photoImageSprite.texture = texture;
          
          // Calculate available frame space inside the polaroid
          const widthOffset = width * 0.13333;
          const heightOffset = height * 0.30246;
          const frameWidth = width - widthOffset;
          const frameHeight = height - heightOffset;

          // Use center-top positioning logic
          const textureRatio = texture.width / texture.height;
          const frameRatio = frameWidth / frameHeight;

          let spriteWidth, spriteHeight, offsetX, offsetY;

          if (textureRatio > frameRatio) {
            // Case 1: Image is wider than frame
            // Fit by height, center horizontally
            spriteHeight = frameHeight;
            spriteWidth = frameHeight * textureRatio;
            offsetX = (frameWidth - spriteWidth) / 2; // Center horizontally
            offsetY = 0; // Top aligned
          } else {
            // Case 2: Image is taller than frame (Standard Portrait)
            // Fit by width, crop from bottom
            spriteWidth = frameWidth;
            spriteHeight = frameWidth / textureRatio;
            offsetX = 0; 
            offsetY = 0; // Top aligned - KEEPS HEAD VISIBLE
          }

          // Apply size and position
          this.photoImageSprite.width = spriteWidth;
          this.photoImageSprite.height = spriteHeight;
          this.photoImageSprite.position.set(widthOffset / 2 + offsetX, heightOffset / 2 + offsetY);

          // Apply Mask to clip overflow
          if (!this.photoMask) {
            this.photoMask = new PIXI.Graphics();
            this.shape.addChild(this.photoMask);
          }
          this.photoMask.clear();
          this.photoMask.beginFill(0xffffff);
          this.photoMask.drawRect(widthOffset / 2, heightOffset / 2, frameWidth, frameHeight);
          this.photoMask.endFill();
          this.photoImageSprite.mask = this.photoMask;
          this.photoMask.visible = true;
          this.photoImageSprite.visible = true;
        }
      } catch (err) {
        console.error(`Failed to load foreground texture: ${fgImage}`, err);
        if (this.photoImageSprite) {
          this.photoImageSprite.texture = PIXI.Texture.EMPTY;
        }
      }
    } else if (this.photoImageSprite) {
      this.photoImageSprite.visible = false;
      if (this.photoMask) this.photoMask.visible = false;
    }
    
    // --- Pin Handling (managed by updatePins, just load texture here) ---
    await this._loadPinTexture(noteData);

    // Default text layout.
    // Font size is anchored to the settings-based note width, NOT the document shape width.
    // This means scaling the note frame (via the scale handle) gives more text area without
    // changing the character size — the user controls size explicitly via the edit panel.
    const settingsWidth = isPhoto
      ? game.settings.get(MODULE_ID, "photoNoteWidth")
      : isIndex
        ? game.settings.get(MODULE_ID, "indexNoteWidth") || 600
        : game.settings.get(MODULE_ID, "stickyNoteWidth");

    const font = noteData.font || game.settings.get(MODULE_ID, "font");
    const defaultFontSize = isIndex ? 9 : game.settings.get(MODULE_ID, "baseFontSize");
    const baseFontSize = noteData.fontSize || defaultFontSize;
    const fontBoost = font === "Caveat" ? 1.6 : 1.0;
    const fontSize = (settingsWidth / 200) * baseFontSize * fontBoost;
    const textStyle = new PIXI.TextStyle({
      fontFamily: font,
      fontSize: fontSize,
      fill: noteData.textColor || "#000000",
      wordWrap: true,
      wordWrapWidth: width - 2, // Uses document shape width — scaling adds more wrap space
      align: "center",
    });
    const truncatedText = truncateText(noteData.text || "Default Text", font, noteData.type, fontSize, width, height);
    if (!this.noteText || this.noteText.destroyed) {
      this.noteText = new PIXI.Text(truncatedText, textStyle);
      this.noteText.anchor.set(0.5);
      this.shape.addChild(this.noteText);
    } else {
      this.noteText.anchor.set(0.5); // reset in case this sprite was previously used by a document note
      this.noteText.style = textStyle;
      this.noteText.text = truncatedText;
    }
    if (this.noteText && !this.noteText.destroyed) {
      this.noteText.position.set(width / 2, isPhoto ? height - 25 : height / 2);
    }

    // Hide futuristic text elements if they exist
    if (this.futuristicText) this.futuristicText.visible = false;
  }

  _getPinPosition() {
    const noteData = this.document.flags[MODULE_ID];
    if (!noteData) return { x: this.document.x, y: this.document.y };

    const noteWidth = this.document.shape.width || 200;
    const noteHeight = this.document.shape.height || 200;

    if (noteData.type === "pin") {
      return {
        x: this.document.x + noteWidth / 2,
        y: this.document.y + noteHeight / 2
      };
    }

    if (noteData.type === "handout") {
      return {
        x: this.document.x + noteWidth / 2,
        y: this.document.y + noteHeight * 0.05 + 20
      };
    }

    // sticky, photo, index, media — pin is centered horizontally, near the top
    return {
      x: this.document.x + noteWidth / 2,
      y: this.document.y + 23
    };
  }

  /**
   * Convert this pin-only note into a different note type, keeping connections and linkedObject.
   */
  /**
   * Convert this pin-only note into a different note type.
   * Deletes the pin and creates a fresh note of the target type at the same position,
   * preserving connections and the linked object.
   */
  async _convertToNoteType(targetType) {
    // Capture everything we need before the delete destroys the document
    const existing  = this.document.flags[MODULE_ID] || {};
    const savedX    = this.document.x;
    const savedY    = this.document.y;
    const savedConns = (existing.connections || []).slice();
    const savedLink  = existing.linkedObject || "";
    const pinId      = this.document.id;

    // Collect notes with incoming connections pointing at this pin, before deleting it
    const incomingNotes = canvas.drawings.placeables.filter(d => {
      if (d.document.id === pinId) return false;
      return d.document.flags[MODULE_ID]?.connections?.some(c => c.targetId === pinId);
    });

    // Delete the pin (bypass the bulk-deletion guard)
    await collaborativeDelete(pinId);

    // Create the replacement note at the same position.
    // createNote() handles all dimensions, fill, defaults, and opens the edit sheet.
    const { createNote } = await import("../utils/creation-utils.js");
    const newDoc = await createNote(targetType, { x: savedX, y: savedY });

    if (newDoc?.id) {
      // Restore outgoing connections and linked object on the new note
      const updates = {};
      if (savedLink)         updates[`flags.${MODULE_ID}.linkedObject`] = savedLink;
      if (savedConns.length) updates[`flags.${MODULE_ID}.connections`]  = savedConns;
      if (Object.keys(updates).length) await collaborativeUpdate(newDoc.id, updates);

      // Re-point incoming connections from the old pin ID to the new note ID
      for (const other of incomingNotes) {
        const conns = other.document.flags[MODULE_ID].connections.map(c =>
          c.targetId === pinId ? { ...c, targetId: newDoc.id } : c
        );
        await collaborativeUpdate(other.document.id, { [`flags.${MODULE_ID}.connections`]: conns });
      }
    }
  }
}

/**
 * Returns true if the given media note flags describe a video (not audio) note.
 * Detection is based on the videoPath field — if set, it's a video note regardless
 * of extension. The extension check on videoPath is a belt-and-suspenders guard.
 * @param {object} noteData  flags[MODULE_ID] from a media note
 */
export function isVideoMedia(noteData) {
  if (!noteData?.videoPath) return false;
  const ext = noteData.videoPath.split(".").pop().toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
}

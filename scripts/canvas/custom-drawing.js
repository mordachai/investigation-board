import { MODULE_ID, PIN_COLORS, SOCKET_NAME } from "../config.js";
import { InvestigationBoardState } from "../state.js";
import { collaborativeUpdate, collaborativeDelete, socket, activeGlobalSounds } from "../utils/socket-handler.js";
import { getDynamicCharacterLimits, truncateText } from "../utils/helpers.js";
import { NotePreviewer } from "../apps/note-previewer.js";
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
    this.photoImageSprite = null;
    this.photoMask = null;
    this.identityNameText = null;
    this.futuristicText = null;
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
      // Allow all users to view investigation board notes
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
   * Override activateListeners to ensure the MouseInteractionManager is configured
   * to allow right-click events even for non-owners.
   */
  activateListeners() {
    super.activateListeners();
    if (this.mouseInteractionManager) {
      this.mouseInteractionManager.permissions.clickRight = () => true;
      this.mouseInteractionManager.permissions.clickRight2 = () => true;
    }
  }

  /**
   * Override double-click to open the larger preview instead of the edit sheet.
   */
  _onClickLeft2(event) {
    const noteData = this.document.flags?.[MODULE_ID];
    if (noteData?.type) {
      // Open the detail view previewer
      new NotePreviewer(this.document).render(true);
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

    const data = event.data || event.interactionData;
    const originalEvent = data.originalEvent;
    
    // Positions
    const x = originalEvent.clientX;
    const y = originalEvent.clientY;

    // Remove any existing custom context menus
    document.querySelectorAll('.ib-context-menu').forEach(el => el.remove());

    const menu = document.createElement('div');
    menu.classList.add('ib-context-menu');
    menu.style.position = 'fixed';
    menu.style.top = `${y}px`;
    menu.style.left = `${x}px`;
    menu.style.zIndex = '10000';

    const editOption = document.createElement('div');
    editOption.innerHTML = '<i class="fas fa-edit"></i> Edit';
    editOption.classList.add('ib-context-menu-item');
    editOption.onclick = (e) => {
      e.stopPropagation();
      this.document.sheet.render(true);
      menu.remove();
    };

    // Media-specific options
    if (noteData.type === "media" && noteData.audioPath) {
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
          // Stop App Audio
          if (audioEl) audioEl.pause();
          // Stop Legacy Audio
          const sounds = Array.from(game.audio.playing.values()).filter(s => s.src === noteData.audioPath);
          sounds.forEach(s => s.stop());
          menu.remove();
        };
      } else {
        playMeOption.innerHTML = '<i class="fas fa-volume-up"></i> Play for Me';
        playMeOption.onclick = (e) => {
          e.stopPropagation();
          // Open Preview with autoplay
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
            // Try to use App control first
            if (app) {
               const globalBtn = app.element.querySelector('.global-toggle');
               if (globalBtn && globalBtn.classList.contains('active')) {
                 globalBtn.click();
                 menu.remove();
                 return;
               }
            }

            // Fallback to manual socket stop
            if (socket) {
              socket.emit(SOCKET_NAME, {
                action: "stopAudio",
                audioPath: noteData.audioPath
              });
              const sound = activeGlobalSounds.get(noteData.audioPath);
              if (sound) {
                sound.stop();
                activeGlobalSounds.delete(noteData.audioPath);
              }
            }
            menu.remove();
          };
        } else {
          playAllOption.innerHTML = '<i class="fas fa-broadcast-tower"></i> Play for All';
          playAllOption.onclick = (e) => {
            e.stopPropagation();
            // Unified: Open Preview and broadcast
            new NotePreviewer(this.document).render(true, { autobroadcast: true });
            menu.remove();
          };
        }
        playAllOption.classList.add('ib-context-menu-item');
        menu.appendChild(playAllOption);
      }
    }

    const viewOption = document.createElement('div');
    viewOption.innerHTML = '<i class="fas fa-eye"></i> View';
    viewOption.classList.add('ib-context-menu-item');
    viewOption.onclick = (e) => {
      e.stopPropagation();
      new NotePreviewer(this.document).render(true);
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

    // Linked Object Option
    if (noteData.linkedObject) {
      const linkMatch = noteData.linkedObject.match(/\[([^\]]+)\](?:\{([^\}]+)\})?/);
      if (linkMatch) {
        const uuid = linkMatch[1];
        const name = linkMatch[2] || "Linked Object";
        
        const linkOption = document.createElement('div');
        linkOption.innerHTML = `<i class="fas fa-link"></i> Open: ${name}`;
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
    // Mark as investigation board note for CSS filtering
    this.element?.setAttribute("data-investigation-note", "true");
    await this._updateSprites();
    // Redraw all connections and reposition pins globally
    drawAllConnectionLines();
    return this;
  }

  // Ensure sprites update correctly on refresh.
  async refresh() {
    await super.refresh();
    // Mark as investigation board note for CSS filtering
    this.element?.setAttribute("data-investigation-note", "true");
    await this._updateSprites();
    // Redraw all connections and reposition pins globally
    drawAllConnectionLines();
    return this;
  }

  async _updateSprites() {
    const noteData = this.document.flags[MODULE_ID];
    if (!noteData) return;

    const isPhoto = noteData.type === "photo";
    const isIndex = noteData.type === "index";
    const isHandout = noteData.type === "handout";
    const isMedia = noteData.type === "media";
    const mode = game.settings.get(MODULE_ID, "boardMode");

    // MEDIA NOTE LAYOUT (Cassette tape)
    if (isMedia) {
      const drawingWidth = this.document.shape.width || 400;
      const drawingHeight = this.document.shape.height || Math.round(drawingWidth * 0.74);

      // No background sprite for media (we use photoImageSprite for the cassette)
      if (this.bgSprite) {
        this.removeChild(this.bgSprite);
        this.bgSprite.destroy();
        this.bgSprite = null;
      }

      if (!this.photoImageSprite || !this.photoImageSprite.parent) {
        if (this.photoImageSprite) this.photoImageSprite.destroy();
        this.photoImageSprite = new PIXI.Sprite();
        this.addChild(this.photoImageSprite);
      }

      // --- Cassette Shadow ---
      if (!this.bgShadow) {
        this.bgShadow = new PIXI.Sprite();
        this.addChildAt(this.bgShadow, 0); // Put it behind everything
      }

      const imagePath = noteData.image || "modules/investigation-board/assets/cassette1.webp";
      try {
        const texture = await PIXI.Assets.load(imagePath);
        if (texture) {
          // Update shadow
          if (this.bgShadow) {
            this.bgShadow.texture = texture;
            this.bgShadow.width = drawingWidth;
            this.bgShadow.height = drawingHeight;
            this.bgShadow.tint = 0x000000;
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

      // --- Pin Sprite ---
      const pinSetting = game.settings.get(MODULE_ID, "pinColor");
      if (pinSetting === "none") {
        if (this.pinSprite) {
          this.removeChild(this.pinSprite);
          this.pinSprite.destroy();
          this.pinSprite = null;
        }
      } else {
        if (!this.pinSprite || !this.pinSprite.parent) {
          if (this.pinSprite) this.pinSprite.destroy();
          this.pinSprite = new PIXI.Sprite();
          this.addChild(this.pinSprite);
        }

        let pinColor = noteData.pinColor;
        if (!pinColor) {
          pinColor = (pinSetting === "random")
            ? PIN_COLORS[Math.floor(Math.random() * PIN_COLORS.length)]
            : `${pinSetting}Pin.webp`;
          await collaborativeUpdate(this.document.id, { [`flags.${MODULE_ID}.pinColor`]: pinColor });
        }

        const pinImage = `modules/investigation-board/assets/${pinColor}`;
        try {
          const texture = await PIXI.Assets.load(pinImage);
          if (texture && this.pinSprite && this.pinSprite.parent) {
            this.pinSprite.texture = texture;
            this.pinSprite.width = 40;
            this.pinSprite.height = 40;
            // Center horizontally based on the actual drawing width
            this.pinSprite.position.set(drawingWidth / 2 - 20, 3);
          }
        } catch (err) {
          console.error(`Failed to load pin texture: ${pinImage}`, err);
        }
      }

      // Hide text for media notes on canvas
      if (this.noteText) this.noteText.visible = false;
      if (this.identityNameText) this.identityNameText.visible = false;
      if (this.futuristicText) this.futuristicText.visible = false;

      return; // Early exit for media notes
    }

    // HANDOUT NOTE LAYOUT (Image-only, transparent background)
    if (isHandout) {
      const drawingWidth = this.document.shape.width || 400;
      const drawingHeight = this.document.shape.height || 400;

      // No background sprite for handouts (transparent)
      if (this.bgSprite) {
        this.removeChild(this.bgSprite);
        this.bgSprite.destroy();
        this.bgSprite = null;
      }

      // --- User Image (primary content) ---
      // Check if sprite exists and has a valid parent, recreate if orphaned
      if (!this.photoImageSprite || !this.photoImageSprite.parent) {
        // Destroy old sprite if it exists
        if (this.photoImageSprite) {
          this.photoImageSprite.destroy();
        }
        this.photoImageSprite = new PIXI.Sprite();
        this.addChild(this.photoImageSprite);
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

      // --- Pin Sprite ---
      const pinSetting = game.settings.get(MODULE_ID, "pinColor");
      if (pinSetting === "none") {
        if (this.pinSprite) {
          this.removeChild(this.pinSprite);
          this.pinSprite.destroy();
          this.pinSprite = null;
        }
      } else {
        // Check if sprite exists and has a valid parent, recreate if orphaned
        if (!this.pinSprite || !this.pinSprite.parent) {
          // Destroy old sprite if it exists
          if (this.pinSprite) {
            this.pinSprite.destroy();
          }
          this.pinSprite = new PIXI.Sprite();
          this.addChild(this.pinSprite);
        }

        let pinColor = noteData.pinColor;
        if (!pinColor) {
          pinColor = (pinSetting === "random")
            ? PIN_COLORS[Math.floor(Math.random() * PIN_COLORS.length)]
            : `${pinSetting}Pin.webp`;
          // Use collaborative update to save pin color (works for all users)
          await collaborativeUpdate(this.document.id, { [`flags.${MODULE_ID}.pinColor`]: pinColor });
        }

        const pinImage = `modules/investigation-board/assets/${pinColor}`;
        try {
          const texture = await PIXI.Assets.load(pinImage);
          if (texture && this.pinSprite && this.pinSprite.parent) {
            this.pinSprite.texture = texture;
            this.pinSprite.width = 40;
            this.pinSprite.height = 40;
            // Position at 5% from top, centered horizontally
            this.pinSprite.position.set(
              drawingWidth / 2 - 20,
              drawingHeight * 0.05
            );
          }
        } catch (err) {
          console.error(`Failed to load pin texture: ${pinImage}`, err);
          if (this.pinSprite) {
            this.pinSprite.texture = PIXI.Texture.EMPTY;
          }
        }
      }

      // Hide text sprites (handouts don't have text)
      if (this.noteText) {
        this.noteText.visible = false;
      }
      if (this.identityNameText) {
        this.identityNameText.visible = false;
      }
      if (this.futuristicText) {
        this.futuristicText.visible = false;
      }

      // Ensure the drawing itself is visible for handouts
      this.visible = true;
      this.alpha = 1;
      this.renderable = true;

      // Force PIXI render update by multiple methods
      this.transform.updateTransform(this.parent.transform);

      // Mark all children as needing update
      if (this.photoImageSprite) {
        this.photoImageSprite.updateTransform();
      }
      if (this.pinSprite) {
        this.pinSprite.updateTransform();
      }

      return; // Early exit for handout notes
    }

    // FUTURISTIC PHOTO NOTE LAYOUT
    if (isPhoto && mode === "futuristic") {
      const fullWidth = game.settings.get(MODULE_ID, "photoNoteWidth");
      const margin = 10;
      const photoImgWidth = fullWidth * 0.4;
      const photoImgHeight = photoImgWidth * (4 / 3);
      const textAreaX = margin + photoImgWidth + margin;
      const fullHeight = photoImgHeight + margin * 2;
    
      // --- Background Frame ---
      if (!this.bgSprite) {
        this.bgSprite = new PIXI.Sprite();
        this.addChildAt(this.bgSprite, 0);
      }
    
      // --- Background Shadow ---
      if (!this.bgShadow) {
        this.bgShadow = new PIXI.Sprite();
        this.addChildAt(this.bgShadow, 0); // Behind the frame
      }
    
      try {
        const texture = await PIXI.Assets.load("modules/investigation-board/assets/photoFrame.webp");
        if (texture) {
          // Update shadow
          if (this.bgShadow) {
            this.bgShadow.texture = texture;
            this.bgShadow.width = fullWidth;
            this.bgShadow.height = fullHeight;
            this.bgShadow.tint = 0x000000;
            this.bgShadow.alpha = 0.4;
            this.bgShadow.position.set(6, 6);
            this.bgShadow.filters = [new PIXI.BlurFilter(3)];
          }

          if (this.bgSprite) {
            this.bgSprite.texture = texture;
            this.bgSprite.width = fullWidth;
            this.bgSprite.height = fullHeight;
          }
        }
      } catch (err) {
        console.error("Failed to load photo frame texture", err);
        if (this.bgSprite) {
          this.bgSprite.texture = PIXI.Texture.EMPTY;
        }
      }

      // --- Foreground (User-Assigned) Photo ---
      if (!this.photoImageSprite) {
        this.photoImageSprite = new PIXI.Sprite();
        this.addChild(this.photoImageSprite);
      }
      try {
        const imagePath = noteData.image || "modules/investigation-board/assets/placeholder.webp";
        const texture = await PIXI.Assets.load(imagePath);
        if (texture && this.photoImageSprite) {
          this.photoImageSprite.texture = texture;
          
          const frameWidth = fullWidth * 0.9;
          const frameHeight = fullHeight * 0.9;
          const frameX = fullWidth * 0.05;
          const frameY = fullHeight * 0.05;

          // Use center-top positioning logic to avoid stretching
          const textureRatio = texture.width / texture.height;
          const frameRatio = frameWidth / frameHeight;

          let spriteWidth, spriteHeight, offsetX, offsetY;

          if (textureRatio > frameRatio) {
            // Case 1: Image is wider than frame - Fit by height, center horizontally
            spriteHeight = frameHeight;
            spriteWidth = frameHeight * textureRatio;
            offsetX = (frameWidth - spriteWidth) / 2;
            offsetY = 0;
          } else {
            // Case 2: Image is taller than frame - Fit by width, top aligned
            spriteWidth = frameWidth;
            spriteHeight = frameWidth / textureRatio;
            offsetX = 0;
            offsetY = 0;
          }

          this.photoImageSprite.width = spriteWidth;
          this.photoImageSprite.height = spriteHeight;
          this.photoImageSprite.position.set(frameX + offsetX, frameY + offsetY);

          // Apply Mask to clip overflow in futuristic mode too
          if (!this.photoMask) {
            this.photoMask = new PIXI.Graphics();
            this.addChild(this.photoMask);
          }
          this.photoMask.clear();
          this.photoMask.beginFill(0xffffff);
          this.photoMask.drawRect(frameX, frameY, frameWidth, frameHeight);
          this.photoMask.endFill();
          this.photoImageSprite.mask = this.photoMask;
          this.photoMask.visible = true;
          this.photoImageSprite.visible = true;
        }
      } catch (err) {
        console.error(`Failed to load user photo: ${noteData.image}`, err);
        if (this.photoImageSprite) {
          this.photoImageSprite.texture = PIXI.Texture.EMPTY;
        }
      }

      // --- Identity Name and Additional Text (Futuristic) ---
      const font = noteData.font || game.settings.get(MODULE_ID, "font");
      const baseFontSize = noteData.fontSize || game.settings.get(MODULE_ID, "baseFontSize");
      const fontSize = (fullWidth / 200) * baseFontSize;
      const textStyle = new PIXI.TextStyle({
        fontFamily: font,
        fontSize: fontSize,
        fill: "#000000",
        wordWrap: true,
        wordWrapWidth: fullWidth - textAreaX - margin,
        align: "left",
      });
      if (!this.identityNameText) {
        this.identityNameText = new PIXI.Text("", textStyle);
        this.addChild(this.identityNameText);
      }
      this.identityNameText.text = noteData.identityName || "Name";
      this.identityNameText.style = textStyle;
      this.identityNameText.position.set(textAreaX, margin);
    
      if (!this.futuristicText) {
        this.futuristicText = new PIXI.Text("", textStyle);
        this.addChild(this.futuristicText);
      }
      this.futuristicText.text = noteData.text || "";
      this.futuristicText.style = textStyle;
      this.futuristicText.position.set(textAreaX, margin + this.identityNameText.height + 5);
    
      // Remove default note text if present.
      if (this.noteText) {
        this.removeChild(this.noteText);
        this.noteText.destroy();
        this.noteText = null;
      }
    
      // --- Pin Handling (Futuristic) ---
      const pinSetting = game.settings.get(MODULE_ID, "pinColor");
      if (pinSetting === "none") {
        if (this.pinSprite) {
          this.removeChild(this.pinSprite);
          this.pinSprite.destroy();
          this.pinSprite = null;
        }
      } else {
        if (!this.pinSprite) {
          this.pinSprite = new PIXI.Sprite();
          this.addChild(this.pinSprite);
        }
        let pinColor = noteData.pinColor;
        if (!pinColor) {
          pinColor = (pinSetting === "random")
            ? PIN_COLORS[Math.floor(Math.random() * PIN_COLORS.length)]
            : `${pinSetting}Pin.webp`;
          // Use collaborative update to save pin color (works for all users)
          await collaborativeUpdate(this.document.id, { [`flags.${MODULE_ID}.pinColor`]: pinColor });
        }
        const pinImage = `modules/investigation-board/assets/${pinColor}`;
        try {
          const texture = await PIXI.Assets.load(pinImage);
          if (texture && this.pinSprite) {
            this.pinSprite.texture = texture;
            this.pinSprite.width = 40;
            this.pinSprite.height = 40;
            this.pinSprite.position.set(fullWidth / 2 - 20, 3);
          }
        } catch (err) {
          console.error(`Failed to load pin texture: ${pinImage}`, err);
          if (this.pinSprite) {
            this.pinSprite.texture = PIXI.Texture.EMPTY;
          }
        }
      }
      return; // End early for futuristic photo notes.
    }
    
    // STANDARD LAYOUT (Modern photo notes, sticky, index, etc.)
    const width = isPhoto
      ? game.settings.get(MODULE_ID, "photoNoteWidth")
      : isIndex
        ? game.settings.get(MODULE_ID, "indexNoteWidth") || 600
        : game.settings.get(MODULE_ID, "stickyNoteWidth");
    
    const height = isPhoto
      ? Math.round(width / (225 / 290))
      : isIndex
        ? Math.round(width / (600 / 400))
        : width;
    
    // Background Image based on board mode.
    const getBackgroundImage = (noteType, mode) => {
      if (mode === "futuristic") {
        if (noteType === "photo") return "modules/investigation-board/assets/futuristic_photoFrame.webp";
        if (noteType === "index") return "modules/investigation-board/assets/futuristic_note_index.webp";
        return "modules/investigation-board/assets/futuristic_note_white.webp";
      } else if (mode === "custom") {
        if (noteType === "photo") return "modules/investigation-board/assets/custom_photoFrame.webp";
        if (noteType === "index") return "modules/investigation-board/assets/custom_note_index.webp";
        return "modules/investigation-board/assets/custom_note_white.webp";
      }
      // Default "modern" mode:
      if (noteType === "photo") return "modules/investigation-board/assets/photoFrame.webp";
      if (noteType === "index") return "modules/investigation-board/assets/note_index.webp";
      return "modules/investigation-board/assets/note_white.webp";
    };
    const bgImage = getBackgroundImage(noteData.type, mode);
    
    if (!this.bgSprite) {
      this.bgSprite = new PIXI.Sprite();
      this.addChild(this.bgSprite);
    }
    
    // --- Background Shadow ---
    if (!this.bgShadow) {
      this.bgShadow = new PIXI.Sprite();
      this.addChildAt(this.bgShadow, 0); // Behind the background
    }
    
    try {
      const texture = await PIXI.Assets.load(bgImage);
      if (texture) {
        // Update shadow
        if (this.bgShadow) {
          this.bgShadow.texture = texture;
          this.bgShadow.width = width;
          this.bgShadow.height = height;
          this.bgShadow.tint = 0x000000;
          this.bgShadow.alpha = 0.4;
          this.bgShadow.position.set(6, 6);
          this.bgShadow.filters = [new PIXI.BlurFilter(3)];
        }
        
        if (this.bgSprite) {
          this.bgSprite.texture = texture;
          this.bgSprite.width = width;
          this.bgSprite.height = height;
        }
      }
    } catch (err) {
      console.error(`Failed to load background texture: ${bgImage}`, err);
      if (this.bgSprite) {
        this.bgSprite.texture = PIXI.Texture.EMPTY;
      }
    }
    
    // --- Foreground (User-Assigned) Photo for Modern Mode ---
    if (isPhoto) {
      const fgImage = noteData.image || "modules/investigation-board/assets/placeholder.webp";
      if (!this.photoImageSprite) {
        this.photoImageSprite = new PIXI.Sprite();
        this.addChild(this.photoImageSprite);
      }
      try {
        const texture = await PIXI.Assets.load(fgImage);
        if (texture && this.photoImageSprite) {
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
            this.addChild(this.photoMask);
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
    
    // --- Pin Handling (Standard) ---
    {
      const pinSetting = game.settings.get(MODULE_ID, "pinColor");
      if (pinSetting === "none") {
        if (this.pinSprite) {
          this.removeChild(this.pinSprite);
          this.pinSprite.destroy();
          this.pinSprite = null;
        }
      } else {
        if (!this.pinSprite) {
          this.pinSprite = new PIXI.Sprite();
          this.addChild(this.pinSprite);
        }
        let pinColor = noteData.pinColor;
        if (!pinColor) {
          pinColor = (pinSetting === "random")
            ? PIN_COLORS[Math.floor(Math.random() * PIN_COLORS.length)]
            : `${pinSetting}Pin.webp`;
          // Use collaborative update to save pin color (works for all users)
          await collaborativeUpdate(this.document.id, { [`flags.${MODULE_ID}.pinColor`]: pinColor });
        }
        const pinImage = `modules/investigation-board/assets/${pinColor}`;
        try {
          const texture = await PIXI.Assets.load(pinImage);
          if (texture && this.pinSprite) {
            this.pinSprite.texture = texture;
            this.pinSprite.width = 40;
            this.pinSprite.height = 40;
            this.pinSprite.position.set(width / 2 - 20, 3);
          }
        } catch (err) {
          console.error(`Failed to load pin texture: ${pinImage}`, err);
          if (this.pinSprite) {
            this.pinSprite.texture = PIXI.Texture.EMPTY;
          }
        }
      }
    }

    // Default text layout for non-futuristic notes.
    const font = noteData.font || game.settings.get(MODULE_ID, "font");
    const defaultFontSize = isIndex ? 9 : game.settings.get(MODULE_ID, "baseFontSize");
    const baseFontSize = noteData.fontSize || defaultFontSize;
    const fontSize = (width / 200) * baseFontSize;
    const textStyle = new PIXI.TextStyle({
      fontFamily: font,
      fontSize: fontSize,
      fill: "#000000",
      wordWrap: true,
      wordWrapWidth: width - 15,
      align: "center",
    });
    const truncatedText = truncateText(noteData.text || "Default Text", font, noteData.type, fontSize);
    if (!this.noteText) {
      this.noteText = new PIXI.Text(truncatedText, textStyle);
      this.noteText.anchor.set(0.5);
      this.addChild(this.noteText);
    } else {
      this.noteText.style = textStyle;
      this.noteText.text = truncatedText;
    }
    this.noteText.position.set(width / 2, isPhoto ? height - 25 : height / 2);
  }

  _getPinPosition() {
    const noteData = this.document.flags[MODULE_ID];
    if (!noteData) return { x: this.document.x, y: this.document.y };

    // Handout notes use dynamic positioning based on drawing height
    if (noteData.type === "handout") {
      const width = this.document.shape.width || 400;
      const height = this.document.shape.height || 400;
      return {
        x: this.document.x + width / 2,
        y: this.document.y + (height * 0.05) + 20  // 5% from top + half pin height
      };
    }

    // Media notes (cassettes) center horizontally based on actual width
    if (noteData.type === "media") {
      const width = this.document.shape.width || 400;
      return {
        x: this.document.x + width / 2,
        y: this.document.y + 23
      };
    }

    const isPhoto = noteData.type === "photo";
    const isIndex = noteData.type === "index";

    // Get note width based on type
    let width;
    if (isPhoto) {
      width = game.settings.get(MODULE_ID, "photoNoteWidth");
    } else if (isIndex) {
      width = game.settings.get(MODULE_ID, "indexNoteWidth") || 600;
    } else {
      width = game.settings.get(MODULE_ID, "stickyNoteWidth");
    }

    // Pin center is at (width/2, 23) relative to drawing position
    return {
      x: this.document.x + width / 2,
      y: this.document.y + 23
    };
  }
}

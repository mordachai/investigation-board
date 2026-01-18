/**
 * Utilities for applying audio effects to simulate lo-fi/tape sounds.
 */

/**
 * Applies a "tape" effect to a Web Audio node chain.
 * This typically involves a high-pass filter to remove bass and a low-pass filter to remove crisp highs.
 * @param {AudioContext} context - The audio context to use.
 * @param {AudioNode} inputNode - The source node.
 * @param {AudioNode} outputNode - The destination node (e.g., context.destination).
 * @returns {Object} An object containing the filter nodes for later cleanup.
 */
export function applyTapeEffect(context, inputNode, outputNode) {
  // Create High-pass filter (removes bass/lows for that tinny sound)
  const hpFilter = context.createBiquadFilter();
  hpFilter.type = "highpass";
  hpFilter.frequency.value = 600; // Cut everything below 500Hz
  hpFilter.Q.value = 1;

  // Create Low-pass filter (removes very high frequencies to simulate tape degradation)
  const lpFilter = context.createBiquadFilter();
  lpFilter.type = "lowpass";
  lpFilter.frequency.value = 2500; // Cut everything above 3000Hz
  lpFilter.Q.value = 1;

  // Create a Gain node to boost the signal slightly if it feels too quiet after filtering
  const gainNode = context.createGain();
  gainNode.gain.value = 1.2;

  // Connect the chain: Input -> HP -> LP -> Gain -> Output
  inputNode.connect(hpFilter);
  hpFilter.connect(lpFilter);
  lpFilter.connect(gainNode);
  gainNode.connect(outputNode);

  return {
    hpFilter,
    lpFilter,
    gainNode,
    disconnect: () => {
        try {
            inputNode.disconnect(hpFilter);
            hpFilter.disconnect(lpFilter);
            lpFilter.disconnect(gainNode);
            gainNode.disconnect(outputNode);
        } catch (e) {
            // Already disconnected or failed
        }
    }
  };
}

/**
 * Applies a "tape" effect to a Foundry Sound object by redirecting its node.
 * @param {Sound} sound - The Foundry Sound instance.
 */
export function applyTapeEffectToSound(sound) {
    if (!sound || !game.audio.context) return;

    // Use a listener to wait until the sound starts playing and has a node
    const apply = () => {
        const sourceNode = sound.sourceNode || sound.node;
        if (!sourceNode) return;

        try {
            // Disconnect from default destination (usually game.audio.master or context.destination)
            // Note: disconnect() without arguments removes all outgoing connections
            sourceNode.disconnect();
            
            // Apply the tape effect chain and connect it to the master destination
            // In Foundry v13, game.audio.master is the primary gain node
            const destination = game.audio.master || game.audio.context.destination;
            applyTapeEffect(game.audio.context, sourceNode, destination);
        } catch (err) {
            console.warn("Investigation Board: Failed to redirect Sound node for tape effect", err);
        }
    };

    if (sound.playing) apply();
    else sound.on("start", apply, {once: true});
}

/**
 * Applies a "tape" effect to a native HTMLAudioElement.
 * @param {HTMLAudioElement} audioElement - The audio element.
 * @returns {Object} The filter nodes for cleanup.
 */
const audioSourceMap = new WeakMap();

export function applyTapeEffectToElement(audioElement) {
    if (audioElement._ibTapeEffectApplied) return null;
    const context = game.audio.context;
    if (!context) return null;

    try {
        audioElement._ibTapeEffectApplied = true;
        let source;
        if (audioSourceMap.has(audioElement)) {
            source = audioSourceMap.get(audioElement);
        } else {
            source = context.createMediaElementSource(audioElement);
            audioSourceMap.set(audioElement, source);
        }
        
        
        // Connect source to the tape effect chain, then to master destination
        const destination = game.audio.master || context.destination;
        return applyTapeEffect(context, source, destination);
    } catch (err) {
        console.warn("Investigation Board: Could not apply audio effect to element", err);
        return null;
    }
}

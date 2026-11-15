// Procedural sound: every effect is synthesized with WebAudio, so the game ships
// no audio files and makes no network request. Created lazily on the first user
// gesture (browsers block audio before one) and silent until then.
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBuffer(seconds) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ duration, freq, type = 'lowpass', gain = 0.5, slideTo = null, delay = 0 }) {
    if (!ensure() || muted) return;
    const t0 = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(duration + 0.05);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t0);
    if (slideTo) filter.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    source.connect(filter).connect(g).connect(master);
    source.start(t0);
    source.stop(t0 + duration + 0.05);
  }

  function tone({ freq, duration, gain = 0.2, type = 'sine', slideTo = null, delay = 0 }) {
    if (!ensure() || muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  return {
    unlock() { ensure(); },
    shot(kind) {
      if (kind === 'sniper') burst({ duration: 0.28, freq: 900, slideTo: 120, gain: 0.7 });
      else if (kind === 'smg') burst({ duration: 0.09, freq: 1600, slideTo: 300, gain: 0.35 });
      else if (kind === 'pistol') burst({ duration: 0.12, freq: 1400, slideTo: 250, gain: 0.4 });
      else burst({ duration: 0.14, freq: 1200, slideTo: 200, gain: 0.5 });
    },
    enemyShot(distance) {
      const gain = Math.max(0.08, 0.4 - distance * 0.008);
      burst({ duration: 0.12, freq: 900, slideTo: 180, gain });
    },
    dry() { tone({ freq: 1800, duration: 0.04, gain: 0.12, type: 'square' }); },
    reload() {
      tone({ freq: 500, duration: 0.05, gain: 0.12, type: 'square' });
      tone({ freq: 700, duration: 0.05, gain: 0.12, type: 'square', delay: 0.5 });
    },
    hit() { tone({ freq: 2400, duration: 0.06, gain: 0.18, type: 'sine' }); },
    kill() {
      tone({ freq: 2400, duration: 0.06, gain: 0.18 });
      tone({ freq: 3200, duration: 0.08, gain: 0.18, delay: 0.07 });
    },
    hurt() { tone({ freq: 160, duration: 0.18, gain: 0.25, type: 'sawtooth', slideTo: 90 }); },
    beep(final = false) { tone({ freq: final ? 1400 : 950, duration: final ? 0.3 : 0.12, gain: 0.22 }); },
    plant() {
      tone({ freq: 880, duration: 0.1, gain: 0.2 });
      tone({ freq: 880, duration: 0.1, gain: 0.2, delay: 0.18 });
    },
    explosion() {
      burst({ duration: 0.9, freq: 400, slideTo: 60, gain: 0.9 });
      tone({ freq: 55, duration: 0.7, gain: 0.5, slideTo: 30 });
    },
    roundWin() {
      tone({ freq: 523, duration: 0.14, gain: 0.2 });
      tone({ freq: 659, duration: 0.14, gain: 0.2, delay: 0.14 });
      tone({ freq: 784, duration: 0.22, gain: 0.22, delay: 0.28 });
    },
    roundLose() {
      tone({ freq: 392, duration: 0.16, gain: 0.2 });
      tone({ freq: 311, duration: 0.26, gain: 0.2, delay: 0.16 });
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
  };
}

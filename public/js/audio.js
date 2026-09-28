/* Quizzle sound engine: every sound effect and music track is synthesized live with
   the Web Audio API, so there are no audio files to download or license. */
const Sound = (() => {
  const pref = {
    get(k, d) { try { const v = localStorage.getItem('quizzle.' + k); return v === null ? d : v === '1'; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('quizzle.' + k, v ? '1' : '0'); } catch { /* private mode */ } },
  };

  let ctx = null, master, musicBus, sfxBus, noiseBuf;
  let soundOn = pref.get('sound', true);
  let musicOn = pref.get('music', true);
  let wanted = null, current = null;
  const readyListeners = [];

  const ready = () => !!ctx && ctx.state === 'running';

  function init() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = soundOn ? 1 : 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 4;
      master.connect(comp).connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = musicOn ? 0.3 : 0;
      musicBus.connect(master);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.8;
      sfxBus.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const onReady = () => {
      if (wanted && musicOn && current?.name !== wanted) startMusic(wanted);
      readyListeners.splice(0).forEach(f => f());
    };
    if (ctx.state === 'running') onReady();
    else ctx.resume().then(onReady).catch(() => {});
  }
  for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, init, { capture: true, passive: true });

  // ── Synth building blocks ────────────────────────────────────────────────
  const NOTES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midi(n) {
    if (typeof n === 'number') return n;
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(n);
    return (Number(m[3]) + 1) * 12 + NOTES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }
  const hz = n => 440 * Math.pow(2, (midi(n) - 69) / 12);

  function env(g, t, vol, attack, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function tone(dest, { n, f, t, dur = 0.2, type = 'square', vol = 0.2, attack = 0.005, slide, slideF, cutoff, detune = 0 }) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(f ?? hz(n), t);
    const target = slideF ?? (slide != null ? hz(slide) : null);
    if (target) osc.frequency.exponentialRampToValueAtTime(target, t + dur * 0.9);
    const g = ctx.createGain();
    env(g, t, vol, attack, dur);
    let out = osc;
    if (cutoff) {
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.value = cutoff;
      out = out.connect(flt);
    }
    out.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise(dest, { t, dur = 0.1, vol = 0.2, type = 'highpass', f = 5000, q = 0.7, sweepTo, attack = 0.002 }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f, t);
    if (sweepTo) flt.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    env(g, t, vol, attack, dur);
    src.connect(flt).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  function kick(dest, t, vol = 0.7) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    env(g, t, vol, 0.002, 0.22);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.25);
  }
  const snare = (d, t, vol = 0.18) => {
    noise(d, { t, dur: 0.14, vol, type: 'bandpass', f: 1800, q: 0.8 });
    tone(d, { f: 190, t, dur: 0.08, type: 'triangle', vol: vol * 0.8 });
  };
  const hat = (d, t, vol = 0.05) => noise(d, { t, dur: 0.04, vol, f: 8000 });

  // ── Sound effects ────────────────────────────────────────────────────────
  const SFX = {
    click(t) { tone(sfxBus, { f: 900, t, dur: 0.05, vol: 0.08, cutoff: 3000 }); },
    pop(t) {
      const f = 320 + Math.random() * 320;
      tone(sfxBus, { f, slideF: f * 2.6, t, dur: 0.13, type: 'sine', vol: 0.4 });
      tone(sfxBus, { f: f * 2, t: t + 0.05, dur: 0.08, type: 'triangle', vol: 0.12 });
    },
    tick(t) {
      tone(sfxBus, { f: 1250, t, dur: 0.07, type: 'sine', vol: 0.35 });
      tone(sfxBus, { f: 2500, t, dur: 0.03, vol: 0.04 });
    },
    whoosh(t) { noise(sfxBus, { t, dur: 0.7, vol: 0.3, type: 'bandpass', f: 250, sweepTo: 4000, q: 1.4, attack: 0.3 }); },
    start(t) {
      ['C4', 'G4', 'C5', 'E5', 'G5', 'C6'].forEach((n, i) => tone(sfxBus, { n, t: t + i * 0.06, dur: 0.18, vol: 0.1, cutoff: 3500 }));
      noise(sfxBus, { t: t + 0.36, dur: 0.6, vol: 0.12, f: 5000 });
    },
    lock(t) {
      tone(sfxBus, { n: 'E6', t, dur: 0.15, type: 'sine', vol: 0.3 });
      tone(sfxBus, { n: 'B6', t: t + 0.08, dur: 0.35, type: 'sine', vol: 0.22 });
    },
    correct(t) {
      ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => {
        tone(sfxBus, { n, t: t + i * 0.08, dur: 0.3, vol: 0.12, cutoff: 3500 });
        tone(sfxBus, { n, t: t + i * 0.08, dur: 0.3, type: 'triangle', vol: 0.15 });
      });
      ['G6', 'C7', 'E7'].forEach((n, i) => tone(sfxBus, { n, t: t + 0.4 + i * 0.07, dur: 0.4, type: 'sine', vol: 0.1 }));
    },
    wrong(t) {
      tone(sfxBus, { n: 'D4', slide: 'C#4', t, dur: 0.3, type: 'sawtooth', vol: 0.14, cutoff: 1300 });
      tone(sfxBus, { n: 'C#4', slide: 'A3', t: t + 0.32, dur: 0.6, type: 'sawtooth', vol: 0.14, cutoff: 1000 });
    },
    timeout(t) {
      tone(sfxBus, { n: 'A4', slide: 'E4', t, dur: 0.5, type: 'triangle', vol: 0.25 });
    },
    gong(t) {
      [[196, 1], [394, 0.5], [588, 0.35], [836, 0.2], [1180, 0.1]].forEach(([f, v]) =>
        tone(sfxBus, { f, t, dur: 2.2, type: 'sine', vol: 0.3 * v, attack: 0.004 }));
      noise(sfxBus, { t, dur: 0.25, vol: 0.1, type: 'bandpass', f: 3000 });
    },
    reveal(t) {
      [['G4', 0], ['C5', 0.1], ['E5', 0.2]].forEach(([n, d]) => tone(sfxBus, { n, t: t + d, dur: 0.12, vol: 0.1, cutoff: 3000 }));
      ['C5', 'E5', 'G5', 'C6'].forEach(n => tone(sfxBus, { n, t: t + 0.32, dur: 0.9, type: 'triangle', vol: 0.12, attack: 0.02 }));
      noise(sfxBus, { t: t + 0.32, dur: 0.9, vol: 0.08, f: 6000 });
    },
    coin(t) {
      tone(sfxBus, { n: 'B5', t, dur: 0.08, vol: 0.1 });
      tone(sfxBus, { n: 'E6', t: t + 0.08, dur: 0.4, vol: 0.1 });
    },
    fanfare(t) {
      [['G4', 0, 0.14], ['C5', 0.15, 0.14], ['E5', 0.3, 0.14], ['G5', 0.45, 0.3], ['E5', 0.8, 0.14], ['G5', 0.95, 1.2]].forEach(([n, d, l]) => {
        tone(sfxBus, { n, t: t + d, dur: l + 0.1, type: 'sawtooth', vol: 0.12, cutoff: 2600, attack: 0.02 });
        tone(sfxBus, { n, t: t + d, dur: l + 0.1, vol: 0.06, cutoff: 3200, detune: 9, attack: 0.02 });
      });
      ['C4', 'E4', 'G4', 'C5'].forEach(n => tone(sfxBus, { n, t: t + 0.95, dur: 1.4, type: 'triangle', vol: 0.12, attack: 0.03 }));
      noise(sfxBus, { t: t + 0.95, dur: 1.6, vol: 0.18, f: 4500 });
      kick(sfxBus, t + 0.95, 0.9);
    },
    drumroll(t, dur = 4) {
      for (let x = 0; x < dur; x += Math.max(0.035, 0.085 - 0.05 * (x / dur))) {
        noise(sfxBus, { t: t + x, dur: 0.08, vol: 0.04 + 0.2 * (x / dur), type: 'bandpass', f: 1900, q: 0.9 });
      }
      noise(sfxBus, { t: t + dur, dur: 1.8, vol: 0.3, f: 4000 });
      kick(sfxBus, t + dur, 1);
    },
    cheer(t) {
      for (let i = 0; i < 90; i++) {
        noise(sfxBus, { t: t + Math.random() * 2, dur: 0.03 + Math.random() * 0.05, vol: 0.05 + Math.random() * 0.08, type: 'bandpass', f: 1200 + Math.random() * 2500, q: 1.5 });
      }
    },
  };

  // ── Music: tiny step sequencer ───────────────────────────────────────────
  const CH = {
    C: ['C3', 'C4', 'E4', 'G4'], Am: ['A2', 'A3', 'C4', 'E4'], F: ['F2', 'F3', 'A3', 'C4'],
    G: ['G2', 'G3', 'B3', 'D4'], E: ['E2', 'E3', 'G#3', 'B3'], Dm: ['D3', 'D4', 'F4', 'A4'],
  };
  const mel = s => s.trim().split(/\s+/);
  const lead = (d, n, t, dur) => {
    tone(d, { n, t, dur: dur * 0.95, vol: 0.07, cutoff: 2600, attack: 0.01 });
    tone(d, { n, t, dur: dur * 0.95, type: 'triangle', vol: 0.12, attack: 0.01, detune: 6 });
  };
  // '-' is a rest, '_' holds the previous note.
  function melody(tokens, i, t, s, d) {
    const n = tokens[i % tokens.length];
    if (n === '-' || n === '_') return;
    let len = 1;
    while (tokens[(i + len) % tokens.length] === '_') len++;
    lead(d, n, t, len * s);
  }
  const bounceBass = (d, root, i, t, s) =>
    tone(d, { n: midi(root) + (i % 2 ? 12 : 0), t, dur: s * 0.8, type: 'triangle', vol: 0.4 });

  const TRACKS = {
    lobby: {
      bpm: 116, div: 2, bars: ['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G'],
      melody: mel(`E5 G5 C6 G5 E5 - D5 E5   C5 E5 A5 G5 E5 - C5 D5   F5 A5 C6 A5 G5 F5 E5 D5   D5 _ G5 _ B4 _ - -
                   G5 _ E5 G5 C6 _ B5 C6   A5 _ E5 A5 C6 _ B5 A5   F5 _ A5 C6 D6 C6 A5 F5   G5 F5 E5 D5 B4 _ - -`),
      play(d, chord, i, g, t, s) {
        const [root, ...tones] = CH[chord];
        bounceBass(d, root, i, t, s);
        if (i === 2 || i === 6) tones.forEach(n => tone(d, { n: midi(n) + 12, t, dur: 0.14, vol: 0.035, cutoff: 1800 }));
        melody(this.melody, g, t, s, d);
        if (i === 0 || i === 4) kick(d, t, 0.45);
        if (i === 2 || i === 6) snare(d, t, 0.07);
        if (i % 2) hat(d, t, 0.03);
      },
    },
    question: {
      bpm: 128, div: 4, bars: ['Am', 'Am', 'F', 'F', 'C', 'C', 'E', 'E'],
      play(d, chord, i, g, t, s) {
        const [root, ...tones] = CH[chord];
        if (i % 2 === 0) tone(d, { n: root, t, dur: s * 1.6, type: 'sawtooth', vol: 0.16, cutoff: 600 });
        const oct = (i >> 2) % 2 ? 24 : 12;
        tone(d, { n: midi(tones[[0, 1, 2, 1][i % 4]]) + oct, t, dur: s * 0.9, vol: 0.045, cutoff: 2600 });
        if (i % 4 === 0) kick(d, t, 0.5);
        if (i === 4 || i === 12) snare(d, t, 0.07);
        if (i % 2) hat(d, t, 0.03);
        if (g % 64 === 0) noise(d, { t, dur: 0.8, vol: 0.06, f: 5000 });
      },
    },
    victory: {
      bpm: 124, div: 2, bars: ['C', 'F', 'G', 'C', 'Am', 'F', 'G', 'C'],
      melody: mel(`C5 _ E5 G5 C6 _ _ G5   A5 _ F5 A5 C6 _ A5 _   B5 _ G5 B5 D6 _ B5 _   C6 _ _ _ G5 _ E5 _
                   A5 _ E5 A5 C6 _ B5 A5   F5 _ A5 C6 F6 _ E6 D6   D6 _ B5 _ G5 _ B5 D6   C6 _ _ _ - - - -`),
      play(d, chord, i, g, t, s) {
        const [root, ...tones] = CH[chord];
        bounceBass(d, root, i, t, s);
        if (i % 2) tones.forEach(n => tone(d, { n: midi(n) + 12, t, dur: 0.12, vol: 0.03, cutoff: 2000 }));
        melody(this.melody, g, t, s, d);
        if (i % 2 === 0) kick(d, t, 0.45);
        if (i === 2 || i === 6) snare(d, t, 0.1);
        hat(d, t, 0.03);
        if (g % 32 === 0) noise(d, { t, dur: 1, vol: 0.1, f: 4500 });
      },
    },
  };

  function startMusic(name) {
    stopCurrent(0.05);
    const tr = TRACKS[name];
    if (!tr) return;
    const bus = ctx.createGain();
    bus.connect(musicBus);
    const perBar = tr.div * 4, total = perBar * tr.bars.length, s = 60 / tr.bpm / tr.div;
    const cur = { name, bus, step: 0, next: ctx.currentTime + 0.08 };
    cur.timer = setInterval(() => {
      if (cur.next < ctx.currentTime - 0.05) cur.next = ctx.currentTime + 0.05; // tab was asleep
      while (cur.next < ctx.currentTime + 0.2) {
        const g = cur.step % total;
        tr.play(bus, tr.bars[Math.floor(g / perBar)], g % perBar, g, cur.next, s);
        cur.step++;
        cur.next += s;
      }
    }, 40);
    current = cur;
  }

  function stopCurrent(fade = 0.4) {
    if (!current) return;
    const { bus, timer } = current;
    clearInterval(timer);
    current = null;
    const now = ctx.currentTime;
    bus.gain.setValueAtTime(bus.gain.value, now);
    bus.gain.linearRampToValueAtTime(0, now + fade);
    setTimeout(() => bus.disconnect(), fade * 1000 + 500);
  }

  return {
    init,
    ready,
    onReady(fn) { ready() ? fn() : readyListeners.push(fn); },
    sfx(name, ...args) {
      if (ready() && soundOn && SFX[name]) SFX[name](ctx.currentTime + 0.01, ...args);
    },
    music(name) {
      wanted = name;
      if (ready() && musicOn && current?.name !== name) startMusic(name);
    },
    stopMusic(fade) {
      wanted = null;
      if (ctx) stopCurrent(fade);
    },
    get soundOn() { return soundOn; },
    get musicOn() { return musicOn; },
    toggleSound() {
      soundOn = !soundOn;
      pref.set('sound', soundOn);
      if (master) master.gain.setTargetAtTime(soundOn ? 1 : 0, ctx.currentTime, 0.05);
      return soundOn;
    },
    toggleMusic() {
      musicOn = !musicOn;
      pref.set('music', musicOn);
      if (ctx) {
        musicBus.gain.setTargetAtTime(musicOn ? 0.3 : 0, ctx.currentTime, 0.05);
        if (!musicOn) stopCurrent(0.2);
        else if (wanted && ready()) startMusic(wanted);
      }
      return musicOn;
    },
  };
})();

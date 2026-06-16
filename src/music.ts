/**
 * Procedural lofi music engine — fully self-contained, no audio files, no
 * imports. Three generative MOODS share one cozy synth palette (soft e-piano
 * chords, gentle sine bass, sparse melody, a quiet noise bed) and are sequenced
 * one bar at a time by a classic look-ahead scheduler, with light randomization
 * (melody choice, rests, velocity, strum timing) so the loop never repeats
 * exactly.
 *
 * Signal chain:  voices ─▶ layer(gain, one per mood) ─▶ master(gain)
 *                          ─▶ lofi lowpass ─▶ destination
 *
 * Mood switches crossfade between two layer busses; each layer owns its own
 * scheduler timer + looping noise bed, and is disposed after its fade-out.
 *
 * Browsers block audio before a user gesture, so the AudioContext is created
 * lazily on the first play() call — never in the constructor.
 */

// ───────────────────────── tuning block ─────────────────────────
// Music is BACKGROUND — it must sit well under the SFX engines, so the master
// ceiling is low and per-voice gains are lower still.
const MASTER_GAIN = 0.16; // absolute music ceiling (scaled by setVolume 0..1)
const DEFAULT_VOLUME = 0.5; // user volume default (0..1 of MASTER_GAIN)
const CROSSFADE = 1.6; // seconds — mood-to-mood / stop fade time
const LOOKAHEAD = 0.6; // seconds of audio scheduled ahead of currentTime
const TICK_MS = 200; // scheduler wake-up interval (setTimeout)
const LOFI_CUTOFF = 3400; // Hz — master lowpass for that warm tape/lofi roundness
// Per-mood tempo (BPM). Lofi sits ~70-80; zombies crawls.
const BPM_HUB = 76;
const BPM_TD = 84;
const BPM_ZOMBIES = 52;

export type Mood = "hub" | "td" | "zombies";

interface ChordDef {
  bass: number; // MIDI note for the bass voice
  pad: number[]; // MIDI notes for the chord pad voicing
}

interface MoodDef {
  bpm: number;
  chords: ChordDef[]; // progression, one chord per bar, cycled
  scale: number[]; // MIDI pool the melody picks from
  melodyChance: number; // probability a given 8th-note slot plays a note
  drone: boolean; // true = slow drone pad/bass, false = plucky e-piano
  kickBeats: number[]; // beats (0-3) that get a soft heartbeat kick
  bed: "vinyl" | "rumble" | null; // looping noise bed flavor
  padGain: number;
  bassGain: number;
  melGain: number;
  bedGain: number;
}

const MOODS: Record<Mood, MoodDef> = {
  // Warm & cozy: the classic lofi ii7–V7–Imaj7–vi7 in C, pentatonic sprinkles,
  // vinyl crackle underneath.
  hub: {
    bpm: BPM_HUB,
    chords: [
      { bass: 38, pad: [50, 53, 57, 60] }, // Dm7
      { bass: 43, pad: [53, 59, 62] }, // G7
      { bass: 36, pad: [52, 55, 59, 64] }, // Cmaj7
      { bass: 45, pad: [55, 60, 64] }, // Am7
    ],
    scale: [72, 74, 76, 79, 81, 84], // C major pentatonic, C5..C6
    melodyChance: 0.22,
    drone: false,
    kickBeats: [],
    bed: "vinyl",
    padGain: 0.045,
    bassGain: 0.1,
    melGain: 0.05,
    bedGain: 0.05,
  },
  // Calm but focused: dreamy A-minor seventh chords with a soft heartbeat kick
  // on beats 1 & 3 for a little forward pulse.
  td: {
    bpm: BPM_TD,
    chords: [
      { bass: 45, pad: [55, 60, 64] }, // Am7
      { bass: 41, pad: [57, 60, 64] }, // Fmaj7
      { bass: 38, pad: [53, 57, 60] }, // Dm7
      { bass: 40, pad: [55, 59, 62] }, // Em7
    ],
    scale: [69, 72, 74, 76, 79, 81], // A minor pentatonic, A4..A5
    melodyChance: 0.16,
    drone: false,
    kickBeats: [0, 2],
    bed: "vinyl",
    padGain: 0.04,
    bassGain: 0.09,
    melGain: 0.045,
    bedGain: 0.03,
  },
  // Dark ambient: slow detuned D-minor drones over a sub rumble, with rare
  // high, slightly-off notes (incl. a tritone) drifting on top.
  zombies: {
    bpm: BPM_ZOMBIES,
    chords: [
      { bass: 38, pad: [50, 53, 57] }, // Dm
      { bass: 34, pad: [50, 53, 58] }, // Bb
      { bass: 31, pad: [50, 55, 58] }, // Gm
      { bass: 33, pad: [52, 57, 61] }, // A (C# tension)
    ],
    scale: [74, 77, 80, 81, 85], // D F G#(tritone) A C# — uneasy highs
    melodyChance: 0.1,
    drone: true,
    kickBeats: [],
    bed: "rumble",
    padGain: 0.05,
    bassGain: 0.11,
    melGain: 0.035,
    bedGain: 0.06,
  },
};

/** One active mood generator: its mix bus, scheduler state, and noise bed. */
interface Layer {
  mood: Mood;
  gain: GainNode;
  timer: number | undefined; // scheduler setTimeout id
  cleanup: number | undefined; // post-fade dispose setTimeout id
  nextBarTime: number; // ctx time the next bar starts
  barIndex: number;
  bedSrc: AudioBufferSourceNode | undefined;
  fading: boolean;
}

export class Music {
  private ctx?: AudioContext;
  private master?: GainNode; // music volume bus (enable × volume × ceiling)
  // Pre-baked loop buffers, created once and reused by every layer's bed.
  private vinylBuf?: AudioBuffer;
  private noiseBuf?: AudioBuffer;
  private layers: Layer[] = [];
  private cur: Mood | null = null;
  private enabled = true;
  private volume = DEFAULT_VOLUME;

  constructor() {
    // Intentionally empty: the AudioContext is created lazily in play() so we
    // never trip the browser autoplay policy before a user gesture.
  }

  /** The mood currently playing (the fade-in target during a crossfade). */
  get current(): Mood | null {
    return this.cur;
  }

  /** Start (or crossfade to) a mood. Calling with the current mood is a no-op. */
  play(mood: Mood) {
    if (this.cur === mood) return;
    if (!this.ok()) return;
    // Fade out whatever is playing, fade the new layer in over it.
    for (const layer of this.layers) this.fadeOutLayer(layer);
    this.startLayer(mood);
    this.cur = mood;
  }

  /** Fade out and stop all scheduling. play() works again afterwards. */
  stop() {
    this.cur = null;
    if (!this.ctx) return;
    for (const layer of this.layers) this.fadeOutLayer(layer);
  }

  /** Master music volume, 0..1 (scales the already-low internal ceiling). */
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyMaster();
  }

  /** Hard mute toggle. Remembered even before the context exists. */
  setEnabled(on: boolean) {
    this.enabled = on;
    this.applyMaster();
  }

  // ─────────────────────── lifecycle / helpers ───────────────────────

  /** Lazily create the context + master chain. Returns false if unavailable. */
  private ensure(): boolean {
    if (this.ctx) return true;
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      const ctx = new Ctor();
      this.ctx = ctx;

      // Gentle master lowpass = instant "warm tape" lofi character, and it also
      // tames any oscillator edge so the music never pokes above the SFX.
      const lofi = ctx.createBiquadFilter();
      lofi.type = "lowpass";
      lofi.frequency.value = LOFI_CUTOFF;
      lofi.Q.value = 0.5;
      lofi.connect(ctx.destination);

      const master = ctx.createGain();
      master.gain.value = this.enabled ? MASTER_GAIN * this.volume : 0;
      master.connect(lofi);
      this.master = master;

      // Pre-bake the looping bed buffers once (reused by every layer).
      this.vinylBuf = this.makeVinyl(2.0);
      this.noiseBuf = this.makeNoise(1.0);
      return true;
    } catch {
      // No Web Audio available — the game simply runs without music.
      this.ctx = undefined;
      return false;
    }
  }

  /** Guard: context exists, not closed, resumed if suspended. */
  private ok(): boolean {
    if (!this.ensure()) return false;
    const ctx = this.ctx;
    if (!ctx || ctx.state === "closed" || !this.master) return false;
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }
    return true;
  }

  private get t(): number {
    return this.ctx!.currentTime;
  }

  /** Push the enable × volume product to the master bus, click-free. */
  private applyMaster() {
    if (!this.ctx || this.ctx.state === "closed" || !this.master) return;
    const target = this.enabled ? MASTER_GAIN * this.volume : 0;
    this.master.gain.setTargetAtTime(target, this.t, 0.05);
  }

  /** MIDI note → frequency (Hz). */
  private freq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /** Static mono white-noise buffer (zombies' low rumble bed). */
  private makeNoise(dur: number): AudioBuffer {
    const ctx = this.ctx!;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Vinyl-crackle loop: faint hiss + a couple dozen tiny decaying pops. */
  private makeVinyl(dur: number): AudioBuffer {
    const ctx = this.ctx!;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * 0.015; // hiss floor
    const pops = 26;
    for (let p = 0; p < pops; p++) {
      const at = Math.floor(Math.random() * frames);
      const len = Math.floor(ctx.sampleRate * (0.001 + Math.random() * 0.004));
      const amp = 0.25 + Math.random() * 0.4;
      for (let i = 0; i < len && at + i < frames; i++) {
        data[at + i] += (Math.random() * 2 - 1) * amp * (1 - i / len);
      }
    }
    return buf;
  }

  // ─────────────────────────── layers ───────────────────────────

  /** Create a layer bus + noise bed for `mood`, fade it in, start scheduling. */
  private startLayer(mood: Mood) {
    const ctx = this.ctx!;
    const def = MOODS[mood];
    const gain = ctx.createGain();
    const now = this.t;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(1, now + CROSSFADE);
    gain.connect(this.master!);

    const layer: Layer = {
      mood,
      gain,
      timer: undefined,
      cleanup: undefined,
      nextBarTime: now + 0.1,
      barIndex: 0,
      bedSrc: undefined,
      fading: false,
    };

    // Continuous noise bed (looping source, lives as long as the layer).
    if (def.bed) {
      const buf = def.bed === "vinyl" ? this.vinylBuf : this.noiseBuf;
      if (buf) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const filt = ctx.createBiquadFilter();
        if (def.bed === "vinyl") {
          filt.type = "highpass"; // keep only the ticky crackle top
          filt.frequency.value = 1800;
          filt.Q.value = 0.7;
        } else {
          filt.type = "lowpass"; // deep unsettled room rumble
          filt.frequency.value = 140;
          filt.Q.value = 0.8;
        }
        const bg = ctx.createGain();
        bg.gain.value = def.bedGain;
        src.connect(filt);
        filt.connect(bg);
        bg.connect(gain);
        src.start(now, Math.random() * buf.duration);
        layer.bedSrc = src;
      }
    }

    this.layers.push(layer);

    // Look-ahead scheduler: top up bars whenever the horizon gets close, then
    // sleep. The timer is owned by the layer and cleared on fade-out/dispose.
    const loop = () => {
      if (layer.fading || !this.ctx || this.ctx.state === "closed") return;
      while (layer.nextBarTime < this.ctx.currentTime + LOOKAHEAD) {
        this.scheduleBar(layer, def);
        layer.nextBarTime += (60 / def.bpm) * 4;
        layer.barIndex++;
      }
      layer.timer = window.setTimeout(loop, TICK_MS);
    };
    loop();
  }

  /** Stop scheduling, ramp the bus to silence, then dispose after the fade. */
  private fadeOutLayer(layer: Layer) {
    if (layer.fading) return;
    layer.fading = true;
    if (layer.timer !== undefined) clearTimeout(layer.timer);
    layer.timer = undefined;
    const now = this.t;
    const g = layer.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.linearRampToValueAtTime(0.0001, now + CROSSFADE);
    layer.cleanup = window.setTimeout(() => this.disposeLayer(layer), (CROSSFADE + 0.3) * 1000);
  }

  /** Tear down a faded layer: kill the bed source and drop the bus. */
  private disposeLayer(layer: Layer) {
    if (layer.cleanup !== undefined) clearTimeout(layer.cleanup);
    layer.cleanup = undefined;
    if (layer.bedSrc) {
      try {
        layer.bedSrc.stop();
      } catch {
        /* already stopped */
      }
      layer.bedSrc = undefined;
    }
    try {
      layer.gain.disconnect();
    } catch {
      /* context closed */
    }
    const i = this.layers.indexOf(layer);
    if (i >= 0) this.layers.splice(i, 1);
  }

  // ─────────────────────────── sequencing ───────────────────────────

  /** Schedule one bar (bass + pad + melody + kick) starting at nextBarTime. */
  private scheduleBar(layer: Layer, def: MoodDef) {
    const t0 = layer.nextBarTime;
    const beat = 60 / def.bpm;
    const bar = beat * 4;
    const chord = def.chords[layer.barIndex % def.chords.length];
    if (!chord) return;
    const dest = layer.gain;
    const vel = () => 0.75 + Math.random() * 0.25; // gentle velocity variation

    // ── bass ──
    const bf = this.freq(chord.bass);
    if (def.drone) {
      // One long, slowly-swelling sub note per bar (overlaps the next slightly).
      this.note(bf, t0, bar * 1.05, def.bassGain * vel(), dest, { type: "sine", attack: beat, hold: true });
    } else {
      // Soft round bass on the downbeat…
      this.note(bf, t0 + 0.01, beat * 2.6, def.bassGain * vel(), dest, { type: "sine", attack: 0.03 });
      // …and occasionally a little walk-up (fifth) into the next bar.
      if (Math.random() < 0.35) {
        this.note(bf * 1.5, t0 + beat * 3, beat * 0.9, def.bassGain * 0.55 * vel(), dest, {
          type: "sine",
          attack: 0.03,
        });
      }
    }

    // ── chord pad ──
    if (def.drone) {
      // Detuned saw pair per voice: slow beating, dark and thick (low gain —
      // the master lofi lowpass rounds the edge off).
      for (const m of chord.pad) {
        const f = this.freq(m);
        const g = def.padGain * 0.5 * vel();
        this.note(f, t0, bar * 1.08, g, dest, { type: "sawtooth", attack: bar * 0.3, hold: true, detune: -7 });
        this.note(f, t0, bar * 1.08, g, dest, { type: "sawtooth", attack: bar * 0.3, hold: true, detune: 7 });
      }
    } else {
      // E-piano-ish pluck: lazily strummed triangles + a quiet sine "tine" an
      // octave up. Re-struck softer halfway through the bar, sometimes.
      const strum = () => 0.01 + Math.random() * 0.03;
      const hits: { at: number; amp: number }[] = [{ at: t0, amp: 1 }];
      if (Math.random() < 0.55) hits.push({ at: t0 + beat * 2, amp: 0.6 });
      for (const hit of hits) {
        chord.pad.forEach((m, i) => {
          const f = this.freq(m);
          const at = hit.at + i * strum();
          const g = def.padGain * hit.amp * vel();
          this.note(f, at, beat * 3.1, g, dest, { type: "triangle", attack: 0.015 });
          this.note(f * 2, at, beat * 2.2, g * 0.35, dest, { type: "sine", attack: 0.01 });
        });
      }
    }

    // ── melody: 8 eighth-note slots, mostly rests ──
    const eighth = beat / 2;
    for (let s = 0; s < 8; s++) {
      if (Math.random() >= def.melodyChance) continue;
      const m = def.scale[(Math.random() * def.scale.length) | 0];
      if (m === undefined) continue;
      const f = this.freq(m);
      const at = t0 + s * eighth;
      const g = def.melGain * vel();
      if (def.drone) {
        // Unsettling: slow-attack detuned sine pair that beats against itself.
        this.note(f, at, beat * 2.5, g, dest, { type: "sine", attack: 0.4, hold: true, detune: -8 });
        this.note(f, at, beat * 2.5, g * 0.8, dest, { type: "sine", attack: 0.4, hold: true, detune: 8 });
      } else {
        // Soft pentatonic pluck, sometimes held a little longer.
        const dur = eighth * (Math.random() < 0.3 ? 3 : 1.6);
        this.note(f, at, dur, g, dest, { type: "triangle", attack: 0.012 });
      }
    }

    // ── heartbeat kick ──
    for (const b of def.kickBeats) {
      if (Math.random() < 0.12) continue; // occasionally skip a beat — human feel
      this.kick(t0 + b * beat, 0.1 * vel(), dest);
    }
  }

  /**
   * One oscillator voice with an envelope into `dest`. Default is a pluck
   * (fast-ish attack, exponential decay); `hold` makes it a swell (linear
   * attack, sustained, linear release) for drones.
   */
  private note(
    freq: number,
    start: number,
    dur: number,
    peak: number,
    dest: AudioNode,
    opts: { type?: OscillatorType; attack?: number; detune?: number; hold?: boolean } = {},
  ) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? "triangle";
    osc.frequency.value = freq;
    if (opts.detune) osc.detune.value = opts.detune;
    const g = ctx.createGain();
    const a = Math.min(opts.attack ?? 0.02, dur * 0.5);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(peak, start + a);
    if (opts.hold) {
      g.gain.setValueAtTime(peak, start + Math.max(a, dur * 0.6));
      g.gain.linearRampToValueAtTime(0.0001, start + dur);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    }
    osc.connect(g);
    g.connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  /** Soft heartbeat kick: a quick down-swept sine thump, very quiet. */
  private kick(start: number, peak: number, dest: AudioNode) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(105, start);
    osc.frequency.exponentialRampToValueAtTime(44, start + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(peak, start + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
    osc.connect(g);
    g.connect(dest);
    osc.start(start);
    osc.stop(start + 0.25);
  }
}

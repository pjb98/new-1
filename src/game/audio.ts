// Dependency-free WebAudio sound engine.
//
// Sounds are synthesized at runtime from OscillatorNode + GainNode graphs, so
// there are no audio asset files to ship or load. Everything is guarded so a
// missing or blocked AudioContext (older browsers, autoplay policies, private
// mode) degrades silently rather than throwing.

const MUTE_KEY = 'solana-valley:muted';

// A single tone scheduled relative to a start time. We synthesize each sound as
// a handful of these so they stay short and snappy.
type Tone = {
  freq: number;
  type: OscillatorType;
  start: number; // seconds after the play() instant
  dur: number; // seconds
  gain: number; // peak gain (kept low to avoid clipping when notes overlap)
  freqTo?: number; // optional linear pitch sweep to this frequency
};

type SoundName =
  | 'till'
  | 'water'
  | 'plant'
  | 'harvest'
  | 'sell'
  | 'buy'
  | 'upgrade'
  | 'levelup'
  | 'achievement'
  | 'click';

// Recipes: each sound is an array of tones. Frequencies in Hz, times in seconds.
// Gains are intentionally subtle (~0.05–0.12) and durations short (~0.05–0.2s).
const RECIPES: Record<SoundName, Tone[]> = {
  // Dull thunk: a low, fast-decaying sine that drops in pitch.
  till: [{ freq: 150, freqTo: 70, type: 'sine', start: 0, dur: 0.12, gain: 0.11 }],

  // Soft watery sweep: a quiet triangle gliding upward.
  water: [{ freq: 320, freqTo: 620, type: 'triangle', start: 0, dur: 0.18, gain: 0.06 }],

  // Gentle pop: a brief sine that pitches up a touch.
  plant: [{ freq: 420, freqTo: 540, type: 'sine', start: 0, dur: 0.08, gain: 0.09 }],

  // Bright pluck: a short triangle high up.
  harvest: [{ freq: 880, freqTo: 1180, type: 'triangle', start: 0, dur: 0.1, gain: 0.08 }],

  // Coin-y two-note up (classic pickup): two quick square notes.
  sell: [
    { freq: 988, type: 'square', start: 0, dur: 0.07, gain: 0.06 },
    { freq: 1319, type: 'square', start: 0.07, dur: 0.12, gain: 0.06 },
  ],

  // Short click + tone: a tiny tick followed by a soft confirming note.
  buy: [
    { freq: 1400, type: 'square', start: 0, dur: 0.02, gain: 0.05 },
    { freq: 560, type: 'sine', start: 0.02, dur: 0.09, gain: 0.08 },
  ],

  // Rising arpeggio: three ascending triangle notes.
  upgrade: [
    { freq: 523, type: 'triangle', start: 0, dur: 0.08, gain: 0.07 },
    { freq: 659, type: 'triangle', start: 0.07, dur: 0.08, gain: 0.07 },
    { freq: 784, type: 'triangle', start: 0.14, dur: 0.12, gain: 0.07 },
  ],

  // Cheerful 3-note arpeggio (major triad up an octave).
  levelup: [
    { freq: 523, type: 'square', start: 0, dur: 0.09, gain: 0.06 },
    { freq: 659, type: 'square', start: 0.09, dur: 0.09, gain: 0.06 },
    { freq: 1047, type: 'square', start: 0.18, dur: 0.16, gain: 0.07 },
  ],

  // Fanfare-ish: a triad stab then a held top note.
  achievement: [
    { freq: 659, type: 'triangle', start: 0, dur: 0.1, gain: 0.06 },
    { freq: 831, type: 'triangle', start: 0.05, dur: 0.1, gain: 0.06 },
    { freq: 988, type: 'triangle', start: 0.1, dur: 0.1, gain: 0.06 },
    { freq: 1319, type: 'square', start: 0.18, dur: 0.2, gain: 0.07 },
  ],

  // Tiny tick: a barely-there high blip.
  click: [{ freq: 1200, type: 'square', start: 0, dur: 0.03, gain: 0.05 }],
};

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private failed = false; // AudioContext unavailable; stop trying.

  constructor() {
    this.muted = this.readMuted();
  }

  private readMuted(): boolean {
    try {
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      return false;
    }
  }

  // Lazily create the AudioContext on first use. Returns null if unavailable.
  private ensureCtx(): AudioContext | null {
    if (this.ctx || this.failed) return this.ctx;
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.failed = true;
        return null;
      }
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    } catch {
      this.failed = true;
      this.ctx = null;
      this.master = null;
    }
    return this.ctx;
  }

  // Call from a user-gesture handler. Browsers start the context suspended
  // until a gesture occurs; this resumes it so subsequent sounds are audible.
  resume(): void {
    try {
      const ctx = this.ensureCtx();
      if (ctx && ctx.state === 'suspended') void ctx.resume();
    } catch {
      // ignore — audio just stays silent
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(b: boolean): void {
    this.muted = b;
    try {
      localStorage.setItem(MUTE_KEY, b ? '1' : '0');
    } catch {
      // storage may be unavailable; mute still applies for the session
    }
    if (this.master && this.ctx) {
      // Ramp to avoid clicks on toggle.
      try {
        const now = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setValueAtTime(this.master.gain.value, now);
        this.master.gain.linearRampToValueAtTime(b ? 0 : 1, now + 0.02);
      } catch {
        this.master.gain.value = b ? 0 : 1;
      }
    }
  }

  play(name: SoundName | string): void {
    if (this.muted) return;
    const recipe = RECIPES[name as SoundName];
    if (!recipe) return;
    let ctx: AudioContext | null;
    let master: GainNode | null;
    try {
      ctx = this.ensureCtx();
      master = this.master;
      if (!ctx || !master) return;
      // If still suspended (no gesture yet) there's nothing audible to do.
      if (ctx.state === 'suspended') return;
      const t0 = ctx.currentTime;
      for (const tone of recipe) this.scheduleTone(ctx, master, tone, t0);
    } catch {
      // Never let audio failures bubble into gameplay.
    }
  }

  private scheduleTone(ctx: AudioContext, dest: GainNode, tone: Tone, t0: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone.type;

    const start = t0 + tone.start;
    const end = start + tone.dur;

    osc.frequency.setValueAtTime(tone.freq, start);
    if (tone.freqTo != null) {
      osc.frequency.linearRampToValueAtTime(tone.freqTo, end);
    }

    // Quick attack, then exponential-ish decay to near-zero for a soft tail.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(tone.gain, start + Math.min(0.008, tone.dur * 0.4));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain);
    gain.connect(dest);

    osc.start(start);
    osc.stop(end + 0.02);
    // Free nodes once they've finished so they don't accumulate.
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // already disconnected
      }
    };
  }
}

export const sfx = new Sfx();
export type { SoundName };

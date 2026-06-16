let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function playTone(freq: number, type: OscillatorType, dur: number, vol = 0.3, attack = 0.01, decay = 0.1) {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(c.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime);
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(vol, c.currentTime + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + dur + decay);
}

export const Audio = {
  water() {
    playTone(800, "sine", 0.15, 0.2);
    setTimeout(() => playTone(600, "sine", 0.1, 0.15), 80);
  },
  plant() {
    playTone(300, "triangle", 0.2, 0.25);
    setTimeout(() => playTone(500, "triangle", 0.15, 0.2), 100);
  },
  harvest() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, "sine", 0.3, 0.4), i * 80));
  },
  sell() {
    [392, 494, 587, 784].forEach((f, i) => setTimeout(() => playTone(f, "triangle", 0.25, 0.35), i * 60));
  },
  buy() {
    playTone(440, "square", 0.1, 0.15);
    setTimeout(() => playTone(554, "square", 0.1, 0.2), 100);
  },
  error() {
    playTone(200, "sawtooth", 0.2, 0.3);
  },
  levelUp() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => playTone(f, "sine", 0.4, 0.5), i * 100));
  },
  nutrient() {
    playTone(660, "sine", 0.12, 0.2);
    setTimeout(() => playTone(880, "sine", 0.1, 0.15), 60);
  },
};

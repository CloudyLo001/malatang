/** Tiny synthesized sound effects; no audio files. */
let ctx: AudioContext | null = null;
let muted = false;

function audio(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, duration: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function noise(duration: number, gain: number, cutoff: number, delay = 0) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * duration), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const amp = ac.createGain();
  amp.gain.value = gain;
  src.connect(filter).connect(amp).connect(ac.destination);
  src.start(t);
}

export const sfx = {
  grab() {
    tone(2400, 0.05, 'triangle', 0.05);
    tone(3100, 0.04, 'triangle', 0.035, 0.035);
  },
  drop() {
    tone(190, 0.12, 'sine', 0.16, 0, 90);
    noise(0.09, 0.09, 900);
  },
  remove() {
    tone(420, 0.09, 'sine', 0.07, 0, 640);
  },
  click() {
    tone(660, 0.05, 'sine', 0.05);
  },
  tick() {
    tone(1500, 0.025, 'square', 0.015);
  },
  beep() {
    tone(1960, 0.12, 'square', 0.04);
  },
  receipt(good: boolean) {
    if (good) {
      [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.22, 'triangle', 0.07, i * 0.085));
    } else {
      tone(520, 0.2, 'triangle', 0.07);
      tone(392, 0.3, 'triangle', 0.07, 0.16);
    }
  },
  full() {
    tone(240, 0.12, 'square', 0.04);
    tone(200, 0.16, 'square', 0.04, 0.1);
  },
  toggleMute(): boolean {
    muted = !muted;
    return muted;
  },
};

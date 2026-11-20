// Синтезований ретро-звук: двигун, постріли, вибухи + чіптюн-саундтрек. Без жодного аудіофайлу.
export class Sound {
  constructor() { this.ctx = null; this.musicOn = true; this.sfxOn = true; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0.7; this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.mus = c.createGain(); this.mus.gain.value = 0.32; this.mus.connect(this.master);
    // шум
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // двигун
    this.eng = c.createGain(); this.eng.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 4;
    this.engLp = lp;
    this.o1 = c.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = c.createOscillator(); this.o2.type = 'square';
    this.o1.connect(lp); this.o2.connect(lp); lp.connect(this.eng); this.eng.connect(this.sfx);
    this.o1.start(); this.o2.start();
    this.startMusic();
  }

  setEngine(speed01, boosting, on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 42 + speed01 * 95 + (boosting ? 25 : 0);
    this.o1.frequency.setTargetAtTime(f, t, 0.08);
    this.o2.frequency.setTargetAtTime(f * 0.503, t, 0.08);
    this.engLp.frequency.setTargetAtTime(300 + speed01 * 1400 + (boosting ? 600 : 0), t, 0.1);
    this.eng.gain.setTargetAtTime(on && this.sfxOn ? 0.07 + speed01 * 0.05 : 0, t, 0.1);
  }

  noiseHit(dur, f0, f1, vol, type = 'lowpass', q = 1) {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.6 + Math.random() * 0.8;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  tone(type, f0, f1, dur, vol, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }

  play(name, vol = 1) {
    if (!this.ctx || !this.sfxOn || vol < 0.03) return;
    switch (name) {
      case 'mg': this.noiseHit(0.07, 3000, 600, 0.22 * vol, 'bandpass', 2); this.tone('square', 180, 60, 0.05, 0.05 * vol); break;
      case 'rocket': this.noiseHit(0.5, 600, 2500, 0.3 * vol, 'bandpass', 3); this.tone('sawtooth', 120, 400, 0.3, 0.06 * vol); break;
      case 'boom': this.noiseHit(0.9, 1800, 60, 0.9 * vol); this.tone('sine', 110, 30, 0.6, 0.7 * vol); break;
      case 'bigboom': this.noiseHit(1.6, 2400, 40, 1.0 * vol); this.tone('sine', 90, 22, 1.1, 0.9 * vol); this.tone('square', 60, 25, 0.5, 0.15 * vol); break;
      case 'hit': this.tone('square', 900 + Math.random() * 300, 300, 0.06, 0.08 * vol); this.noiseHit(0.05, 5000, 2000, 0.12 * vol, 'highpass'); break;
      case 'crash': this.noiseHit(0.35, 1200, 120, 0.6 * vol); this.tone('triangle', 140, 50, 0.25, 0.25 * vol); break;
      case 'pickup': [0, 0.06, 0.12].forEach((d, i) => this.tone('square', [660, 880, 1320][i], [660, 880, 1320][i], 0.08, 0.12 * vol, d)); break;
      case 'heal': [0, 0.08, 0.16].forEach((d, i) => this.tone('triangle', [440, 554, 659][i], [440, 554, 659][i], 0.12, 0.2 * vol, d)); break;
      case 'zap': this.tone('sawtooth', 2400, 80, 0.35, 0.18 * vol); this.noiseHit(0.3, 8000, 1500, 0.25 * vol, 'highpass'); break;
      case 'shock': this.tone('sine', 300, 30, 0.6, 0.5 * vol); this.noiseHit(0.5, 400, 60, 0.4 * vol); break;
      case 'mine': this.tone('square', 1200, 1200, 0.05, 0.08 * vol); this.tone('square', 900, 900, 0.05, 0.08 * vol, 0.08); break;
      case 'land': this.noiseHit(0.2, 500, 80, 0.4 * vol); break;
      case 'empty': this.tone('square', 200, 150, 0.06, 0.06 * vol); break;
      case 'kill': [0, 0.1, 0.2, 0.3].forEach((d, i) => this.tone('square', [523, 659, 784, 1046][i], [523, 659, 784, 1046][i], 0.1, 0.12 * vol, d)); break;
    }
  }

  // ---------------------------------------------------------------- музика: темний синтвейв у ля-мінорі
  startMusic() {
    const c = this.ctx;
    const bpm = 132, step = 60 / bpm / 4;
    const bass = [45, 45, 57, 45, 45, 45, 55, 45, 41, 41, 53, 41, 43, 43, 55, 47];
    const chords = [[57, 60, 64], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
    const lead = [69, 0, 72, 0, 76, 0, 74, 72, 69, 0, 67, 0, 69, 0, 0, 0, 65, 0, 69, 0, 72, 0, 71, 69, 67, 0, 71, 0, 74, 0, 72, 71];
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    let n = 0, next = c.currentTime + 0.1;
    const note = (type, f, t, dur, vol, cut = 2000) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f;
      const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = cut;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(flt); flt.connect(g); g.connect(this.mus); o.start(t); o.stop(t + dur + 0.05);
    };
    const drum = (t, kind) => {
      if (kind === 'k') {
        const o = c.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
        const g = c.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        o.connect(g); g.connect(this.mus); o.start(t); o.stop(t + 0.25);
      } else {
        const s = c.createBufferSource(); s.buffer = this.noise;
        const f = c.createBiquadFilter(); f.type = kind === 'h' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'h' ? 7000 : 1800;
        const g = c.createGain(); const v = kind === 'h' ? 0.12 : 0.45, d = kind === 'h' ? 0.04 : 0.16;
        g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
        s.connect(f); f.connect(g); g.connect(this.mus); s.start(t, Math.random()); s.stop(t + d + 0.02);
      }
    };
    const tick = () => {
      while (next < c.currentTime + 0.2) {
        const i = n % 16, bar = (n >> 4) % 4, phrase = (n >> 6) % 2;
        note('sawtooth', mtof(bass[i] - 12), next, step * 0.9, 0.28, 500 + (i % 4) * 150);
        if (i % 4 === 0) drum(next, 'k');
        if (i % 8 === 4) drum(next, 's');
        if (i % 2 === 1) drum(next, 'h');
        if (i % 4 === 2) chords[bar].forEach((m) => note('square', mtof(m), next, step * 1.6, 0.035, 1600));
        if (phrase === 1) { const l = lead[(n % 32)]; if (l) note('square', mtof(l), next, step * 1.8, 0.07, 3000); }
        next += step; n++;
      }
    };
    this.musTimer = setInterval(tick, 50);
  }
  setMusic(on) { this.musicOn = on; if (this.mus) this.mus.gain.value = on ? 0.32 : 0; }
  setSfx(on) { this.sfxOn = on; }
}

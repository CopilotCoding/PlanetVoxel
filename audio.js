export class Audio {
  constructor() {
    this._ctx = null;
    this._beltGainNode = null;
    this._beltPlaying = false;
    this._ready = false;
    this._initOnInteraction();
  }

  _initOnInteraction() {
    const init = () => {
      if (this._ready) return;
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._masterGain = this._ctx.createGain();
      this._masterGain.gain.value = 0.4;
      this._masterGain.connect(this._ctx.destination);
      this._setupBeltHum();
      this._ready = true;
      window.removeEventListener('click', init);
      window.removeEventListener('keydown', init);
    };
    window.addEventListener('click', init, { once: false });
    window.addEventListener('keydown', init, { once: false });
  }

  _setupBeltHum() {
    this._beltGainNode = this._ctx.createGain();
    this._beltGainNode.gain.value = 0;
    this._beltGainNode.connect(this._masterGain);
    const osc = this._ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const filter = this._ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    osc.connect(filter);
    filter.connect(this._beltGainNode);
    osc.start();
  }

  _tone(freq, type, duration, gainVal, detune = 0) {
    if (!this._ready) return;
    const ctx = this._ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    g.connect(this._masterGain);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(g);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }

  _noise(duration, gainVal, filterFreq = 2000) {
    if (!this._ready) return;
    const ctx = this._ctx;
    const bufSize = ctx.sampleRate * duration;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(this._masterGain);
    src.start();
  }

  playMine(material) {
    if (!this._ready) return;
    const matColors = { Rock: 180, 'Iron Ore': 220, 'Copper Ore': 280, Coal: 100, Titanium: 350, Quartz: 900, Gem: 1200, Xenonite: 800 };
    const freq = matColors[material] || 200;
    this._noise(0.12, 0.3, freq);
    this._tone(freq * 0.5, 'triangle', 0.08, 0.15);
  }

  playSell() {
    if (!this._ready) return;
    this._tone(523, 'sine', 0.15, 0.3);
    setTimeout(() => this._tone(784, 'sine', 0.2, 0.25), 80);
    setTimeout(() => this._tone(1046, 'sine', 0.3, 0.2), 160);
  }

  playAlert() {
    if (!this._ready) return;
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        this._tone(880, 'square', 0.1, 0.2);
        this._tone(1320, 'square', 0.1, 0.15, 1200);
      }, i * 200);
    }
  }

  playPlace() {
    if (!this._ready) return;
    this._tone(440, 'sine', 0.1, 0.3);
    this._tone(660, 'sine', 0.15, 0.2);
  }

  playJetpack(active) {
    if (!this._ready) return;
    if (active) {
      this._noise(0.05, 0.15, 400 + Math.random() * 200);
    }
  }

  setBeltHum(volume) {
    if (!this._ready || !this._beltGainNode) return;
    this._beltGainNode.gain.setTargetAtTime(volume * 0.08, this._ctx.currentTime, 0.3);
  }
}

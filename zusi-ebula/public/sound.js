// Nussy EBuLa – gemeinsame Gerätetöne für EBuLa (index.html) und Fahrpult (fahrpult.html).
// Eigene Tondateien aus sounds/sounds.json haben Vorrang; ohne Datei werden die Töne live synthetisiert:
// Schnappscheibe der Folientaste, Piezo-Summer (≈ 2,7 kHz Resonanz) und dumpfer Gehäuseanteil.
// opts() liefert die aktuellen Einstellungen: { sound, vol, meldeton, vibra, quiet }
'use strict';
window.EbulaSound = function EbulaSound(opts) {
  let ctx = null, out = null, noise = null, lastWarn = 0, lastInfo = 0;
  function init() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 6;
      out = ctx.createGain(); out.connect(comp); comp.connect(ctx.destination);
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    out.gain.value = opts().vol / 100;
    return ctx;
  }
  // Piezo: Rechteck durch Bandpass, weicher Ein-/Ausschwinger gegen Knacken
  function piezo(t, f, dur, lvl) {
    const o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = f;
    bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 5;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(lvl, t + 0.004);
    g.gain.setValueAtTime(lvl, t + dur - 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bp); bp.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }
  // Schnappscheibe: kurzer, gefilterter Rauschimpuls
  function snap(t, f, lvl, len) {
    const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = noise; n.playbackRate.value = 0.9 + Math.random() * 0.2;
    bp.type = 'bandpass'; bp.frequency.value = f * (0.94 + Math.random() * 0.12); bp.Q.value = 1.4;
    g.gain.setValueAtTime(lvl, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    n.connect(bp); bp.connect(g); g.connect(out);
    n.start(t, Math.random() * 0.05); n.stop(t + len + 0.01);
  }
  // Gehäuse: tiefer, schnell abklingender Anteil
  function body(t, f, lvl, len) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + len);
    g.gain.setValueAtTime(lvl, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + len + 0.01);
  }
  const P = {
    key: (t) => { snap(t, 3400, 0.55, 0.012); body(t, 210, 0.35, 0.03); piezo(t + 0.006, 2730, 0.05, 0.16); snap(t + 0.085, 2600, 0.16, 0.008); },
    ok: (t) => { piezo(t, 2730, 0.07, 0.15); piezo(t + 0.1, 3250, 0.13, 0.15); },
    err: (t) => { piezo(t, 1180, 0.13, 0.2); piezo(t + 0.18, 1180, 0.13, 0.2); },
    warn: (t) => { for (let i = 0; i < 3; i++) piezo(t + i * 0.24, 2300, 0.15, 0.18); },
    info: (t) => { piezo(t, 1800, 0.12, 0.13); piezo(t + 0.16, 2400, 0.2, 0.11); },
    on: (t) => { snap(t, 1800, 0.6, 0.02); body(t, 120, 0.5, 0.06); piezo(t + 0.2, 2000, 0.06, 0.13); piezo(t + 0.29, 2730, 0.14, 0.13); },
    off: (t) => { piezo(t, 2730, 0.06, 0.13); piezo(t + 0.09, 1700, 0.12, 0.13); snap(t + 0.24, 1600, 0.45, 0.02); },
  };
  // Eigene Tondateien: sounds/sounds.json ordnet den Tönen Dateien zu, z. B. { "key": "taste.wav" }.
  // XMLHttpRequest statt fetch, damit es auch in der App (file://) funktioniert.
  const custom = {};
  function get(url, type) {
    return new Promise((ok, fail) => {
      const x = new XMLHttpRequest();
      x.open('GET', url); x.responseType = type;
      x.onload = () => (x.status === 200 || (x.status === 0 && x.response) ? ok(x.response) : fail(new Error(url)));
      x.onerror = () => fail(new Error(url));
      x.send();
    });
  }
  function loadCustom() {
    get('sounds/sounds.json', 'json').then((map) => {
      for (const [n, file] of Object.entries(map || {})) {
        if (!P[n] || typeof file !== 'string') continue;
        get('sounds/' + encodeURIComponent(file), 'arraybuffer')
          .then((buf) => new Promise((ok, fail) => init().decodeAudioData(buf, ok, fail)))
          .then((b) => { custom[n] = { b, from: leadIn(b) }; })
          .catch(() => console.warn('EBuLa: Tondatei nicht lesbar:', file));
      }
    }).catch(() => { /* keine eigenen Töne – synthetisch */ });
  }
  // Stille am Dateianfang überspringen, damit der Ton ohne Verzögerung auf den Tastendruck folgt
  function leadIn(b) {
    const d = b.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > peak * 0.05) return Math.max(0, i / b.sampleRate - 0.002);
    return 0;
  }
  function sample(t, c) {
    const s = ctx.createBufferSource();
    s.buffer = c.b; s.connect(out); s.start(t, c.from);
  }
  loadCustom();
  function vibrate(ms) {
    if (!opts().vibra) return;
    try {
      if (window.NussyApp && window.NussyApp.vibrate) window.NussyApp.vibrate(String([].concat(ms)));
      else if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) { /* keine Vibration */ }
  }
  return {
    play(name) {
      const o = opts();
      if (name === 'key') vibrate(12);
      else if (name === 'err' || name === 'warn') vibrate(name === 'err' ? [40, 60, 40] : [60, 80, 60, 80, 60]);
      if (!o.sound || (name !== 'key' && !o.meldeton)) return;
      if (name === 'warn') { if (Date.now() - lastWarn < 10000) return; lastWarn = Date.now(); }
      if (name === 'info') { if (o.quiet || Date.now() - lastInfo < 2000) return; lastInfo = Date.now(); }
      try {
        init();
        const t = ctx.currentTime + 0.005;
        if (custom[name]) sample(t, custom[name]); else P[name](t);
      } catch (e) { /* kein Ton */ }
    },
    eigene: () => Object.keys(custom),
  };
};

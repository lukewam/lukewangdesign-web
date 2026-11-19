// UNDERTONE, Web build: the desktop build's sound, rebuilt where Unity's Web audio leaves it out.
//
// Unity's Web audio (BuildTools/lib/Audio.js, Unity 6000.3) has no AudioLowPassFilter or AudioReverbFilter, and pans and
// mixes a little differently from the desktop build. Every difference below was measured on the desktop build with
// UNDERTONE.exe -audiotest (AudioTest.cs, webtest/measure_effects.py; numbers in webtest/effects_desktop.md), and the
// same test run in the browser checks the reproduction (webtest/effects_web.md):
//
//   low-pass       AudioLowPassFilter is two RBJ two-pole low-passes in series at its cutoff and Q (24 dB per octave),
//                  within 0.3-1.6 dB of the desktop response. Not one two-pole, which is 20 dB off.
//   reverb         AudioReverbFilter (Underwater) is the measured response, convolved (underwater.f32: the wet part of a
//                  unit impulse, stereo, 48 kHz). It follows the low-pass, follows the source's volume (distance), and is
//                  not panned: a source hard right has its reverb on both sides.
//   end of a play  on desktop a source's filters stop with it: a 250 ms clip's reverb stops 6 ms after the clip ends.
//                  So each play's low-pass and reverb are cut at the end of its clip, or when it is stopped or replaced.
//   start          Play() ramps its first 64 samples up from 1/64; PlayScheduled() does not.
//   panning        equal power, decided only by the source's direction across the listener (the right component of
//                  the unit vector, whatever the elevation), on the measured curve, which is wider than Web Audio's.
//                  A stereo clip's channels sit spread/2 either side of the source; a mono clip with spread is the
//                  mean of the gains at those two edges (Sound.At uses 40, her voice 20). Web Audio has no spread, and
//                  folded stereo clips to mono (-3 dB on the generated sounds, which are stereo).
//   2D mono        desktop puts a mono 2D sound in the centre at -3 dB each side; a browser copies it to both at 0 dB.
//
// The game says which filters a play carries: WebAudio.Play in C# calls tag() just before Play()/PlayScheduled() and
// untag() just after, and Unity wires that play's nodes inside the call, so the first channel to connect in between is
// that play. Unity then pauses it and resumes it on a fresh source of the same buffer a moment later; that resume is
// recognised as the same play. Plays the game starts some other way (music, beds) carry nothing and get only the panning and mono fixes.
// If a future Unity wires things differently, sounds still play, only without these corrections.
(function () {
  "use strict";
  if (typeof AudioNode === "undefined" || typeof PannerNode === "undefined") return;
  // ?water=0 leaves Unity's Web audio as it is: for comparing against it in a test run on this computer
  var onThisComputer = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (onThisComputer && new URLSearchParams(location.search).get("water") === "0") return;

  // ---------------------------------------------------------------- measured on the desktop build
  var PAN_X = [0, 0.2588, 0.5, 0.7071, 0.8660, 0.9659, 1];          // right component of the direction
  var PAN_DEG = [45, 55.5, 65.7, 75.0, 82.8, 88.1, 90];             // equal-power angle: 0 hard left, 90 hard right
  var RAMP = 64;                                                    // samples of the Play() ramp, from 1/64
  var CUT_AFTER = 0.006;                                            // s after a clip ends, its effects stop
  var MONO_2D = Math.SQRT1_2;

  var connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect;
  var valueOf = Object.getOwnPropertyDescriptor(AudioParam.prototype, "value");
  var Src = typeof AudioBufferSourceNode !== "undefined" ? AudioBufferSourceNode.prototype : null;
  var stats = { plays: 0, filtered: 0, missed: 0, panned: 0 };
  var log = [], ids = 0, chains = 0, reverbs = 0, allChains = [], rvSpans = [];   // starts and stops, for checking from a test run (UNDERTONE_WATER.log())
  var DEBUG = onThisComputer && new URLSearchParams(location.search).get("waterdebug") === "1";
  // ?wateroff=pan,rv,lp: leave out parts, to find what costs the audio thread (test runs on this computer only)
  var OFF = (onThisComputer && new URLSearchParams(location.search).get("wateroff") || "").split(",");
  var pending = null;

  // ---------------------------------------------------------------- the measured reverb
  // fetched when the game makes its first sound context (index.html) or first needs it: a phone never loads the game
  var irData = null, irBuffers = new WeakMap(), irFetch = null;
  function prefetch(ctx) {
    if (!irFetch) irFetch = fetch("underwater.f32").then(function (r) { return r.ok ? r.arrayBuffer() : null; })
      .then(function (b) { if (b) irData = new Float32Array(b); }).catch(function () {});
    if (ctx) irFetch.then(function () { if (irData) tend(ctx); });   // convolvers ready before the game plays
    return irFetch;
  }
  function irFor(ctx) {
    if (!irData) { prefetch(); return null; }
    var b = irBuffers.get(ctx);
    if (b) return b;
    var n48 = irData.length / 2, ratio = ctx.sampleRate / 48000, n = Math.floor(n48 * ratio);
    b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = b.getChannelData(c);
      for (var i = 0; i < n; i++) {
        var p = i / ratio, k = Math.floor(p), f = p - k;
        var a = irData[2 * k + c] || 0, z = irData[2 * (k + 1) + c] || 0;
        d[i] = (a + (z - a) * f) / ratio;   // a unit impulse's response, kept at the same energy at any rate
      }
    }
    irBuffers.set(ctx, b);
    return b;
  }

  // ---------------------------------------------------------------- watching values Unity sets
  // Unity sets volumes and positions through AudioParam.value; a hook on the instance lets the page follow at once.
  function watch(param, fn) {
    if (!param || !valueOf) return;
    if (!param.__watch) {
      param.__watch = [];
      Object.defineProperty(param, "value", {
        configurable: true,
        get: function () { return valueOf.get.call(this); },
        set: function (v) { valueOf.set.call(this, v); for (var i = 0; i < this.__watch.length; i++) this.__watch[i](v); }
      });
    }
    param.__watch.push(fn);
  }
  function val(param, fallback) { return param ? valueOf.get.call(param) : (fallback || 0); }

  // ---------------------------------------------------------------- panning, on the desktop curve
  var pans = new Set(), listenersWatched = new WeakSet(), panIds = 0;
  function angle(x) {
    var ax = Math.min(1, Math.abs(x)), i = 1;
    while (i < PAN_X.length - 1 && PAN_X[i] < ax) i++;
    var k = (ax - PAN_X[i - 1]) / (PAN_X[i] - PAN_X[i - 1]);
    var deg = PAN_DEG[i - 1] + (PAN_DEG[i] - PAN_DEG[i - 1]) * Math.max(0, Math.min(1, k));
    return (x < 0 ? 90 - deg : deg) * Math.PI / 180;
  }
  function place(p, now) {
    var ctx = p.ctx, l = ctx.listener, q = p.panner;
    var px = val(q.positionX, q._x), py = val(q.positionY, q._y), pz = val(q.positionZ, q._z);
    var lx = val(l.positionX, l._positionX), ly = val(l.positionY, l._positionY), lz = val(l.positionZ, l._positionZ);
    var fx = val(l.forwardX, l._forwardX), fy = val(l.forwardY, l._forwardY), fz = l.forwardZ ? val(l.forwardZ) : (l._forwardZ === undefined ? -1 : l._forwardZ);
    var ux = val(l.upX, l._upX), uy = l.upY ? val(l.upY) : (l._upY === undefined ? 1 : l._upY), uz = val(l.upZ, l._upZ);
    // right = forward x up, as Web Audio takes it (Unity hands it a negated forward, so this is Unity's right); the
    // listener's front is Unity's forward, the negative of Web Audio's
    var rx = fy * uz - fz * uy, ry = fz * ux - fx * uz, rz = fx * uy - fy * ux, rl = Math.hypot(rx, ry, rz) || 1;
    var fl = Math.hypot(fx, fy, fz) || 1;
    var dx = px - lx, dy = py - ly, dz = pz - lz, dl = Math.hypot(dx, dy, dz);
    var side = dl > 1e-6 ? (dx * rx + dy * ry + dz * rz) / (rl * dl) : 0;
    var front = dl > 1e-6 ? -(dx * fx + dy * fy + dz * fz) / (fl * dl) : 1;
    // Spread (measured, webtest/effects_desktop.md): a stereo clip's left channel sits spread/2 to the left of the
    // source and its right channel spread/2 to the right, each panned on the curve; a mono clip with spread is the
    // average of the gains at those two edges. Only the right component of each direction decides the pan.
    var az = Math.atan2(side, front), flat = Math.hypot(side, front), half = (p.spread || 0) * Math.PI / 360;
    function gains(o) { var a = angle(Math.sin(az + o) * flat); return [Math.cos(a), Math.sin(a)]; }
    var g0, g1;
    if (p.channels >= 2) { g0 = gains(-half); g1 = gains(half); }
    else if (half > 0) { var e0 = gains(-half), e1 = gains(half); g0 = [(e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2]; g1 = [0, 0]; }
    else { g0 = gains(0); g1 = [0, 0]; }
    if (DEBUG && now && log.length < 4000) log.push({ ev: "place", t: ctx.currentTime, pan: p.id, spread: p.spread, channels: p.channels, side: +side.toFixed(3), front: +front.toFixed(3), g0: g0.map(function (v) { return +v.toFixed(3); }), g1: g1.map(function (v) { return +v.toFixed(3); }) });
    // only what changed: every automation event is work on the audio thread
    var g = [g0[0], g0[1], g1[0], g1[1]], last = p.last;
    if (!now && last && Math.abs(g[0] - last[0]) < 1e-4 && Math.abs(g[1] - last[1]) < 1e-4 && Math.abs(g[2] - last[2]) < 1e-4 && Math.abs(g[3] - last[3]) < 1e-4) return;
    p.last = g;
    var set = now ? function (param, v) { param.cancelScheduledValues(ctx.currentTime); param.setValueAtTime(v, ctx.currentTime); } : function (param, v) { param.setTargetAtTime(v, ctx.currentTime, 0.004); };
    set(p.l0.gain, g[0]); set(p.r0.gain, g[1]); set(p.l1.gain, g[2]); set(p.r1.gain, g[3]);
  }
  // Unity sets the listener's nine values and each source's three every frame: the pans are worked out once per task,
  // for the channels in use, not once per value per channel (a camera moving through a scene of many sounds made that
  // a thousand automation events a frame)
  var dirty = new Set(), flushing = false;
  function mark(p) {
    if (!p.active) return;
    dirty.add(p);
    if (!flushing) { flushing = true; Promise.resolve().then(flush); }
  }
  function markAll(ctx) { pans.forEach(function (q) { if (q.ctx === ctx) mark(q); }); }
  function flush() {
    flushing = false;
    var list = Array.from(dirty); dirty.clear();
    for (var i = 0; i < list.length; i++) { try { place(list[i]); } catch (e) { } }
  }
  function panFor(panner) {
    if (panner.__pan) return panner.__pan;
    var ctx = panner.context;
    // input channel 0 (left, or the mono) and 1 (right) each panned to both outputs
    var p = { ctx: ctx, panner: panner, input: ctx.createGain(), split: ctx.createChannelSplitter(2), output: ctx.createChannelMerger(2),
              l0: ctx.createGain(), r0: ctx.createGain(), l1: ctx.createGain(), r1: ctx.createGain(), channels: 1, spread: 0, id: ++panIds };
    p.input.channelCount = 2; p.input.channelCountMode = "explicit"; p.input.channelInterpretation = "discrete";
    connect.call(p.input, p.split);
    connect.call(p.split, p.l0, 0); connect.call(p.split, p.r0, 0);
    connect.call(p.split, p.l1, 1); connect.call(p.split, p.r1, 1);
    connect.call(p.l0, p.output, 0, 0); connect.call(p.l1, p.output, 0, 0);
    connect.call(p.r0, p.output, 0, 1); connect.call(p.r1, p.output, 0, 1);
    panner.__pan = p; pans.add(p);
    ["positionX", "positionY", "positionZ"].forEach(function (k) { watch(panner[k], function () { mark(p); }); });
    if (!listenersWatched.has(ctx.listener)) {
      listenersWatched.add(ctx.listener);
      ["positionX", "positionY", "positionZ", "forwardX", "forwardY", "forwardZ", "upX", "upY", "upZ"].forEach(function (k) {
        watch(ctx.listener[k], function () { markAll(ctx); });
      });
    }
    return p;
  }
  // browsers without position AudioParams (Firefox's listener) take setPosition()/setOrientation(): follow those calls
  ["setPosition", "setOrientation"].forEach(function (m) {
    var L = typeof AudioListener !== "undefined" && AudioListener.prototype[m];
    if (L) AudioListener.prototype[m] = function () { var r = L.apply(this, arguments); var self = this; pans.forEach(function (q) { if (q.ctx.listener === self) mark(q); }); return r; };
  });
  var setPos = PannerNode.prototype.setPosition;
  if (setPos) PannerNode.prototype.setPosition = function () { var r = setPos.apply(this, arguments); if (this.__pan) mark(this.__pan); return r; };

  // ---------------------------------------------------------------- a channel's effects
  function lowpass(ctx) { var f = ctx.createBiquadFilter(); f.type = "lowpass"; return f; }
  function chainFor(gain) {
    if (gain.__chain) return gain.__chain;
    var ctx = gain.context;
    var c = { id: ++chains, ctx: ctx, comp: ctx.createGain(), lp1: lowpass(ctx), lp2: lowpass(ctx), cut: ctx.createGain(), rv: null };
    if (DEBUG) ["setValueAtTime", "linearRampToValueAtTime", "cancelScheduledValues"].forEach(function (m) {
      var f = c.cut.gain[m];
      c.cut.gain[m] = function () { if (log.length < 4000) log.push({ ev: m, ch: c.id, t: ctx.currentTime, a: Array.from(arguments) }); return f.apply(this, arguments); };
    });
    c.comp.gain.value = MONO_2D;
    connect.call(c.cut, ctx.destination);
    gain.__chain = c; allChains.push(c);
    return c;
  }
  function reverbFor(c) {
    if (c.rv) return c.rv;
    var ctx = c.ctx, ir = irFor(ctx);
    if (!ir) return null;
    // input: always stereo (a mono 2D sound is spread to both sides, as the desktop centres it); mono: (L+R)/sqrt 2
    var r = { input: ctx.createGain(), mono: ctx.createGain(), lp1: lowpass(ctx), lp2: lowpass(ctx), conv: null };
    r.input.channelCount = 2; r.input.channelCountMode = "explicit"; r.input.channelInterpretation = "speakers";
    r.mono.channelCount = 1; r.mono.channelCountMode = "explicit"; r.mono.channelInterpretation = "speakers";
    r.mono.gain.value = Math.SQRT2;   // the speakers down-mix is (L+R)/2
    connect.call(r.input, r.mono);
    c.rv = r; reverbs++;
    return r;
  }

  // A voice's convolver works only while the voice sounds. Chrome runs a convolver on for its whole response (1.76 s)
  // after its input falls silent, but the desktop cuts a voice's reverb 6 ms after its clip, so all that work went
  // into a closed gate: in WHITE MAT (footsteps of 0.2 s, two or three a second) up to 29 convolvers ran at once for at
  // most 6 voices heard, and the sound crackled (webtest: 425 underruns a minute; 8 convolvers is safe on a fast
  // desktop, 16 is not). So each play takes a clean convolver, gives it up at its cut (disconnected, it is no longer
  // run), and it is emptied (its response set again, ~7 ms) in idle time for a later play. A voice played again while
  // it still sounds keeps its convolver, so its tail runs on into the new play as on desktop.
  // Never made during a play: Unity reads its clock, calls in here, then starts the sound at the time it read, so
  // every millisecond spent here is cut off the front of the sound (a first convolver took 61 ms and swallowed a
  // click). The pool is filled while the page loads (prefetch) and topped up between frames, one at a time: a task of
  // its own can never fall inside a play.
  // At most CAP voices have convolvers of their own (fewer if Chrome reports the audio thread late); a burst beyond
  // that (WHITE MAT's footsteps reach 15), or one that empties the pool, shares one whose tail is not cut at the
  // clip's end, the only difference.
  var pools = new WeakMap(), convs = 0, convsLate = 0, sharedPlays = 0, SPARE = 8, CAP = 8;
  var idle = typeof requestIdleCallback === "function"
    ? function (f) { requestIdleCallback(f, { timeout: 50 }); }
    : function (f) { setTimeout(f, 20); };
  function poolFor(ctx) {
    var p = pools.get(ctx);
    if (!p) { p = { clean: [], dirty: [], busy: false, live: 0, shared: null, cap: CAP, capAt: 0, u: undefined }; pools.set(ctx, p); }
    return p;
  }
  function capFor(ctx) {
    var p = poolFor(ctx), st = ctx.playbackStats, now = ctx.currentTime;
    if (st && typeof st.underrunEvents === "number") {
      if (p.u !== undefined && st.underrunEvents > p.u + 1 && now - p.capAt > 2) { p.cap = Math.max(3, p.cap - 1); p.capAt = now; }
      else if (now - p.capAt > 20 && p.cap < CAP) { p.cap++; p.capAt = now; }
      p.u = st.underrunEvents;
    }
    return p.cap;
  }
  function makeConv(ctx) { var cv = ctx.createConvolver(); cv.normalize = false; cv.buffer = irFor(ctx); convs++; return cv; }
  function empty(cv) { cv.buffer = null; cv.buffer = irFor(cv.context); return cv; }   // a new response starts it empty
  function tend(ctx) {
    var p = poolFor(ctx);
    if (p.busy || (p.shared && !p.dirty.length && p.clean.length >= SPARE)) return;
    p.busy = true;
    idle(function (d) {
      p.busy = false;
      try {   // never an error out of here: Unity's page takes any uncaught error as the game failing
        if (!irFor(ctx)) return;
        // one at a time (each is a few ms), more while the page has idle time left
        do {
          if (!p.shared) { p.shared = makeConv(ctx); connect.call(p.shared, ctx.destination); }
          else if (p.dirty.length) p.clean.push(empty(p.dirty.pop()));
          else if (p.clean.length < SPARE) p.clean.push(makeConv(ctx));
          else break;
        } while (d && !d.didTimeout && d.timeRemaining() > 10);
      } catch (e) { return; }
      tend(ctx);
    });
  }
  function retire(c) {
    var r = c.rv, cv = r && r.conv;
    if (!cv) return;
    [r.mono, r.lp1, r.lp2].forEach(function (n) { disconnect.call(n); });
    r.conv = null;
    if (r.shared) { r.shared = false; return; }   // the shared one runs on for the others
    disconnect.call(cv);
    var p = poolFor(c.ctx);
    p.live--; p.dirty.push(cv);
    tend(c.ctx);
  }
  // A convolver is only ever given its response while it is out of the graph: set on a connected one, Chrome
  // reconfigures it on the audio thread (60-86 underruns a minute in WHITE MAT when the pool ran dry that way).
  function convFor(c) {
    var r = c.rv, p = poolFor(c.ctx);
    tend(c.ctx);
    if (p.live < capFor(c.ctx) && p.clean.length) { r.conv = p.clean.pop(); r.shared = false; p.live++; connect.call(r.conv, c.cut); return true; }
    if (!p.clean.length) convsLate++;
    if (DEBUG && p.live >= p.cap && log.length < 4000) log.push({ ev: "capped", t: c.ctx.currentTime, ch: c.id, live: p.live, holders: allChains.filter(function (h) { return h.rv && h.rv.conv && !h.rv.shared; })
      .map(function (h) { return { ch: h.id, left: +(h.activeUntil - h.ctx.currentTime).toFixed(3), rvOn: !!h.rvOn, loop: !!(h.src && h.src.loop), active: !!h.active }; }) });
    if (p.shared) { r.conv = p.shared; r.shared = true; sharedPlays++; return true; }
    return false;   // the moment between the response arriving and the first convolver: this play has no reverb
  }
  // at the voice's cut (set in Src.start / Src.stop below), unless it has been played again by then
  function retireAtCut(c) {
    var r = c.rv;
    if (!r || !r.conv || !isFinite(c.activeUntil)) return;
    var cv = r.conv, wait = Math.max(0, c.activeUntil - c.ctx.currentTime) * 1000 + 50;
    setTimeout(function () {
      try {
        if (r.conv !== cv) return;                                    // already given up (played again afresh)
        if (c.activeUntil <= c.ctx.currentTime || !c.rvOn) retire(c);  // its play is over, or the voice plays on dry (a loop)
        else if (isFinite(c.activeUntil)) setTimeout(function () { retireAtCut(c); }, 250);   // played again, or the clock paused
      } catch (e) { }
    }, wait);
  }
  // Unity's low-pass, fitted (webtest/effects_desktop.md): whatever lowpassResonanceQ the game sets in 0.8..1, each of
  // the two stages behaves as RBJ Q 0.815 at 0.992 of the cutoff (0.23-0.26 dB from the desktop response). Above 1 it
  // was not measured; it is scaled from there. Web Audio's low-pass Q is in dB.
  var LP_Q = 0.815, LP_F = 0.992;
  function q(qLinear) { return 20 * Math.log10(LP_Q * Math.max(1, qLinear)); }
  function fc(cutoff) { return cutoff * LP_F; }

  /// Wires one tagged play:  gain -> [mono fix] -> [low-pass x2] -> cut -> speakers
  ///                         (the same, panned) -> mono (L+R)/sqrt 2 -> [low-pass x2] -> reverb -> cut
  /// The reverb is fed what the desktop feeds it: the panned, distance-attenuated sound folded to mono, so a source to
  /// one side reaches it 3 dB down (measured: hard right, wet -3 dB against centred) and its output is not panned.
  function route(gain, tag, mono2d) {
    var c = chainFor(gain);
    [c.comp, c.lp1, c.lp2].forEach(function (n) { disconnect.call(n); });
    var head = c.cut;
    if (tag.cutoff > 0 && OFF.indexOf("lp") < 0) {
      c.lp1.frequency.value = c.lp2.frequency.value = fc(tag.cutoff);
      c.lp1.Q.value = c.lp2.Q.value = q(tag.q);
      connect.call(c.lp1, c.lp2); connect.call(c.lp2, c.cut);
      head = c.lp1;
    }
    var out = gain;                                   // this play as the desktop would have it, before its filters
    if (mono2d) { connect.call(c.comp, head); head = c.comp; out = c.comp; }
    connect.call(gain, head);
    var src = gain.__src;
    // a play without reverb on a voice whose last play is over: its convolver goes back now
    if (!(tag.reverb >= 0 && OFF.indexOf("rv") < 0) && c.rv && c.rv.conv && !(c.activeUntil > c.ctx.currentTime)) retire(c);
    if (tag.reverb >= 0 && OFF.indexOf("rv") < 0) {
      var r = reverbFor(c);
      if (r) {
        if (r.conv && !(c.activeUntil > c.ctx.currentTime)) retire(c);   // the voice is silent: its old tail must not sound
        if (!r.conv && !convFor(c)) r = null;
      }
      if (r) {
        [r.mono, r.lp1, r.lp2].forEach(function (n) { disconnect.call(n); });
        var rhead = r.conv;
        if (tag.cutoff > 0) {
          r.lp1.frequency.value = r.lp2.frequency.value = fc(tag.cutoff);
          r.lp1.Q.value = r.lp2.Q.value = q(tag.q);
          connect.call(r.lp1, r.lp2); connect.call(r.lp2, r.conv);
          rhead = r.lp1;
        }
        connect.call(r.mono, rhead);
        connect.call(out, r.input);
      }
    }
    if (src) { src.__chain = c; src.__ramp = !tag.scheduled; }
    gain.__spread = tag.spread || 0;
    c.src = src; c.active = true; c.rvOn = tag.reverb >= 0 && !!c.rv;
    // A media-element source (Firefox, Safari play long compressed clips this way) has its own start and stop, which
    // the hooks below never see: open its gate now and close it on its own stop. (The game's filtered clips are
    // decoded on load in the Web build, so this is a fallback.)
    if (src && !(Src && src instanceof AudioBufferSourceNode) && !src.__mediaGate) {
      src.__mediaGate = true;
      var g = c.cut.gain, at = c.ctx.currentTime;
      g.cancelScheduledValues(at); g.setValueAtTime(1, at); c.activeUntil = Infinity;
      var own = src.stop;
      if (typeof own === "function") src.stop = function (when) {
        if (c.src === src) { var t = Math.max(when || 0, c.ctx.currentTime); g.cancelScheduledValues(t); g.setValueAtTime(0, t); c.activeUntil = t; c.src = null; retireAtCut(c); }
        return own.apply(this, arguments);
      };
    }
  }

  // The game's audio clock (AudioSettings.dspTime) runs about 93 ms ahead of the browser's (currentTime) and, read from
  // the game, wobbles by up to 8 ms from call to call (webtest: water_log.json). One steady offset, followed very slowly,
  // maps a time asked for on one to the other, so the distances between scheduled plays come out as the game set them.
  var offsets = new WeakMap();
  function clock(ctx, at, dspNow) {
    var seen = ctx.currentTime - dspNow, k = offsets.get(ctx);
    if (k === undefined || Math.abs(seen - k) > 0.05) k = seen;   // first time, or the clocks jumped (a pause)
    else k += (seen - k) * 0.002;   // under a sample per call: the distances stay exact once on the sample grid
    offsets.set(ctx, k);
    return at + k;
  }

  // a play's start and end: the ramp, and the cut that ends its effects with it
  if (Src) {
    var start = Src.start, stop = Src.stop;
    Src.start = function (when, offset) {
      var c = this.__chain, self = this, ramp = this.__ramp;
      if (c) {
        var at = c.ctx.currentTime;
        if (this.__resume) {
          // Unity's Web audio pauses every play right after starting it and resumes it on a new source a moment
          // later, re-deriving the start from its coarse clock. A resume before the play was due starts it exactly
          // when it was due; a resume of a play already under way continues it, without a second ramp.
          // (it can resume more than once before the play is due: every one of them is held to the time)
          if (c.fresh && c.when0 > at + 0.0005) { when = c.when0; offset = c.offset0; }
          else { c.fresh = false; if ((offset || 0) > (RAMP / c.ctx.sampleRate)) ramp = false; }
        } else {
          // a PlayScheduled(): placed by the game's own clock on the browser's (see clock()), so plays keep the exact
          // distances the game gave them (measured before this: 403.3 and 794.3 ms for 400 and 800)
          if (pending && pending.at > 0) when = clock(c.ctx, pending.at, pending.dspNow);
          c.when0 = Math.max(when || 0, at); c.offset0 = offset || 0; c.fresh = true;
          // On desktop a voice's filters run while it is playing or waiting to play. Played again before it has
          // finished, its dry sound stops at once (as here) but its reverb runs on into the new play (measured: the
          // tail of a voice rescheduled mid-clip carries on to the new start). Her creak does this when its clicks
          // outrun her twelve voices.
          c.carry = c.activeUntil > at;
          c.activeUntil = Infinity;
        }
      }
      if (c) {
        // on the sample grid, as the desktop mixer starts: a start between samples is interpolated, which smears a
        // click over two samples and dulls its top (measured: -1.4 dB on an impulse, up to -6 dB at 16 kHz)
        var sr = c.ctx.sampleRate;
        if (when) when = Math.round(when * sr) / sr;
        if (offset) offset = Math.round(offset * sr) / sr;
      }
      var r = c ? start.call(this, when, offset) : start.apply(this, arguments);
      if (c) {
        if (!this.__id) this.__id = ++ids;
        if (log.length < 2000) log.push({ ev: "start", id: this.__id, t: c.ctx.currentTime, when: when, offset: offset || 0, resume: !!this.__resume, carry: !!c.carry, ramp: !!ramp, fresh: !!c.fresh, ch: c.id });
        var now = c.ctx.currentTime, t0 = Math.max(when || 0, now), g = c.cut.gain;
        g.cancelScheduledValues(now);
        if (c.carry) g.setValueAtTime(1, now);                 // the voice was still sounding: its tail runs on
        else {
          g.setValueAtTime(0, now);                            // an idle voice: nothing of it until the play starts
          if (ramp) { g.setValueAtTime(1 / RAMP, t0); g.linearRampToValueAtTime(1, t0 + (RAMP - 1) / c.ctx.sampleRate); }
          else g.setValueAtTime(1, t0);
        }
        var off = offset || 0;
        Promise.resolve().then(function () {                   // after Unity has set the pitch
          if (c.src !== self) return;
          if (self.loop || !self.buffer) { c.activeUntil = Infinity; return; }
          var rate = self.playbackRate.value || 1;
          c.activeUntil = t0 + Math.max(0, self.buffer.duration - off) / rate + CUT_AFTER;
          g.setValueAtTime(0, c.activeUntil);
          retireAtCut(c);
          if (DEBUG && c.rvOn && rvSpans.length < 5000) rvSpans.push([+t0.toFixed(3), +c.activeUntil.toFixed(3), c.id, !!c.carry]);
        });
      }
      return r;
    };
    Src.stop = function (when) {
      var c = this.__chain;
      if (c && log.length < 2000) log.push({ ev: "stop", id: this.__id, t: c.ctx.currentTime, when: when || 0, current: c.src === this, pending: !!pending, fresh: !!c.fresh, ch: c.id });
      // Unity stops a voice's old source just before giving it a new play (inside the tagged call): the new play
      // decides what its effects do. It also stops every new play a moment after starting it (the pause before the
      // resume, before the play is due): that is not an end either. Any other stop ends the voice's effects, and the
      // voice is no longer anyone's, so a later play does not carry its cut tail on.
      var dance = pending || (c && c.fresh && c.ctx.currentTime < c.when0 + 0.1);
      if (c && c.src === this && !dance) {
        var t = Math.max(when || 0, c.ctx.currentTime);
        c.cut.gain.cancelScheduledValues(t);
        c.cut.gain.setValueAtTime(0, t);
        c.activeUntil = t;
        c.src = null; c.fresh = false;
        retireAtCut(c);
      }
      return stop.apply(this, arguments);
    };
  }

  // ---------------------------------------------------------------- following Unity's wiring (configurePanningNodes)
  //   3D: source -> dry -> gain;  source -> wet -> panner -> gain;  gain -> destination
  //   2D: source -> gain -> destination
  function isSource(n) {
    return (typeof AudioScheduledSourceNode !== "undefined" && n instanceof AudioScheduledSourceNode) ||
      (typeof MediaElementAudioSourceNode !== "undefined" && n instanceof MediaElementAudioSourceNode);
  }

  AudioNode.prototype.connect = function (target) {
    if (isSource(this) && target instanceof GainNode) {
      target.__src = this;
      if (pending && !pending.source) pending.source = this;
      // the play's spread rides on its source: Unity may rewire it as 3D after the call (a channel that last played
      // 2D gets its spatial blend on the next audio update), when the tag is gone
      if (pending) this.__spread = pending.spread || 0;
    } else if (this instanceof GainNode && target instanceof PannerNode && OFF.indexOf("pan") < 0) {
      // the spatial path goes through the desktop's panning instead of Web Audio's
      var p = panFor(target);
      p.gain = null;
      p.input.__src = this.__src;
      var sb = this.__src && this.__src.buffer;
      // a media-element source (Firefox, Safari: long compressed clips) has no buffer to ask: taking it as stereo
      // keeps both channels of a stereo clip, and a mono one only loses the averaging of its spread
      p.channels = sb ? sb.numberOfChannels : 2;
      p.active = true;
      if (this.__src && this.__src.__spread !== undefined) p.spread = this.__src.__spread;
      else if (pending) p.spread = pending.spread || 0;
      if (DEBUG && log.length < 4000) log.push({ ev: "wet->panner", t: p.ctx.currentTime, pan: p.id, pending: pending ? pending.spread : null, srcSpread: this.__src ? this.__src.__spread : "nosrc", spread: p.spread, channels: p.channels });
      place(p, true);
      stats.panned++;
      return connect.call(this, p.input);
    } else if (this instanceof PannerNode && target instanceof GainNode && OFF.indexOf("pan") < 0) {
      var pp = panFor(this);
      target.__3d = true; target.__src = target.__src || pp.input.__src; pp.gain = target;
      // rewired as 3D after its call (it was wired 2D at first, as the channel's last play was): the spread its play
      // was tagged with is kept on the channel
      if (!pending && target.__spread !== undefined && pp.spread !== target.__spread) { pp.spread = target.__spread; place(pp, true); }
      return connect.call(pp.output, target);
    } else if (this instanceof GainNode && target instanceof GainNode && this.__src) {
      // the dry part of a partly spatial sound: a mono one is centred at -3 dB on desktop
      target.__src = this.__src;
      var b = this.__src.buffer;
      if (b && b.numberOfChannels === 1) {
        if (!this.__comp) { this.__comp = this.context.createGain(); this.__comp.gain.value = MONO_2D; connect.call(this.__comp, target); }
        return connect.call(this, this.__comp);
      }
    } else if (target instanceof AudioDestinationNode && this instanceof GainNode && (this.__src || pending)) {
      stats.plays++;
      var src = this.__src, buf = src && src.buffer;
      var mono2d = !this.__3d && buf && buf.numberOfChannels === 1;
      var tag = pending;
      if (tag) {
        tag.used = true;
        if (tag.cutoff > 0 || tag.reverb >= 0) stats.filtered++;
        route(this, tag, mono2d);
        return;
      }
      var c = this.__chain;
      // the same play, rewired: keep its effects. Either its spatial blend changed (same source), or Unity resumed it:
      // Unity's Web audio starts every play paused and unpauses it on its next audio update (JS_Sound_SetPaused ->
      // channel.resume), which replaces the source with a new one on the same buffer; that new source is the one heard.
      if (c && c.active && src && c.src && (c.src === src || (src.buffer && src.buffer === c.src.buffer))) {
        if (c.src !== src) src.__resume = true;
        route(this, c.lastTag || { cutoff: 0, q: 1, reverb: -1, scheduled: 1 }, mono2d);
        return;
      }
      if (c) c.active = false;
      if (mono2d) {
        if (!this.__comp2d) { this.__comp2d = this.context.createGain(); this.__comp2d.gain.value = MONO_2D; connect.call(this.__comp2d, target); }
        return connect.call(this, this.__comp2d);
      }
    }
    return connect.apply(this, arguments);
  };

  AudioNode.prototype.disconnect = function () {
    if (this instanceof PannerNode && this.__pan && arguments.length === 0) {
      var p = this.__pan;
      disconnect.call(p.output);
      if (p.gain) p.gain.__3d = false;
      p.active = false; dirty.delete(p);   // out of the per-frame panning until a play wires it again
      return disconnect.apply(this, arguments);
    }
    return disconnect.apply(this, arguments);
  };

  // remember each play's tag on its chain, so a rewiring of the same play keeps it
  var routeTagged = route;
  route = function (gain, tag, mono2d) { routeTagged(gain, tag, mono2d); gain.__chain.lastTag = tag; };

  window.UNDERTONE_WATER = {
    tag: function (cutoff, qv, reverb, at, dspNow, spread) { pending = { cutoff: cutoff, q: qv, reverb: reverb, scheduled: at > 0, at: at, dspNow: dspNow, spread: spread || 0, used: false }; },
    untag: function () { if (pending && !pending.used) stats.missed++; pending = null; },
    rvSpans: function () { return rvSpans; },
    stats: function () { var s = JSON.parse(JSON.stringify(stats)); s.chains = chains; s.pans = pans.size; s.reverbs = reverbs; s.log = log.length;
      var live = allChains.filter(function (c) { return c.rvOn && c.activeUntil > c.ctx.currentTime; });
      s.liveReverbs = live.length; s.liveLoopReverbs = live.filter(function (c) { return c.activeUntil === Infinity; }).length;
      s.convs = convs; s.convsLate = convsLate; s.sharedPlays = sharedPlays;
      s.liveConvs = allChains.filter(function (c) { return c.rv && c.rv.conv && !c.rv.shared; }).length;
      var p0 = allChains.length ? pools.get(allChains[0].ctx) : null; s.cap = p0 ? p0.cap : CAP;
      var live = 0; pans.forEach(function (p) { if (p.active) live++; }); s.activePans = live; return s; },
    log: function () { return log.slice(); },
    prefetch: prefetch
  };
  // a play that missed its filters is worth one line in the console, once per new miss
  var reported = 0;
  setInterval(function () { if (stats.missed > reported) { reported = stats.missed; console.log("[water] " + JSON.stringify(stats)); } }, 30000);
})();

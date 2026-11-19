// UNDERTONE, Web build, test runs only: records the page's final mix, as UNDERTONE.exe -audiotap records the listener.
// Active only when the page was opened with ?args=...-audiotap <file>... and ?capture=http://127.0.0.1:<port>
// (webtest/run.mjs). Everything that would reach the speakers goes through one bus into a recorder instead, so a test
// run is silent, like the desktop tap. The game starts and stops it (AudioTap in Sound.cs -> Capture.jslib), so both
// builds record the same stretch. The samples are posted in order as raw interleaved stereo 32-bit floats.
// The recorder is an AudioWorklet, on the audio thread: a ScriptProcessor on the main thread lost 2.1 s of 95 while the
// game ran, which looked like sounds going missing. It fills one buffer at a time and hands it over whole (transferred,
// not copied). Its own output, all the speakers get, is not quite zero (1e-20, far below hearing): Chrome takes 30 s of
// exact zeros as an idle page and swaps the sound card for a timer, which in a headless (windowless) Chrome on Windows
// ticks too slowly, so from 30 s into a test run the audio clock ran at 0.67-0.79 of real time and the recording came
// out squeezed, with steps missing (webtest/run.mjs prints the "audio clock" rate).
// Must load before water.js, so the water's own connections are recorded.
(function () {
  "use strict";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;   // test runs are on this computer only
  var q = new URLSearchParams(location.search);
  var capture = q.get("capture");
  // ?tapall=<file>: record everything from the start, whatever the game asks (to compare any chapter)
  var all = q.get("tapall");
  if (!all && !/(^|\s)-audiotap(\s|$)/.test(q.get("args") || "")) return;
  if (!capture || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(capture)) return;
  if (typeof AudioNode === "undefined" || typeof AudioWorkletNode === "undefined") return;

  var processor =
    "class Rec extends AudioWorkletProcessor {" +
    "  constructor() { super(); this.on = false; this.size = 24576; this.buf = new Float32Array(this.size * 2); this.n = 0;" +
    "    this.port.onmessage = (e) => { if (e.data === 'start') { this.on = true; this.n = 0; }" +
    "      else if (e.data === 'stop') { this.on = false; this.send(true); } }; }" +
    "  send(done) { var b = this.buf, n = this.n; this.buf = new Float32Array(this.size * 2); this.n = 0;" +
    "    this.port.postMessage({ chunk: b, frames: n, done: done }, [b.buffer]); }" +
    "  process(inputs, outputs) {" +
    "    var q = outputs[0]; for (var c = 0; c < q.length; c++) q[c].fill(1e-20);" +
    "    if (!this.on) return true;" +
    "    var i = inputs[0], l = i && i[0], r = i && (i[1] || i[0]), n = l ? l.length : 128, b = this.buf, o = this.n * 2;" +
    "    if (l) { for (var k = 0; k < n; k++) { b[o + 2 * k] = l[k]; b[o + 2 * k + 1] = r[k]; } } else b.fill(0, o, o + 2 * n);" +
    "    this.n += n;" +
    "    if (this.n + 128 > this.size) this.send(false);" +
    "    return true; } }" +
    "registerProcessor('ut-rec', Rec);";
  var moduleUrl = URL.createObjectURL(new Blob([processor], { type: "application/javascript" }));

  var connect = AudioNode.prototype.connect;
  var buses = new WeakMap();
  var recording = null, startedAt = 0, recorded = 0, chain = Promise.resolve(), rec = null, ctxOf = null;

  function post(chunk) {
    if (!chunk.length || !recording) return;
    recorded += chunk.length / 2;
    var url = capture + "/save?append=1&path=" + encodeURIComponent(recording);
    window.UNDERTONE_PENDING = (window.UNDERTONE_PENDING || 0) + 1;
    chain = chain.then(function () { return fetch(url, { method: "POST", body: chunk }); })
      .catch(function (e) { console.log("[capture] tap failed " + e); })
      .then(function () { window.UNDERTONE_PENDING--; });
  }

  function bus(ctx) {
    var b = buses.get(ctx);
    if (b) return b;
    var master = ctx.createGain();
    master.channelCount = 2; master.channelCountMode = "explicit"; master.channelInterpretation = "speakers";
    b = { master: master };
    buses.set(ctx, b);
    ctxOf = ctx;
    ctx.audioWorklet.addModule(moduleUrl).then(function () {
      rec = new AudioWorkletNode(ctx, "ut-rec", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      rec.port.onmessage = function (e) {
        post(e.data.chunk.subarray(0, e.data.frames * 2));
        if (e.data.done) {
          console.log("[tap] web stop " + recording + " clock " + (ctx.currentTime - startedAt).toFixed(3) + " s, recorded " + (recorded / ctx.sampleRate).toFixed(3) + " s");
          recording = null;
        }
      };
      connect.call(master, rec);
      connect.call(rec, ctx.destination);   // its output is silence: nothing reaches the speakers
      if (all && !recording) { recording = all; startedAt = ctx.currentTime; console.log("[tap] web start " + all + " rate " + ctx.sampleRate); }
      if (recording) rec.port.postMessage("start");
    }).catch(function (e) { console.log("[tap] recorder failed " + e); });
    return b;
  }

  AudioNode.prototype.connect = function (target) {
    if (target instanceof AudioDestinationNode) return connect.call(this, bus(target.context).master);
    return connect.apply(this, arguments);
  };

  window.UNDERTONE_TAP = {
    start: function (path) {
      if (all) return;   // already recording everything
      recording = path; recorded = 0;
      startedAt = ctxOf ? ctxOf.currentTime : 0;
      if (rec) rec.port.postMessage("start");
      console.log("[tap] web start " + path + " rate " + (ctxOf ? ctxOf.sampleRate : "?"));
    },
    stop: function (force) {
      if (all && !force) return;   // the driver ends it
      if (rec) rec.port.postMessage("stop");
      else recording = null;
    }
  };
})();

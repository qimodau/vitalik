/**
 * rnnoise-processor.js
 * AudioWorklet для шумоподавления через RNNoise (WebAssembly).
 * Положи этот файл рядом с index.html в репозитории.
 *
 * Также нужен файл rnnoise.wasm — скачай командой:
 *   npx --yes @jitsi/rnnoise-wasm cp rnnoise.wasm .
 * или вручную с:
 *   https://github.com/jitsi/rnnoise-wasm/raw/main/dist/rnnoise.wasm
 */

const FRAME = 480; // RNNoise всегда 480 сэмплов = 10мс при 48kHz

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ready = false;
    this._exp = null;
    this._st = null;
    this._inPtr = null;
    this._outPtr = null;
    this._inputBuf = [];
    this._outputBuf = [];

    this.port.onmessage = (e) => {
      if (e.data.type === 'init') this._initWasm(e.data.wasmBuffer);
    };
  }

  async _initWasm(wasmBuffer) {
    try {
      const mem = new WebAssembly.Memory({ initial: 256, maximum: 512 });
      const { instance } = await WebAssembly.instantiate(wasmBuffer, {
        env: {
          memory: mem,
          table: new WebAssembly.Table({ initial: 0, element: 'anyfunc' }),
          abort: () => {},
          __assert_fail: () => {},
          emscripten_resize_heap: () => 0,
        },
        wasi_snapshot_preview1: { proc_exit: () => {} }
      });

      this._exp = instance.exports;
      this._st     = this._exp.rnnoise_create(0);
      this._inPtr  = this._exp.malloc(FRAME * 4);
      this._outPtr = this._exp.malloc(FRAME * 4);
      this._ready  = true;
      this.port.postMessage({ type: 'ready', success: true });
    } catch(e) {
      console.error('[RNNoise processor] init error:', e);
      this.port.postMessage({ type: 'ready', success: false, error: String(e) });
    }
  }

  _denoise(inputF32) {
    const heap = new Float32Array(this._exp.memory.buffer);
    const inOff  = this._inPtr  / 4;
    const outOff = this._outPtr / 4;

    // RNNoise хочет float в диапазоне int16 (-32768..32768)
    for (let i = 0; i < FRAME; i++) heap[inOff + i] = inputF32[i] * 32768;
    this._exp.rnnoise_process_frame(this._st, this._outPtr, this._inPtr);
    const out = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i++) out[i] = heap[outOff + i] / 32768;
    return out;
  }

  process(inputs, outputs) {
    const inCh  = inputs[0]?.[0];
    const outCh = outputs[0]?.[0];
    if (!inCh || !outCh) return true;

    if (!this._ready) { outCh.set(inCh); return true; }

    for (let i = 0; i < inCh.length; i++) this._inputBuf.push(inCh[i]);

    while (this._inputBuf.length >= FRAME) {
      const frame = new Float32Array(this._inputBuf.splice(0, FRAME));
      const out   = this._denoise(frame);
      for (let i = 0; i < out.length; i++) this._outputBuf.push(out[i]);
    }

    for (let i = 0; i < outCh.length; i++) {
      outCh[i] = this._outputBuf.length > 0 ? this._outputBuf.shift() : 0;
    }

    return true;
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);

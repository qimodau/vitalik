// rnnoise-processor.js — кладёшь рядом с index.html и rnnoise-sync.js

const FRAME = 480;

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ready  = false;
    this._mod    = null;
    this._st     = 0;
    this._inPtr  = 0;
    this._outPtr = 0;
    this._inBuf  = new Float32Array(FRAME);
    this._outBuf = new Float32Array(FRAME);
    this._inPos  = 0;
    this._outPos = 0;
    this._outN   = 0;
    this._warmup = true; // первые фреймы пропускаем без обработки

    this.port.onmessage = async ({ data }) => {
      if (data.type !== 'init') return;
      try {
        await this._load(data.syncJsText);
        this.port.postMessage({ type: 'ready', success: true });
      } catch (e) {
        this.port.postMessage({ type: 'ready', success: false, error: String(e) });
      }
    };
  }

  async _load(syncJsText) {
    // Убираем import.meta и export чтобы работало через new Function
    const cleaned = syncJsText
      .replace(/var _scriptDir\s*=\s*import\.meta\.url\s*;?\s*/g, 'var _scriptDir = "";')
      .replace(/export\s+default\s+\S+\s*;?/g, '')
      .replace(/export\s*\{[^}]*\}\s*;?/g, '');

    const fn = new Function(cleaned + '\nreturn createRNNWasmModuleSync;');
    const factory = fn();
    const mod = factory();

    this._mod    = mod;
    this._st     = mod._rnnoise_create(0);
    this._inPtr  = mod._malloc(FRAME * 4);
    this._outPtr = mod._malloc(FRAME * 4);
    this._ready  = true;
    this._warmup = false;
  }

  _denoise() {
    const mod  = this._mod;
    const heap = mod.HEAPF32;
    const inB  = this._inPtr  >> 2;
    const outB = this._outPtr >> 2;
    for (let i = 0; i < FRAME; i++) heap[inB + i] = this._inBuf[i] * 32768;
    mod._rnnoise_process_frame(this._st, this._outPtr, this._inPtr);
    for (let i = 0; i < FRAME; i++) this._outBuf[i] = heap[outB + i] / 32768;
    this._outPos = 0;
    this._outN   = FRAME;
    this._inPos  = 0;
  }

  process(inputs, outputs) {
    const inp = inputs[0]?.[0];
    const out = outputs[0]?.[0];
    if (!inp || !out) return true;

    // Пока не готовы — пропускаем звук без обработки (без роботизации)
    if (!this._ready) {
      out.set(inp);
      return true;
    }

    let i = 0;
    while (i < out.length) {
      if (this._outN > 0) {
        const take = Math.min(out.length - i, this._outN);
        out.set(this._outBuf.subarray(this._outPos, this._outPos + take), i);
        this._outPos += take;
        this._outN   -= take;
        i            += take;
        continue;
      }
      const copy = Math.min(FRAME - this._inPos, inp.length - i);
      this._inBuf.set(inp.subarray(i, i + copy), this._inPos);
      this._inPos += copy;
      i           += copy;
      if (this._inPos === FRAME) {
        this._denoise();
      } else {
        // Буфер не заполнен — отдаём входной звук как есть
        out.set(inp.subarray(i - copy, i), i - copy);
        break;
      }
    }
    return true;
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);

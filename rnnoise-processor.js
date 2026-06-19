// rnnoise-processor.js
// Кладёшь рядом с index.html + rnnoise.wasm + rnnoise.js
// Оба файла: github.com/jitsi/rnnoise-wasm → ветка master → папка dist/

const FRAME = 480;

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ready  = false;
    this._mod    = null;
    this._st     = 0;
    this._inPtr  = 0;
    this._outPtr = 0;

    this._inBuf  = new Float32Array(FRAME);  // накапливаем входные сэмплы
    this._outBuf = new Float32Array(FRAME);  // храним обработанные
    this._inPos  = 0;  // сколько накоплено во входном
    this._outPos = 0;  // сколько уже прочитано из выходного
    this._outN   = 0;  // сколько готово в выходном

    this.port.onmessage = async ({ data }) => {
      if (data.type !== 'init') return;
      try {
        await this._load(data.wasmBuffer);
        this.port.postMessage({ type: 'ready', success: true });
      } catch (e) {
        this.port.postMessage({ type: 'ready', success: false, error: String(e) });
      }
    };
  }

  async _load(wasmBuf) {
    importScripts('./rnnoise.js');
    const mod = await new Promise((res, rej) =>
      createRNNWasmModule({ wasmBinary: wasmBuf })['ready'].then(res).catch(rej)
    );
    mod._rnnoise_init();
    this._st     = mod._rnnoise_create(0);
    this._inPtr  = mod._malloc(FRAME * 4);
    this._outPtr = mod._malloc(FRAME * 4);
    this._mod    = mod;
    this._ready  = true;
  }

  _denoise() {
    const heap = this._mod.HEAPF32;
    const inB  = this._inPtr  >> 2;
    const outB = this._outPtr >> 2;
    for (let i = 0; i < FRAME; i++) heap[inB + i] = this._inBuf[i] * 32768;
    this._mod._rnnoise_process_frame(this._st, this._outPtr, this._inPtr);
    for (let i = 0; i < FRAME; i++) this._outBuf[i] = heap[outB + i] / 32768;
    this._outPos = 0;
    this._outN   = FRAME;
    this._inPos  = 0;
  }

  process(inputs, outputs) {
    const inp = inputs[0]?.[0];
    const out = outputs[0]?.[0];
    if (!inp || !out) return true;

    if (!this._ready) { out.set(inp); return true; }

    let i = 0; // позиция в inp/out (оба всегда 128)

    while (i < out.length) {
      // Сначала отдаём всё что уже обработано
      if (this._outN > 0) {
        const take = Math.min(out.length - i, this._outN);
        out.set(this._outBuf.subarray(this._outPos, this._outPos + take), i);
        this._outPos += take;
        this._outN   -= take;
        i            += take;
        continue;
      }

      // Выходной буфер пуст — накапливаем входные до FRAME
      const need = FRAME - this._inPos;
      const have = inp.length - i;
      const copy = Math.min(need, have);
      this._inBuf.set(inp.subarray(i, i + copy), this._inPos);
      this._inPos += copy;
      i           += copy;

      if (this._inPos === FRAME) {
        this._denoise(); // готово — обрабатываем и кладём в outBuf
      } else {
        // Входных не хватило до 480 — тишина на остаток выходного
        out.fill(0, i);
        break;
      }
    }

    return true;
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);

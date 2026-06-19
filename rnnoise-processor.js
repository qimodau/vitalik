// rnnoise-processor.js
// Нужен только этот файл + rnnoise-sync.js рядом с index.html
// rnnoise-sync.js: https://raw.githubusercontent.com/jitsi/rnnoise-wasm/master/dist/rnnoise-sync.js

import createRNNWasmModuleSync from './rnnoise-sync.js';

const FRAME = 480;

// Инициализируем синхронно на старте модуля
const mod = createRNNWasmModuleSync();
const st      = mod._rnnoise_create(0);
const inPtr   = mod._malloc(FRAME * 4);
const outPtr  = mod._malloc(FRAME * 4);

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._inBuf  = new Float32Array(FRAME);
    this._outBuf = new Float32Array(FRAME);
    this._inPos  = 0;
    this._outPos = 0;
    this._outN   = 0;
  }

  _denoise() {
    const heap = mod.HEAPF32;
    const inB  = inPtr  >> 2;
    const outB = outPtr >> 2;
    for (let i = 0; i < FRAME; i++) heap[inB + i] = this._inBuf[i] * 32768;
    mod._rnnoise_process_frame(st, outPtr, inPtr);
    for (let i = 0; i < FRAME; i++) this._outBuf[i] = heap[outB + i] / 32768;
    this._outPos = 0;
    this._outN   = FRAME;
    this._inPos  = 0;
  }

  process(inputs, outputs) {
    const inp = inputs[0]?.[0];
    const out = outputs[0]?.[0];
    if (!inp || !out) return true;

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
        out.fill(0, i);
        break;
      }
    }
    return true;
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);

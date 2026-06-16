// rnnoise-processor.js – AudioWorklet‑процессор для шумоподавления
import createRNNWasmModule from './rnnoise.js';

class RnnoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ready = false;
    this._init();
  }

  async _init() {
    try {
      const wasm = await createRNNWasmModule();
      this._wasm = wasm;
      this._rnnoise_create = wasm._rnnoise_create;
      this._rnnoise_process_frame = wasm._rnnoise_process_frame;
      this._rnnoise_destroy = wasm._rnnoise_destroy;
      this._context = this._rnnoise_create();
      this._buffer = new Float32Array(480);
      this._ready = true;
    } catch (e) {
      console.error('Failed to init RNNoise', e);
    }
  }

  process(inputs, outputs) {
    if (!this._ready) return true;
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    for (let i = 0; i < input[0].length; i += 480) {
      const frame = input[0].subarray(i, i + 480);
      if (frame.length < 480) break;
      this._buffer.set(frame);
      this._rnnoise_process_frame(this._context, this._buffer, this._buffer);
      const outFrame = output[0].subarray(i, i + 480);
      outFrame.set(this._buffer);
    }
    return true;
  }
}

registerProcessor('rnnoise-processor', RnnoiseProcessor);

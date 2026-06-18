/**
 * rnnoise-processor.js
 * AudioWorklet для шумоподавления через RNNoise.
 */

const FRAME = 480; // 10 мс при 48 кГц

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._ready = false;
    this._state = null;
    this._module = null;
    this._inputBuf = [];
    this._outputBuf = [];
    this._inputPtr = null;
    this._outputPtr = null;

    const { wasmBinary, scriptBase } = (options && options.processorOptions) || {};
    if (!wasmBinary || !scriptBase) {
      console.error('[RNNoise processor] wasmBinary или scriptBase не переданы');
      return;
    }

    // Используем динамический import() — работает в module и classic воркерах
    import(scriptBase + 'rnnoise.js').then((mod) => {
      const factory = mod.default || mod;
      return factory({ wasmBinary });
    }).then((rnModule) => {
      this._module = rnModule;
      this._inputPtr  = rnModule._malloc(FRAME * 4);
      this._outputPtr = rnModule._malloc(FRAME * 4);
      this._state = rnModule._rnnoise_create(0);
      this._ready = true;
    }).catch((e) => {
      console.error('[RNNoise processor] ошибка инициализации:', e);
    });
  }

  _denoise(inputF32) {
    const mod = this._module;
    mod.HEAPF32.set(inputF32, this._inputPtr >> 2);
    mod._rnnoise_process_frame(this._state, this._outputPtr, this._inputPtr);
    return mod.HEAPF32.slice(this._outputPtr >> 2, (this._outputPtr >> 2) + FRAME);
  }

  process(inputs, outputs) {
    const inCh  = inputs[0]?.[0];
    const outCh = outputs[0]?.[0];
    if (!inCh || !outCh) return true;

    if (!this._ready) {
      outCh.set(inCh);
      return true;
    }

    for (let i = 0; i < inCh.length; i++) this._inputBuf.push(inCh[i]);

    while (this._inputBuf.length >= FRAME) {
      const frame = new Float32Array(this._inputBuf.splice(0, FRAME));
      const denoised = this._denoise(frame);
      for (let i = 0; i < denoised.length; i++) this._outputBuf.push(denoised[i]);
    }

    for (let i = 0; i < outCh.length; i++) {
      outCh[i] = this._outputBuf.length > 0 ? this._outputBuf.shift() : 0;
    }

    return true;
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);

/**
 * rnnoise-processor.js
 * AudioWorklet для шумоподавления через RNNoise.
 * Использует статический импорт локального модуля rnnoise.js.
 */
import RNNoiseModule from './rnnoise.js';

const FRAME = 480; // 10 мс при 48 кГц

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ready = false;
    this._state = null;
    this._inputBuf = [];
    this._outputBuf = [];

    try {
      // RNNoise экспортирует фабричную функцию. Вызываем её.
      const rnnoise = typeof RNNoiseModule === 'function' 
        ? RNNoiseModule() 
        : RNNoiseModule.default ? RNNoiseModule.default() : RNNoiseModule;
      
      if (typeof rnnoise.createState !== 'function') {
        throw new Error('createState not found in RNNoise API');
      }
      this._state = rnnoise.createState();
      this._ready = true;
    } catch (e) {
      console.error('[RNNoise processor] конструктор ошибка:', e);
    }
  }

  _denoise(inputF32) {
    const out = new Float32Array(FRAME);
    this._state.processFrame(inputF32, out);
    return out;
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

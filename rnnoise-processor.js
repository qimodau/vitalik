/**
 * rnnoise-processor.js
 * AudioWorklet для шумоподавления через RNNoise.
 * Получает wasmBinary из processorOptions (передаётся из основного потока).
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
    if (!wasmBinary) {
      console.error('[RNNoise processor] wasmBinary не передан в processorOptions');
      return;
    }

    try {
      // Импортируем rnnoise.js — используем абсолютный URL переданный из основного потока
      importScripts(scriptBase + 'rnnoise.js');
    } catch (e) {
      console.error('[RNNoise processor] не удалось загрузить rnnoise.js:', e);
      return;
    }

    // createRNNWasmModule — глобальная функция после importScripts
    if (typeof createRNNWasmModule !== 'function') {
      console.error('[RNNoise processor] createRNNWasmModule не найдена');
      return;
    }

    createRNNWasmModule({
      wasmBinary: wasmBinary,
      // Говорим модулю не искать .wasm файл — он уже передан
      locateFile: (path) => path,
    }).ready.then((mod) => {
      this._module = mod;

      // Выделяем буферы в WASM heap
      this._inputPtr  = mod._malloc(FRAME * 4); // Float32 = 4 байта
      this._outputPtr = mod._malloc(FRAME * 4);

      // Создаём состояние RNNoise
      this._state = mod._rnnoise_create(0);

      this._ready = true;
    }).catch((e) => {
      console.error('[RNNoise processor] ошибка инициализации WASM:', e);
    });
  }

  _denoise(inputF32) {
    const mod = this._module;
    // Копируем float32 в WASM heap
    mod.HEAPF32.set(inputF32, this._inputPtr >> 2);
    // Обрабатываем кадр
    mod._rnnoise_process_frame(this._state, this._outputPtr, this._inputPtr);
    // Читаем результат
    return mod.HEAPF32.slice(this._outputPtr >> 2, (this._outputPtr >> 2) + FRAME);
  }

  process(inputs, outputs) {
    const inCh  = inputs[0]?.[0];
    const outCh = outputs[0]?.[0];
    if (!inCh || !outCh) return true;

    if (!this._ready) {
      outCh.set(inCh); // пока не готово — пропускаем без обработки
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

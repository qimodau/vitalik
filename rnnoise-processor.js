/**
 * rnnoise-processor.js
 * AudioWorklet для шумоподавления через RNNoise.
 */

const FRAME = 480; // 10 мс при 48 кГц

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._ready = false;
    this._module = null;
    this._inputBuf = [];
    this._outputBuf = [];
    this._inputPtr = null;
    this._outputPtr = null;

    const { wasmBinary } = (options && options.processorOptions) || {};
    if (!wasmBinary) {
      console.error('[RNNoise processor] wasmBinary не передан');
      return;
    }

    // Импорты, которые ожидает скомпилированный WASM (соответствуют asmLibraryArg из rnnoise.js)
    const importObject = {
      a: {
        // _emscripten_resize_heap
        a: (requestedSize) => {
          const oldSize = this._module.memory.buffer.byteLength;
          requestedSize = requestedSize >>> 0;
          const maxHeapSize = 2147483648; // 2 ГБ
          if (requestedSize > maxHeapSize) return 0;
          const alignUp = (x, multiple) => x + (multiple - x % multiple) % multiple;
          for (let cutDown = 1; cutDown <= 4; cutDown *= 2) {
            let overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
            overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
            let newSize = Math.min(maxHeapSize, alignUp(Math.max(requestedSize, overGrownHeapSize), 65536));
            let pages = Math.ceil((newSize - oldSize) / 65536);
            if (pages > 0) {
              try {
                this._module.memory.grow(pages);
                return 1;
              } catch (e) {}
            }
          }
          return 0;
        },
        // _emscripten_memcpy_big
        b: (dest, src, num) => {
          const heapU8 = new Uint8Array(this._module.memory.buffer);
          heapU8.copyWithin(dest, src, src + num);
        }
      }
    };

    // Загружаем WASM с правильными импортами
    WebAssembly.instantiate(wasmBinary, importObject)
      .then((result) => {
        const exports = result.instance.exports;
        this._module = exports;
        this._inputPtr = exports._malloc(FRAME * 4);
        this._outputPtr = exports._malloc(FRAME * 4);
        this._state = exports._rnnoise_create(0);
        this._ready = true;
        console.log('[RNNoise processor] WASM загружен и готов');
      })
      .catch((e) => {
        console.error('[RNNoise processor] ошибка инициализации WASM:', e);
        this._ready = false;
      });
  }

  _denoise(inputF32) {
    const mod = this._module;
    const heapF32 = new Float32Array(mod.memory.buffer);
    heapF32.set(inputF32, this._inputPtr >> 2);
    mod._rnnoise_process_frame(this._state, this._outputPtr, this._inputPtr);
    return new Float32Array(mod.memory.buffer, this._outputPtr, FRAME);
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

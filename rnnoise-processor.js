// rnnoise-processor.js – AudioWorklet‑процессор для шумоподавления
const RNNOISE_SAMPLE_LENGTH = 480;

class RnnoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ready = false;
    this._context = null;
    this._buffer = new Float32Array(RNNOISE_SAMPLE_LENGTH);

    this.port.onmessage = (event) => {
      if (event.data.type === 'wasm') {
        const funcs = event.data.functions;
        this._rnnoise_create = funcs._rnnoise_create;
        this._rnnoise_process_frame = funcs._rnnoise_process_frame;
        this._rnnoise_destroy = funcs._rnnoise_destroy;
        this._context = this._rnnoise_create();
        this._ready = true;
        console.log('✅ RNNoise ready inside AudioWorklet');
      }
    };
  }

  process(inputs, outputs) {
    if (!this._ready || !inputs[0] || !inputs[0][0]) return true;
    const input = inputs[0][0];
    const output = outputs[0][0];
    if (input.length === 0) return true;

    for (let i = 0; i < input.length; i += RNNOISE_SAMPLE_LENGTH) {
      const frame = input.subarray(i, i + RNNOISE_SAMPLE_LENGTH);
      if (frame.length < RNNOISE_SAMPLE_LENGTH) break;
      this._buffer.set(frame);
      this._rnnoise_process_frame(this._context, this._buffer, this._buffer);
      output.set(this._buffer, i);
    }
    return true;
  }
}

registerProcessor('rnnoise-processor', RnnoiseProcessor);

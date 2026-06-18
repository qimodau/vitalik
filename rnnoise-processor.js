        // Пробуем загрузить RNNoise через статический импорт в AudioWorklet
        let rnnoiseLoaded = false;
        try {
          // Регистрируем процессор (он сам импортирует rnnoise.js)
          await ctx.audioWorklet.addModule('./rnnoise-processor.js');
          const rnNode = new AudioWorkletNode(ctx, 'rnnoise-processor');

          // ВАЖНО: больше не отправляем postMessage и не ждём инициализации,
          // потому что процессор инициализируется в конструкторе.
          // Сразу подключаем.
          src.connect(rnNode);
          rnNode.connect(compressor);
          compressor.connect(dest);
          rnnoiseLoaded = true;
          console.log('RNNoise загружен ✓ (статический импорт)');
        } catch(rnErr) {
          console.warn('RNNoise недоступен, fallback на noise gate:', rnErr.message);
        }

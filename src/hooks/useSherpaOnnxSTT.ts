import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * sherpa-onnx WASM STT hook
 * 
 * 从 HuggingFace 加载 sherpa-onnx 的 WASM 构建（Zipformer 中英文模型），
 * 在浏览器端离线运行流式语音识别。
 * 
 * 作为 Web Speech API 不可用时的 fallback（如华为鸿蒙手机无 Google 服务）。
 * 
 * 模型文件约 199MB（含 encoder/decoder/joiner），首次加载需下载，
 * 浏览器会自动缓存（HTTP cache）。
 */

interface UseSherpaOnnxSTTOptions {
  language?: string;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
}

// HuggingFace Space base URL for sherpa-onnx zh-en WASM files
const HF_BASE_URL = 'https://huggingface.co/spaces/k2-fsa/web-assembly-asr-sherpa-onnx-zh-en/resolve/main';

// Singleton state for the WASM module & recognizer (shared across hook instances)
let moduleLoadPromise: Promise<any> | null = null;
let sherpaModule: any = null;
let sherpaRecognizer: any = null;
let loadError: string | null = null;

/**
 * Dynamically load a script from a URL
 */
function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if already loaded
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
    document.head.appendChild(script);
  });
}

/**
 * Initialize the sherpa-onnx WASM module and create the recognizer.
 * This is called once and cached.
 */
async function initSherpaOnnx(
  onProgress?: (status: string) => void,
): Promise<{ module: any; recognizer: any }> {
  if (sherpaModule && sherpaRecognizer) {
    return { module: sherpaModule, recognizer: sherpaRecognizer };
  }
  if (loadError) {
    throw new Error(loadError);
  }
  if (moduleLoadPromise) {
    return moduleLoadPromise;
  }

  moduleLoadPromise = (async () => {
    try {
      onProgress?.('正在加载语音识别引擎...');

      // 1. Set up global Module before loading the emscripten JS
      const win = window as any;
      win.Module = win.Module || {};
      
      // locateFile: redirect .data and .wasm fetches to HuggingFace
      win.Module.locateFile = (path: string, _scriptDir: string) => {
        console.log(`[SherpaOnnx] locateFile: ${path}`);
        return `${HF_BASE_URL}/${path}`;
      };

      // setStatus: track download progress
      win.Module.setStatus = (status: string) => {
        console.log(`[SherpaOnnx] Status: ${status}`);
        if (status) {
          // Parse download progress
          const match = status.match(/Downloading data\.\.\. \((\d+)\/(\d+)\)/);
          if (match) {
            const downloaded = Number(match[1]);
            const total = Number(match[2]);
            const pct = total > 0 ? ((downloaded / total) * 100).toFixed(1) : '0';
            onProgress?.(`正在下载语音模型... ${pct}%`);
          } else if (status.includes('Running')) {
            onProgress?.('模型下载完成，正在初始化...');
          }
        }
      };

      // Wrap onRuntimeInitialized as a promise
      const runtimeReady = new Promise<void>((resolve) => {
        const origOnInit = win.Module.onRuntimeInitialized;
        win.Module.onRuntimeInitialized = () => {
          console.log('[SherpaOnnx] Runtime initialized');
          origOnInit?.();
          resolve();
        };
      });

      // 2. Load the sherpa-onnx-asr.js (contains createOnlineRecognizer, OnlineRecognizer, etc.)
      await loadScript(`${HF_BASE_URL}/sherpa-onnx-asr.js`);
      console.log('[SherpaOnnx] sherpa-onnx-asr.js loaded');

      // 3. Load the emscripten glue JS (this triggers .data and .wasm download)
      await loadScript(`${HF_BASE_URL}/sherpa-onnx-wasm-main-asr.js`);
      console.log('[SherpaOnnx] WASM glue JS loaded, waiting for runtime...');

      // 4. Wait for runtime initialization (model download + WASM compilation)
      await runtimeReady;

      // 5. Create the online recognizer
      sherpaModule = win.Module;
      const createOnlineRecognizer = (win as any).createOnlineRecognizer;
      if (!createOnlineRecognizer) {
        throw new Error('createOnlineRecognizer not found - sherpa-onnx-asr.js may not have loaded correctly');
      }
      
      sherpaRecognizer = createOnlineRecognizer(sherpaModule);
      console.log('[SherpaOnnx] Recognizer created successfully');
      onProgress?.('语音模型已就绪');

      return { module: sherpaModule, recognizer: sherpaRecognizer };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      loadError = errMsg;
      moduleLoadPromise = null;
      console.error('[SherpaOnnx] Init failed:', err);
      throw err;
    }
  })();

  return moduleLoadPromise;
}

/**
 * Downsample audio buffer from source sample rate to target sample rate.
 * Copied from sherpa-onnx demo.
 */
function downsampleBuffer(
  buffer: Float32Array,
  recordSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (targetSampleRate === recordSampleRate) {
    return buffer;
  }
  const ratio = recordSampleRate / targetSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

export function useSherpaOnnxSTT({
  language = 'zh-CN',
  onResult,
  onError,
}: UseSherpaOnnxSTTOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported] = useState(true); // WASM is supported in all modern browsers
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [isModelReady, setIsModelReady] = useState(!!sherpaRecognizer);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');

  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderNodeRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const recognizerStreamRef = useRef<any>(null);
  const recognizerRef = useRef<any>(null);
  const shouldRestartRef = useRef(false);
  const lastResultRef = useRef('');

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Check if model is already loaded on mount
  useEffect(() => {
    if (sherpaRecognizer) {
      setIsModelReady(true);
    }
  }, []);

  /**
   * Load the sherpa-onnx model (can be called explicitly or auto-called on startListening)
   */
  const loadModel = useCallback(async () => {
    if (sherpaRecognizer) {
      setIsModelReady(true);
      return true;
    }
    if (isModelLoading) return false;

    setIsModelLoading(true);
    try {
      const { recognizer } = await initSherpaOnnx((status) => {
        setLoadingStatus(status);
      });
      recognizerRef.current = recognizer;
      setIsModelReady(true);
      setLoadingStatus('');
      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '模型加载失败';
      onErrorRef.current?.(errMsg);
      setLoadingStatus('');
      return false;
    } finally {
      setIsModelLoading(false);
    }
  }, [isModelLoading]);

  /**
   * Process audio data from microphone
   */
  const processAudio = useCallback((event: AudioProcessingEvent) => {
    const recognizer = recognizerRef.current;
    if (!recognizer) return;

    const inputData = event.inputBuffer.getChannelData(0);
    const sampleRate = audioContextRef.current?.sampleRate || 48000;
    const targetSampleRate = 16000;

    // Downsample to 16kHz
    let samples = downsampleBuffer(new Float32Array(inputData), sampleRate, targetSampleRate);

    // Create stream if needed
    if (!recognizerStreamRef.current) {
      recognizerStreamRef.current = recognizer.createStream();
    }

    const stream = recognizerStreamRef.current;

    // Feed audio to recognizer
    stream.acceptWaveform(targetSampleRate, samples);

    // Decode
    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
    }

    // Check for endpoint (sentence boundary)
    const isEndpoint = recognizer.isEndpoint(stream);

    // Get current result
    let result = recognizer.getResult(stream).text;

    // For paraformer models, add tail paddings
    if (recognizer.config?.modelConfig?.paraformer?.encoder) {
      const tailPaddings = new Float32Array(targetSampleRate);
      stream.acceptWaveform(targetSampleRate, tailPaddings);
      while (recognizer.isReady(stream)) {
        recognizer.decode(stream);
      }
      result = recognizer.getResult(stream).text;
    }

    // Emit partial results
    if (result.length > 0 && lastResultRef.current !== result) {
      lastResultRef.current = result;
      setInterimTranscript(result);
      onResultRef.current?.(result, false);
    }

    // Emit final result on endpoint
    if (isEndpoint) {
      if (lastResultRef.current.length > 0) {
        console.log('[SherpaOnnx STT] Final result:', lastResultRef.current);
        onResultRef.current?.(lastResultRef.current, true);
        setInterimTranscript('');
        lastResultRef.current = '';
      }
      recognizer.reset(stream);
    }
  }, []);

  const startListening = useCallback(async () => {
    if (isListening) {
      console.log('[SherpaOnnx STT] Already listening');
      return false;
    }

    // Auto-load model if not ready
    if (!sherpaRecognizer) {
      const loaded = await loadModel();
      if (!loaded) return false;
    }

    recognizerRef.current = sherpaRecognizer;

    try {
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          sampleRate: 16000,
        },
        video: false,
      });
      mediaStreamRef.current = stream;

      // Create AudioContext
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;

      const recordSampleRate = audioCtx.sampleRate;
      console.log('[SherpaOnnx STT] Audio sample rate:', recordSampleRate);

      // Create media stream source
      const source = audioCtx.createMediaStreamSource(stream);
      mediaStreamSourceRef.current = source;

      // Create ScriptProcessorNode for audio capture
      const bufferSize = 4096;
      const recorder = audioCtx.createScriptProcessor(bufferSize, 1, 1);
      recorderNodeRef.current = recorder;

      // Reset state
      lastResultRef.current = '';
      recognizerStreamRef.current = null;

      // Set up audio processing
      recorder.onaudioprocess = processAudio;

      // Connect audio graph
      source.connect(recorder);
      recorder.connect(audioCtx.destination);

      shouldRestartRef.current = true;
      setIsListening(true);
      setInterimTranscript('');
      console.log('[SherpaOnnx STT] Started listening');
      return true;
    } catch (err) {
      console.error('[SherpaOnnx STT] Failed to start:', err);
      const errMsg = err instanceof Error ? err.message : '启动语音识别失败';
      onErrorRef.current?.(errMsg);
      return false;
    }
  }, [isListening, loadModel, processAudio]);

  const stopListening = useCallback(() => {
    shouldRestartRef.current = false;
    if (!isListening) return;

    console.log('[SherpaOnnx STT] Stopping...');

    // Disconnect audio graph
    try {
      if (recorderNodeRef.current && audioContextRef.current) {
        recorderNodeRef.current.disconnect();
        mediaStreamSourceRef.current?.disconnect();
      }
    } catch (e) {
      // Ignore
    }

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    // Close AudioContext
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    // Emit any remaining result as final
    if (lastResultRef.current.length > 0) {
      onResultRef.current?.(lastResultRef.current, true);
      lastResultRef.current = '';
    }

    // Free the stream (but NOT the recognizer - it's shared/cached)
    if (recognizerStreamRef.current) {
      try {
        recognizerStreamRef.current.free();
      } catch (e) {
        // Ignore
      }
      recognizerStreamRef.current = null;
    }

    recorderNodeRef.current = null;
    mediaStreamSourceRef.current = null;

    setIsListening(false);
    setInterimTranscript('');
  }, [isListening]);

  const abortListening = useCallback(() => {
    shouldRestartRef.current = false;
    lastResultRef.current = '';
    stopListening();
  }, [stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      try {
        recorderNodeRef.current?.disconnect();
        mediaStreamSourceRef.current?.disconnect();
        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(() => {});
        }
        recognizerStreamRef.current?.free();
      } catch (e) {
        // Ignore cleanup errors
      }
    };
  }, []);

  return {
    isSupported,
    isListening,
    isModelLoading,
    isModelReady,
    loadingStatus,
    interimTranscript,
    startListening,
    stopListening,
    abortListening,
    loadModel,
  };
}

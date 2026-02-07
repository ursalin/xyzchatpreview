import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * sherpa-onnx WASM VAD+ASR STT hook
 *
 * 使用 sherpa-onnx 的 VAD (语音活动检测) + 离线 ASR (语音识别)。
 * VAD 自动检测用户说话开始/结束，ASR 识别说话内容。
 *
 * 模型文件约 93MB（含 VAD + Zipformer 中文模型），首次加载需下载，
 * 浏览器会自动缓存（HTTP cache），后续打开秒加载。
 *
 * 文件从 GitHub Releases 加载（稳定 CDN）。
 */

interface UseSherpaOnnxSTTOptions {
  language?: string;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
}

// HuggingFace Static Space serving the zh VAD+ASR WASM files (~92MB total)
// .data: 81MB (model), .wasm: 11MB, JS files: ~150KB
// Using the static.hf.space domain which has CORS: Access-Control-Allow-Origin: *
const HF_BASE_URL = 'https://k2-fsa-web-assembly-vad-asr-sherpa-onnx-zh-zipfo-bff3a9c.static.hf.space';

// Singleton state
let moduleLoadPromise: Promise<SherpaState> | null = null;
let sherpaState: SherpaState | null = null;
let loadError: string | null = null;

interface SherpaState {
  module: any;
  vad: any;
  buffer: any;
  recognizer: any;
}

/**
 * Dynamically load a script from a URL, with retries
 */
function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load: ${url}`));
    document.head.appendChild(script);
  });
}

/**
 * Initialize sherpa-onnx WASM with VAD + offline ASR
 */
async function initSherpaOnnx(
  onProgress?: (status: string) => void,
): Promise<SherpaState> {
  if (sherpaState) return sherpaState;
  if (loadError) throw new Error(loadError);
  if (moduleLoadPromise) return moduleLoadPromise;

  moduleLoadPromise = (async () => {
    try {
      onProgress?.('正在加载语音识别引擎...');

      const win = window as any;
      win.Module = win.Module || {};

      // locateFile: redirect .data and .wasm fetches to HF CDN
      win.Module.locateFile = (path: string, _scriptDir: string) => {
        console.log(`[SherpaOnnx] locateFile: ${path}`);
        return `${HF_BASE_URL}/${path}`;
      };

      // Track download progress
      win.Module.setStatus = (status: string) => {
        console.log(`[SherpaOnnx] Status: ${status}`);
        if (!status) return;

        const match = status.match(/Downloading data\.\.\. \((\d+)\/(\d+)\)/);
        if (match) {
          const downloaded = Number(match[1]);
          const total = Number(match[2]);
          const pct = total > 0 ? ((downloaded / total) * 100).toFixed(1) : '0';
          const downloadedMB = (downloaded / 1024 / 1024).toFixed(1);
          const totalMB = (total / 1024 / 1024).toFixed(1);
          onProgress?.(`正在下载语音模型... ${pct}% (${downloadedMB}/${totalMB}MB)`);
        } else if (status.includes('Running')) {
          onProgress?.('模型下载完成，正在初始化...');
        }
      };

      // Wait for runtime initialization
      const runtimeReady = new Promise<void>((resolve) => {
        const origOnInit = win.Module.onRuntimeInitialized;
        win.Module.onRuntimeInitialized = () => {
          console.log('[SherpaOnnx] Runtime initialized');
          origOnInit?.();
          resolve();
        };
      });

      // Load JS files (order matters: asr.js and vad.js define classes, then glue JS loads WASM)
      onProgress?.('正在加载脚本...');
      await loadScript(`${HF_BASE_URL}/sherpa-onnx-asr.js`);
      console.log('[SherpaOnnx] sherpa-onnx-asr.js loaded');

      await loadScript(`${HF_BASE_URL}/sherpa-onnx-vad.js`);
      console.log('[SherpaOnnx] sherpa-onnx-vad.js loaded');

      // Load the emscripten glue (triggers .data + .wasm download)
      await loadScript(`${HF_BASE_URL}/sherpa-onnx-wasm-main-vad-asr.js`);
      console.log('[SherpaOnnx] WASM glue loaded, waiting for runtime...');

      onProgress?.('正在下载语音模型...');
      await runtimeReady;

      const M = win.Module;

      // Create VAD
      const createVadFn = win.createVad;
      if (!createVadFn) {
        throw new Error('createVad not found');
      }
      const vad = createVadFn(M);
      console.log('[SherpaOnnx] VAD created');

      // Create CircularBuffer
      const CircularBufferCls = win.CircularBuffer;
      if (!CircularBufferCls) {
        throw new Error('CircularBuffer not found');
      }
      const buffer = new CircularBufferCls(30 * 16000, M);
      console.log('[SherpaOnnx] CircularBuffer created');

      // Create offline recognizer
      // Detect which model files are available
      const fileExists = (filename: string): boolean => {
        const filenameLen = M.lengthBytesUTF8(filename) + 1;
        const buf = M._malloc(filenameLen);
        M.stringToUTF8(filename, buf, filenameLen);
        const exists = M._SherpaOnnxFileExists(buf);
        M._free(buf);
        return exists === 1;
      };

      let recognizerConfig: any = {
        modelConfig: {
          debug: 0,
          tokens: './tokens.txt',
        },
      };

      if (fileExists('transducer-encoder.onnx')) {
        recognizerConfig.modelConfig.transducer = {
          encoder: './transducer-encoder.onnx',
          decoder: './transducer-decoder.onnx',
          joiner: './transducer-joiner.onnx',
        };
        recognizerConfig.modelConfig.modelType = 'transducer';
      } else if (fileExists('paraformer.onnx')) {
        recognizerConfig.modelConfig.paraformer = {
          model: './paraformer.onnx',
        };
      } else if (fileExists('sense-voice.onnx')) {
        recognizerConfig.modelConfig.senseVoice = {
          model: './sense-voice.onnx',
          useInverseTextNormalization: 1,
        };
      } else if (fileExists('telespeech.onnx')) {
        recognizerConfig.modelConfig.telespeechCtc = './telespeech.onnx';
      } else if (fileExists('whisper-encoder.onnx')) {
        recognizerConfig.modelConfig.whisper = {
          encoder: './whisper-encoder.onnx',
          decoder: './whisper-decoder.onnx',
        };
      } else if (fileExists('zipformer-ctc.onnx')) {
        recognizerConfig.modelConfig.zipformerCtc = {
          model: './zipformer-ctc.onnx',
        };
      } else if (fileExists('dolphin.onnx')) {
        recognizerConfig.modelConfig.dolphin = { model: './dolphin.onnx' };
      } else {
        throw new Error('No ASR model files found in WASM filesystem');
      }

      const OfflineRecognizerCls = win.OfflineRecognizer;
      if (!OfflineRecognizerCls) {
        throw new Error('OfflineRecognizer not found');
      }
      const recognizer = new OfflineRecognizerCls(recognizerConfig, M);
      console.log('[SherpaOnnx] Offline recognizer created');

      onProgress?.('语音模型已就绪 ✅');

      sherpaState = { module: M, vad, buffer, recognizer };
      return sherpaState;
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
 */
function downsampleBuffer(
  buffer: Float32Array,
  recordSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (targetSampleRate === recordSampleRate) return buffer;
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
  const [isSupported] = useState(true);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [isModelReady, setIsModelReady] = useState(!!sherpaState);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');

  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderNodeRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sherpaRef = useRef<SherpaState | null>(null);
  const shouldRestartRef = useRef(false);
  const speechDetectedRef = useRef(false);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { if (sherpaState) setIsModelReady(true); }, []);

  const loadModel = useCallback(async () => {
    if (sherpaState) {
      sherpaRef.current = sherpaState;
      setIsModelReady(true);
      return true;
    }
    if (isModelLoading) return false;

    setIsModelLoading(true);
    try {
      const state = await initSherpaOnnx((status) => setLoadingStatus(status));
      sherpaRef.current = state;
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
   * Process audio: feed to VAD, when speech segment ends → run ASR
   */
  const processAudio = useCallback((event: AudioProcessingEvent) => {
    const state = sherpaRef.current;
    if (!state) return;

    const { vad, buffer, recognizer, module: M } = state;
    const inputData = event.inputBuffer.getChannelData(0);
    const sampleRate = audioContextRef.current?.sampleRate || 48000;
    const targetRate = 16000;

    const samples = downsampleBuffer(new Float32Array(inputData), sampleRate, targetRate);

    // Push audio into circular buffer
    buffer.push(samples);

    // Feed buffer to VAD in windowSize chunks
    while (buffer.size() > vad.config.sileroVad.windowSize) {
      const chunk = buffer.get(buffer.head(), vad.config.sileroVad.windowSize);
      vad.acceptWaveform(chunk);
      buffer.pop(vad.config.sileroVad.windowSize);

      // Show "Speech detected" as interim
      if (vad.isDetected() && !speechDetectedRef.current) {
        speechDetectedRef.current = true;
        setInterimTranscript('正在聆听...');
        onResultRef.current?.('正在聆听...', false);
      }

      if (!vad.isDetected()) {
        speechDetectedRef.current = false;
      }

      // Process completed speech segments
      while (!vad.isEmpty()) {
        const segment = vad.front();
        vad.pop();

        // Run offline ASR on this segment
        const stream = recognizer.createStream();
        stream.acceptWaveform(targetRate, segment.samples);
        recognizer.decode(stream);
        const result = recognizer.getResult(stream);
        const text = result.text?.trim() || '';
        stream.free();

        if (text) {
          console.log('[SherpaOnnx STT] Recognized:', text);
          setInterimTranscript('');
          onResultRef.current?.(text, true);
        }
      }
    }
  }, []);

  const startListening = useCallback(async () => {
    if (isListening) return false;

    // Auto-load model
    if (!sherpaState) {
      const loaded = await loadModel();
      if (!loaded) return false;
    }
    sherpaRef.current = sherpaState;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
        video: false,
      });
      mediaStreamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;

      console.log('[SherpaOnnx STT] Audio sample rate:', audioCtx.sampleRate);

      const source = audioCtx.createMediaStreamSource(stream);
      mediaStreamSourceRef.current = source;

      const bufferSize = 4096;
      const recorder = audioCtx.createScriptProcessor(bufferSize, 1, 2);
      recorderNodeRef.current = recorder;

      // Reset VAD state
      sherpaRef.current?.vad.reset();
      sherpaRef.current?.buffer.reset();
      speechDetectedRef.current = false;

      recorder.onaudioprocess = processAudio;

      source.connect(recorder);
      recorder.connect(audioCtx.destination);

      shouldRestartRef.current = true;
      setIsListening(true);
      setInterimTranscript('');
      console.log('[SherpaOnnx STT] Started listening');
      return true;
    } catch (err) {
      console.error('[SherpaOnnx STT] Failed to start:', err);
      onErrorRef.current?.(err instanceof Error ? err.message : '启动失败');
      return false;
    }
  }, [isListening, loadModel, processAudio]);

  const stopListening = useCallback(() => {
    shouldRestartRef.current = false;
    if (!isListening) return;

    console.log('[SherpaOnnx STT] Stopping...');

    try {
      recorderNodeRef.current?.disconnect();
      mediaStreamSourceRef.current?.disconnect();
    } catch (e) { /* ignore */ }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    // Flush VAD to get any remaining speech
    if (sherpaRef.current) {
      try {
        const { vad, recognizer } = sherpaRef.current;
        vad.flush();
        while (!vad.isEmpty()) {
          const segment = vad.front();
          vad.pop();
          const stream = recognizer.createStream();
          stream.acceptWaveform(16000, segment.samples);
          recognizer.decode(stream);
          const result = recognizer.getResult(stream);
          const text = result.text?.trim() || '';
          stream.free();
          if (text) {
            onResultRef.current?.(text, true);
          }
        }
      } catch (e) {
        console.error('[SherpaOnnx STT] Flush error:', e);
      }
    }

    recorderNodeRef.current = null;
    mediaStreamSourceRef.current = null;

    setIsListening(false);
    setInterimTranscript('');
  }, [isListening]);

  const abortListening = useCallback(() => {
    shouldRestartRef.current = false;
    // Don't flush on abort — discard pending results
    try {
      recorderNodeRef.current?.disconnect();
      mediaStreamSourceRef.current?.disconnect();
    } catch (e) { /* ignore */ }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    recorderNodeRef.current = null;
    mediaStreamSourceRef.current = null;
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      try {
        recorderNodeRef.current?.disconnect();
        mediaStreamSourceRef.current?.disconnect();
        mediaStreamRef.current?.getTracks().forEach(t => t.stop());
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(() => {});
        }
      } catch (e) { /* ignore */ }
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

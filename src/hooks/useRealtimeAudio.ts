import { useState, useRef, useCallback, useEffect } from 'react';

interface AudioQueueItem {
  data: Uint8Array;
  id: string;
}

class AudioQueue {
  private queue: AudioQueueItem[] = [];
  private isPlaying = false;
  private audioContext: AudioContext;
  private onPlayingChange?: (isPlaying: boolean) => void;

  constructor(audioContext: AudioContext, onPlayingChange?: (isPlaying: boolean) => void) {
    this.audioContext = audioContext;
    this.onPlayingChange = onPlayingChange;
  }

  async addToQueue(audioData: Uint8Array, id: string) {
    this.queue.push({ data: audioData, id });
    console.log(`Audio queue: added chunk ${id}, queue length: ${this.queue.length}`);
    if (!this.isPlaying) {
      await this.playNext();
    }
  }

  clear() {
    this.queue = [];
    this.isPlaying = false;
    this.onPlayingChange?.(false);
    console.log("Audio queue cleared");
  }

  private createWavFromPCM(pcmData: Uint8Array): Uint8Array {
    // 豆包返回的是 PCM16LE (24kHz, 16bit, mono)
    // 直接使用，不需要转换
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmData.length;

    // Create WAV header (44 bytes)
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // Combine header and data
    const wavArray = new Uint8Array(44 + dataSize);
    wavArray.set(new Uint8Array(wavHeader), 0);
    wavArray.set(pcmData, 44);

    return wavArray;
  }

  private async playNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.isPlaying = false;
      this.onPlayingChange?.(false);
      console.log("Audio queue: playback complete");
      return;
    }

    this.isPlaying = true;
    this.onPlayingChange?.(true);
    const item = this.queue.shift()!;

    try {
      const wavData = this.createWavFromPCM(item.data);
      const audioBuffer = await this.audioContext.decodeAudioData(wavData.buffer.slice(0) as ArrayBuffer);

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);

      source.onended = () => this.playNext();
      source.start(0);
      console.log(`Audio queue: playing chunk ${item.id}`);
    } catch (error) {
      console.error('Error playing audio chunk:', error);
      this.playNext(); // Continue with next even if this fails
    }
  }
}

// 豆包要求 PCM16 (16kHz, 16bit, mono, little endian)
export const encodeAudioForAPI = (float32Array: Float32Array, targetSampleRate: number = 16000): string => {
  // 如果输入采样率是 24kHz，需要降采样到 16kHz
  const inputSampleRate = 24000;
  const ratio = inputSampleRate / targetSampleRate;
  
  // 降采样
  const outputLength = Math.floor(float32Array.length / ratio);
  const int16Array = new Int16Array(outputLength);
  
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = Math.floor(i * ratio);
    const s = Math.max(-1, Math.min(1, float32Array[srcIndex]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  
  const uint8Array = new Uint8Array(int16Array.buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }

  return btoa(binary);
};

interface UseRealtimeAudioOptions {
  systemPrompt?: string;
  voiceId?: string;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onSpeakingChange?: (isSpeaking: boolean) => void;
  onError?: (error: string) => void;
  onAudioComplete?: (audioBase64: string) => void; // 完整音频响应回调
}

export interface ConnectionDiagnostics {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  lastCloseCode?: number;
  lastCloseReason?: string;
  proxyError?: string;
  timestamp?: Date;
}

export function useRealtimeAudio(options: UseRealtimeAudioOptions = {}) {
  const { systemPrompt, voiceId = 'alloy', onTranscript, onSpeakingChange, onError, onAudioComplete } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [diagnostics, setDiagnostics] = useState<ConnectionDiagnostics>({ status: 'disconnected' });

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioQueue | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sessionCreatedRef = useRef(false);
  const audioChunkIdRef = useRef(0);
  const audioChunksRef = useRef<string[]>([]); // 累积完整音频响应

  const handleSpeakingChange = useCallback((speaking: boolean) => {
    setIsSpeaking(speaking);
    onSpeakingChange?.(speaking);
  }, [onSpeakingChange]);

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log("Already connected");
      return;
    }

    setDiagnostics({ status: 'connecting', timestamp: new Date() });

    try {
      // Initialize audio context
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      audioQueueRef.current = new AudioQueue(audioContextRef.current, handleSpeakingChange);

      // Connect to edge function
      const wsUrl = `wss://ylxrtqnlgfzivkmgeqsx.supabase.co/functions/v1/realtime-chat`;
      console.log("Connecting to:", wsUrl);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
        setDiagnostics({ status: 'connected', timestamp: new Date() });
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("Received event:", data.type);

          switch (data.type) {
            case 'session.created':
              console.log("Session created, sending config...");
              sessionCreatedRef.current = true;
              // Send session update after session.created
              ws.send(JSON.stringify({
                type: 'session.update',
                session: {
                  modalities: ['text', 'audio'],
                  instructions: systemPrompt || '你是一个友好的AI助手，请用中文回复。保持回答简洁自然。',
                  voice: voiceId,
                  input_audio_format: 'pcm16',
                  output_audio_format: 'pcm16',
                  input_audio_transcription: {
                    model: 'whisper-1'
                  },
                  turn_detection: {
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 800
                  },
                  temperature: 0.8,
                  max_response_output_tokens: 4096
                }
              }));
              break;

            case 'session.updated':
              console.log("Session updated successfully");
              break;

            case 'conversation.item.input_audio_transcription.completed':
              const userText = data.transcript;
              console.log("User said:", userText);
              setTranscript(userText);
              onTranscript?.(userText, true);
              break;

            case 'response.audio_transcript.delta':
              setAiResponse(prev => prev + (data.delta || ''));
              break;

            case 'response.audio_transcript.done':
              console.log("AI response complete:", data.transcript);
              break;

            case 'response.audio.delta':
              if (data.delta) {
                // 累积音频块
                audioChunksRef.current.push(data.delta);
                
                const binaryString = atob(data.delta);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                audioChunkIdRef.current++;
                await audioQueueRef.current?.addToQueue(bytes, `chunk-${audioChunkIdRef.current}`);
              }
              break;

            case 'response.audio.done':
              console.log("Audio response complete, chunks:", audioChunksRef.current.length);
              // 合并所有音频块并回调
              if (audioChunksRef.current.length > 0 && onAudioComplete) {
                try {
                  // 将所有 base64 块合并
                  const allBinaryChunks: number[] = [];
                  for (const chunk of audioChunksRef.current) {
                    const binaryString = atob(chunk);
                    for (let i = 0; i < binaryString.length; i++) {
                      allBinaryChunks.push(binaryString.charCodeAt(i));
                    }
                  }
                  // 转换为 base64
                  const fullAudioBytes = new Uint8Array(allBinaryChunks);
                  let binary = '';
                  const chunkSize = 0x8000;
                  for (let i = 0; i < fullAudioBytes.length; i += chunkSize) {
                    const subChunk = fullAudioBytes.subarray(i, Math.min(i + chunkSize, fullAudioBytes.length));
                    binary += String.fromCharCode.apply(null, Array.from(subChunk));
                  }
                  const fullAudioBase64 = btoa(binary);
                  console.log("Full audio length:", fullAudioBase64.length);
                  onAudioComplete(fullAudioBase64);
                } catch (e) {
                  console.error("Failed to merge audio chunks:", e);
                }
              }
              audioChunksRef.current = []; // 清空
              break;

            case 'response.done':
              console.log("Response complete");
              setAiResponse('');
              break;

            case 'input_audio_buffer.speech_started':
              console.log("Speech started");
              // Clear audio queue when user starts speaking
              audioQueueRef.current?.clear();
              break;

            case 'input_audio_buffer.speech_stopped':
              console.log("Speech stopped");
              break;

            case 'error':
              console.error("OpenAI error:", data.error);
              onError?.(data.error?.message || 'Unknown error');
              break;

            case 'proxy.error':
              console.error("Proxy error:", data.message);
              setDiagnostics(prev => ({
                ...prev,
                status: 'error',
                proxyError: data.message || 'Upstream WebSocket error',
                timestamp: new Date()
              }));
              break;

            case 'proxy.closed':
              console.log("Proxy closed:", data.code, data.reason);
              setDiagnostics(prev => ({
                ...prev,
                status: 'error',
                lastCloseCode: data.code,
                lastCloseReason: data.reason || 'Upstream connection closed',
                timestamp: new Date()
              }));
              break;
          }
        } catch (e) {
          console.error("Error processing message:", e);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setDiagnostics(prev => ({
          ...prev,
          status: 'error',
          proxyError: 'WebSocket connection error',
          timestamp: new Date()
        }));
        onError?.("WebSocket connection error");
      };

      ws.onclose = (event) => {
        console.log("WebSocket closed:", event.code, event.reason);
        setIsConnected(false);
        sessionCreatedRef.current = false;

        // 关键：不要在已收到 proxy.error/proxy.closed 后又立刻覆盖成 disconnected，
        // 否则 UI 会“闪退”看不到错误面板。
        setDiagnostics(prev => {
          const hasErrorAlready = prev.status === 'error' || !!prev.proxyError;
          const looksLikeErrorClose = event.code !== 1000 || (!!event.reason && event.reason !== '');
          const nextStatus: ConnectionDiagnostics['status'] = (hasErrorAlready || looksLikeErrorClose)
            ? 'error'
            : 'disconnected';

          return {
            ...prev,
            status: nextStatus,
            lastCloseCode: event.code,
            lastCloseReason: event.reason || prev.lastCloseReason || '',
            timestamp: new Date(),
          };
        });
      };
    } catch (error) {
      console.error("Connection error:", error);
      setDiagnostics({ status: 'error', proxyError: `Failed to connect: ${error}`, timestamp: new Date() });
      onError?.(`Failed to connect: ${error}`);
    }
  }, [systemPrompt, voiceId, onTranscript, onError, handleSpeakingChange]);

  const startRecording = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error("WebSocket not connected");
      return;
    }

    try {
      // 豆包要求 16kHz 输入
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      mediaStreamRef.current = stream;

      // 录音使用 16kHz，播放仍使用 24kHz（豆包输出是 24kHz）
      const recordingContext = new AudioContext({ sampleRate: 16000 });
      
      // 确保播放用的 audioContext 是 24kHz
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
        audioQueueRef.current = new AudioQueue(audioContextRef.current, handleSpeakingChange);
      }

      const source = recordingContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // createScriptProcessor requires power-of-2 buffer size (256-16384)
      // Use 512 samples per buffer (~32ms at 16kHz), send immediately
      const processor = recordingContext.createScriptProcessor(512, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          // 直接编码，不需要降采样（已经是 16kHz）
          const int16Array = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          const uint8Array = new Uint8Array(int16Array.buffer);
          let binary = '';
          for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
          }
          const audioBase64 = btoa(binary);
          
          wsRef.current.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: audioBase64
          }));
        }
      };

      source.connect(processor);
      processor.connect(recordingContext.destination);
      setIsRecording(true);
      console.log("Recording started");
    } catch (error) {
      console.error("Error starting recording:", error);
      onError?.(`Failed to start recording: ${error}`);
    }
  }, [onError]);

  const stopRecording = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    setIsRecording(false);
    console.log("Recording stopped");
  }, []);

  const disconnect = useCallback(() => {
    stopRecording();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    audioQueueRef.current?.clear();
    audioQueueRef.current = null;
    setIsConnected(false);
    sessionCreatedRef.current = false;
    console.log("Disconnected");
  }, [stopRecording]);

  const sendTextMessage = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error("WebSocket not connected");
      return;
    }

    wsRef.current.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }]
      }
    }));
    wsRef.current.send(JSON.stringify({ type: 'response.create' }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    isRecording,
    isSpeaking,
    transcript,
    aiResponse,
    diagnostics,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    sendTextMessage
  };
}

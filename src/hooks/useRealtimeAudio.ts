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
    // Convert bytes to 16-bit samples (little endian)
    const int16Data = new Int16Array(pcmData.length / 2);
    for (let i = 0; i < pcmData.length; i += 2) {
      int16Data[i / 2] = (pcmData[i + 1] << 8) | pcmData[i];
    }
    
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const byteRate = sampleRate * blockAlign;
    const dataSize = int16Data.byteLength;

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
    const wavArray = new Uint8Array(44 + int16Data.byteLength);
    wavArray.set(new Uint8Array(wavHeader), 0);
    wavArray.set(new Uint8Array(int16Data.buffer as ArrayBuffer), 44);

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

export const encodeAudioForAPI = (float32Array: Float32Array): string => {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
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
}

export function useRealtimeAudio(options: UseRealtimeAudioOptions = {}) {
  const { systemPrompt, voiceId = 'alloy', onTranscript, onSpeakingChange, onError } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [aiResponse, setAiResponse] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioQueue | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sessionCreatedRef = useRef(false);
  const audioChunkIdRef = useRef(0);

  const handleSpeakingChange = useCallback((speaking: boolean) => {
    setIsSpeaking(speaking);
    onSpeakingChange?.(speaking);
  }, [onSpeakingChange]);

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log("Already connected");
      return;
    }

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
              console.log("Audio response complete");
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
          }
        } catch (e) {
          console.error("Error processing message:", e);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        onError?.("WebSocket connection error");
      };

      ws.onclose = (event) => {
        console.log("WebSocket closed:", event.code, event.reason);
        setIsConnected(false);
        sessionCreatedRef.current = false;
      };
    } catch (error) {
      console.error("Connection error:", error);
      onError?.(`Failed to connect: ${error}`);
    }
  }, [systemPrompt, voiceId, onTranscript, onError, handleSpeakingChange]);

  const startRecording = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error("WebSocket not connected");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      mediaStreamRef.current = stream;

      const audioContext = audioContextRef.current || new AudioContext({ sampleRate: 24000 });
      if (!audioContextRef.current) {
        audioContextRef.current = audioContext;
      }

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          const audioBase64 = encodeAudioForAPI(new Float32Array(inputData));
          wsRef.current.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: audioBase64
          }));
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
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
    connect,
    disconnect,
    startRecording,
    stopRecording,
    sendTextMessage
  };
}

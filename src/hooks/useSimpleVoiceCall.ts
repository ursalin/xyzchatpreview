import { useState, useCallback, useRef, useEffect } from 'react';
import { Message, AppSettings, defaultVoiceConfig } from '@/types/chat';
import { useWebSpeechSTT } from './useWebSpeechSTT';
import { removeParenthesesContent } from '@/lib/textUtils';

interface UseSimpleVoiceCallOptions {
  settings: AppSettings;
  systemPrompt: string;
  onSpeakingChange?: (isSpeaking: boolean) => void;
  onAudioResponse?: (audioBase64: string) => void;
}

export function useSimpleVoiceCall({
  settings,
  systemPrompt,
  onSpeakingChange,
  onAudioResponse,
}: UseSimpleVoiceCallOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 用 ref 保存最新的 messages，避免闭包过期
  const messagesRef = useRef<Message[]>([]);
  const isConnectedRef = useRef(false);
  const systemPromptRef = useRef(systemPrompt);

  // 同步 state 到 ref
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    systemPromptRef.current = systemPrompt;
  }, [systemPrompt]);

  // TTS 播放（用 useCallback 但通过 ref 读取 settings）
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const speak = useCallback(async (text: string) => {
    const { voiceConfig } = settingsRef.current;
    // Fallback to defaults if saved config has empty keys
    const apiKey = voiceConfig.minimaxApiKey || defaultVoiceConfig.minimaxApiKey;
    const groupId = voiceConfig.minimaxGroupId || defaultVoiceConfig.minimaxGroupId;
    const voice = voiceConfig.voiceId || defaultVoiceConfig.voiceId;
    const enabled = voiceConfig.minimaxApiKey ? voiceConfig.enabled : defaultVoiceConfig.enabled;

    if (!enabled || !apiKey || !groupId) {
      console.log('Voice not enabled or missing config, skipping TTS');
      return;
    }

    const textToSpeak = removeParenthesesContent(text);
    if (!textToSpeak) return;

    try {
      console.log('[TTS] Generating audio for:', textToSpeak.substring(0, 50) + '...');
      console.log('[TTS] Config:', { voiceId: voice, groupId: groupId.substring(0, 6) + '...' });
      
      // 直接调MiniMax API，不走Supabase edge function
      const response = await fetch(
        `https://api.minimax.chat/v1/t2a_v2?GroupId=${groupId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'speech-01-turbo',
            text: textToSpeak,
            stream: false,
            voice_setting: {
              voice_id: voice,
              speed: 1.0,
              vol: 1.0,
              pitch: 0,
            },
            audio_setting: {
              sample_rate: 32000,
              bitrate: 128000,
              format: 'mp3',
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[TTS] API error:', response.status, errorText);
        import('sonner').then(({ toast }) => toast.error(`语音合成失败: ${response.status}`));
        return;
      }

      const result = await response.json();
      
      if (result.base_resp?.status_code !== 0) {
        const errMsg = result.base_resp?.status_msg || 'MiniMax API error';
        console.error('[TTS] MiniMax error:', errMsg);
        import('sonner').then(({ toast }) => toast.error(`语音合成失败: ${errMsg}`));
        return;
      }

      const audioHex = result.data?.audio;
      if (!audioHex) {
        console.error('[TTS] No audio data in response');
        import('sonner').then(({ toast }) => toast.error('语音合成失败: 无音频数据'));
        return;
      }

      // Convert hex to base64
      const bytes = new Uint8Array(audioHex.length / 2);
      for (let i = 0; i < audioHex.length; i += 2) {
        bytes[i / 2] = parseInt(audioHex.substring(i, i + 2), 16);
      }
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const audioBase64 = btoa(binary);

      if (audioBase64) {
        console.log('[TTS] Got audio, length:', audioBase64.length);
        onAudioResponse?.(audioBase64);
        
        const audioUrl = `data:audio/mpeg;base64,${data.audioContent}`;
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        
        audio.onplay = () => {
          console.log('[TTS] Audio playing');
          setIsPlaying(true);
        };
        audio.onended = () => {
          console.log('[TTS] Audio ended');
          setIsPlaying(false);
        };
        audio.onerror = (e) => {
          console.error('[TTS] Audio playback error:', e);
          setIsPlaying(false);
          import('sonner').then(({ toast }) => toast.error('音频播放失败'));
        };
        
        await audio.play();
      } else {
        console.error('[TTS] No audioContent in response:', data);
        import('sonner').then(({ toast }) => toast.error('语音合成返回空数据'));
      }
    } catch (error) {
      console.error('[TTS] Error:', error);
      import('sonner').then(({ toast }) => toast.error(`语音合成异常: ${error instanceof Error ? error.message : '未知错误'}`));
    }
  }, [onAudioResponse]);

  // 发送消息给 AI（不依赖 messages state，用 ref 读取）
  const sendMessageToAI = useCallback(async (content: string) => {
    if (isLoading) {
      console.log('Already loading, skipping duplicate send');
      return null;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // 用 ref 读取最新 messages 构建上下文
      const currentMessages = messagesRef.current;
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            messages: [...currentMessages, userMessage].slice(-20).map(m => ({
              role: m.role,
              content: m.content,
            })),
            systemPrompt: systemPromptRef.current,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => `HTTP ${response.status}`);
        console.error('Chat API error:', response.status, errorText);
        throw new Error(`AI 回复失败 (${response.status})`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应');

      const decoder = new TextDecoder();
      let assistantContent = '';
      const assistantMessageId = crypto.randomUUID();

      setMessages(prev => [
        ...prev,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          timestamp: new Date(),
        },
      ]);

      let textBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);
            const deltaContent = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (deltaContent) {
              assistantContent += deltaContent;
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantMessageId
                    ? { ...m, content: assistantContent }
                    : m
                )
              );
            }
          } catch {
            // 不完整的 JSON，放回 buffer
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // 自动播放 TTS
      if (assistantContent && settingsRef.current.voiceConfig.enabled) {
        await speak(assistantContent);
      }

      return assistantContent;
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: error instanceof Error ? error.message : '抱歉，我遇到了一些问题',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, speak]);

  // 用 ref 保存 sendMessageToAI，让 STT 回调始终调用最新版本
  const sendMessageToAIRef = useRef(sendMessageToAI);
  useEffect(() => {
    sendMessageToAIRef.current = sendMessageToAI;
  }, [sendMessageToAI]);

  // 使用 Web Speech API 进行语音识别
  const {
    isListening: isRecording,
    isSupported: isSpeechSupported,
    interimTranscript: webSpeechInterim,
    startListening,
    stopListening,
  } = useWebSpeechSTT({
    language: 'zh-CN',
    onResult: useCallback((transcript: string, isFinal: boolean) => {
      if (isFinal) {
        if (transcript.trim() && isConnectedRef.current) {
          console.log('[Voice] Sending final transcript:', transcript.trim());
          sendMessageToAIRef.current(transcript.trim());
        }
        setInterimTranscript('');
      } else {
        setInterimTranscript(transcript);
      }
    }, []),
    onError: useCallback((error: string) => {
      console.error('[STT Error]', error);
      setInterimTranscript('');
    }, []),
  });

  // 同步临时识别结果
  useEffect(() => {
    setInterimTranscript(webSpeechInterim);
  }, [webSpeechInterim]);

  // 通知父组件说话状态
  useEffect(() => {
    onSpeakingChange?.(isPlaying);
  }, [isPlaying, onSpeakingChange]);

  // 停止播放
  const stopPlaying = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  }, []);

  // 开始通话
  const connect = useCallback(async () => {
    if (!isSpeechSupported) {
      console.error('Web Speech API not supported');
      return false;
    }
    setIsConnected(true);
    startListening();
    return true;
  }, [isSpeechSupported, startListening]);

  // 结束通话
  const disconnect = useCallback(() => {
    stopListening();
    stopPlaying();
    setIsConnected(false);
  }, [stopListening, stopPlaying]);

  // 开始录音
  const startRecording = useCallback(() => {
    if (isConnectedRef.current) {
      startListening();
    }
  }, [startListening]);

  // 停止录音
  const stopRecording = useCallback(() => {
    stopListening();
  }, [stopListening]);

  // 发送文字消息
  const sendTextMessage = useCallback((text: string) => {
    if (text.trim() && isConnectedRef.current) {
      sendMessageToAIRef.current(text.trim());
    }
  }, []);

  // 清空消息
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    isLoading,
    isConnected,
    isRecording,
    isPlaying,
    isSpeechSupported,
    interimTranscript,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    sendTextMessage,
    clearMessages,
    stopPlaying,
  };
}

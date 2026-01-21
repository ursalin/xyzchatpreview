import { useState, useCallback, useRef, useEffect } from 'react';
import { Message, AppSettings } from '@/types/chat';
import { supabase } from '@/integrations/supabase/client';

// 角色图片 URL（需要是公开可访问的 URL）
import characterFrontImg from '@/assets/character-front.jpg';

interface UseVideoCallOptions {
  settings: AppSettings;
  systemPrompt: string;
  onSpeakingChange?: (isSpeaking: boolean) => void;
  onLipsyncVideoReady?: (videoUrl: string) => void;
}

export function useVideoCall({ settings, systemPrompt, onSpeakingChange, onLipsyncVideoReady }: UseVideoCallOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGeneratingLipsync, setIsGeneratingLipsync] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 通知父组件说话状态变化
  useEffect(() => {
    onSpeakingChange?.(isPlaying);
  }, [isPlaying, onSpeakingChange]);

  // 启动摄像头
  const startCamera = useCallback(async (videoElement: HTMLVideoElement) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
        audio: false,
      });
      
      videoElement.srcObject = stream;
      await videoElement.play();
      
      videoRef.current = videoElement;
      streamRef.current = stream;
      setIsCameraActive(true);
      
      // 创建用于截图的canvas
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      canvasRef.current = canvas;
      
      return true;
    } catch (error) {
      console.error('Failed to start camera:', error);
      return false;
    }
  }, []);

  // 关闭摄像头
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }
    setIsCameraActive(false);
  }, []);

  // 截取当前画面
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  }, []);

  // 开始录音
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };
      
      mediaRecorder.start(100);
      setIsRecording(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
      throw error;
    }
  }, []);

  // 停止录音并转文字
  const stopRecording = useCallback(async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!mediaRecorderRef.current) {
        reject(new Error('No recording in progress'));
        return;
      }

      const mediaRecorder = mediaRecorderRef.current;
      
      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        setIsProcessingVoice(true);
        
        try {
          const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
          
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          
          reader.onloadend = async () => {
            try {
              const base64Audio = (reader.result as string).split(',')[1];
              
              const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-to-text`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
                  },
                  body: JSON.stringify({ audio: base64Audio }),
                }
              );

              if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'STT request failed');
              }

              const data = await response.json();
              resolve(data.text || '');
            } catch (error) {
              reject(error);
            } finally {
              setIsProcessingVoice(false);
            }
          };
          
          reader.onerror = () => {
            setIsProcessingVoice(false);
            reject(new Error('Failed to read audio data'));
          };
        } catch (error) {
          setIsProcessingVoice(false);
          reject(error);
        }
        
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorder.stop();
    });
  }, []);

  // 获取角色图片的公开 URL
  const getCharacterImageUrl = useCallback((): string => {
    // 将本地图片转换为完整 URL
    const baseUrl = window.location.origin;
    return `${baseUrl}${characterFrontImg}`;
  }, []);

  // 生成唇形动画视频
  const generateLipsyncVideo = useCallback(async (audioBase64: string): Promise<string | null> => {
    try {
      setIsGeneratingLipsync(true);
      console.log('Generating lipsync video...');
      
      const imageUrl = getCharacterImageUrl();
      console.log('Character image URL:', imageUrl);

      const { data, error } = await supabase.functions.invoke('omnihuman-lipsync', {
        body: {
          imageUrl,
          audioBase64,
          resolution: '720p',
          turboMode: true,
        },
      });

      if (error) {
        console.error('Lipsync function error:', error);
        return null;
      }

      if (data?.error) {
        console.error('Lipsync API error:', data.error);
        return null;
      }

      if (data?.videoUrl) {
        console.log('Lipsync video generated:', data.videoUrl);
        return data.videoUrl;
      }

      return null;
    } catch (error) {
      console.error('Lipsync generation error:', error);
      return null;
    } finally {
      setIsGeneratingLipsync(false);
    }
  }, [getCharacterImageUrl]);

  // TTS 播放（同时触发唇形动画生成）
  const speak = useCallback(async (text: string) => {
    const { voiceConfig } = settings;
    if (!voiceConfig.enabled || !voiceConfig.minimaxApiKey || !voiceConfig.minimaxGroupId) {
      console.log('Voice not enabled or missing config');
      return;
    }

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/minimax-tts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            text,
            apiKey: voiceConfig.minimaxApiKey,
            groupId: voiceConfig.minimaxGroupId,
            voiceId: voiceConfig.voiceId,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'TTS request failed');
      }

      const data = await response.json();
      
      if (data.audioContent) {
        // 同时播放音频和生成唇形动画视频
        const audioUrl = `data:audio/mpeg;base64,${data.audioContent}`;
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        
        audio.onplay = () => setIsPlaying(true);
        audio.onended = () => setIsPlaying(false);
        audio.onerror = () => setIsPlaying(false);
        
        // 先播放音频（立即响应）
        await audio.play();

        // 后台生成唇形动画视频（异步，不阻塞音频播放）
        // 下次对话时可以使用生成的视频
        generateLipsyncVideo(data.audioContent).then(videoUrl => {
          if (videoUrl && onLipsyncVideoReady) {
            onLipsyncVideoReady(videoUrl);
          }
        });
      }
    } catch (error) {
      console.error('TTS error:', error);
    }
  }, [settings, generateLipsyncVideo, onLipsyncVideoReady]);

  // 停止播放
  const stopPlaying = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  }, []);

  // 发送消息（带视觉）
  const sendMessage = useCallback(async (content: string, includeImage = true) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // 截取当前画面
      const image = includeImage ? captureFrame() : null;
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vision-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            messages: [...messages, userMessage].map(m => ({
              role: m.role,
              content: m.content,
            })),
            systemPrompt,
            image,
          }),
        }
      );

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('请求过于频繁，请稍后再试');
        }
        if (response.status === 402) {
          throw new Error('API额度已用完，请充值');
        }
        throw new Error('AI回复失败');
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
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // 自动播放TTS
      if (assistantContent && settings.voiceConfig.enabled) {
        await speak(assistantContent);
      }

      return assistantContent;
    } catch (error) {
      console.error('Video call error:', error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: error instanceof Error ? error.message : '抱歉，我遇到了一些问题，请稍后再试。',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [messages, systemPrompt, captureFrame, settings, speak]);

  // 清除消息
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // 清理
  useEffect(() => {
    return () => {
      stopCamera();
      stopPlaying();
    };
  }, [stopCamera, stopPlaying]);

  return {
    messages,
    isLoading,
    isCameraActive,
    isRecording,
    isProcessingVoice,
    isPlaying,
    isGeneratingLipsync,
    startCamera,
    stopCamera,
    captureFrame,
    startRecording,
    stopRecording,
    sendMessage,
    clearMessages,
    speak,
    stopPlaying,
  };
}

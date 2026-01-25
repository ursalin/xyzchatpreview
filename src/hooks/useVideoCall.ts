import { useState, useCallback, useRef, useEffect } from 'react';
import { Message, AppSettings } from '@/types/chat';
import { supabase } from '@/integrations/supabase/client';

// 角色图片 URL（需要是公开可访问的 URL）
import characterFrontImg from '@/assets/character-front.jpg';

// 唇形动画视频缓存（基于文本哈希）
interface LipsyncCacheEntry {
  videoUrl: string;
  audioBase64: string;
  createdAt: number;
}

const CACHE_EXPIRY_MS = 60 * 60 * 1000; // 1小时过期
const CACHE_KEY = 'lipsync_video_cache';
const MAX_CACHE_ENTRIES = 20;
const CHAT_HISTORY_KEY = 'ai-companion-chat-history';
const MAX_STORED_MESSAGES = 100;

// 简单的文本哈希函数
function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

// 从 localStorage 加载缓存
function loadCache(): Map<string, LipsyncCacheEntry> {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return new Map(Object.entries(parsed));
    }
  } catch (e) {
    console.error('Failed to load lipsync cache:', e);
  }
  return new Map();
}

// 保存缓存到 localStorage
function saveCache(cache: Map<string, LipsyncCacheEntry>) {
  try {
    const obj: Record<string, LipsyncCacheEntry> = {};
    cache.forEach((value, key) => {
      obj[key] = value;
    });
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch (e) {
    console.error('Failed to save lipsync cache:', e);
  }
}

// 清理过期缓存
function cleanExpiredCache(cache: Map<string, LipsyncCacheEntry>): Map<string, LipsyncCacheEntry> {
  const now = Date.now();
  const entries = Array.from(cache.entries());
  
  // 过滤掉过期的条目
  const valid = entries.filter(([, entry]) => now - entry.createdAt < CACHE_EXPIRY_MS);
  
  // 如果超过最大数量，删除最旧的
  if (valid.length > MAX_CACHE_ENTRIES) {
    valid.sort((a, b) => b[1].createdAt - a[1].createdAt);
    return new Map(valid.slice(0, MAX_CACHE_ENTRIES));
  }
  
  return new Map(valid);
}

// 序列化消息用于存储
function serializeMessages(messages: Message[]): string {
  return JSON.stringify(messages.map(m => ({
    ...m,
    timestamp: m.timestamp.toISOString(),
  })));
}

// 反序列化存储的消息
function deserializeMessages(data: string): Message[] {
  try {
    const parsed = JSON.parse(data);
    return parsed.map((m: { id: string; role: 'user' | 'assistant'; content: string; timestamp: string }) => ({
      ...m,
      timestamp: new Date(m.timestamp),
    }));
  } catch {
    return [];
  }
}

// 从 localStorage 加载聊天记录
function loadStoredMessages(): Message[] {
  try {
    const stored = localStorage.getItem(CHAT_HISTORY_KEY);
    if (stored) {
      console.log('Loaded chat history from localStorage');
      return deserializeMessages(stored);
    }
  } catch (e) {
    console.error('Failed to load chat history:', e);
  }
  return [];
}

interface UseVideoCallOptions {
  settings: AppSettings;
  systemPrompt: string;
  onSpeakingChange?: (isSpeaking: boolean) => void;
  onLipsyncVideoReady?: (videoUrl: string) => void;
  onPresetAnimationTrigger?: (audioBase64: string) => void; // 传递音频数据用于同步
}

export function useVideoCall({ settings, systemPrompt, onSpeakingChange, onLipsyncVideoReady, onPresetAnimationTrigger }: UseVideoCallOptions) {
  const [messages, setMessages] = useState<Message[]>(() => loadStoredMessages());
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
  const lipsyncCacheRef = useRef<Map<string, LipsyncCacheEntry>>(loadCache());

  // 保存聊天记录到 localStorage
  useEffect(() => {
    if (messages.length > 0) {
      try {
        const messagesToStore = messages.slice(-MAX_STORED_MESSAGES);
        localStorage.setItem(CHAT_HISTORY_KEY, serializeMessages(messagesToStore));
      } catch (e) {
        console.error('Failed to save chat history:', e);
      }
    }
  }, [messages]);

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

  // 将角色图片转换为 base64 data URL (fal.ai 可以直接使用)
  const getCharacterImageDataUrl = useCallback(async (): Promise<string> => {
    try {
      // Fetch the image and convert to base64
      const response = await fetch(characterFrontImg);
      const blob = await response.blob();
      
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          console.log('Character image converted to data URL, length:', dataUrl.length);
          resolve(dataUrl);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Failed to convert image to data URL:', error);
      // Fallback to the original URL
      const baseUrl = window.location.origin;
      return `${baseUrl}${characterFrontImg}`;
    }
  }, []);

  // 检查缓存中是否有视频
  const getCachedVideo = useCallback((text: string): LipsyncCacheEntry | null => {
    const hash = hashText(text);
    const cache = cleanExpiredCache(lipsyncCacheRef.current);
    lipsyncCacheRef.current = cache;
    saveCache(cache);
    
    const entry = cache.get(hash);
    if (entry && Date.now() - entry.createdAt < CACHE_EXPIRY_MS) {
      console.log('Found cached lipsync video for text hash:', hash);
      return entry;
    }
    return null;
  }, []);

  // 保存视频到缓存
  const cacheVideo = useCallback((text: string, videoUrl: string, audioBase64: string) => {
    const hash = hashText(text);
    const cache = cleanExpiredCache(lipsyncCacheRef.current);
    
    cache.set(hash, {
      videoUrl,
      audioBase64,
      createdAt: Date.now(),
    });
    
    lipsyncCacheRef.current = cache;
    saveCache(cache);
    console.log('Cached lipsync video for text hash:', hash);
  }, []);

  // 生成唇形动画视频 - 支持多引擎
  const generateLipsyncVideo = useCallback(async (audioBase64: string, text: string): Promise<string | null> => {
    try {
      setIsGeneratingLipsync(true);
      const engine = settings.voiceConfig.lipsyncEngine || 'musetalk';
      console.log(`Generating lipsync video with engine: ${engine}`);
      
      const imageUrl = await getCharacterImageDataUrl();
      console.log('Character image data URL length:', imageUrl.length);

      // 根据选择的引擎调用不同的 API
      let functionName: string;
      let requestBody: Record<string, unknown>;

      if (engine === 'musetalk') {
        functionName = 'musetalk-lipsync';
        requestBody = {
          imageUrl,
          audioBase64,
        };
      } else {
        functionName = 'omnihuman-lipsync';
        requestBody = {
          imageUrl,
          audioBase64,
          resolution: '720p',
          turboMode: true,
        };
      }

      console.log(`Calling ${functionName}...`);
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: requestBody,
      });

      if (error) {
        console.error(`${engine} function error:`, error);
        
        // 如果主引擎失败，尝试备用引擎
        if (engine === 'musetalk') {
          console.log('MuseTalk failed, falling back to OmniHuman...');
          const fallbackResult = await supabase.functions.invoke('omnihuman-lipsync', {
            body: {
              imageUrl,
              audioBase64,
              resolution: '720p',
              turboMode: true,
            },
          });
          
          if (fallbackResult.data?.videoUrl) {
            console.log('Fallback to OmniHuman succeeded:', fallbackResult.data.videoUrl);
            cacheVideo(text, fallbackResult.data.videoUrl, audioBase64);
            return fallbackResult.data.videoUrl;
          }
        }
        return null;
      }

      if (data?.error) {
        console.error(`${engine} API error:`, data.error);
        return null;
      }

      if (data?.videoUrl) {
        console.log('Lipsync video generated:', data.videoUrl);
        cacheVideo(text, data.videoUrl, audioBase64);
        return data.videoUrl;
      }

      return null;
    } catch (error) {
      console.error('Lipsync generation error:', error);
      return null;
    } finally {
      setIsGeneratingLipsync(false);
    }
  }, [getCharacterImageDataUrl, cacheVideo, settings.voiceConfig.lipsyncEngine]);

  // 同步播放音频和视频
  const playSynced = useCallback(async (audioBase64: string, videoUrl: string) => {
    const audioUrl = `data:audio/mpeg;base64,${audioBase64}`;
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    
    // 先通知视频准备好
    if (onLipsyncVideoReady) {
      onLipsyncVideoReady(videoUrl);
    }
    
    // 短暂延迟让视频元素加载
    await new Promise(resolve => setTimeout(resolve, 100));
    
    audio.onplay = () => setIsPlaying(true);
    audio.onended = () => setIsPlaying(false);
    audio.onerror = () => setIsPlaying(false);
    
    await audio.play();
  }, [onLipsyncVideoReady]);

  // TTS 播放（根据模式选择预设动画或生成动画）
  const speak = useCallback(async (text: string) => {
    const { voiceConfig } = settings;
    if (!voiceConfig.enabled || !voiceConfig.minimaxApiKey || !voiceConfig.minimaxGroupId) {
      console.log('Voice not enabled or missing config');
      return;
    }

    const lipsyncMode = voiceConfig.lipsyncMode || 'preset';

    // 预设动画模式：生成TTS后由预设动画系统同步播放
    if (lipsyncMode === 'preset') {
      try {
        console.log('Generating TTS audio (preset mode)...');
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
          console.log('TTS audio ready, passing to preset animation system for synced playback...');
          
          // 将音频数据传递给预设动画系统，由它来处理同步播放
          if (onPresetAnimationTrigger) {
            onPresetAnimationTrigger(data.audioContent);
          } else {
            // 后备：如果没有预设动画处理器，直接播放音频
            const audioUrl = `data:audio/mpeg;base64,${data.audioContent}`;
            const audio = new Audio(audioUrl);
            audioRef.current = audio;
            audio.onplay = () => setIsPlaying(true);
            audio.onended = () => setIsPlaying(false);
            audio.onerror = () => setIsPlaying(false);
            await audio.play();
          }
        }
      } catch (error) {
        console.error('TTS error:', error);
      }
      return;
    }

    // AI生成模式：原有逻辑
    // 先检查缓存
    const cached = getCachedVideo(text);
    if (cached) {
      console.log('Using cached lipsync video - playing synced');
      await playSynced(cached.audioBase64, cached.videoUrl);
      return;
    }

    try {
      // Step 1: 生成 TTS 音频
      console.log('Generating TTS audio...');
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
        // Step 2: 等待视频生成完成
        console.log('TTS audio ready, generating lipsync video...');
        const videoUrl = await generateLipsyncVideo(data.audioContent, text);
        
        if (videoUrl) {
          // Step 3: 视频生成完成，同步播放音频和视频
          console.log('Video ready, playing synced audio and video');
          await playSynced(data.audioContent, videoUrl);
        } else {
          // 视频生成失败，仅播放音频
          console.log('Video generation failed, playing audio only');
          const audioUrl = `data:audio/mpeg;base64,${data.audioContent}`;
          const audio = new Audio(audioUrl);
          audioRef.current = audio;
          
          audio.onplay = () => setIsPlaying(true);
          audio.onended = () => setIsPlaying(false);
          audio.onerror = () => setIsPlaying(false);
          
          await audio.play();
        }
      }
    } catch (error) {
      console.error('TTS error:', error);
    }
  }, [settings, generateLipsyncVideo, getCachedVideo, playSynced, onPresetAnimationTrigger]);

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
    try {
      localStorage.removeItem(CHAT_HISTORY_KEY);
    } catch (e) {
      console.error('Failed to clear chat history:', e);
    }
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

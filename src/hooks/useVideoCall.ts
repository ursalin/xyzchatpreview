import { useState, useCallback, useRef, useEffect } from 'react';
import { Message, AppSettings } from '@/types/chat';
import { supabase } from '@/integrations/supabase/client';
import { removeParenthesesContent } from '@/lib/textUtils';
import { useWebSpeechSTT } from './useWebSpeechSTT';
import { useXunfeiSTT } from './useXunfeiSTT';
import { useMemoryManager } from './useMemoryManager';

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
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGeneratingLipsync, setIsGeneratingLipsync] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lipsyncCacheRef = useRef<Map<string, LipsyncCacheEntry>>(loadCache());
  const pendingTranscriptRef = useRef<string>('');

  // 使用记忆管理器
  const {
    memorySummary,
    isSummarizing,
    checkAndSummarize,
    buildContextMessages,
    clearMemory,
    updateMemorySummary,
  } = useMemoryManager();

  // 用 ref 保存 sendMessage，避免 STT 回调闭包过期
  const sendMessageRef = useRef<(content: string, includeImage?: boolean) => Promise<void>>(null as any);

  // STT 回调
  const handleSTTResult = useCallback((transcript: string, isFinal: boolean) => {
    if (isFinal) {
      // 最终结果，发送消息
      if (transcript.trim()) {
        sendMessageRef.current?.(transcript.trim(), true);
      }
      setInterimTranscript('');
      pendingTranscriptRef.current = '';
    } else {
      // 临时结果，仅显示
      setInterimTranscript(transcript);
      pendingTranscriptRef.current = transcript;
    }
  }, []);

  const handleSTTError = useCallback((error: string) => {
    console.error('[STT Error]', error);
    setInterimTranscript('');
    pendingTranscriptRef.current = '';
  }, []);

  // 尝试使用讯飞语音识别
  const xunfeiSTT = useXunfeiSTT({
    language: 'zh_cn',
    onResult: handleSTTResult,
    onError: handleSTTError,
  });

  // 备用：Web Speech API
  const webSpeechSTT = useWebSpeechSTT({
    language: 'zh-CN',
    onResult: handleSTTResult,
    onError: handleSTTError,
  });

  // 优先使用讯飞，如果不可用则使用 Web Speech API
  const sttEngine = xunfeiSTT.isSupported ? xunfeiSTT : webSpeechSTT;
  const {
    isListening: isRecording,
    interimTranscript: sttInterim,
    startListening,
    stopListening,
  } = sttEngine;

  console.log('[STT] Using engine:', xunfeiSTT.isSupported ? 'Xunfei' : 'Web Speech API');

  // 同步 STT 的临时识别结果
  useEffect(() => {
    setInterimTranscript(sttInterim);
  }, [sttInterim]);

  const isProcessingVoice = false; // Web Speech API 不需要处理延迟

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
  const startCamera = useCallback(async (videoElement: HTMLVideoElement, facing: 'user' | 'environment' = 'user') => {
    try {
      // 先停掉旧的流
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: facing,
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
      await startListening();
    } catch (e) {
      throw new Error('Failed to start speech recognition');
    }
  }, [startListening]);

  // 停止录音
  const stopRecording = useCallback(async (): Promise<string> => {
    stopListening();
    // Web Speech API 会通过 onResult 回调返回结果
    // 这里返回当前的临时识别结果（如果有的话）
    const result = pendingTranscriptRef.current || '';
    pendingTranscriptRef.current = '';
    return result;
  }, [stopListening]);

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

    // 移除括号内的内容，不朗读
    const textToSpeak = removeParenthesesContent(text);
    if (!textToSpeak) {
      console.log('No text to speak after removing parentheses content');
      return;
    }

    const lipsyncMode = voiceConfig.lipsyncMode || 'preset';

    // 预设动画模式：生成TTS后由预设动画系统同步播放
    if (lipsyncMode === 'preset') {
      try {
        console.log('Generating TTS audio (preset mode)...');
        import('sonner').then(({ toast }) => toast.info(`🎤 调用MiniMax TTS...`));
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/minimax-tts`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({
              text: textToSpeak,
              apiKey: voiceConfig.minimaxApiKey,
              groupId: voiceConfig.minimaxGroupId,
              voiceId: voiceConfig.voiceId,
            }),
          }
        );

        if (!response.ok) {
          const error = await response.json();
          import('sonner').then(({ toast }) => toast.error(`❌ TTS API失败: ${error.error || response.status}`));
          throw new Error(error.error || 'TTS request failed');
        }

        const data = await response.json();
        
        if (data.audioContent) {
          console.log('TTS audio ready, passing to preset animation system for synced playback...');
          import('sonner').then(({ toast }) => toast.success(`✅ 音频就绪, 长度=${data.audioContent.length}, 有动画回调=${!!onPresetAnimationTrigger}`));
          
          // 将音频数据传递给预设动画系统，由它来处理同步播放
          if (onPresetAnimationTrigger) {
            await onPresetAnimationTrigger(data.audioContent);
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
        } else {
          import('sonner').then(({ toast }) => toast.error(`❌ TTS返回无音频数据`));
        }
      } catch (error) {
        console.error('TTS error:', error);
        import('sonner').then(({ toast }) => toast.error(`❌ TTS异常: ${error instanceof Error ? error.message : '未知错误'}`));
      }
      return;
    }

    // AI生成模式：原有逻辑
    // 先检查缓存（使用过滤后的文本作为key）
    const cached = getCachedVideo(textToSpeak);
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
            text: textToSpeak,
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
        const videoUrl = await generateLipsyncVideo(data.audioContent, textToSpeak);
        
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
      // 检查是否需要总结旧对话
      const allMessages = [...messages, userMessage];
      await checkAndSummarize(
        allMessages,
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
      );

      // 构建上下文消息（包含记忆摘要 + 最近消息）
      const contextMessages = buildContextMessages(allMessages);

      // 截取当前画面
      const image = includeImage ? captureFrame() : null;
      
      // 每次发消息时实时注入当前时间
      const nowDate = new Date();
      const nowStr = nowDate.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
      });
      const cnHour = parseInt(nowDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false }));
      const period = cnHour < 6 ? '凌晨' : cnHour < 9 ? '早上' : cnHour < 12 ? '上午' : cnHour < 14 ? '中午' : cnHour < 18 ? '下午' : cnHour < 22 ? '晚上' : '深夜';
      const realtimePrompt = systemPrompt.replace(
        /当前时间：.*/,
        `当前时间：${nowStr}（${period}）`
      );

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vision-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            messages: contextMessages,
            systemPrompt: realtimePrompt,
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
        import('sonner').then(({ toast }) => toast.info(`🔊 TTS开始: "${assistantContent.substring(0, 20)}..."`));
        await speak(assistantContent);
      } else {
        import('sonner').then(({ toast }) => toast.warning(`⚠️ TTS跳过: 内容=${!!assistantContent}, 语音=${settings.voiceConfig.enabled}`));
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
  }, [messages, systemPrompt, captureFrame, settings, speak, checkAndSummarize, buildContextMessages]);

  // 同步 sendMessage 到 ref，让 STT 回调始终调用最新版本
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  // 清除消息
  const clearMessages = useCallback(() => {
    setMessages([]);
    try {
      localStorage.removeItem(CHAT_HISTORY_KEY);
    } catch (e) {
      console.error('Failed to clear chat history:', e);
    }
  }, []);

  // 删除指定消息
  const deleteMessages = useCallback((messageIds: string[]) => {
    setMessages(prev => prev.filter(m => !messageIds.includes(m.id)));
  }, []);

  // 编辑指定消息
  const editMessage = useCallback((messageId: string, newContent: string) => {
    setMessages(prev => prev.map(m => 
      m.id === messageId ? { ...m, content: newContent } : m
    ));
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
    interimTranscript,
    memorySummary,
    isSummarizing,
    startCamera,
    stopCamera,
    captureFrame,
    startRecording,
    stopRecording,
    sendMessage,
    clearMessages,
    deleteMessages,
    editMessage,
    clearMemory,
    updateMemorySummary,
    speak,
    stopPlaying,
  };
}

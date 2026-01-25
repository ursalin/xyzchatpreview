import { useRef, useCallback, useState, useEffect } from 'react';

// 内置的说话动画（从 assets 导入）
import speakingAnimation1 from '@/assets/speaking-animation-1.mp4';

// 预设说话动画配置
export interface PresetAnimation {
  id: string;
  name: string;
  videoUrl: string;
  duration: number; // 毫秒
  isBuiltIn?: boolean; // 是否为内置动画
}

// 用于存储用户上传的预设动画
const PRESET_ANIMATIONS_KEY = 'preset_speaking_animations';

interface StoredAnimation {
  id: string;
  name: string;
  videoData: string; // base64 data URL
  duration: number;
}

// 内置动画列表（会在初始化时加载）
const BUILT_IN_ANIMATIONS: Array<{ id: string; name: string; videoUrl: string }> = [
  { id: 'builtin-speaking-1', name: '说话动画1', videoUrl: speakingAnimation1 },
];

// 获取音频时长（毫秒）
// 将 PCM16 base64 转换为 WAV data URL
export function pcm16ToWavDataUrl(pcmBase64: string, sampleRate = 24000): string {
  // 解码 base64 到 Uint8Array
  const binaryString = atob(pcmBase64);
  const pcmData = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    pcmData[i] = binaryString.charCodeAt(i);
  }

  // 创建 WAV 头
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length;

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
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // 合并头和数据
  const wavArray = new Uint8Array(44 + dataSize);
  wavArray.set(new Uint8Array(wavHeader), 0);
  wavArray.set(pcmData, 44);

  // 转回 base64
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < wavArray.length; i += chunkSize) {
    const chunk = wavArray.subarray(i, Math.min(i + chunkSize, wavArray.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

// 检测音频格式并返回正确的 data URL
function getAudioDataUrl(audioBase64: string): string {
  // 尝试检测格式：MP3 以 'SUQ' 或 '//' 开头，WAV 以 'UklG' 开头
  // PCM16 原始数据没有特定头部
  if (audioBase64.startsWith('SUQ') || audioBase64.startsWith('//')) {
    return `data:audio/mpeg;base64,${audioBase64}`;
  } else if (audioBase64.startsWith('UklG')) {
    return `data:audio/wav;base64,${audioBase64}`;
  } else {
    // 假设是 PCM16 原始数据，转换为 WAV
    console.log('Detected PCM16 audio, converting to WAV...');
    return pcm16ToWavDataUrl(audioBase64);
  }
}

// 获取音频时长（毫秒）- 支持多种格式
export function getAudioDuration(audioBase64: string): Promise<number> {
  return new Promise((resolve) => {
    const audioUrl = getAudioDataUrl(audioBase64);
    const audio = new Audio();
    
    audio.onloadedmetadata = () => {
      resolve(audio.duration * 1000);
    };
    
    audio.onerror = (e) => {
      console.warn('Could not get audio duration:', e, 'defaulting to 3000ms');
      resolve(3000);
    };
    
    // 超时保护
    setTimeout(() => resolve(3000), 2000);
    
    audio.src = audioUrl;
  });
}

export function usePresetAnimations() {
  const [animations, setAnimations] = useState<PresetAnimation[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAnimationId, setCurrentAnimationId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 加载内置动画的时长
  const loadBuiltInAnimations = useCallback(async () => {
    const builtInAnims: PresetAnimation[] = [];
    
    for (const anim of BUILT_IN_ANIMATIONS) {
      try {
        // 获取视频时长
        const duration = await new Promise<number>((resolve) => {
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.onloadedmetadata = () => resolve(video.duration * 1000);
          video.onerror = () => resolve(3000); // 默认3秒
          video.src = anim.videoUrl;
        });
        
        builtInAnims.push({
          id: anim.id,
          name: anim.name,
          videoUrl: anim.videoUrl,
          duration,
          isBuiltIn: true,
        });
        console.log(`Loaded built-in animation: ${anim.name} (${duration}ms)`);
      } catch (e) {
        console.error(`Failed to load built-in animation ${anim.name}:`, e);
      }
    }
    
    return builtInAnims;
  }, []);

  // 从 localStorage 加载用户动画 + 内置动画
  useEffect(() => {
    const loadAnimations = async () => {
      // 1. 加载内置动画
      const builtIn = await loadBuiltInAnimations();
      
      // 2. 加载用户上传的动画
      let userAnims: PresetAnimation[] = [];
      try {
        const stored = localStorage.getItem(PRESET_ANIMATIONS_KEY);
        if (stored) {
          const parsed: StoredAnimation[] = JSON.parse(stored);
          userAnims = parsed.map(a => ({
            id: a.id,
            name: a.name,
            videoUrl: a.videoData,
            duration: a.duration,
            isBuiltIn: false,
          }));
        }
      } catch (e) {
        console.error('Failed to load preset animations:', e);
      }
      
      // 合并：内置 + 用户上传
      setAnimations([...builtIn, ...userAnims]);
    };
    
    loadAnimations();
  }, [loadBuiltInAnimations]);

  // 保存动画到 localStorage（只保存用户上传的，不保存内置的）
  const saveAnimations = useCallback((anims: PresetAnimation[]) => {
    try {
      // 只保存非内置的动画
      const userAnims = anims.filter(a => !a.isBuiltIn);
      const toStore: StoredAnimation[] = userAnims.map(a => ({
        id: a.id,
        name: a.name,
        videoData: a.videoUrl,
        duration: a.duration,
      }));
      localStorage.setItem(PRESET_ANIMATIONS_KEY, JSON.stringify(toStore));
    } catch (e) {
      console.error('Failed to save preset animations:', e);
    }
  }, []);

  // 添加新的预设动画
  const addAnimation = useCallback((file: File): Promise<PresetAnimation> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const videoData = e.target?.result as string;
        
        // 创建临时视频元素获取时长
        const tempVideo = document.createElement('video');
        tempVideo.src = videoData;
        tempVideo.onloadedmetadata = () => {
          const newAnim: PresetAnimation = {
            id: crypto.randomUUID(),
            name: file.name.replace(/\.[^.]+$/, ''),
            videoUrl: videoData,
            duration: tempVideo.duration * 1000,
          };
          
          setAnimations(prev => {
            const updated = [...prev, newAnim];
            saveAnimations(updated);
            return updated;
          });
          
          resolve(newAnim);
        };
        tempVideo.onerror = () => reject(new Error('无法加载视频'));
      };
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
  }, [saveAnimations]);

  // 删除预设动画
  const removeAnimation = useCallback((id: string) => {
    setAnimations(prev => {
      const updated = prev.filter(a => a.id !== id);
      saveAnimations(updated);
      return updated;
    });
  }, [saveAnimations]);

  // 随机选择一个动画
  const getRandomAnimation = useCallback((): PresetAnimation | null => {
    if (animations.length === 0) return null;
    const index = Math.floor(Math.random() * animations.length);
    return animations[index];
  }, [animations]);

  // 选择最适合音频时长的动画
  const getBestAnimation = useCallback((audioDurationMs: number): PresetAnimation | null => {
    if (animations.length === 0) return null;
    
    // 优先选择时长接近的动画
    let best = animations[0];
    let bestDiff = Math.abs(best.duration - audioDurationMs);
    
    for (const anim of animations) {
      const diff = Math.abs(anim.duration - audioDurationMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = anim;
      }
    }
    
    return best;
  }, [animations]);

  // 核心同步播放函数 - 精确音画同步
  const playSynced = useCallback(async (
    audioBase64: string,
    onStart?: () => void,
    onEnd?: () => void
  ): Promise<void> => {
    // 1. 先获取音频时长
    const audioDurationMs = await getAudioDuration(audioBase64);
    console.log(`Audio duration: ${audioDurationMs}ms`);

    // 2. 选择最佳动画（根据时长匹配）
    const animation = getBestAnimation(audioDurationMs) || getRandomAnimation();
    
    // 3. 创建音频元素（自动检测格式）- 移动端兼容
    const audioUrl = getAudioDataUrl(audioBase64);
    const audio = new Audio();
    audio.preload = 'auto';
    (audio as any).playsInline = true;
    (audio as any).webkitPlaysInline = true;
    audio.src = audioUrl;
    audioRef.current = audio;
    
    // 如果没有预设动画，只播放音频
    if (!animation) {
      console.log('No preset animation available, playing audio only');
      audio.onplay = () => {
        setIsPlaying(true);
        onStart?.();
      };
      audio.onended = () => {
        setIsPlaying(false);
        onEnd?.();
      };
      // 等待音频加载完成
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 2000);
        audio.oncanplaythrough = () => { clearTimeout(timeout); resolve(); };
        audio.load();
      });
      await audio.play();
      return;
    }

    console.log(`Selected animation: ${animation.name} (${animation.duration}ms) for audio ${audioDurationMs}ms`);

    return new Promise((resolve) => {
      // 4. 创建视频元素
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = animation.videoUrl;
      videoRef.current = video;

      // 5. 计算播放速率以匹配音频时长
      const playbackRate = animation.duration / audioDurationMs;
      // 限制播放速率在合理范围内 (0.5x - 2x)
      const clampedRate = Math.max(0.5, Math.min(2.0, playbackRate));
      console.log(`Playback rate: ${clampedRate.toFixed(2)}x`);

      let videoReady = false;
      let audioReady = false;
      let started = false;

      const tryStart = async () => {
        if (!videoReady || !audioReady || started) return;
        started = true;

        console.log('Both media ready, starting synced playback');
        setIsPlaying(true);
        setCurrentAnimationId(animation.id);
        onStart?.();

        // 设置播放速率
        video.playbackRate = clampedRate;
        
        // 同步开始播放
        try {
          video.currentTime = 0;
          audio.currentTime = 0;
          
          // 同时触发播放
          await Promise.all([video.play(), audio.play()]);
        } catch (e) {
          console.error('Synced playback error:', e);
          // 尝试只播放音频
          try { await audio.play(); } catch { /* ignore */ }
        }
      };

      const onFinish = () => {
        setIsPlaying(false);
        setCurrentAnimationId(null);
        video.pause();
        video.src = '';
        onEnd?.();
        resolve();
      };

      // 视频就绪检测
      video.oncanplaythrough = () => {
        if (!videoReady) {
          videoReady = true;
          console.log('Video ready');
          tryStart();
        }
      };

      // 音频就绪检测
      audio.oncanplaythrough = () => {
        if (!audioReady) {
          audioReady = true;
          console.log('Audio ready');
          tryStart();
        }
      };

      // 以音频结束为准
      audio.onended = () => {
        console.log('Audio ended, stopping video');
        onFinish();
      };

      // 如果音频比视频长，视频需要循环
      video.onended = () => {
        if (!audio.ended && !audio.paused) {
          console.log('Video ended but audio still playing, looping video');
          video.currentTime = 0;
          video.play().catch(() => {});
        }
      };

      audio.onerror = (e) => {
        console.error('Audio error:', e);
        onFinish();
      };

      // 超时保护：如果5秒内没开始，强制开始
      setTimeout(() => {
        if (!started) {
          console.warn('Timeout waiting for media ready, forcing start');
          videoReady = true;
          audioReady = true;
          tryStart();
        }
      }, 5000);

      // 开始加载
      video.load();
      audio.load();
    });
  }, [getRandomAnimation, getBestAnimation]);

  // 停止播放
  const stopPlaying = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
      videoRef.current = null;
    }
    setIsPlaying(false);
    setCurrentAnimationId(null);
  }, []);

  return {
    animations,
    isPlaying,
    currentAnimationId,
    addAnimation,
    removeAnimation,
    getRandomAnimation,
    getBestAnimation,
    playSynced,
    stopPlaying,
    hasAnimations: animations.length > 0,
  };
}

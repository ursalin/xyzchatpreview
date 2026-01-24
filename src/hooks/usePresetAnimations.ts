import { useRef, useCallback, useState, useEffect } from 'react';

// 预设说话动画配置
export interface PresetAnimation {
  id: string;
  name: string;
  videoUrl: string;
  duration: number; // 毫秒
}

// 用于存储用户上传的预设动画
const PRESET_ANIMATIONS_KEY = 'preset_speaking_animations';

interface StoredAnimation {
  id: string;
  name: string;
  videoData: string; // base64 data URL
  duration: number;
}

// 获取音频时长（毫秒）
export function getAudioDuration(audioBase64: string): Promise<number> {
  return new Promise((resolve) => {
    const audioUrl = `data:audio/mpeg;base64,${audioBase64}`;
    const audio = new Audio();
    
    audio.onloadedmetadata = () => {
      resolve(audio.duration * 1000);
    };
    
    audio.onerror = () => {
      console.warn('Could not get audio duration, defaulting to 3000ms');
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

  // 从 localStorage 加载已保存的动画
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PRESET_ANIMATIONS_KEY);
      if (stored) {
        const parsed: StoredAnimation[] = JSON.parse(stored);
        setAnimations(parsed.map(a => ({
          id: a.id,
          name: a.name,
          videoUrl: a.videoData,
          duration: a.duration,
        })));
      }
    } catch (e) {
      console.error('Failed to load preset animations:', e);
    }
  }, []);

  // 保存动画到 localStorage
  const saveAnimations = useCallback((anims: PresetAnimation[]) => {
    try {
      const toStore: StoredAnimation[] = anims.map(a => ({
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
    
    // 3. 创建音频元素
    const audioUrl = `data:audio/mpeg;base64,${audioBase64}`;
    const audio = new Audio(audioUrl);
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

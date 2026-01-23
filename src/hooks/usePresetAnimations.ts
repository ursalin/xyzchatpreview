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

  // 同步播放音频和预设动画
  const playSynced = useCallback(async (
    audioBase64: string,
    video: HTMLVideoElement,
    onStart?: () => void,
    onEnd?: () => void
  ): Promise<void> => {
    // 获取随机或最佳动画
    const animation = getRandomAnimation();
    if (!animation) {
      // 没有预设动画，只播放音频
      const audioUrl = `data:audio/mpeg;base64,${audioBase64}`;
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      
      audio.onplay = () => onStart?.();
      audio.onended = () => onEnd?.();
      
      await audio.play();
      return;
    }

    return new Promise((resolve) => {
      const audioUrl = `data:audio/mpeg;base64,${audioBase64}`;
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      videoRef.current = video;

      // 设置视频源
      video.src = animation.videoUrl;
      video.load();

      let videoReady = false;
      let audioReady = false;
      let started = false;

      const tryStart = async () => {
        if (!videoReady || !audioReady || started) return;
        started = true;

        setIsPlaying(true);
        setCurrentAnimationId(animation.id);
        onStart?.();

        // 同时开始播放
        try {
          video.currentTime = 0;
          audio.currentTime = 0;
          await Promise.all([video.play(), audio.play()]);
        } catch (e) {
          console.error('Synced playback error:', e);
        }
      };

      const onFinish = () => {
        setIsPlaying(false);
        setCurrentAnimationId(null);
        onEnd?.();
        resolve();
      };

      video.oncanplaythrough = () => {
        videoReady = true;
        tryStart();
      };

      audio.oncanplaythrough = () => {
        audioReady = true;
        tryStart();
      };

      // 音频结束时停止视频（音频为主）
      audio.onended = () => {
        video.pause();
        video.currentTime = 0;
        onFinish();
      };

      // 如果音频较长，视频循环播放
      video.onended = () => {
        if (!audio.ended && !audio.paused) {
          video.currentTime = 0;
          video.play().catch(() => {});
        }
      };

      audio.onerror = () => {
        video.pause();
        onFinish();
      };
    });
  }, [getRandomAnimation]);

  // 停止播放
  const stopPlaying = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
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

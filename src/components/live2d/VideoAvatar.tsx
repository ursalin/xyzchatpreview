import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Upload, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import idleVideo from '@/assets/character-idle.mp4';
import posterImg from '@/assets/character-front.jpg';

interface VideoAvatarProps {
  isSpeaking?: boolean;
  onImageLoaded?: () => void;
}

const VideoAvatar: React.FC<VideoAvatarProps> = ({ 
  isSpeaking = false,
  onImageLoaded 
}) => {
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeVideoRef = useRef<'A' | 'B'>('A');
  const switchingRef = useRef(false);

  const [customVideo, setCustomVideo] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeVideo, setActiveVideo] = useState<'A' | 'B'>('A');

  const src = customVideo || idleVideo;


  // 行业标杆无缝循环：
  // 1) 用 rAF 高频监测剩余时间（避免 timeupdate 低频导致错过切点）
  // 2) 提前“预热”下一段：先播放到解码出首帧后立刻暂停
  // 3) 临近结尾时再瞬时切换到已预热的视频并继续播放，避免结尾解码停顿/静止帧
  const setupSeamlessLoop = useCallback((currentSrc: string) => {
    const videoA = videoARef.current;
    const videoB = videoBRef.current;
    if (!videoA || !videoB) return;

    // 预热阈值要明显早于切换阈值，否则来不及解码会出现“卡一下/静止帧”
    const ARM_THRESHOLD_S = 0.8;
    const SWITCH_THRESHOLD_S = 0.28;
    const MIN_PROGRESS_S = 0.03; // 切过去前确保已经推进一点点（避免显示首帧定住）

    let rafId: number | null = null;
    let destroyed = false;

    const armedRef = { current: false };

    const safePlay = async (v: HTMLVideoElement) => {
      try {
        await v.play();
      } catch {
        // muted + playsInline 通常允许自动播放；失败也不应让循环崩掉
      }
    };

    const waitNextFrame = (v: HTMLVideoElement) =>
      new Promise<void>((resolve) => {
        // requestVideoFrameCallback 最稳（Chrome/Edge/部分 Safari）
        const anyV = v as any;
        if (typeof anyV.requestVideoFrameCallback === 'function') {
          anyV.requestVideoFrameCallback(() => resolve());
          return;
        }
        // 兜底：至少等一个宏任务 + rAF
        setTimeout(() => requestAnimationFrame(() => resolve()), 0);
      });

    const primeVideo = async (v: HTMLVideoElement) => {
      // 把下一段预热到“首帧已解码”，但不要让它持续播放（避免跑到结尾）
      try {
        v.pause();
        v.currentTime = 0;
      } catch {
        // ignore
      }

      // 强制浏览器开始拉取/解码
      v.load();
      await safePlay(v);
      await waitNextFrame(v);
      v.pause();
    };

    const switchTo = async (nextKey: 'A' | 'B') => {
      if (switchingRef.current || destroyed) return;

      const currentVideo = nextKey === 'A' ? videoB : videoA;
      const nextVideo = nextKey === 'A' ? videoA : videoB;

      switchingRef.current = true;
      try {
        // 重新从 0 播放，并确保“真的开始动了”再切可见层
        try {
          nextVideo.currentTime = 0;
        } catch {
          // ignore
        }

        await safePlay(nextVideo);

        // 等到 nextVideo 至少推进一点点（避免切过去显示首帧静止）
        const start = performance.now();
        while (!destroyed) {
          if (nextVideo.currentTime >= MIN_PROGRESS_S) break;
          await waitNextFrame(nextVideo);
          // 兜底：最多等 250ms，防止死等
          if (performance.now() - start > 250) break;
        }

        activeVideoRef.current = nextKey;
        setActiveVideo(nextKey);

        // 当前视频变成“下一次的缓冲”，重置并重新 load
        currentVideo.pause();
        try {
          currentVideo.currentTime = 0;
        } catch {
          // ignore
        }
        currentVideo.load();

        armedRef.current = false;
      } finally {
        switchingRef.current = false;
      }
    };

    const getActive = () => (activeVideoRef.current === 'A' ? videoA : videoB);
    const getInactive = () => (activeVideoRef.current === 'A' ? videoB : videoA);

    const monitor = async () => {
      if (destroyed) return;

      const current = getActive();
      const inactive = getInactive();
      const d = current.duration;

      if (Number.isFinite(d) && d > 0) {
        const remaining = d - current.currentTime;

        // 提前预热下一段
        if (!armedRef.current && remaining <= ARM_THRESHOLD_S && remaining > SWITCH_THRESHOLD_S) {
          armedRef.current = true;
          void primeVideo(inactive);
        }

        // 临近结尾：瞬时切换
        if (remaining <= SWITCH_THRESHOLD_S && remaining > 0) {
          void switchTo(activeVideoRef.current === 'A' ? 'B' : 'A');
        }
      }

      rafId = requestAnimationFrame(() => {
        void monitor();
      });
    };

    // 初始化：保证两路都指向同一 src，A 可见播放，B 预热缓冲
    destroyed = false;
    switchingRef.current = false;
    activeVideoRef.current = 'A';
    setActiveVideo('A');

    videoA.src = currentSrc;
    videoB.src = currentSrc;

    try {
      videoA.pause();
      videoB.pause();
      videoA.currentTime = 0;
      videoB.currentTime = 0;
    } catch {
      // ignore
    }

    videoA.load();
    videoB.load();

    const onCanPlayA = () => {
      void safePlay(videoA);
      // 先把 B 预热好，避免第一次循环边界就卡一下
      void primeVideo(videoB);
    };

    const onEndedA = () => {
      // 极端兜底：就算切换没发生也不允许停住
      if (activeVideoRef.current === 'A') {
        videoA.currentTime = 0;
        void safePlay(videoA);
      }
    };

    const onEndedB = () => {
      if (activeVideoRef.current === 'B') {
        videoB.currentTime = 0;
        void safePlay(videoB);
      }
    };

    videoA.addEventListener('canplay', onCanPlayA, { once: true });
    videoA.addEventListener('ended', onEndedA);
    videoB.addEventListener('ended', onEndedB);

    void monitor();

    return () => {
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      videoA.removeEventListener('ended', onEndedA);
      videoB.removeEventListener('ended', onEndedB);
    };
  }, []);

  useEffect(() => {
    const cleanup = setupSeamlessLoop(src);
    return cleanup;
  }, [src, setupSeamlessLoop]);

  // Adjust playback rate based on speaking state
  useEffect(() => {
    const rate = isSpeaking ? 1.15 : 1.0;
    if (videoARef.current) videoARef.current.playbackRate = rate;
    if (videoBRef.current) videoBRef.current.playbackRate = rate;
  }, [isSpeaking]);

  const handleVideoLoad = () => {
    setIsLoaded(true);
    onImageLoaded?.();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file);
      setCustomVideo(url);
      setIsLoaded(false);
    }
  };

  const handleReset = () => {
    if (customVideo) {
      URL.revokeObjectURL(customVideo);
    }
    setCustomVideo(null);
    setIsLoaded(false);
  };

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 rounded-xl overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleFileSelect}
        className="hidden"
      />
      
      {/* 双缓冲视频 - 瞬时切换实现无缝循环 */}
      <video
        ref={videoARef}
        src={src}
        muted
        playsInline
        preload="auto"
        poster={posterImg}
        onLoadedData={handleVideoLoad}
        className="absolute inset-0 w-full h-full object-contain"
        style={{
          filter: isSpeaking ? 'brightness(1.05)' : 'brightness(1)',
          transition: 'filter 0.3s ease',
          opacity: activeVideo === 'A' ? 1 : 0,
          pointerEvents: activeVideo === 'A' ? 'auto' : 'none',
        }}
      />
      <video
        ref={videoBRef}
        src={src}
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 w-full h-full object-contain"
        style={{
          filter: isSpeaking ? 'brightness(1.05)' : 'brightness(1)',
          transition: 'filter 0.3s ease',
          opacity: activeVideo === 'B' ? 1 : 0,
          pointerEvents: activeVideo === 'B' ? 'auto' : 'none',
        }}
      />

      {/* Loading spinner */}
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent"></div>
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-4 right-4 flex gap-2">
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8 bg-background/80 backdrop-blur-sm hover:bg-background/90"
          onClick={() => fileInputRef.current?.click()}
          title="上传自定义视频"
        >
          <Upload className="h-4 w-4" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8 bg-background/80 backdrop-blur-sm hover:bg-background/90"
          onClick={handleReset}
          title="恢复默认"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default VideoAvatar;

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

  // 行业标杆无缝循环：双 video 双缓冲，在结束前瞬时切换到已预加载视频，避免结尾解码停顿
  const setupSeamlessLoop = useCallback(() => {
    const videoA = videoARef.current;
    const videoB = videoBRef.current;
    if (!videoA || !videoB) return;

    const SWITCH_THRESHOLD = 0.18; // 稍提前一点，给解码/渲染留余量

    const safePlay = async (v: HTMLVideoElement) => {
      try {
        await v.play();
      } catch {
        // muted + playsInline normally allows autoplay; ignore failures but don't break loop
      }
    };

    const canSwitchTo = (v: HTMLVideoElement) => v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;

    const doSwitch = async (currentVideo: HTMLVideoElement, nextVideo: HTMLVideoElement, nextKey: 'A' | 'B') => {
      if (switchingRef.current) return;
      if (!canSwitchTo(nextVideo)) {
        // 还没解码到可播放帧：触发加载但不切换，避免切过去定住
        nextVideo.load();
        return;
      }

      switchingRef.current = true;
      try {
        try {
          nextVideo.currentTime = 0;
        } catch {
          // ignore
        }

        await safePlay(nextVideo);

        activeVideoRef.current = nextKey;
        setActiveVideo(nextKey);

        currentVideo.pause();
        try {
          currentVideo.currentTime = 0;
        } catch {
          // ignore
        }

        // 让旧视频重新进入“可播放”状态，作为下一次切换的缓冲
        currentVideo.load();
      } finally {
        switchingRef.current = false;
      }
    };

    const handleTimeUpdate = (currentVideo: HTMLVideoElement, nextVideo: HTMLVideoElement, nextKey: 'A' | 'B') => {
      const d = currentVideo.duration;
      if (!Number.isFinite(d) || d <= 0) return;

      const remaining = d - currentVideo.currentTime;
      if (remaining <= SWITCH_THRESHOLD && remaining > 0) {
        void doSwitch(currentVideo, nextVideo, nextKey);
      }
    };

    const onTimeUpdateA = () => handleTimeUpdate(videoA, videoB, 'B');
    const onTimeUpdateB = () => handleTimeUpdate(videoB, videoA, 'A');

    const onEndedA = () => {
      // 兜底：万一没赶上切换，至少不要停住
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

    videoA.addEventListener('timeupdate', onTimeUpdateA);
    videoB.addEventListener('timeupdate', onTimeUpdateB);
    videoA.addEventListener('ended', onEndedA);
    videoB.addEventListener('ended', onEndedB);

    // 初始化：A播放，B做缓冲（都先load，避免后续切换时没解码帧导致定住）
    switchingRef.current = false;
    activeVideoRef.current = 'A';
    setActiveVideo('A');

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
      videoA.removeEventListener('canplay', onCanPlayA);
    };

    videoA.addEventListener('canplay', onCanPlayA);

    return () => {
      videoA.removeEventListener('timeupdate', onTimeUpdateA);
      videoB.removeEventListener('timeupdate', onTimeUpdateB);
      videoA.removeEventListener('ended', onEndedA);
      videoB.removeEventListener('ended', onEndedB);
      videoA.removeEventListener('canplay', onCanPlayA);
    };
  }, []);

  useEffect(() => {
    const cleanup = setupSeamlessLoop();
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

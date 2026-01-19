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

  const [customVideo, setCustomVideo] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeVideo, setActiveVideo] = useState<'A' | 'B'>('A');

  const src = customVideo || idleVideo;

  // 双缓冲无缝循环：在视频结束前切换到另一个已预加载的视频
  const setupSeamlessLoop = useCallback(() => {
    const videoA = videoARef.current;
    const videoB = videoBRef.current;
    if (!videoA || !videoB) return;

    const SWITCH_THRESHOLD = 0.15; // 在结束前150ms切换

    const handleTimeUpdate = (currentVideo: HTMLVideoElement, nextVideo: HTMLVideoElement, isA: boolean) => {
      const remaining = currentVideo.duration - currentVideo.currentTime;
      
      if (remaining <= SWITCH_THRESHOLD && remaining > 0) {
        // 预备切换：确保下一个视频已就绪并从头开始
        nextVideo.currentTime = 0;
        nextVideo.play().catch(() => {});
        
        // 瞬时切换显示
        activeVideoRef.current = isA ? 'B' : 'A';
        setActiveVideo(activeVideoRef.current);
        
        // 暂停当前视频并重置
        currentVideo.pause();
        currentVideo.currentTime = 0;
      }
    };

    const onTimeUpdateA = () => handleTimeUpdate(videoA, videoB, true);
    const onTimeUpdateB = () => handleTimeUpdate(videoB, videoA, false);

    videoA.addEventListener('timeupdate', onTimeUpdateA);
    videoB.addEventListener('timeupdate', onTimeUpdateB);

    // 初始化：播放A，预加载B
    videoA.currentTime = 0;
    videoA.play().catch(() => {});
    videoB.currentTime = 0;
    videoB.load();

    return () => {
      videoA.removeEventListener('timeupdate', onTimeUpdateA);
      videoB.removeEventListener('timeupdate', onTimeUpdateB);
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

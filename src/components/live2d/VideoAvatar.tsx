import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Upload, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import idleVideo from '@/assets/character-idle.mp4';
import sideVideo from '@/assets/character-side.mp4';

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
  
  const [activeVideo, setActiveVideo] = useState<'A' | 'B'>('A');
  const [videoSources] = useState([idleVideo, sideVideo]);
  const [customVideo, setCustomVideo] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Handle video transition with fade
  const handleVideoTimeUpdate = useCallback((video: HTMLVideoElement, isActiveVideo: boolean) => {
    if (!isActiveVideo || isTransitioning || customVideo) return;
    
    const timeRemaining = video.duration - video.currentTime;
    
    // Start transition 0.8s before video ends
    if (timeRemaining <= 0.8 && timeRemaining > 0) {
      setIsTransitioning(true);
      
      // Switch to other video
      setActiveVideo(prev => prev === 'A' ? 'B' : 'A');
      
      // Reset transition flag after animation completes
      setTimeout(() => {
        setIsTransitioning(false);
      }, 800);
    }
  }, [isTransitioning, customVideo]);

  // Set up video sources
  useEffect(() => {
    if (customVideo) {
      if (videoARef.current) videoARef.current.src = customVideo;
      if (videoBRef.current) videoBRef.current.src = customVideo;
    } else {
      if (videoARef.current) videoARef.current.src = videoSources[0];
      if (videoBRef.current) videoBRef.current.src = videoSources[1];
    }
  }, [customVideo, videoSources]);

  // Handle time updates for seamless looping
  useEffect(() => {
    const videoA = videoARef.current;
    const videoB = videoBRef.current;
    
    const handleTimeUpdateA = () => handleVideoTimeUpdate(videoA!, activeVideo === 'A');
    const handleTimeUpdateB = () => handleVideoTimeUpdate(videoB!, activeVideo === 'B');
    
    if (videoA) videoA.addEventListener('timeupdate', handleTimeUpdateA);
    if (videoB) videoB.addEventListener('timeupdate', handleTimeUpdateB);
    
    return () => {
      if (videoA) videoA.removeEventListener('timeupdate', handleTimeUpdateA);
      if (videoB) videoB.removeEventListener('timeupdate', handleTimeUpdateB);
    };
  }, [activeVideo, handleVideoTimeUpdate]);

  // Control playback based on active video
  useEffect(() => {
    const videoA = videoARef.current;
    const videoB = videoBRef.current;
    
    if (activeVideo === 'A') {
      videoA?.play().catch(() => {});
      if (videoB && !customVideo) {
        videoB.currentTime = 0;
      }
    } else {
      videoB?.play().catch(() => {});
      if (videoA && !customVideo) {
        videoA.currentTime = 0;
      }
    }
  }, [activeVideo, customVideo]);

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
      setActiveVideo('A');
    }
  };

  const handleReset = () => {
    if (customVideo) {
      URL.revokeObjectURL(customVideo);
    }
    setCustomVideo(null);
    setIsLoaded(false);
    setActiveVideo('A');
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
      
      {/* Video A (Front view / Custom) */}
      <video
        ref={videoARef}
        src={customVideo || videoSources[0]}
        autoPlay
        loop={!!customVideo}
        muted
        playsInline
        onLoadedData={handleVideoLoad}
        className="absolute inset-0 w-full h-full object-contain transition-opacity duration-700 ease-in-out"
        style={{
          opacity: activeVideo === 'A' ? 1 : 0,
          filter: isSpeaking ? 'brightness(1.05)' : 'brightness(1)',
          transition: 'opacity 0.7s ease-in-out, filter 0.3s ease'
        }}
      />
      
      {/* Video B (Side view) - only used when no custom video */}
      {!customVideo && (
        <video
          ref={videoBRef}
          src={videoSources[1]}
          autoPlay
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-contain transition-opacity duration-700 ease-in-out"
          style={{
            opacity: activeVideo === 'B' ? 1 : 0,
            filter: isSpeaking ? 'brightness(1.05)' : 'brightness(1)',
            transition: 'opacity 0.7s ease-in-out, filter 0.3s ease'
          }}
        />
      )}

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

      {/* Speaking indicator */}
      {isSpeaking && (
        <div className="absolute bottom-4 left-4 flex items-center gap-2 px-3 py-1.5 bg-primary/20 backdrop-blur-sm rounded-full">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
          <span className="text-xs text-primary font-medium">说话中</span>
        </div>
      )}
    </div>
  );
};

export default VideoAvatar;

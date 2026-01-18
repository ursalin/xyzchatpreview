import React, { useRef, useEffect, useState } from 'react';
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
  const isTransitioningRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [customVideo, setCustomVideo] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [active, setActive] = useState<'A' | 'B'>('A');
  const [aOpacity, setAOpacity] = useState(1);
  const [bOpacity, setBOpacity] = useState(0);

  const src = customVideo || idleVideo;
  const CROSSFADE_SECONDS = 0.35;

  // Seamless loop via double-buffer crossfade (prevents white/black frame at loop boundary)
  useEffect(() => {
    const a = videoARef.current;
    const b = videoBRef.current;
    if (!a || !b) return;

    isTransitioningRef.current = false;
    setActive('A');
    setAOpacity(1);
    setBOpacity(0);
    setIsLoaded(false);

    const prime = (v: HTMLVideoElement) => {
      try {
        v.pause();
        v.currentTime = 0;
        v.load();
      } catch {
        // ignore
      }
    };

    prime(a);
    prime(b);

    const onCanPlay = () => {
      void a.play().catch(() => {});
    };

    a.addEventListener('canplay', onCanPlay, { once: true });
    return () => a.removeEventListener('canplay', onCanPlay);
  }, [src]);

  useEffect(() => {
    const a = videoARef.current;
    const b = videoBRef.current;
    if (!a || !b) return;

    const activeEl = active === 'A' ? a : b;
    const nextEl = active === 'A' ? b : a;

    const onTimeUpdate = () => {
      if (isTransitioningRef.current) return;

      const d = activeEl.duration;
      if (!Number.isFinite(d) || d <= 0) return;

      const remaining = d - activeEl.currentTime;
      if (remaining <= CROSSFADE_SECONDS && remaining > 0) {
        isTransitioningRef.current = true;

        try {
          nextEl.currentTime = 0;
        } catch {
          // ignore
        }

        nextEl.playbackRate = activeEl.playbackRate;
        void nextEl.play().catch(() => {});

        // kick crossfade on next frame to ensure nextEl has begun rendering
        requestAnimationFrame(() => {
          if (active === 'A') {
            setAOpacity(0);
            setBOpacity(1);
          } else {
            setAOpacity(1);
            setBOpacity(0);
          }
        });

        window.setTimeout(() => {
          activeEl.pause();
          try {
            activeEl.currentTime = 0;
          } catch {
            // ignore
          }

          const next = active === 'A' ? 'B' : 'A';
          setActive(next);

          // ensure stable final state
          if (next === 'A') {
            setAOpacity(1);
            setBOpacity(0);
          } else {
            setAOpacity(0);
            setBOpacity(1);
          }

          isTransitioningRef.current = false;
        }, CROSSFADE_SECONDS * 1000);
      }
    };

    activeEl.addEventListener('timeupdate', onTimeUpdate);
    return () => activeEl.removeEventListener('timeupdate', onTimeUpdate);
  }, [active, src]);

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
      
      {/* Double-buffer Videos (crossfade loop) */}
      <video
        ref={videoARef}
        src={src}
        autoPlay
        muted
        playsInline
        preload="auto"
        poster={posterImg}
        onLoadedData={handleVideoLoad}
        className="absolute inset-0 w-full h-full object-contain"
        style={{
          opacity: aOpacity,
          filter: isSpeaking ? 'brightness(1.05)' : 'brightness(1)',
          transition: `opacity ${Math.round(CROSSFADE_SECONDS * 1000)}ms linear, filter 0.3s ease`,
        }}
      />
      <video
        ref={videoBRef}
        src={src}
        autoPlay
        muted
        playsInline
        preload="auto"
        poster={posterImg}
        onLoadedData={handleVideoLoad}
        className="absolute inset-0 w-full h-full object-contain"
        style={{
          opacity: bOpacity,
          filter: isSpeaking ? 'brightness(1.05)' : 'brightness(1)',
          transition: `opacity ${Math.round(CROSSFADE_SECONDS * 1000)}ms linear, filter 0.3s ease`,
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

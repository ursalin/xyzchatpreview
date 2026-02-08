import React, { useRef, forwardRef, useImperativeHandle, useCallback, useState } from 'react';
import posterImg from '@/assets/character-front.jpg';
import idleVideo from '@/assets/character-idle.mp4';

export interface VideoAvatarRef {
  playPresetAnimation: () => void;
}

interface VideoAvatarProps {
  isSpeaking?: boolean;
  lipsyncVideoUrl?: string | null;
  onImageLoaded?: () => void;
}

// 最简方案：单个 <video> 标签 + loop
// 闪不闪完全取决于视频素材首尾是否衔接
const VideoAvatar = forwardRef<VideoAvatarRef, VideoAvatarProps>(({ 
  isSpeaking = false,
  onImageLoaded 
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);

  const playPresetAnimation = useCallback(() => {
    // 说话时加速播放
    if (videoRef.current) {
      videoRef.current.playbackRate = 1.3;
      setTimeout(() => {
        if (videoRef.current) videoRef.current.playbackRate = 1.0;
      }, 2000);
    }
  }, []);

  useImperativeHandle(ref, () => ({
    playPresetAnimation,
  }), [playPresetAnimation]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden">
      {/* 静态封面图：视频加载前显示 */}
      {!videoReady && (
        <img
          src={posterImg}
          alt="Character"
          onLoad={() => onImageLoaded?.()}
          className="absolute inset-0 w-full h-full object-contain z-10"
        />
      )}

      {/* 单视频循环 — 就这么简单 */}
      <video
        ref={videoRef}
        src={idleVideo}
        muted
        autoPlay
        loop
        playsInline
        preload="auto"
        poster={posterImg}
        onCanPlay={() => {
          setVideoReady(true);
          onImageLoaded?.();
        }}
        className="w-full h-full object-contain"
        style={{
          filter: isSpeaking ? 'brightness(1.05)' : 'brightness(1)',
          transition: 'filter 0.3s ease',
        }}
      />
    </div>
  );
});

VideoAvatar.displayName = 'VideoAvatar';

export default VideoAvatar;

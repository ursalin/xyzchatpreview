import React, { forwardRef, useImperativeHandle, useCallback } from 'react';
import posterImg from '@/assets/character-front.jpg';

export interface VideoAvatarRef {
  playPresetAnimation: () => void;
}

interface VideoAvatarProps {
  isSpeaking?: boolean;
  lipsyncVideoUrl?: string | null;
  onImageLoaded?: () => void;
}

const VideoAvatar = forwardRef<VideoAvatarRef, VideoAvatarProps>(({ 
  isSpeaking = false,
  onImageLoaded 
}, ref) => {

  const playPresetAnimation = useCallback(() => {
    // 不需要做什么，动画由 CSS 控制
  }, []);

  useImperativeHandle(ref, () => ({
    playPresetAnimation,
  }), [playPresetAnimation]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden">
      <img
        src={posterImg}
        alt="Character"
        onLoad={() => onImageLoaded?.()}
        className="w-full h-full object-contain"
        style={{
          animation: isSpeaking 
            ? 'speaking-pulse 2s ease-in-out infinite' 
            : 'idle-breathe 4s ease-in-out infinite',
        }}
      />
      <style>{`
        @keyframes idle-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.008); }
        }
        @keyframes speaking-pulse {
          0%, 100% { transform: scale(1); filter: brightness(1); }
          50% { transform: scale(1.012); filter: brightness(1.03); }
        }
      `}</style>
    </div>
  );
});

VideoAvatar.displayName = 'VideoAvatar';

export default VideoAvatar;

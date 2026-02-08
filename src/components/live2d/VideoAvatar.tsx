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
  onImageLoaded 
}, ref) => {

  const playPresetAnimation = useCallback(() => {}, []);

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
      />
    </div>
  );
});

VideoAvatar.displayName = 'VideoAvatar';

export default VideoAvatar;

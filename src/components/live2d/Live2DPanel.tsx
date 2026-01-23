import React, { useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import VideoAvatar from './VideoAvatar';

export interface Live2DPanelRef {
  playPresetAnimation: () => void;
}

interface Live2DPanelProps {
  isSpeaking?: boolean;
  lipsyncVideoUrl?: string | null;
  isGeneratingLipsync?: boolean;
}

const Live2DPanel = forwardRef<Live2DPanelRef, Live2DPanelProps>(({ 
  isSpeaking = false,
  lipsyncVideoUrl = null,
  isGeneratingLipsync = false,
}, ref) => {
  const videoAvatarRef = useRef<{ playPresetAnimation: () => void } | null>(null);

  useImperativeHandle(ref, () => ({
    playPresetAnimation: () => {
      videoAvatarRef.current?.playPresetAnimation();
    },
  }));

  return (
    <div className="w-full h-full min-h-[400px] rounded-xl overflow-hidden bg-gradient-to-br from-primary/5 via-background to-secondary/5 relative">
      <VideoAvatar 
        ref={videoAvatarRef}
        isSpeaking={isSpeaking}
        lipsyncVideoUrl={lipsyncVideoUrl}
        onImageLoaded={() => console.log('Video avatar loaded')}
      />
      
      {/* 唇形动画生成状态指示 */}
      {isGeneratingLipsync && (
        <div className="absolute top-3 left-3 flex items-center gap-2 bg-blue-500/90 text-white px-3 py-1.5 rounded-full text-xs">
          <div className="w-2 h-2 border border-white border-t-transparent rounded-full animate-spin" />
          生成唇形动画中...
        </div>
      )}
    </div>
  );
});

Live2DPanel.displayName = 'Live2DPanel';

export default Live2DPanel;

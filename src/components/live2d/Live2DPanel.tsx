import React, { useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import VideoAvatar from './VideoAvatar';
import { usePresetAnimations } from '@/hooks/usePresetAnimations';

export interface Live2DPanelRef {
  playPresetAnimation: (audioBase64: string) => Promise<void>;
}

interface Live2DPanelProps {
  isSpeaking?: boolean;
  lipsyncVideoUrl?: string | null;
  isGeneratingLipsync?: boolean;
  onSpeakingChange?: (isSpeaking: boolean) => void;
}

const Live2DPanel = forwardRef<Live2DPanelRef, Live2DPanelProps>(({ 
  isSpeaking = false,
  lipsyncVideoUrl = null,
  isGeneratingLipsync = false,
  onSpeakingChange,
}, ref) => {
  const videoAvatarRef = useRef<{ playPresetAnimation: () => void } | null>(null);
  const { playSynced, hasAnimations, isPlaying } = usePresetAnimations();

  // 当预设动画播放状态变化时通知父组件
  React.useEffect(() => {
    onSpeakingChange?.(isPlaying);
  }, [isPlaying, onSpeakingChange]);

  useImperativeHandle(ref, () => ({
    playPresetAnimation: async (audioBase64: string) => {
      console.log('Live2DPanel: Starting synced preset animation playback');
      
      // 如果有预设动画，使用同步播放
      if (hasAnimations) {
        await playSynced(
          audioBase64,
          () => console.log('Preset animation started'),
          () => console.log('Preset animation ended')
        );
      } else {
        // 没有预设动画时，加速idle视频模拟说话
        videoAvatarRef.current?.playPresetAnimation();
        
        // 直接播放音频
        const audioUrl = `data:audio/mpeg;base64,${audioBase64}`;
        const audio = new Audio(audioUrl);
        await audio.play();
      }
    },
  }), [playSynced, hasAnimations]);

  return (
    <div className="w-full h-full min-h-[400px] rounded-xl overflow-hidden bg-gradient-to-br from-primary/5 via-background to-secondary/5 relative">
      <VideoAvatar 
        ref={videoAvatarRef}
        isSpeaking={isSpeaking || isPlaying}
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
      
      {/* 预设动画播放指示 */}
      {isPlaying && (
        <div className="absolute top-3 right-3 flex items-center gap-2 bg-green-500/90 text-white px-3 py-1.5 rounded-full text-xs">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
          播放中
        </div>
      )}
    </div>
  );
});

Live2DPanel.displayName = 'Live2DPanel';

export default Live2DPanel;

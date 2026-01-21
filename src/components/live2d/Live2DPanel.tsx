import React from 'react';
import VideoAvatar from './VideoAvatar';

interface Live2DPanelProps {
  isSpeaking?: boolean;
  lipsyncVideoUrl?: string | null;
  isGeneratingLipsync?: boolean;
}

const Live2DPanel: React.FC<Live2DPanelProps> = ({ 
  isSpeaking = false,
  lipsyncVideoUrl = null,
  isGeneratingLipsync = false,
}) => {
  return (
    <div className="w-full h-full min-h-[400px] rounded-xl overflow-hidden bg-gradient-to-br from-primary/5 via-background to-secondary/5 relative">
      <VideoAvatar 
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
};

export default Live2DPanel;

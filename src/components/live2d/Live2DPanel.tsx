import React from 'react';
import VideoAvatar from './VideoAvatar';

interface Live2DPanelProps {
  isSpeaking?: boolean;
}

const Live2DPanel: React.FC<Live2DPanelProps> = ({ isSpeaking = false }) => {
  return (
    <div className="w-full h-full min-h-[400px] rounded-xl overflow-hidden bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <VideoAvatar 
        isSpeaking={isSpeaking}
        onImageLoaded={() => console.log('Video avatar loaded')}
      />
    </div>
  );
};

export default Live2DPanel;

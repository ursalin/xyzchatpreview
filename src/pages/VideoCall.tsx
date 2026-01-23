import { useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import VideoCallPanel from '@/components/videocall/VideoCallPanel';
import Live2DPanel, { Live2DPanelRef } from '@/components/live2d/Live2DPanel';
import { Button } from '@/components/ui/button';
import { ArrowLeft, PanelLeftClose, PanelLeft } from 'lucide-react';

const VideoCall = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [showAvatar, setShowAvatar] = useState(true);
  const [lipsyncVideoUrl, setLipsyncVideoUrl] = useState<string | null>(null);
  const [isGeneratingLipsync, setIsGeneratingLipsync] = useState(false);
  
  const live2dPanelRef = useRef<Live2DPanelRef>(null);

  const handlePresetAnimationTrigger = useCallback(() => {
    live2dPanelRef.current?.playPresetAnimation();
  }, []);

  return (
    <div className="h-screen w-full flex bg-background">
      {/* 角色动态影像面板 */}
      {showAvatar && (
        <div className="hidden md:flex w-1/2 lg:w-[45%] p-4 relative">
          <Live2DPanel 
            ref={live2dPanelRef}
            isSpeaking={isSpeaking} 
            lipsyncVideoUrl={lipsyncVideoUrl}
            isGeneratingLipsync={isGeneratingLipsync}
          />
        </div>
      )}
      
      {/* 视频通话面板 */}
      <div className={`flex-1 flex flex-col relative ${showAvatar ? '' : 'max-w-4xl mx-auto w-full'}`}>
        {/* 顶部导航 */}
        <div className="flex items-center gap-2 p-3 border-b border-border">
          {/* 返回按钮 */}
          <Link to="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          
          {/* 切换头像显示 */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:flex"
            onClick={() => setShowAvatar(!showAvatar)}
          >
            {showAvatar ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
          </Button>

          <h1 className="font-semibold">视频通话</h1>
          
          {isInCall && (
            <span className="ml-auto flex items-center gap-1 text-green-500 text-sm">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              通话中
            </span>
          )}
        </div>
        
        {/* 视频通话内容 */}
        <div className="flex-1 min-h-0">
          <VideoCallPanel 
            onSpeakingChange={setIsSpeaking}
            onCallStateChange={setIsInCall}
            onLipsyncVideoReady={setLipsyncVideoUrl}
            onLipsyncGeneratingChange={setIsGeneratingLipsync}
            onPresetAnimationTrigger={handlePresetAnimationTrigger}
          />
        </div>
      </div>
      
      {/* 移动端角色显示 */}
      {isInCall && (
        <div className="md:hidden fixed bottom-[200px] right-4 w-32 h-32 rounded-lg overflow-hidden shadow-lg z-50">
          <Live2DPanel 
            isSpeaking={isSpeaking} 
            lipsyncVideoUrl={lipsyncVideoUrl}
            isGeneratingLipsync={isGeneratingLipsync}
          />
        </div>
      )}
    </div>
  );
};

export default VideoCall;

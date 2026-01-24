import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { RealtimeCallPanel } from '@/components/videocall/RealtimeCallPanel';
import Live2DPanel from '@/components/live2d/Live2DPanel';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

const RealtimeCall = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isInCall, setIsInCall] = useState(false);

  return (
    <div className="h-screen w-full flex flex-col md:flex-row bg-background relative">
      {/* 角色大画面 - 微信风格主画面 */}
      <div className="flex-1 relative">
        {/* 顶部导航 */}
        <div className="absolute top-0 left-0 right-0 flex items-center gap-2 p-3 z-20 bg-gradient-to-b from-background/80 to-transparent">
          <Link to="/">
            <Button variant="ghost" size="icon" className="backdrop-blur">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <h1 className="font-semibold">实时语音通话</h1>
          {isInCall && (
            <span className="ml-auto flex items-center gap-1 text-primary text-sm">
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
              通话中
            </span>
          )}
        </div>

        {/* 角色动态影像 - 全屏 */}
        <div className="absolute inset-0">
          <Live2DPanel 
            isSpeaking={isSpeaking}
            lipsyncVideoUrl={null}
            isGeneratingLipsync={false}
          />
        </div>
      </div>

      {/* 通话控制面板 - 底部或侧边 */}
      <div className="md:w-[400px] h-[45vh] md:h-full border-t md:border-t-0 md:border-l border-border bg-background">
        <RealtimeCallPanel
          onSpeakingChange={setIsSpeaking}
          onCallStateChange={setIsInCall}
        />
      </div>
    </div>
  );
};

export default RealtimeCall;

import { useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { RealtimeCallPanel, CallMode } from '@/components/videocall/RealtimeCallPanel';
import Live2DPanel, { Live2DPanelRef } from '@/components/live2d/Live2DPanel';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Settings } from 'lucide-react';
import { usePresetAnimations } from '@/hooks/usePresetAnimations';

const RealtimeCall = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const live2dRef = useRef<Live2DPanelRef>(null);
  const { hasAnimations, playSynced } = usePresetAnimations();

  // 当 AI 说话时触发 preset 动画
  const handleSpeakingChange = useCallback((speaking: boolean) => {
    setIsSpeaking(speaking);
    // 如果开始说话且有预设动画，可以在这里触发
    // 注意：实时通话模式下，音频是流式的，需要特殊处理
  }, []);

  // 处理来自 realtime API 的音频响应
  const handleAudioResponse = useCallback(async (audioBase64: string) => {
    if (hasAnimations && live2dRef.current) {
      try {
        await live2dRef.current.playPresetAnimation(audioBase64);
      } catch (e) {
        console.error('Failed to play preset animation:', e);
      }
    }
  }, [hasAnimations]);

  return (
    <div className="h-screen w-full flex flex-col md:flex-row bg-background relative">
      {/* 角色大画面 - 微信风格主画面 */}
      <div className="flex-1 relative">
        {/* 顶部导航 */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-3 z-20 bg-gradient-to-b from-background/80 to-transparent">
          <div className="flex items-center gap-2">
            <Link to="/">
              <Button variant="ghost" size="icon" className="backdrop-blur">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <h1 className="font-semibold">实时通话</h1>
          </div>
          <div className="flex items-center gap-2">
            {isInCall && (
              <span className="flex items-center gap-1 text-primary text-sm">
                <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                通话中
              </span>
            )}
            <Link to="/">
              <Button variant="ghost" size="icon" className="backdrop-blur">
                <Settings className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>

        {/* 角色动态影像 - 全屏 */}
        <div className="absolute inset-0">
          <Live2DPanel 
            ref={live2dRef}
            isSpeaking={isSpeaking}
            lipsyncVideoUrl={null}
            isGeneratingLipsync={false}
            onSpeakingChange={setIsSpeaking}
          />
        </div>

        {/* 预设动画提示 */}
        {!hasAnimations && isInCall && (
          <div className="absolute bottom-4 left-4 right-4 md:right-auto md:max-w-xs z-10">
            <div className="bg-background/90 backdrop-blur rounded-lg p-3 text-sm">
              <p className="text-muted-foreground">
                💡 提示：上传说话动画视频可让角色嘴部动起来
              </p>
              <Link to="/" className="text-primary text-xs hover:underline">
                去设置面板上传 →
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* 通话控制面板 - 底部或侧边 */}
      <div className="md:w-[400px] h-[45vh] md:h-full border-t md:border-t-0 md:border-l border-border bg-background">
        <RealtimeCallPanel
          onSpeakingChange={handleSpeakingChange}
          onCallStateChange={setIsInCall}
          onAudioResponse={handleAudioResponse}
        />
      </div>
    </div>
  );
};

export default RealtimeCall;

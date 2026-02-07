import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { 
  Phone, PhoneOff, Mic, MicOff, Send, MessageSquare, 
  Video, VideoOff, Volume2, VolumeX, Camera
} from 'lucide-react';
import { useSimpleVoiceCall } from '@/hooks/useSimpleVoiceCall';
import { useSettings } from '@/hooks/useSettings';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
// supabase import removed - using fetch directly for vision-chat
import '@/styles/realtime-responsive.css';
import { Message } from '@/types/chat';

export type CallMode = 'voice' | 'video';

interface RealtimeCallPanelProps {
  onSpeakingChange?: (isSpeaking: boolean) => void;
  onCallStateChange?: (isInCall: boolean) => void;
  onAudioResponse?: (audioBase64: string) => void; // 新增：传递音频给 preset 动画
}

export const RealtimeCallPanel: React.FC<RealtimeCallPanelProps> = ({
  onSpeakingChange,
  onCallStateChange,
  onAudioResponse
}) => {
  const { settings } = useSettings();
  const [inputText, setInputText] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);
  const [callMode, setCallMode] = useState<CallMode>('voice');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStartTimeRef = useRef<Date | null>(null);
  const lastVisionContextRef = useRef<string>(''); // AI视觉上下文
  const lastActivityRef = useRef<number>(Date.now()); // 沉默检测：最后活动时间
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Build system prompt from settings + vision context
  const buildSystemPrompt = useCallback(() => {
    let prompt = `你是${settings.character.name}。
${settings.character.persona}
${settings.character.background}
说话风格：${settings.character.speakingStyle}
请用中文回复，保持回答简洁自然，像真人对话一样。`;

    if (callMode === 'video' && lastVisionContextRef.current) {
      prompt += `\n\n[视觉上下文] 你可以看到用户的摄像头画面：${lastVisionContextRef.current}`;
    }
    return prompt;
  }, [settings.character, callMode]);

  // 使用简化的语音通话 hook (Web Speech API + sherpa-onnx fallback + MiniMax TTS)
  const {
    messages,
    isLoading,
    isConnected,
    isRecording,
    isPlaying: isSpeaking,
    isSpeechSupported,
    interimTranscript: transcript,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    sendTextMessage,
    clearMessages,
    sttBackendActive,
    isSherpaModelLoading,
    sherpaLoadingStatus,
  } = useSimpleVoiceCall({
    settings,
    systemPrompt: buildSystemPrompt(),
    onSpeakingChange,
    onAudioResponse,
  });

  // 更新最后活动时间（用户说话或AI回复时）
  useEffect(() => {
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'user' || lastMsg.role === 'assistant') {
        lastActivityRef.current = Date.now();
      }
    }
  }, [messages]);

  // 沉默检测：8秒无活动时AI主动说话
  useEffect(() => {
    if (!isConnected) {
      if (silenceTimerRef.current) {
        clearInterval(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      return;
    }

    // 连接时重置活动时间
    lastActivityRef.current = Date.now();

    silenceTimerRef.current = setInterval(async () => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed < 8000) return;
      if (isLoading || isSpeaking) return;

      if (callMode === 'video') {
        await captureAndAnalyzeFrame();
        sendTextMessage('[系统: 用户已经沉默了一会儿。请根据当前视觉画面或之前的对话主动说些什么，比如评论看到的画面、问一个问题、或表达关心。不要提及这是系统指令。]');
      } else {
        sendTextMessage('[系统: 用户已经沉默了一会儿。请主动说些什么来保持对话，比如问一个问题、分享一个想法、或表达关心。不要提及这是系统指令。]');
      }
      lastActivityRef.current = Date.now();
    }, 1000);

    return () => {
      if (silenceTimerRef.current) {
        clearInterval(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    };
  }, [isConnected, isLoading, isSpeaking, callMode, captureAndAnalyzeFrame, sendTextMessage]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Notify call state changes
  useEffect(() => {
    onCallStateChange?.(isConnected);
  }, [isConnected, onCallStateChange]);

  // 通话计时器
  useEffect(() => {
    if (isConnected) {
      callStartTimeRef.current = new Date();
      callTimerRef.current = setInterval(() => {
        if (callStartTimeRef.current) {
          const elapsed = Math.floor((Date.now() - callStartTimeRef.current.getTime()) / 1000);
          setCallDuration(elapsed);
        }
      }, 1000);
    } else {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
      setCallDuration(0);
      callStartTimeRef.current = null;
    }

    return () => {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
    };
  }, [isConnected]);

  // 格式化通话时长
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Start/stop camera based on mode
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // 确保视频开始播放
        try {
          await videoRef.current.play();
        } catch (e) {
          console.log('Video autoplay blocked, user interaction needed');
        }
      }
      return true;
    } catch (error) {
      console.error('Failed to start camera:', error);
      toast.error('无法访问摄像头');
      return false;
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // 周期性采样摄像头帧并发送给AI分析
  const captureAndAnalyzeFrame = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || callMode !== 'video') return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx || video.readyState < 2) return;

    // 设置canvas尺寸
    canvas.width = 320; // 降低分辨率节省传输
    canvas.height = 240;

    // 绘制并导出
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.6);

    try {
      // 直接用 fetch 调用 vision-chat 并解析 SSE 流
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vision-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: '请用一句话简洁描述你看到的画面。' }],
            systemPrompt: '你是一个视觉分析助手，用简洁的中文描述画面内容。',
            image: imageDataUrl,
          }),
        }
      );

      if (!response.ok) {
        console.error('[Vision] API error:', response.status);
        return;
      }

      // 解析 SSE 流提取文本内容
      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let visionText = '';
      let textBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) visionText += delta;
          } catch {
            // 不完整的 JSON，忽略
          }
        }
      }

      if (visionText) {
        lastVisionContextRef.current = visionText.slice(0, 200);
        console.log('[Vision] Context updated:', lastVisionContextRef.current);
      }
    } catch (e) {
      console.error('[Vision] Frame analysis error:', e);
    }
  }, [callMode]);

  // 开始周期性采样（视频模式）
  const startFrameCapture = useCallback(() => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
    }
    // 每3秒采样一次
    frameIntervalRef.current = setInterval(captureAndAnalyzeFrame, 3000);
    // 立即采样一次
    setTimeout(captureAndAnalyzeFrame, 500);
  }, [captureAndAnalyzeFrame]);

  // 切换通话模式
  const handleModeSwitch = async () => {
    if (!isConnected) {
      setCallMode(prev => prev === 'voice' ? 'video' : 'voice');
      return;
    }

    const newMode = callMode === 'voice' ? 'video' : 'voice';
    
    if (newMode === 'video') {
      const success = await startCamera();
      if (success) {
        setCallMode('video');
        startFrameCapture();
        toast.info('已切换到视频通话，注意隐私保护');
      }
    } else {
      stopCamera();
      setCallMode('voice');
      lastVisionContextRef.current = '';
    }
  };

  // 静音控制
  const handleMuteToggle = () => {
    if (isMuted) {
      startRecording();
      setIsMuted(false);
    } else {
      stopRecording();
      setIsMuted(true);
    }
  };

  const handleStartCall = async () => {
    // 检查语音设置
    if (!settings.voiceConfig.enabled) {
      toast.error('请先在设置中启用语音功能');
      return;
    }
    if (!settings.voiceConfig.minimaxApiKey || !settings.voiceConfig.minimaxGroupId) {
      toast.error('请先在设置中配置 MiniMax API');
      return;
    }

    if (callMode === 'video') {
      const cameraSuccess = await startCamera();
      if (!cameraSuccess) {
        // 降级到语音模式
        setCallMode('voice');
      }
    }
    
    const success = await connect();
    if (!success) {
      toast.error('无法启动语音识别');
      return;
    }
    
    toast.success('通话已连接，开始说话吧！');
    
    // 连接后自动开始录音
    setTimeout(() => {
      startRecording();
      if (callMode === 'video' && streamRef.current) {
        startFrameCapture();
      }
    }, 500);
  };

  const handleEndCall = () => {
    stopRecording();
    disconnect();
    stopCamera();
    lastVisionContextRef.current = '';
    if (silenceTimerRef.current) {
      clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    clearMessages();
  };

  const handleSendText = () => {
    if (!inputText.trim() || !isConnected) return;
    sendTextMessage(inputText);
    setInputText('');
    setShowTextInput(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  return (
    <div className="realtime-call-panel h-full flex flex-col bg-gradient-to-b from-background to-muted/20 relative">
      {/* 隐藏的canvas用于帧采样 */}
      <canvas ref={canvasRef} className="hidden" />

      {/* 微信风格顶部状态栏 */}
      {isConnected && (
        <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-background/90 to-transparent p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{settings.character.name}</span>
              <span className={cn(
                "px-2 py-0.5 rounded-full text-xs",
                callMode === 'video' 
                  ? "bg-primary/20 text-primary" 
                  : "bg-muted text-muted-foreground"
              )}>
                {callMode === 'video' ? '视频通话' : '语音通话'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{formatDuration(callDuration)}</span>
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            </div>
          </div>
        </div>
      )}

      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto p-4 pt-14 space-y-3">
        {/* sherpa-onnx 模型加载状态提示 */}
        {isSherpaModelLoading && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-3">
            <p className="text-sm text-blue-600">
              {sherpaLoadingStatus || '正在加载离线语音识别模型...'}
            </p>
            <p className="text-xs text-blue-500 mt-1">
              首次使用需下载约200MB模型，请耐心等待
            </p>
          </div>
        )}

        {/* STT 后端指示 */}
        {isConnected && sttBackendActive === 'sherpa-onnx' && !isSherpaModelLoading && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 mb-3">
            <p className="text-xs text-emerald-600">
              🔧 使用离线语音识别 (sherpa-onnx)
            </p>
          </div>
        )}

        {/* 浏览器不支持提示 */}
        {!isSpeechSupported && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-3">
            <p className="text-sm text-amber-600">
              语音识别服务不可用。
            </p>
          </div>
        )}

        {messages.length === 0 && !isConnected && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Phone className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-center">点击下方按钮开始{callMode === 'video' ? '视频' : '语音'}通话</p>
            <p className="text-sm mt-2 opacity-70">
              {callMode === 'video' 
                ? '视频模式下 AI 可以看见你的画面' 
                : '语音模式，支持实时对话'}
            </p>
          </div>
        )}
        
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "max-w-[85%] p-3 rounded-2xl",
              msg.role === 'user'
                ? "ml-auto bg-primary text-primary-foreground rounded-br-md"
                : "mr-auto bg-muted rounded-bl-md"
            )}
          >
            <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
          </div>
        ))}
        
        {/* 实时转写指示器 */}
        {isRecording && !isMuted && transcript && (
          <div className="max-w-[85%] ml-auto p-3 rounded-2xl bg-primary/50 text-primary-foreground rounded-br-md animate-pulse">
            <p className="text-sm">{transcript}...</p>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* 用户摄像头 PiP（仅视频模式） */}
      {isConnected && callMode === 'video' && (
        <div className="absolute top-14 right-4 w-28 h-36 rounded-xl overflow-hidden shadow-lg border-2 border-primary/30 z-10 bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover transform scale-x-[-1]"
          />
          {/* 录音指示器 */}
          {isRecording && !isMuted && (
            <div className="absolute top-2 right-2 w-3 h-3 bg-destructive rounded-full animate-pulse" />
          )}
          {/* 静音指示器 */}
          {isMuted && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-destructive/80 rounded-full p-1">
              <MicOff className="h-3 w-3 text-white" />
            </div>
          )}
        </div>
      )}

      {/* 文字输入（可选） */}
      {showTextInput && isConnected && (
        <div className="p-4 border-t flex gap-2">
          <Textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            className="min-h-[40px] max-h-[100px] resize-none"
            rows={1}
          />
          <Button onClick={handleSendText} size="icon" disabled={!inputText.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* 微信风格底部控制栏 */}
      <div className="p-4 border-t bg-background/80 backdrop-blur">
        {!isConnected ? (
          /* 未接通状态 */
          <div className="flex flex-col items-center gap-4">
            {/* 模式切换 */}
            <div className="flex items-center gap-2 bg-muted rounded-full p-1">
              <button
                onClick={() => setCallMode('voice')}
                className={cn(
                  "px-4 py-2 rounded-full text-sm transition-colors",
                  callMode === 'voice' 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Volume2 className="h-4 w-4 inline mr-1" />
                语音
              </button>
              <button
                onClick={() => setCallMode('video')}
                className={cn(
                  "px-4 py-2 rounded-full text-sm transition-colors",
                  callMode === 'video' 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Video className="h-4 w-4 inline mr-1" />
                视频
              </button>
            </div>
            
            {/* 开始通话按钮 */}
            <Button
              onClick={handleStartCall}
              size="lg"
              className="rounded-full h-16 w-16 bg-emerald-600 hover:bg-emerald-700"
            >
              {callMode === 'video' ? <Video className="h-6 w-6" /> : <Phone className="h-6 w-6" />}
            </Button>
          </div>
        ) : (
          /* 通话中控制栏 */
          <div className="flex items-center justify-center gap-3">
            {/* 静音 */}
            <Button
              onClick={handleMuteToggle}
              size="icon"
              variant={isMuted ? "destructive" : "outline"}
              className="rounded-full h-12 w-12"
            >
              {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>

            {/* 切换语音/视频 */}
            <Button
              onClick={handleModeSwitch}
              size="icon"
              variant="outline"
              className="rounded-full h-12 w-12"
            >
              {callMode === 'video' ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
            </Button>

            {/* 扬声器 */}
            <Button
              onClick={() => setIsSpeakerOn(!isSpeakerOn)}
              size="icon"
              variant={isSpeakerOn ? "outline" : "secondary"}
              className="rounded-full h-12 w-12"
            >
              {isSpeakerOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </Button>

            {/* 文字消息 */}
            <Button
              onClick={() => setShowTextInput(!showTextInput)}
              size="icon"
              variant={showTextInput ? "default" : "outline"}
              className="rounded-full h-12 w-12"
            >
              <MessageSquare className="h-5 w-5" />
            </Button>

            {/* 挂断 */}
            <Button
              onClick={handleEndCall}
              size="lg"
              className="rounded-full h-14 w-14 bg-destructive hover:bg-destructive/90"
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
          </div>
        )}

        {/* 状态指示器 */}
        {isConnected && (
          <div className="flex items-center justify-center gap-4 mt-3 text-sm text-muted-foreground">
            {isRecording && !isMuted && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                正在聆听...
              </span>
            )}
            {isSpeaking && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                AI 正在说话...
              </span>
            )}
            {callMode === 'video' && (
              <span className="flex items-center gap-1 text-primary/70">
                <Camera className="w-3 h-3" />
                AI可见
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

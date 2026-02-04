import React, { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Video, 
  VideoOff, 
  Mic, 
  MicOff, 
  Send, 
  Phone, 
  PhoneOff,
  Camera,
  Loader2,
  Volume2,
  VolumeX,
  Trash2,
  MessageSquare,
  Brain
} from 'lucide-react';
import { useVideoCall } from '@/hooks/useVideoCall';
import { useSettings } from '@/hooks/useSettings';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import MemoryPanel from '@/components/memory/MemoryPanel';

interface VideoCallPanelProps {
  onSpeakingChange?: (isSpeaking: boolean) => void;
  onCallStateChange?: (isInCall: boolean) => void;
  onLipsyncVideoReady?: (videoUrl: string) => void;
  onLipsyncGeneratingChange?: (isGenerating: boolean) => void;
  onPresetAnimationTrigger?: (audioBase64: string) => void; // 现在传递音频数据
}

const VideoCallPanel: React.FC<VideoCallPanelProps> = ({
  onSpeakingChange,
  onCallStateChange,
  onLipsyncVideoReady,
  onLipsyncGeneratingChange,
  onPresetAnimationTrigger,
}) => {
  const { settings } = useSettings();
  const userVideoRef = useRef<HTMLVideoElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [isInCall, setIsInCall] = useState(false);

  // 获取当前时间信息
  const now = new Date();
  const timeString = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const dateString = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const hour = now.getHours();
  const timeOfDay = hour < 6 ? '凌晨' : hour < 9 ? '早上' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 22 ? '晚上' : '深夜';

  const systemPrompt = `你是${settings.character.name}，${settings.character.persona}。
背景：${settings.character.background}
说话风格：${settings.character.speakingStyle}

当前时间：${dateString} ${timeString}（${timeOfDay}）

你现在正在和用户进行视频通话。你可以看见用户的实时画面。请像真正的视频通话一样自然交流：
- 观察用户的表情、动作、环境并自然回应
- 语气亲切自然，像朋友间的视频聊天
- 回复简洁有趣，适合口语交流
- 可以对看到的画面做出反应和评论
- 你能感知当前时间，可以根据时间自然地打招呼或做出相应评论（如早上好、该吃饭了、这么晚还没睡等）`;

  const {
    messages,
    isLoading,
    isCameraActive,
    isRecording,
    isProcessingVoice,
    isPlaying,
    isGeneratingLipsync,
    interimTranscript,
    memorySummary,
    isSummarizing,
    startCamera,
    stopCamera,
    startRecording,
    stopRecording,
    sendMessage,
    clearMessages,
    deleteMessages,
    clearMemory,
    updateMemorySummary,
    stopPlaying,
  } = useVideoCall({
    settings,
    systemPrompt,
    onSpeakingChange,
    onLipsyncVideoReady,
    onPresetAnimationTrigger,
  });

  // 通知父组件唇形动画生成状态
  useEffect(() => {
    onLipsyncGeneratingChange?.(isGeneratingLipsync);
  }, [isGeneratingLipsync, onLipsyncGeneratingChange]);

  // 自动滚动到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 通知父组件通话状态
  useEffect(() => {
    onCallStateChange?.(isInCall);
  }, [isInCall, onCallStateChange]);

  // 开始通话
  const handleStartCall = async () => {
    if (userVideoRef.current) {
      const success = await startCamera(userVideoRef.current);
      if (success) {
        setIsInCall(true);
        // 不再自动发送开场白，让用户自己开始对话
      }
    }
  };

  // 结束通话
  const handleEndCall = () => {
    stopCamera();
    stopPlaying();
    setIsInCall(false);
  };

  // 发送文字消息
  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const text = input.trim();
    setInput('');
    await sendMessage(text, true);
  };

  // 语音输入
  const handleVoiceToggle = async () => {
    if (isRecording) {
      // 停止录音 - Web Speech API 会自动通过回调发送消息
      stopRecording();
    } else {
      try {
        await startRecording();
      } catch (error) {
        console.error('Failed to start recording:', error);
      }
    }
  };

  // 键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 视频区域 */}
      <div className="relative bg-black aspect-video max-h-[40vh] w-full overflow-hidden rounded-lg m-2">
        {/* 用户摄像头 */}
        <video
          ref={userVideoRef}
          className={cn(
            "w-full h-full object-cover transition-opacity duration-300",
            isCameraActive ? "opacity-100" : "opacity-0"
          )}
          autoPlay
          playsInline
          muted
        />
        
        {/* 未开始通话时的占位 */}
        {!isInCall && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/80">
            <Video className="w-16 h-16 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">点击下方按钮开始视频通话</p>
            <Button onClick={handleStartCall} size="lg" className="gap-2">
              <Phone className="w-5 h-5" />
              开始通话
            </Button>
          </div>
        )}

        {/* 通话状态指示 */}
        {isInCall && (
          <div className="absolute top-3 left-3 flex items-center gap-2">
            <div className="flex items-center gap-1 bg-green-500/90 text-white px-2 py-1 rounded-full text-xs">
              <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
              通话中
            </div>
            {isPlaying && (
              <div className="flex items-center gap-1 bg-blue-500/90 text-white px-2 py-1 rounded-full text-xs">
                <Volume2 className="w-3 h-3" />
                正在说话
              </div>
            )}
          </div>
        )}

        {/* 通话控制按钮 */}
        {isInCall && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
            <Button
              variant={isCameraActive ? "secondary" : "destructive"}
              size="icon"
              onClick={isCameraActive ? stopCamera : () => userVideoRef.current && startCamera(userVideoRef.current)}
              className="rounded-full"
            >
              {isCameraActive ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            </Button>
            
            <Button
              variant="destructive"
              size="icon"
              onClick={handleEndCall}
              className="rounded-full w-12 h-12"
            >
              <PhoneOff className="w-5 h-5" />
            </Button>
            
            {isPlaying && (
              <Button
                variant="secondary"
                size="icon"
                onClick={stopPlaying}
                className="rounded-full"
              >
                <VolumeX className="w-4 h-4" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* 消息区域 */}
      <div className="flex-1 min-h-0">
        <Tabs defaultValue="chat" className="h-full flex flex-col">
          <TabsList className="mx-4 mt-2">
            <TabsTrigger value="chat" className="gap-2">
              <MessageSquare className="w-4 h-4" />
              对话
            </TabsTrigger>
            <TabsTrigger value="memory" className="gap-2">
              <Brain className="w-4 h-4" />
              记忆
              {memorySummary && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary/20 rounded">
                  {memorySummary.summarizedCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="flex-1 min-h-0 mt-0">
            <ScrollArea className="h-full px-4">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <p>开始视频通话后，对话将显示在这里</p>
                </div>
              ) : (
                <div className="py-4 space-y-4">
                  {messages.map((message) => (
                    <ChatMessage key={message.id} message={message} />
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="memory" className="flex-1 min-h-0 mt-0">
            <MemoryPanel
              messages={messages}
              memorySummary={memorySummary}
              isSummarizing={isSummarizing}
              onClearMemory={clearMemory}
              onUpdateMemory={updateMemorySummary}
              onClearMessages={clearMessages}
              onDeleteMessages={deleteMessages}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* 输入区域 */}
      {isInCall && (
        <div className="p-4 border-t border-border bg-background">
          <div className="flex items-end gap-2">
            {/* 清除对话 */}
            <Button
              variant="ghost"
              size="icon"
              onClick={clearMessages}
              disabled={messages.length === 0 || isLoading}
              className="shrink-0"
            >
              <Trash2 className="w-4 h-4" />
            </Button>

            {/* 文本输入 */}
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息..."
              disabled={isLoading || isRecording || isProcessingVoice}
              className="min-h-[44px] max-h-[120px] resize-none"
              rows={1}
            />

            {/* 语音输入 */}
            <Button
              variant={isRecording ? "destructive" : "secondary"}
              size="icon"
              onClick={handleVoiceToggle}
              disabled={isLoading || isProcessingVoice}
              className="shrink-0"
            >
              {isProcessingVoice ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isRecording ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </Button>

            {/* 发送按钮 */}
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isLoading || isRecording}
              size="icon"
              className="shrink-0"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>

          {/* 录音状态提示 */}
          {isRecording && (
            <div className="mt-2 flex items-center gap-2 text-destructive text-sm">
              <div className="w-2 h-2 bg-destructive rounded-full animate-pulse" />
              正在录音，点击麦克风按钮停止...
              {interimTranscript && (
                <span className="text-muted-foreground ml-2">
                  识别中: {interimTranscript}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VideoCallPanel;

import { useState, useRef, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Live2DPanel, { Live2DPanelRef } from '@/components/live2d/Live2DPanel';
import { Button } from '@/components/ui/button';
import { 
  ArrowLeft, Mic, MicOff, Video, VideoOff, PhoneOff, 
  MessageSquare, Volume2, VolumeX, RotateCcw, Trash2, CheckSquare, X, Pencil, Check, SwitchCamera
} from 'lucide-react';
import { useVideoCall } from '@/hooks/useVideoCall';
import { useSettings } from '@/hooks/useSettings';
import { cn } from '@/lib/utils';

const VideoCall = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [showMessages, setShowMessages] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [lipsyncVideoUrl, setLipsyncVideoUrl] = useState<string | null>(null);
  const [isGeneratingLipsync, setIsGeneratingLipsync] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set());
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [hideCharacter, setHideCharacter] = useState(() => {
    return localStorage.getItem('videocall-hide-character') === 'true';
  });
  const [customBgUrl, setCustomBgUrl] = useState<string | null>(() => {
    return localStorage.getItem('videocall-custom-bg') || null;
  });
  const bgInputRef = useRef<HTMLInputElement>(null);
  
  const live2dPanelRef = useRef<Live2DPanelRef>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
你现在正在和用户进行视频通话。请像真正的视频通话一样自然交流，回复简洁有趣，适合口语交流。`;

  const {
    messages,
    isLoading,
    isRecording,
    isPlaying,
    interimTranscript,
    startCamera,
    stopCamera,
    startRecording,
    stopRecording,
    sendMessage,
    clearMessages,
    deleteMessages,
    editMessage,
    stopPlaying,
  } = useVideoCall({
    settings,
    systemPrompt,
    onSpeakingChange: (speaking) => {
      // 通知 Live2D 面板
    },
    onLipsyncVideoReady: setLipsyncVideoUrl,
    onPresetAnimationTrigger: async (audioBase64) => {
      await live2dPanelRef.current?.playPresetAnimation(audioBase64);
    },
  });

  // 静默检测：8秒没有活动（说话/回复），角色自动问候
  const SILENCE_TIMEOUT = 8000;

  // 重置静默计时器
  const resetSilenceTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    if (isInCall && !isLoading && !isPlaying) {
      silenceTimerRef.current = setTimeout(() => {
        if (!isLoading && !isPlaying && isInCall) {
          console.log('[VideoCall] Silence detected, sending auto greeting');
          sendMessage('（用户沉默了一会儿，请主动关心一下或者随便聊点什么）', true);
        }
      }, SILENCE_TIMEOUT);
    }
  }, [isInCall, isLoading, isPlaying, sendMessage]);

  // 消息变化、录音状态变化时重置计时器
  useEffect(() => {
    if (isInCall) {
      resetSilenceTimer();
    }
    return () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
    };
  }, [messages, isRecording, isPlaying, isInCall, resetSilenceTimer]);

  // 消息变化时自动滚动到底部
  useEffect(() => {
    if (showMessages && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, showMessages]);

  // 格式化通话时长
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 开始通话
  const handleStartCall = async () => {
    if (videoRef.current) {
      const success = await startCamera(videoRef.current);
      if (success) {
        setIsInCall(true);
        setIsCameraOn(true);
        // 开始计时
        callTimerRef.current = setInterval(() => {
          setCallDuration(prev => prev + 1);
        }, 1000);
        // 开始录音
        setTimeout(() => {
          startRecording();
        }, 500);
      }
    }
  };

  // 结束通话
  const handleEndCall = () => {
    stopRecording();
    stopCamera();
    stopPlaying();
    setIsInCall(false);
    setCallDuration(0);
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    // 返回主页
    navigate('/');
  };

  // 切换静音
  const handleToggleMute = () => {
    if (isMuted) {
      startRecording();
      setIsMuted(false);
    } else {
      stopRecording();
      setIsMuted(true);
    }
  };

  // 切换摄像头开关
  const handleToggleCamera = async () => {
    if (isCameraOn) {
      stopCamera();
      setIsCameraOn(false);
    } else {
      if (videoRef.current) {
        await startCamera(videoRef.current, facingMode);
        setIsCameraOn(true);
      }
    }
  };

  // 切换前后摄像头
  const handleSwitchCamera = async () => {
    const newFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newFacing);
    if (isCameraOn && videoRef.current) {
      await startCamera(videoRef.current, newFacing);
    }
  };

  // 切换隐藏角色
  const handleToggleCharacter = () => {
    const newVal = !hideCharacter;
    setHideCharacter(newVal);
    localStorage.setItem('videocall-hide-character', String(newVal));
  };

  // 上传背景图
  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('图片不能超过5MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setCustomBgUrl(dataUrl);
      localStorage.setItem('videocall-custom-bg', dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // 清理
  useEffect(() => {
    return () => {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
      stopCamera();
    };
  }, []);

  return (
    <div className="h-screen w-full bg-black relative overflow-hidden">
      {/* 角色全屏背景 / 自定义背景 */}
      <div className="absolute inset-0 z-0">
        {hideCharacter ? (
          // 自定义背景 / 默认渐变
          customBgUrl ? (
            <img src={customBgUrl} alt="背景" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900" />
          )
        ) : (
          <Live2DPanel 
            ref={live2dPanelRef}
            isSpeaking={isPlaying} 
            lipsyncVideoUrl={lipsyncVideoUrl}
            isGeneratingLipsync={isGeneratingLipsync}
          />
        )}
      </div>

      {/* 顶部状态栏 */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/60 to-transparent p-4 pt-safe">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/20">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-white font-semibold text-lg">{settings.character.name}</h1>
              {isInCall && (
                <p className="text-white/70 text-sm">{formatDuration(callDuration)}</p>
              )}
            </div>
          </div>
          
          {/* 状态指示 */}
          {isInCall && (
            <div className="flex items-center gap-2">
              {isRecording && !isMuted && (
                <span className="flex items-center gap-1 text-green-400 text-xs bg-black/40 px-2 py-1 rounded-full">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  聆听中
                </span>
              )}
              {isPlaying && (
                <span className="flex items-center gap-1 text-blue-400 text-xs bg-black/40 px-2 py-1 rounded-full">
                  <Volume2 className="w-3 h-3" />
                  说话中
                </span>
              )}
              {/* 隐藏角色按钮 */}
              <Button 
                variant="ghost" 
                size="icon" 
                className="text-white hover:bg-white/20"
                onClick={handleToggleCharacter}
                title={hideCharacter ? "显示角色" : "隐藏角色"}
              >
                {hideCharacter ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                )}
              </Button>
              {/* 上传背景按钮（仅在隐藏角色时显示） */}
              {hideCharacter && (
                <>
                  <input 
                    ref={bgInputRef}
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={handleBgUpload}
                  />
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="text-white hover:bg-white/20"
                    onClick={() => bgInputRef.current?.click()}
                    title="上传背景图"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 用户摄像头 PiP（右上角） */}
      {isInCall && (
        <div className="absolute top-20 right-4 z-30 w-28 h-40 sm:w-32 sm:h-44 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/30 bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn(
              "w-full h-full object-cover transform scale-x-[-1]",
              !isCameraOn && "hidden"
            )}
          />
          {!isCameraOn && (
            <div className="w-full h-full flex items-center justify-center bg-gray-800">
              <VideoOff className="w-8 h-8 text-gray-500" />
            </div>
          )}
          {/* 静音指示器 */}
          {isMuted && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-red-500/80 rounded-full p-1.5">
              <MicOff className="h-3 w-3 text-white" />
            </div>
          )}
        </div>
      )}

      {/* 实时转写显示（中下方） */}
      {isInCall && interimTranscript && (
        <div className="absolute bottom-36 left-4 right-4 z-20">
          <div className="bg-black/50 backdrop-blur-sm text-white px-4 py-2 rounded-full text-center text-sm">
            {interimTranscript}...
          </div>
        </div>
      )}

      {/* 消息气泡（可选显示） */}
      {showMessages && messages.length > 0 && (
        <div className="absolute bottom-36 left-4 right-4 z-20 max-h-[40vh] overflow-y-auto">
          {/* 消息管理工具栏 */}
          <div className="flex justify-end gap-2 mb-2">
            {isSelectMode ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs bg-red-500/80 text-white hover:bg-red-600/80"
                  disabled={selectedMsgIds.size === 0}
                  onClick={() => {
                    deleteMessages(Array.from(selectedMsgIds));
                    setSelectedMsgIds(new Set());
                    setIsSelectMode(false);
                  }}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  删除({selectedMsgIds.size})
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs bg-white/20 text-white hover:bg-white/30"
                  onClick={() => {
                    // 全选/取消全选
                    if (selectedMsgIds.size === messages.slice(-20).length) {
                      setSelectedMsgIds(new Set());
                    } else {
                      setSelectedMsgIds(new Set(messages.slice(-20).map(m => m.id)));
                    }
                  }}
                >
                  {selectedMsgIds.size === messages.slice(-20).length ? '取消全选' : '全选'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs bg-white/20 text-white hover:bg-white/30"
                  onClick={() => {
                    setIsSelectMode(false);
                    setSelectedMsgIds(new Set());
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs bg-white/20 text-white hover:bg-white/30"
                onClick={() => setIsSelectMode(true)}
              >
                <CheckSquare className="h-3 w-3 mr-1" />
                选择
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {messages.slice(-20).map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex items-start gap-2",
                  msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                )}
                onClick={() => {
                  if (isSelectMode) {
                    setSelectedMsgIds(prev => {
                      const next = new Set(prev);
                      if (next.has(msg.id)) {
                        next.delete(msg.id);
                      } else {
                        next.add(msg.id);
                      }
                      return next;
                    });
                  }
                }}
              >
                {isSelectMode && (
                  <div className={cn(
                    "mt-2 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center",
                    selectedMsgIds.has(msg.id) 
                      ? "bg-blue-500 border-blue-500" 
                      : "border-white/50"
                  )}>
                    {selectedMsgIds.has(msg.id) && (
                      <svg className="w-3 h-3 text-white" viewBox="0 0 12 12">
                        <path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="2" fill="none"/>
                      </svg>
                    )}
                  </div>
                )}
                <div className="flex flex-col max-w-[80%]">
                  {editingMsgId === msg.id ? (
                    /* 编辑模式 */
                    <div className={cn(
                      "flex items-end gap-1",
                      msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                    )}>
                      <textarea
                        autoFocus
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        className="px-3 py-2 rounded-2xl text-sm bg-white text-black border-2 border-blue-400 resize-none min-w-[120px] focus:outline-none"
                        rows={Math.min(4, editingText.split('\n').length + 1)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (editingText.trim()) {
                              editMessage(msg.id, editingText.trim());
                            }
                            setEditingMsgId(null);
                          } else if (e.key === 'Escape') {
                            setEditingMsgId(null);
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 bg-green-500/80 text-white rounded-full hover:bg-green-600/80"
                        onClick={() => {
                          if (editingText.trim()) {
                            editMessage(msg.id, editingText.trim());
                          }
                          setEditingMsgId(null);
                        }}
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 bg-white/20 text-white rounded-full hover:bg-white/30"
                        onClick={() => setEditingMsgId(null)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    /* 普通显示模式 */
                    <div className="group relative">
                      <div
                        className={cn(
                          "px-4 py-2 rounded-2xl text-sm",
                          msg.role === 'user'
                            ? "bg-blue-500 text-white"
                            : "bg-white/90 text-black",
                          isSelectMode && "cursor-pointer",
                          isSelectMode && selectedMsgIds.has(msg.id) && "ring-2 ring-blue-400"
                        )}
                      >
                        {msg.content}
                      </div>
                      {/* 编辑按钮 - hover 时显示 */}
                      {!isSelectMode && (
                        <button
                          className={cn(
                            "absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity",
                            "w-6 h-6 rounded-full bg-black/50 flex items-center justify-center",
                            "active:opacity-100 md:hover:opacity-100",
                            msg.role === 'user' ? "-left-8" : "-right-8"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingMsgId(msg.id);
                            setEditingText(msg.content);
                          }}
                        >
                          <Pencil className="h-3 w-3 text-white" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {/* 底部控制栏 */}
      <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/80 to-transparent p-6 pb-safe">
        {!isInCall ? (
          /* 未通话状态 - 开始通话按钮 */
          <div className="flex flex-col items-center gap-4">
            <p className="text-white/70 text-sm">点击开始视频通话</p>
            <Button
              onClick={handleStartCall}
              size="lg"
              className="rounded-full h-16 w-16 bg-green-500 hover:bg-green-600 shadow-lg"
            >
              <Video className="h-7 w-7" />
            </Button>
            {/* 隐藏的视频元素用于初始化 */}
            <video ref={videoRef} className="hidden" autoPlay playsInline muted />
          </div>
        ) : (
          /* 通话中 - 控制按钮 */
          <div className="flex items-center justify-center gap-4">
            {/* 静音 */}
            <Button
              onClick={handleToggleMute}
              size="icon"
              variant="ghost"
              className={cn(
                "rounded-full h-14 w-14",
                isMuted ? "bg-red-500/80 text-white" : "bg-white/20 text-white hover:bg-white/30"
              )}
            >
              {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
            </Button>

            {/* 摄像头 */}
            <Button
              onClick={handleToggleCamera}
              size="icon"
              variant="ghost"
              className={cn(
                "rounded-full h-14 w-14",
                !isCameraOn ? "bg-red-500/80 text-white" : "bg-white/20 text-white hover:bg-white/30"
              )}
            >
              {isCameraOn ? <Video className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}
            </Button>

            {/* 切换前后摄像头 */}
            {isCameraOn && (
              <Button
                onClick={handleSwitchCamera}
                size="icon"
                variant="ghost"
                className="rounded-full h-14 w-14 bg-white/20 text-white hover:bg-white/30"
              >
                <SwitchCamera className="h-6 w-6" />
              </Button>
            )}

            {/* 挂断 */}
            <Button
              onClick={handleEndCall}
              size="icon"
              className="rounded-full h-16 w-16 bg-red-500 hover:bg-red-600 text-white shadow-lg"
            >
              <PhoneOff className="h-7 w-7" />
            </Button>

            {/* 扬声器 */}
            <Button
              onClick={() => setIsSpeakerOn(!isSpeakerOn)}
              size="icon"
              variant="ghost"
              className={cn(
                "rounded-full h-14 w-14",
                !isSpeakerOn ? "bg-white/20 text-white/50" : "bg-white/20 text-white hover:bg-white/30"
              )}
            >
              {isSpeakerOn ? <Volume2 className="h-6 w-6" /> : <VolumeX className="h-6 w-6" />}
            </Button>

            {/* 消息切换 */}
            <Button
              onClick={() => setShowMessages(!showMessages)}
              size="icon"
              variant="ghost"
              className={cn(
                "rounded-full h-14 w-14",
                showMessages ? "bg-blue-500/80 text-white" : "bg-white/20 text-white hover:bg-white/30"
              )}
            >
              <MessageSquare className="h-6 w-6" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoCall;

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Phone, PhoneOff, Mic, MicOff, Send, MessageSquare } from 'lucide-react';
import { useRealtimeAudio } from '@/hooks/useRealtimeAudio';
import { useSettings } from '@/hooks/useSettings';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface RealtimeCallPanelProps {
  onSpeakingChange?: (isSpeaking: boolean) => void;
  onCallStateChange?: (isInCall: boolean) => void;
}

export const RealtimeCallPanel: React.FC<RealtimeCallPanelProps> = ({
  onSpeakingChange,
  onCallStateChange
}) => {
  const { settings } = useSettings();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Build system prompt from settings
  const systemPrompt = `你是${settings.character.name}。
${settings.character.persona}
${settings.character.background}
说话风格：${settings.character.speakingStyle}
请用中文回复，保持回答简洁自然，像真人对话一样。`;

  const {
    isConnected,
    isRecording,
    isSpeaking,
    transcript,
    aiResponse,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    sendTextMessage
  } = useRealtimeAudio({
    systemPrompt,
    voiceId: 'alloy',
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        setMessages(prev => [...prev, {
          id: `user-${Date.now()}`,
          role: 'user',
          content: text,
          timestamp: new Date()
        }]);
      }
    },
    onSpeakingChange: (speaking) => {
      onSpeakingChange?.(speaking);
    },
    onError: (error) => {
      toast.error(error);
    }
  });

  // Track AI responses
  useEffect(() => {
    if (aiResponse) {
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg?.role === 'assistant') {
          return prev.map((m, i) => 
            i === prev.length - 1 ? { ...m, content: aiResponse } : m
          );
        }
        return [...prev, {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: aiResponse,
          timestamp: new Date()
        }];
      });
    }
  }, [aiResponse]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Notify call state changes
  useEffect(() => {
    onCallStateChange?.(isConnected);
  }, [isConnected, onCallStateChange]);

  // Start camera for PiP
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Failed to start camera:', error);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const handleStartCall = async () => {
    await startCamera();
    await connect();
    // Auto-start recording after connection
    setTimeout(() => {
      startRecording();
    }, 500);
  };

  const handleEndCall = () => {
    stopRecording();
    disconnect();
    stopCamera();
  };

  const handleSendText = () => {
    if (!inputText.trim() || !isConnected) return;
    
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      role: 'user',
      content: inputText,
      timestamp: new Date()
    }]);
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
    <div className="h-full flex flex-col bg-gradient-to-b from-background to-muted/20">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && !isConnected && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Phone className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-center">点击下方按钮开始实时语音通话</p>
            <p className="text-sm mt-2 opacity-70">支持实时语音对话，自动识别说话内容</p>
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
        
        {/* Live transcript indicator */}
        {isRecording && transcript && (
          <div className="max-w-[85%] ml-auto p-3 rounded-2xl bg-primary/50 text-primary-foreground rounded-br-md animate-pulse">
            <p className="text-sm">{transcript}...</p>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* User Camera PiP */}
      {isConnected && (
        <div className="absolute top-4 right-4 w-32 h-24 rounded-lg overflow-hidden shadow-lg border-2 border-primary/50 z-10">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover transform scale-x-[-1]"
          />
          {/* Recording indicator */}
          {isRecording && (
            <div className="absolute top-1 right-1 w-3 h-3 bg-destructive rounded-full animate-pulse" />
          )}
        </div>
      )}

      {/* Text Input (optional) */}
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

      {/* Controls */}
      <div className="p-4 border-t bg-background/80 backdrop-blur">
        <div className="flex items-center justify-center gap-4">
          {!isConnected ? (
            <Button
              onClick={handleStartCall}
              size="lg"
              className="rounded-full h-16 w-16 bg-emerald-600 hover:bg-emerald-700"
            >
              <Phone className="h-6 w-6" />
            </Button>
          ) : (
            <>
              {/* Toggle text input */}
              <Button
                onClick={() => setShowTextInput(!showTextInput)}
                size="icon"
                variant={showTextInput ? "default" : "outline"}
                className="rounded-full h-12 w-12"
              >
                <MessageSquare className="h-5 w-5" />
              </Button>

              {/* Mic toggle */}
              <Button
                onClick={() => isRecording ? stopRecording() : startRecording()}
                size="icon"
                variant={isRecording ? "default" : "outline"}
                className={cn(
                  "rounded-full h-14 w-14",
                  isRecording && "bg-primary animate-pulse"
                )}
              >
                {isRecording ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
              </Button>

              {/* End call */}
              <Button
                onClick={handleEndCall}
                size="lg"
                className="rounded-full h-16 w-16 bg-destructive hover:bg-destructive/90"
              >
                <PhoneOff className="h-6 w-6" />
              </Button>
            </>
          )}
        </div>

        {/* Status indicators */}
        {isConnected && (
          <div className="flex items-center justify-center gap-4 mt-3 text-sm text-muted-foreground">
            {isRecording && (
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
          </div>
        )}
      </div>
    </div>
  );
};

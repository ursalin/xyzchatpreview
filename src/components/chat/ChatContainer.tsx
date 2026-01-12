import { useRef, useEffect, useState } from 'react';
import { useChat } from '@/hooks/useChat';
import { useSettings } from '@/hooks/useSettings';
import { useVoice } from '@/hooks/useVoice';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { SettingsPanel } from './SettingsPanel';
import { Button } from '@/components/ui/button';
import { Trash2, MessageCircle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

export function ChatContainer() {
  const { settings, updateSettings, buildSystemPrompt } = useSettings();
  const systemPrompt = buildSystemPrompt();
  const { messages, isLoading, sendMessage, clearMessages } = useChat(settings, systemPrompt);
  const { 
    isPlaying, 
    isRecording, 
    isProcessing: isVoiceProcessing,
    speak, 
    startRecording, 
    stopRecording 
  } = useVoice(settings.voiceConfig);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentPlayingId, setCurrentPlayingId] = useState<string | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-speak new assistant messages if voice is enabled
  useEffect(() => {
    if (settings.voiceConfig.enabled && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'assistant' && !isLoading && lastMessage.content) {
        // Auto-speak the latest response
        handleSpeak(lastMessage.id, lastMessage.content);
      }
    }
  }, [messages, isLoading, settings.voiceConfig.enabled]);

  const handleSpeak = async (messageId: string, text: string) => {
    if (currentPlayingId === messageId && isPlaying) {
      setCurrentPlayingId(null);
      return;
    }
    setCurrentPlayingId(messageId);
    try {
      await speak(text);
    } catch (error) {
      console.error('Speak error:', error);
    }
    setCurrentPlayingId(null);
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-background to-muted/20">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-primary" />
          <h1 className="font-semibold">{settings.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <SettingsPanel settings={settings} onSettingsChange={updateSettings} />
          {messages.length > 0 && (
            <Button variant="ghost" size="icon" onClick={clearMessages}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-12">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <MessageCircle className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-lg font-medium text-foreground mb-2">
              嗨，我是{settings.character.name}
            </h2>
            <p className="max-w-sm">
              {settings.character.persona}
            </p>
            <p className="text-sm mt-4">发送消息开始聊天吧！</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <ChatMessage 
                key={message.id} 
                message={message} 
                characterName={settings.character.name}
                voiceConfig={settings.voiceConfig}
                onSpeak={(text) => handleSpeak(message.id, text)}
                isPlaying={currentPlayingId === message.id && isPlaying}
                isProcessing={currentPlayingId === message.id && isVoiceProcessing}
              />
            ))}
            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex gap-3 p-4 rounded-2xl max-w-[85%] mr-auto bg-muted animate-pulse">
                <div className="w-8 h-8 rounded-full bg-primary/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted-foreground/20 rounded w-3/4" />
                  <div className="h-4 bg-muted-foreground/20 rounded w-1/2" />
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <ChatInput 
        onSend={sendMessage} 
        isLoading={isLoading}
        onStartRecording={startRecording}
        onStopRecording={stopRecording}
        isRecording={isRecording}
        isProcessingVoice={isVoiceProcessing}
      />
    </div>
  );
}

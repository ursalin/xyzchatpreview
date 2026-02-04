import { useRef, useEffect, useState } from 'react';
import { useChat } from '@/hooks/useChat';
import { useSettings } from '@/hooks/useSettings';
import { useVoice } from '@/hooks/useVoice';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { SettingsPanel } from './SettingsPanel';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Trash2, MessageCircle, Brain } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import MemoryPanel from '@/components/memory/MemoryPanel';

interface ChatContainerProps {
  onSpeakingChange?: (isSpeaking: boolean) => void;
  onMoodChange?: (mood: 'happy' | 'neutral' | 'thinking') => void;
}

export function ChatContainer({ onSpeakingChange, onMoodChange }: ChatContainerProps) {
  const { settings, updateSettings, buildSystemPrompt } = useSettings();
  const systemPrompt = buildSystemPrompt();
  const { 
    messages, 
    isLoading, 
    memorySummary,
    isSummarizing,
    sendMessage, 
    clearMessages,
    deleteMessages,
    clearMemory,
    updateMemorySummary,
  } = useChat(settings, systemPrompt);
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
  const [activeTab, setActiveTab] = useState('chat');

  // Notify parent about speaking state
  useEffect(() => {
    onSpeakingChange?.(isPlaying);
  }, [isPlaying, onSpeakingChange]);

  // Notify parent about mood based on loading state
  useEffect(() => {
    if (isLoading) {
      onMoodChange?.('thinking');
    } else if (isPlaying) {
      onMoodChange?.('happy');
    } else {
      onMoodChange?.('neutral');
    }
  }, [isLoading, isPlaying, onMoodChange]);

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
    <div className="flex flex-col h-full bg-gradient-to-b from-background to-muted/20 md:pt-0 pt-[200px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-2 ml-10 md:ml-10">
          <MessageCircle className="w-5 h-5 text-primary" />
          <h1 className="font-semibold">{settings.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <SettingsPanel settings={settings} onSettingsChange={updateSettings} />
          {messages.length > 0 && activeTab === 'chat' && (
            <Button variant="ghost" size="icon" onClick={clearMessages}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Content with Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-4 mt-2">
          <TabsTrigger value="chat" className="gap-2">
            <MessageCircle className="w-4 h-4" />
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

        <TabsContent value="chat" className="flex-1 flex flex-col min-h-0 mt-0">
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
  );
}

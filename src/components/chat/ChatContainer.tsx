import { useRef, useEffect, useState } from 'react';
import { useChat } from '@/hooks/useChat';
import { useSettings } from '@/hooks/useSettings';
import { useVoice } from '@/hooks/useVoice';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { SettingsPanel } from './SettingsPanel';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Trash2, MessageCircle, Brain, Star, ArrowLeft, X, Search } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import MemoryPanel from '@/components/memory/MemoryPanel';
import { cn } from '@/lib/utils';

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
    toggleStarMessage,
    editMessage,
    starredMessages,
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
  const [showStarred, setShowStarred] = useState(false);
  const [highlightMsgId, setHighlightMsgId] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<typeof messages>([]);

  useEffect(() => {
    onSpeakingChange?.(isPlaying);
  }, [isPlaying, onSpeakingChange]);

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
        handleSpeak(lastMessage.id, lastMessage.content);
      }
    }
  }, [messages, isLoading, settings.voiceConfig.enabled]);

  // 高亮消失
  useEffect(() => {
    if (highlightMsgId) {
      const timer = setTimeout(() => setHighlightMsgId(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [highlightMsgId]);

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

  // 跳转到收藏消息原位置
  const handleJumpToMessage = (messageId: string) => {
    setShowStarred(false);
    setShowSearch(false);
    setActiveTab('chat');
    setHighlightMsgId(messageId);
    // 滚动到目标消息
    setTimeout(() => {
      const el = document.getElementById(`msg-${messageId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  // 搜索消息
  useEffect(() => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const results = messages.filter(msg => 
        msg.content.toLowerCase().includes(query)
      );
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, messages]);

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-background to-muted/20">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-2 ml-10 md:ml-10">
          <MessageCircle className="w-5 h-5 text-primary" />
          <h1 className="font-semibold">{settings.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* 搜索入口 */}
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setShowSearch(!showSearch)}
          >
            <Search className={cn("w-4 h-4", showSearch && "text-primary")} />
          </Button>
          {/* 收藏入口 */}
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setShowStarred(!showStarred)}
            className="relative"
          >
            <Star className={cn("w-4 h-4", showStarred && "text-yellow-500 fill-yellow-500")} />
            {starredMessages.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-500 text-white text-[10px] rounded-full flex items-center justify-center">
                {starredMessages.length}
              </span>
            )}
          </Button>
          <SettingsPanel settings={settings} onSettingsChange={updateSettings} />
          {messages.length > 0 && activeTab === 'chat' && (
            <Button variant="ghost" size="icon" onClick={clearMessages}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* 收藏列表面板 */}
      {showStarred && (
        <div className="absolute inset-0 z-30 bg-background flex flex-col">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <Button variant="ghost" size="icon" onClick={() => setShowStarred(false)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
            <h2 className="font-semibold">收藏消息</h2>
            <span className="text-sm text-muted-foreground">({starredMessages.length})</span>
          </div>
          <ScrollArea className="flex-1 p-4">
            {starredMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Star className="w-12 h-12 mb-4 text-muted-foreground/30" />
                <p>还没有收藏的消息</p>
                <p className="text-sm mt-1">长按消息可以收藏哦</p>
              </div>
            ) : (
              <div className="space-y-3">
                {starredMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className="p-3 rounded-xl border border-border bg-card hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => handleJumpToMessage(msg.id)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        {msg.role === 'user' ? '你' : settings.character.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {msg.timestamp.toLocaleString('zh-CN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 ml-auto"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStarMessage(msg.id);
                        }}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                    {msg.imageUrl && (
                      <img src={msg.imageUrl} alt="" className="h-16 rounded mb-1 object-cover" />
                    )}
                    <p className="text-sm line-clamp-3">{msg.content}</p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      )}

      {/* 搜索面板 */}
      {showSearch && (
        <div className="absolute inset-0 z-30 bg-background flex flex-col">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <Button variant="ghost" size="icon" onClick={() => { setShowSearch(false); setSearchQuery(''); }}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="搜索消息..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full pl-10 pr-8 py-2 rounded-full bg-muted border-none outline-none text-sm"
              />
              {searchQuery && (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  onClick={() => setSearchQuery('')}
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
          <ScrollArea className="flex-1 p-4">
            {searchQuery.trim() === '' ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Search className="w-12 h-12 mb-4 text-muted-foreground/30" />
                <p>输入关键词搜索消息</p>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Search className="w-12 h-12 mb-4 text-muted-foreground/30" />
                <p>没有找到相关消息</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground mb-2">找到 {searchResults.length} 条消息</p>
                {searchResults.map((msg) => {
                  // 高亮匹配的关键词
                  const query = searchQuery.toLowerCase();
                  const idx = msg.content.toLowerCase().indexOf(query);
                  const start = Math.max(0, idx - 20);
                  const end = Math.min(msg.content.length, idx + searchQuery.length + 40);
                  const snippet = (start > 0 ? '...' : '') + msg.content.slice(start, end) + (end < msg.content.length ? '...' : '');
                  
                  return (
                    <div
                      key={msg.id}
                      className="p-3 rounded-xl border border-border bg-card hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => handleJumpToMessage(msg.id)}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-muted-foreground">
                          {msg.role === 'user' ? '你' : settings.character.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {msg.timestamp.toLocaleString('zh-CN', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {msg.starred && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500 ml-auto" />}
                      </div>
                      <p className="text-sm" dangerouslySetInnerHTML={{
                        __html: snippet.replace(
                          new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
                          '<mark class="bg-yellow-300 dark:bg-yellow-600 rounded px-0.5">$1</mark>'
                        )
                      }} />
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      )}

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
                  <div 
                    key={message.id}
                    id={`msg-${message.id}`}
                    className={cn(
                      "transition-all duration-500",
                      highlightMsgId === message.id && "ring-2 ring-yellow-500 rounded-2xl"
                    )}
                  >
                    <ChatMessage 
                      message={message} 
                      characterName={settings.character.name}
                      voiceConfig={settings.voiceConfig}
                      onSpeak={(text) => handleSpeak(message.id, text)}
                      isPlaying={currentPlayingId === message.id && isPlaying}
                      isProcessing={currentPlayingId === message.id && isVoiceProcessing}
                      onToggleStar={toggleStarMessage}
                      onEdit={editMessage}
                    />
                  </div>
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

import { useRef, useEffect, useState } from 'react';
import { useChat } from '@/hooks/useChat';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { PersonalitySelector } from './PersonalitySelector';
import { Personality, defaultPersonalities } from '@/types/chat';
import { Button } from '@/components/ui/button';
import { Trash2, MessageCircle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

export function ChatContainer() {
  const [personality, setPersonality] = useState<Personality>(defaultPersonalities[0]);
  const { messages, isLoading, sendMessage, clearMessages } = useChat(personality);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-background to-muted/20">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-primary" />
          <h1 className="font-semibold">AI 伴侣</h1>
        </div>
        <div className="flex items-center gap-2">
          <PersonalitySelector current={personality} onSelect={setPersonality} />
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
              嗨，我是你的AI伴侣
            </h2>
            <p className="max-w-sm">
              当前性格：<span className="text-primary">{personality.name}</span>
              <br />
              {personality.description}
            </p>
            <p className="text-sm mt-4">发送消息开始聊天吧！</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
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
      <ChatInput onSend={sendMessage} isLoading={isLoading} />
    </div>
  );
}

import { Message, VoiceConfig } from '@/types/chat';
import { cn } from '@/lib/utils';
import { User, Bot, Volume2, VolumeX, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

interface ChatMessageProps {
  message: Message;
  characterName?: string;
  voiceConfig?: VoiceConfig;
  onSpeak?: (text: string) => Promise<void>;
  isPlaying?: boolean;
  isProcessing?: boolean;
}

export function ChatMessage({ 
  message, 
  characterName = 'AI',
  voiceConfig,
  onSpeak,
  isPlaying,
  isProcessing,
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const canSpeak = !isUser && voiceConfig?.enabled && voiceConfig?.minimaxApiKey && voiceConfig?.minimaxGroupId;

  const handleSpeak = async () => {
    if (onSpeak && canSpeak) {
      try {
        await onSpeak(message.content);
      } catch (error) {
        console.error('Failed to speak:', error);
      }
    }
  };

  return (
    <div
      className={cn(
        'flex gap-3 p-4 rounded-2xl max-w-[85%] animate-fade-in',
        isUser
          ? 'ml-auto bg-primary text-primary-foreground'
          : 'mr-auto bg-muted'
      )}
    >
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
          isUser ? 'bg-primary-foreground/20' : 'bg-primary/10'
        )}
      >
        {isUser ? (
          <User className="w-4 h-4" />
        ) : (
          <Bot className="w-4 h-4 text-primary" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-sm">
            {isUser ? '你' : characterName}
          </span>
          <span
            className={cn(
              'text-xs',
              isUser ? 'text-primary-foreground/60' : 'text-muted-foreground'
            )}
          >
            {message.timestamp.toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {canSpeak && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 ml-auto"
              onClick={handleSpeak}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : isPlaying ? (
                <VolumeX className="w-3 h-3" />
              ) : (
                <Volume2 className="w-3 h-3" />
              )}
            </Button>
          )}
        </div>
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    </div>
  );
}

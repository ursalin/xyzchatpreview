import { Message, VoiceConfig } from '@/types/chat';
import { cn } from '@/lib/utils';
import { User, Bot, Volume2, VolumeX, Loader2, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState, useRef, useCallback } from 'react';

interface ChatMessageProps {
  message: Message;
  characterName?: string;
  voiceConfig?: VoiceConfig;
  onSpeak?: (text: string) => Promise<void>;
  isPlaying?: boolean;
  isProcessing?: boolean;
  onToggleStar?: (messageId: string) => void;
}

export function ChatMessage({ 
  message, 
  characterName = 'AI',
  voiceConfig,
  onSpeak,
  isPlaying,
  isProcessing,
  onToggleStar,
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const canSpeak = !isUser && voiceConfig?.enabled && voiceConfig?.minimaxApiKey && voiceConfig?.minimaxGroupId;
  const [showMenu, setShowMenu] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  const handleSpeak = async () => {
    if (onSpeak && canSpeak) {
      try {
        await onSpeak(message.content);
      } catch (error) {
        console.error('Failed to speak:', error);
      }
    }
  };

  const cancelTimer = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      // 震动反馈（如果支持）
      if (navigator.vibrate) navigator.vibrate(30);
      setShowMenu(true);
    }, 600);
  };

  const handleTouchMove = () => {
    cancelTimer();
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    cancelTimer();
    // 如果刚触发了长按菜单，阻止后续 click 事件
    if (didLongPress.current) {
      e.preventDefault();
    }
  };

  // 双击收藏（电脑端快捷方式）
  const handleDoubleClick = () => {
    onToggleStar?.(message.id);
  };

  return (
    <div className="relative" style={{ WebkitUserSelect: 'none', userSelect: 'none' }}>
      <div
        className={cn(
          'flex gap-3 p-4 rounded-2xl max-w-[85%] animate-fade-in relative',
          isUser
            ? 'ml-auto bg-primary text-primary-foreground'
            : 'mr-auto bg-muted'
        )}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          setShowMenu(true);
        }}
      >
        {/* 收藏标记 */}
        {message.starred && (
          <div className="absolute -top-1 -right-1">
            <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
          </div>
        )}

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
          {message.imageUrl && (
            <img 
              src={message.imageUrl} 
              alt="图片" 
              className="mt-2 rounded-lg max-h-48 object-cover cursor-pointer"
              onClick={() => window.open(message.imageUrl, '_blank')}
            />
          )}
          <p className="whitespace-pre-wrap break-words" style={{ WebkitUserSelect: 'text', userSelect: 'text' }}>{message.content}</p>
        </div>
      </div>

      {/* 长按菜单 */}
      {showMenu && (
        <>
          <div 
            className="fixed inset-0 z-40"
            onTouchStart={() => setShowMenu(false)}
            onClick={() => setShowMenu(false)} 
          />
          <div className={cn(
            "absolute z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[120px]",
            isUser ? "right-0 top-full mt-1" : "left-0 top-full mt-1"
          )}>
            <button
              className="w-full px-4 py-2 text-sm text-left hover:bg-muted flex items-center gap-2 active:bg-muted"
              onTouchEnd={(e) => {
                e.stopPropagation();
                onToggleStar?.(message.id);
                setShowMenu(false);
              }}
              onClick={() => {
                onToggleStar?.(message.id);
                setShowMenu(false);
              }}
            >
              <Star className={cn("w-4 h-4", message.starred ? "text-yellow-500 fill-yellow-500" : "")} />
              {message.starred ? '取消收藏' : '收藏'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

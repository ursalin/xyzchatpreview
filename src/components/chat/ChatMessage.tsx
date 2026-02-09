import { Message, VoiceConfig } from '@/types/chat';
import { cn } from '@/lib/utils';
import { User, Bot, Volume2, VolumeX, Loader2, Star, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

interface ChatMessageProps {
  message: Message;
  characterName?: string;
  voiceConfig?: VoiceConfig;
  onSpeak?: (text: string) => Promise<void>;
  isPlaying?: boolean;
  isProcessing?: boolean;
  onToggleStar?: (messageId: string) => void;
  onEdit?: (messageId: string, newContent: string) => void;
  onDelete?: (messageId: string) => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (messageId: string) => void;
}

export function ChatMessage({ 
  message, 
  characterName = 'AI',
  voiceConfig,
  onSpeak,
  isPlaying,
  isProcessing,
  onToggleStar,
  onEdit,
  onDelete,
  isSelectMode,
  isSelected,
  onToggleSelect,
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const canSpeak = !isUser && voiceConfig?.enabled && voiceConfig?.minimaxApiKey && voiceConfig?.minimaxGroupId;
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');

  const handleSpeak = async () => {
    if (onSpeak && canSpeak) {
      try {
        await onSpeak(message.content);
      } catch (error) {
        console.error('Failed to speak:', error);
      }
    }
  };

  const handleStartEdit = () => {
    setEditText(message.content);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (editText.trim() && editText !== message.content) {
      onEdit?.(message.id, editText.trim());
    }
    setIsEditing(false);
  };

  return (
    <div className="relative flex items-start gap-2">
      {/* 多选复选框 */}
      {isSelectMode && (
        <div 
          className="flex-shrink-0 mt-4 cursor-pointer"
          onClick={() => onToggleSelect?.(message.id)}
        >
          <div className={cn(
            "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
            isSelected ? "bg-primary border-primary" : "border-muted-foreground/40"
          )}>
            {isSelected && <span className="text-white text-xs">✓</span>}
          </div>
        </div>
      )}
      
      <div className="flex-1">
        <div
          className={cn(
            'flex gap-3 p-4 rounded-2xl max-w-[85%] animate-fade-in relative',
            isUser
              ? 'ml-auto bg-primary text-primary-foreground'
              : 'mr-auto bg-muted',
            isSelectMode && 'cursor-pointer',
            isSelected && 'ring-2 ring-primary/50'
          )}
          onClick={isSelectMode ? () => onToggleSelect?.(message.id) : undefined}
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
          
          {/* 消息内容 / 编辑模式 */}
          {isEditing ? (
            <div className="mt-1">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full p-2 rounded-lg bg-background text-foreground text-sm border border-border resize-none"
                rows={3}
                autoFocus
              />
              <div className="flex gap-2 mt-1">
                <button 
                  className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground"
                  onClick={handleSaveEdit}
                >
                  保存
                </button>
                <button 
                  className="text-xs px-3 py-1 rounded bg-muted text-muted-foreground"
                  onClick={() => setIsEditing(false)}
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          )}

          {/* 底部操作按钮 */}
          {!isEditing && !isSelectMode && (
            <div className={cn(
              "flex items-center gap-1 mt-2 pt-1",
              isUser ? "border-t border-primary-foreground/10" : "border-t border-border/50"
            )}>
              <button
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors",
                  message.starred 
                    ? "text-yellow-500" 
                    : isUser ? "text-primary-foreground/50 hover:text-primary-foreground/80" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => onToggleStar?.(message.id)}
              >
                <Star className={cn("w-3.5 h-3.5", message.starred && "fill-yellow-500")} />
                <span>{message.starred ? '已收藏' : '收藏'}</span>
              </button>
              
              <button
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors",
                  isUser ? "text-primary-foreground/50 hover:text-primary-foreground/80" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={handleStartEdit}
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>编辑</span>
              </button>

              <button
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors",
                  isUser ? "text-primary-foreground/50 hover:text-red-400" : "text-muted-foreground hover:text-red-500"
                )}
                onClick={() => onDelete?.(message.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>删除</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

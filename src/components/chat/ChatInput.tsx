import { useState, useRef, KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Loader2, Mic, MicOff, ImagePlus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  onSend: (message: string, imageUrl?: string) => void;
  isLoading: boolean;
  disabled?: boolean;
  onStartRecording?: () => Promise<void>;
  onStopRecording?: () => Promise<string>;
  isRecording?: boolean;
  isProcessingVoice?: boolean;
}

export function ChatInput({ 
  onSend, 
  isLoading, 
  disabled,
  onStartRecording,
  onStopRecording,
  isRecording,
  isProcessingVoice,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    if ((input.trim() || imagePreview) && !isLoading && !disabled) {
      onSend(input.trim() || '请看这张图片', imagePreview || undefined);
      setInput('');
      setImagePreview(null);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleVoiceToggle = async () => {
    if (isRecording && onStopRecording) {
      try {
        const text = await onStopRecording();
        if (text.trim()) {
          onSend(text.trim());
        }
      } catch (error) {
        console.error('Voice input error:', error);
      }
    } else if (onStartRecording) {
      try {
        await onStartRecording();
      } catch (error) {
        console.error('Failed to start recording:', error);
      }
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // 限制大小 5MB
    if (file.size > 5 * 1024 * 1024) {
      alert('图片大小不能超过 5MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setImagePreview(dataUrl);
    };
    reader.readAsDataURL(file);
    
    // 清空 input 以便重复选择同一文件
    e.target.value = '';
  };

  const showVoiceButton = onStartRecording && onStopRecording;

  return (
    <div className="border-t border-border bg-background/80 backdrop-blur-sm">
      {/* 图片预览 */}
      {imagePreview && (
        <div className="px-4 pt-3 pb-1">
          <div className="relative inline-block">
            <img
              src={imagePreview}
              alt="预览"
              className="h-20 rounded-lg object-cover border border-border"
            />
            <button
              onClick={() => setImagePreview(null)}
              className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center"
            >
              <X className="w-3 h-3 text-white" />
            </button>
          </div>
        </div>
      )}
      
      {/* 输入区域 */}
      <div className="flex items-end gap-2 p-4 pt-2">
        {/* 图片上传 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          className="hidden"
        />
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading || disabled || isRecording}
          size="icon"
          variant="ghost"
          className="h-12 w-12 rounded-xl flex-shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ImagePlus className="w-5 h-5" />
        </Button>

        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isRecording ? "正在录音..." : "输入消息..."}
          className={cn(
            "min-h-[48px] max-h-[120px] resize-none rounded-xl",
            isRecording && "border-red-500 bg-red-500/5"
          )}
          disabled={isLoading || disabled || isRecording}
        />
        {showVoiceButton && (
          <Button
            onClick={handleVoiceToggle}
            disabled={isLoading || disabled || isProcessingVoice}
            size="icon"
            variant={isRecording ? "destructive" : "outline"}
            className={cn(
              "h-12 w-12 rounded-xl flex-shrink-0",
              isRecording && "animate-pulse"
            )}
          >
            {isProcessingVoice ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : isRecording ? (
              <MicOff className="w-5 h-5" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </Button>
        )}
        <Button
          onClick={handleSend}
          disabled={(!input.trim() && !imagePreview) || isLoading || disabled || isRecording}
          size="icon"
          className="h-12 w-12 rounded-xl flex-shrink-0"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </Button>
      </div>
    </div>
  );
}

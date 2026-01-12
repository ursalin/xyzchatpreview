import { useState, KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Loader2, Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  onSend: (message: string) => void;
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

  const handleSend = () => {
    if (input.trim() && !isLoading && !disabled) {
      onSend(input.trim());
      setInput('');
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

  const showVoiceButton = onStartRecording && onStopRecording;

  return (
    <div className="flex gap-2 p-4 border-t border-border bg-background/80 backdrop-blur-sm">
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
        disabled={!input.trim() || isLoading || disabled || isRecording}
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
  );
}

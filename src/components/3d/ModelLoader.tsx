import { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

interface ModelLoaderProps {
  progress: number;
  status: 'loading' | 'error' | 'success';
  error?: string;
  onRetry?: () => void;
}

export function ModelLoader({ progress, status, error, onRetry }: ModelLoaderProps) {
  const [statusText, setStatusText] = useState('正在初始化...');

  useEffect(() => {
    if (status === 'loading') {
      if (progress < 10) {
        setStatusText('正在连接服务器...');
      } else if (progress < 40) {
        setStatusText('正在下载模型数据...');
      } else if (progress < 70) {
        setStatusText('正在解析模型...');
      } else if (progress < 90) {
        setStatusText('正在渲染3D模型...');
      } else {
        setStatusText('即将完成...');
      }
    }
  }, [progress, status]);

  if (status === 'error') {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-destructive/5 to-background rounded-2xl">
        <div className="flex flex-col items-center gap-4 p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-1">模型加载失败</p>
            <p className="text-xs text-muted-foreground max-w-[200px]">
              {error || '请检查网络连接后重试'}
            </p>
          </div>
          {onRetry && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onRetry}
              className="gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              重新加载
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/5 to-secondary/5 rounded-2xl">
      <div className="flex flex-col items-center gap-4 w-full max-w-[200px] px-4">
        {/* Animated loading indicator */}
        <div className="relative">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
          {/* Glow effect */}
          <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl animate-pulse" />
        </div>
        
        {/* Progress bar */}
        <div className="w-full space-y-2">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">{statusText}</span>
            <span className="text-xs font-medium text-primary">{Math.round(progress)}%</span>
          </div>
        </div>
        
        {/* Tip text */}
        <p className="text-xs text-muted-foreground/60 text-center">
          首次加载可能需要几秒钟
        </p>
      </div>
    </div>
  );
}

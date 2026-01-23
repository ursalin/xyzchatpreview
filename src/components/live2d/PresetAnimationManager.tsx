import React, { useRef } from 'react';
import { Plus, Trash2, Play, Video, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PresetAnimation } from '@/hooks/usePresetAnimations';

interface PresetAnimationManagerProps {
  animations: PresetAnimation[];
  currentAnimationId: string | null;
  isPlaying: boolean;
  onAddAnimation: (file: File) => Promise<void>;
  onRemoveAnimation: (id: string) => void;
  onPreview?: (animation: PresetAnimation) => void;
}

const PresetAnimationManager: React.FC<PresetAnimationManagerProps> = ({
  animations,
  currentAnimationId,
  isPlaying,
  onAddAnimation,
  onRemoveAnimation,
  onPreview,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = React.useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('video/')) return;

    setIsUploading(true);
    try {
      await onAddAnimation(file);
    } catch (error) {
      console.error('Failed to add animation:', error);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.round(ms / 1000);
    return `${seconds}秒`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Film className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">预设说话动画</span>
          <span className="text-xs text-muted-foreground">({animations.length}个)</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="gap-1"
        >
          <Plus className="w-3 h-3" />
          添加
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {animations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-border rounded-lg">
          <Video className="w-8 h-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            还没有预设动画
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            上传角色说话的视频片段
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 gap-1"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus className="w-3 h-3" />
            上传视频
          </Button>
        </div>
      ) : (
        <ScrollArea className="max-h-[200px]">
          <div className="space-y-2">
            {animations.map((anim) => (
              <div
                key={anim.id}
                className={`flex items-center gap-3 p-2 rounded-lg border transition-colors ${
                  currentAnimationId === anim.id && isPlaying
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                {/* 缩略图 */}
                <div className="w-12 h-12 rounded overflow-hidden bg-muted flex-shrink-0">
                  <video
                    src={anim.videoUrl}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                  />
                </div>

                {/* 信息 */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{anim.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDuration(anim.duration)}
                  </p>
                </div>

                {/* 状态/操作 */}
                <div className="flex items-center gap-1">
                  {currentAnimationId === anim.id && isPlaying ? (
                    <span className="flex items-center gap-1 text-xs text-primary">
                      <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                      播放中
                    </span>
                  ) : (
                    <>
                      {onPreview && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => onPreview(anim)}
                        >
                          <Play className="w-3 h-3" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => onRemoveAnimation(anim.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      <p className="text-xs text-muted-foreground">
        提示：上传多个不同的说话动画片段，系统会随机选择播放，与语音同步
      </p>
    </div>
  );
};

export default PresetAnimationManager;

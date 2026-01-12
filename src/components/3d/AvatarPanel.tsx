import { Suspense } from 'react';
import { Avatar3D } from './Avatar3D';
import { Loader2 } from 'lucide-react';

interface AvatarPanelProps {
  isSpeaking: boolean;
  mood?: 'happy' | 'neutral' | 'thinking';
  characterName: string;
  modelUrl?: string | null;
}

function LoadingFallback() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/5 to-secondary/5 rounded-2xl">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">初始化中...</span>
      </div>
    </div>
  );
}

export function AvatarPanel({ isSpeaking, mood = 'neutral', characterName, modelUrl }: AvatarPanelProps) {
  return (
    <div className="relative w-full h-full min-h-[300px] bg-gradient-to-br from-background via-background to-primary/5 rounded-2xl overflow-hidden border border-border/50 shadow-xl">
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-40 h-40 bg-secondary/10 rounded-full blur-3xl" />
      </div>
      
      {/* 3D Canvas */}
      <div className="relative z-10 w-full h-full">
        <Suspense fallback={<LoadingFallback />}>
          <Avatar3D 
            isSpeaking={isSpeaking} 
            mood={mood} 
            modelUrl={modelUrl}
          />
        </Suspense>
      </div>
      
      {/* Character name badge */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
        <div className="px-4 py-2 bg-background/80 backdrop-blur-sm rounded-full border border-border/50 shadow-lg">
          <span className="text-sm font-medium text-foreground">{characterName}</span>
          {isSpeaking && (
            <span className="ml-2 inline-flex gap-0.5">
              <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          )}
        </div>
      </div>
      
      {/* Status indicator */}
      <div className="absolute top-4 right-4 z-20">
        <div className={`w-3 h-3 rounded-full ${
          isSpeaking ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30'
        }`} />
      </div>
    </div>
  );
}

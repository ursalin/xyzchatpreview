import React, { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, X, ZoomIn, ZoomOut, ArrowUp, ArrowDown, RotateCcw } from 'lucide-react';

interface Live2DAvatarProps {
  isSpeaking?: boolean;
  onImageLoaded?: () => void;
}

const Live2DAvatar: React.FC<Live2DAvatarProps> = ({ 
  isSpeaking = false,
  onImageLoaded 
}) => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offsetY, setOffsetY] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Animation state
  const [breathPhase, setBreathPhase] = useState(0);
  const [swayPhase, setSwayPhase] = useState(0);

  // Breathing & sway animation
  useEffect(() => {
    if (!isLoaded) return;

    let animationId: number;
    let startTime = Date.now();

    const animate = () => {
      const elapsed = (Date.now() - startTime) / 1000;
      
      // Breathing: slow up-down movement
      setBreathPhase(Math.sin(elapsed * 1.5) * 0.5);
      
      // Subtle sway: side-to-side
      setSwayPhase(Math.sin(elapsed * 0.8) * 0.3);

      animationId = requestAnimationFrame(animate);
    };

    animate();
    return () => cancelAnimationFrame(animationId);
  }, [isLoaded]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setImageSrc(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleImageLoad = () => {
    setIsLoaded(true);
    setShowControls(true);
    onImageLoaded?.();
  };

  const handleClear = () => {
    setImageSrc(null);
    setIsLoaded(false);
    setShowControls(false);
    setZoom(1);
    setOffsetY(0);
  };

  const handleReset = () => {
    setZoom(1);
    setOffsetY(0);
  };

  // Calculate transform based on animations
  const breathOffset = breathPhase * 2; // pixels
  const swayRotation = swayPhase * 0.5; // degrees
  const speakingScale = isSpeaking ? 1 + Math.sin(Date.now() / 100) * 0.01 : 1;

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-full flex items-center justify-center overflow-hidden bg-gradient-to-b from-background/50 to-background"
    >
      {!imageSrc ? (
        // Upload prompt
        <div className="flex flex-col items-center gap-4 p-8">
          <div className="w-32 h-32 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
            <Upload className="w-12 h-12 text-muted-foreground/50" />
          </div>
          <p className="text-muted-foreground text-center text-sm">
            上传游戏角色图片<br />
            <span className="text-xs opacity-70">支持 PNG、JPG（推荐透明背景 PNG）</span>
          </p>
          <Button 
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="gap-2"
          >
            <Upload className="w-4 h-4" />
            选择图片
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      ) : (
        <>
          {/* Animated character image */}
          <div 
            className="relative transition-transform duration-75"
            style={{
              transform: `
                translateY(${offsetY * 50 + breathOffset}px) 
                rotate(${swayRotation}deg) 
                scale(${zoom * speakingScale})
              `,
              transformOrigin: 'center bottom',
            }}
          >
            <img
              src={imageSrc}
              alt="Live2D Avatar"
              onLoad={handleImageLoad}
              className="max-h-[80vh] max-w-full object-contain drop-shadow-2xl"
              style={{
                filter: isSpeaking 
                  ? 'drop-shadow(0 0 20px hsl(var(--primary) / 0.3))' 
                  : 'drop-shadow(0 10px 30px rgba(0,0,0,0.3))',
              }}
            />
          </div>

          {/* Clear button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClear}
            className="absolute top-2 right-2 bg-background/50 backdrop-blur-sm"
          >
            <X className="w-4 h-4" />
          </Button>

          {/* Control panel */}
          {showControls && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 p-2 rounded-full bg-background/80 backdrop-blur-sm border border-border/50">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setZoom(z => Math.min(z + 0.1, 2))}
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setZoom(z => Math.max(z - 0.1, 0.3))}
              >
                <ZoomOut className="w-4 h-4" />
              </Button>
              <div className="w-px h-6 bg-border mx-1" />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setOffsetY(y => y - 0.2)}
              >
                <ArrowUp className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setOffsetY(y => y + 0.2)}
              >
                <ArrowDown className="w-4 h-4" />
              </Button>
              <div className="w-px h-6 bg-border mx-1" />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleReset}
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Live2DAvatar;

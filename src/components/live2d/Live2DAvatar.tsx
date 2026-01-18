import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, X, ZoomIn, ZoomOut, ArrowUp, ArrowDown, RotateCcw } from 'lucide-react';

interface Live2DAvatarProps {
  isSpeaking?: boolean;
  onImageLoaded?: () => void;
}

// Mesh grid configuration
const GRID_COLS = 20;
const GRID_ROWS = 30;

interface AnimationState {
  time: number;
  breathPhase: number;
  blinkPhase: number;
  isBlinking: boolean;
  mouthOpen: number;
  headTilt: number;
  headNod: number;
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const animationRef = useRef<number>(0);
  const lastBlinkTime = useRef<number>(0);
  const isSpeakingRef = useRef(isSpeaking);

  // Keep speaking ref updated
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  // Calculate deformed vertex position
  const getDeformedVertex = useCallback((
    x: number, 
    y: number, 
    imgWidth: number, 
    imgHeight: number,
    anim: AnimationState
  ): [number, number] => {
    const normalizedX = x / imgWidth; // 0 to 1
    const normalizedY = y / imgHeight; // 0 to 1
    
    let dx = 0;
    let dy = 0;

    // === HEAD REGION (top 35%) ===
    if (normalizedY < 0.35) {
      const headInfluence = 1 - (normalizedY / 0.35);
      
      // Head tilt (side to side)
      dx += anim.headTilt * 8 * headInfluence;
      
      // Head nod (slight up/down)
      dy += anim.headNod * 3 * headInfluence;
      
      // === EYE REGION (15% - 25% from top, 25% - 75% from sides) ===
      if (normalizedY > 0.15 && normalizedY < 0.28) {
        const eyeRegionY = (normalizedY - 0.15) / 0.13; // 0 to 1 within eye region
        const isLeftEye = normalizedX > 0.25 && normalizedX < 0.45;
        const isRightEye = normalizedX > 0.55 && normalizedX < 0.75;
        
        if ((isLeftEye || isRightEye) && anim.isBlinking) {
          // Squish eyes vertically when blinking
          const eyeCenterY = 0.21;
          const distFromCenter = normalizedY - eyeCenterY;
          dy += distFromCenter * anim.blinkPhase * imgHeight * 0.15;
        }
      }
      
      // === MOUTH REGION (28% - 38% from top, center 40%) ===
      if (normalizedY > 0.28 && normalizedY < 0.40 && normalizedX > 0.35 && normalizedX < 0.65) {
        const mouthCenterY = 0.34;
        const distFromMouthCenter = normalizedY - mouthCenterY;
        
        // Open mouth when speaking
        if (distFromMouthCenter > 0) {
          dy += anim.mouthOpen * 6 * (distFromMouthCenter / 0.06);
        } else {
          dy -= anim.mouthOpen * 2 * (-distFromMouthCenter / 0.06);
        }
      }
    }
    
    // === CHEST/TORSO REGION (35% - 70%) - Breathing ===
    if (normalizedY > 0.35 && normalizedY < 0.70) {
      const chestInfluence = Math.sin((normalizedY - 0.35) / 0.35 * Math.PI);
      const horizontalInfluence = 1 - Math.abs(normalizedX - 0.5) * 2;
      
      // Chest expansion (breathing)
      const breathExpand = anim.breathPhase * chestInfluence * horizontalInfluence;
      dx += (normalizedX - 0.5) * breathExpand * 12;
      dy -= breathExpand * 4;
    }
    
    // === SHOULDERS (35% - 45%) ===
    if (normalizedY > 0.35 && normalizedY < 0.50) {
      const shoulderInfluence = 1 - Math.abs(normalizedY - 0.42) / 0.08;
      if (shoulderInfluence > 0) {
        // Slight shoulder rise with breathing
        dy -= anim.breathPhase * shoulderInfluence * 3;
      }
    }

    // === GLOBAL SWAY ===
    const swayAmount = Math.sin(anim.time * 0.5) * 2;
    dx += swayAmount * (1 - normalizedY * 0.5);

    return [x + dx, y + dy];
  }, []);

  // Render the deformed mesh
  const renderMesh = useCallback((anim: AnimationState) => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imgWidth = img.naturalWidth;
    const imgHeight = img.naturalHeight;

    // Set canvas size to match container with zoom
    const container = containerRef.current;
    if (!container) return;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // Calculate display size maintaining aspect ratio
    const scale = Math.min(
      containerWidth / imgWidth,
      (containerHeight * 0.85) / imgHeight
    ) * zoom;

    const displayWidth = imgWidth * scale;
    const displayHeight = imgHeight * scale;

    canvas.width = containerWidth;
    canvas.height = containerHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Center offset
    const offsetX = (containerWidth - displayWidth) / 2;
    const baseOffsetY = (containerHeight - displayHeight) / 2 + offsetY * 50;

    // Draw mesh triangles
    const cellWidth = imgWidth / GRID_COLS;
    const cellHeight = imgHeight / GRID_ROWS;

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        // Source coordinates (texture)
        const sx = col * cellWidth;
        const sy = row * cellHeight;
        const sw = cellWidth;
        const sh = cellHeight;

        // Get deformed corners
        const [x0, y0] = getDeformedVertex(sx, sy, imgWidth, imgHeight, anim);
        const [x1, y1] = getDeformedVertex(sx + sw, sy, imgWidth, imgHeight, anim);
        const [x2, y2] = getDeformedVertex(sx + sw, sy + sh, imgWidth, imgHeight, anim);
        const [x3, y3] = getDeformedVertex(sx, sy + sh, imgWidth, imgHeight, anim);

        // Scale to display size
        const dx0 = offsetX + x0 * scale;
        const dy0 = baseOffsetY + y0 * scale;
        const dx1 = offsetX + x1 * scale;
        const dy1 = baseOffsetY + y1 * scale;
        const dx2 = offsetX + x2 * scale;
        const dy2 = baseOffsetY + y2 * scale;
        const dx3 = offsetX + x3 * scale;
        const dy3 = baseOffsetY + y3 * scale;

        // Draw using two triangles per cell
        // Triangle 1: top-left, top-right, bottom-left
        drawTexturedTriangle(ctx, img,
          sx, sy, sx + sw, sy, sx, sy + sh,
          dx0, dy0, dx1, dy1, dx3, dy3
        );
        
        // Triangle 2: top-right, bottom-right, bottom-left
        drawTexturedTriangle(ctx, img,
          sx + sw, sy, sx + sw, sy + sh, sx, sy + sh,
          dx1, dy1, dx2, dy2, dx3, dy3
        );
      }
    }

    // Add glow effect when speaking
    if (isSpeakingRef.current) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = `hsla(var(--primary) / ${0.05 + anim.mouthOpen * 0.05})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  }, [getDeformedVertex, zoom, offsetY]);

  // Animation loop
  useEffect(() => {
    if (!isLoaded) return;

    let startTime = Date.now();
    lastBlinkTime.current = startTime;

    const animate = () => {
      const now = Date.now();
      const elapsed = (now - startTime) / 1000;

      // Breathing: smooth sine wave
      const breathPhase = (Math.sin(elapsed * 1.8) + 1) / 2; // 0 to 1

      // Blinking: random intervals
      let isBlinking = false;
      let blinkPhase = 0;
      const timeSinceLastBlink = now - lastBlinkTime.current;
      
      if (timeSinceLastBlink > 2500 + Math.random() * 3000) {
        lastBlinkTime.current = now;
      }
      
      const blinkDuration = 150;
      const blinkElapsed = now - lastBlinkTime.current;
      if (blinkElapsed < blinkDuration) {
        isBlinking = true;
        // Quick close then open
        blinkPhase = Math.sin((blinkElapsed / blinkDuration) * Math.PI);
      }

      // Mouth animation when speaking
      let mouthOpen = 0;
      if (isSpeakingRef.current) {
        // Rapid mouth movement
        mouthOpen = (Math.sin(elapsed * 12) + 1) / 2 * 0.7 + 
                    (Math.sin(elapsed * 8.5) + 1) / 2 * 0.3;
      }

      // Head movement
      const headTilt = Math.sin(elapsed * 0.7) * 0.3 + 
                       (isSpeakingRef.current ? Math.sin(elapsed * 2.5) * 0.2 : 0);
      const headNod = Math.sin(elapsed * 0.5) * 0.2 +
                      (isSpeakingRef.current ? Math.sin(elapsed * 3) * 0.15 : 0);

      const animState: AnimationState = {
        time: elapsed,
        breathPhase,
        blinkPhase,
        isBlinking,
        mouthOpen,
        headTilt,
        headNod,
      };

      renderMesh(animState);
      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isLoaded, renderMesh]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          imageRef.current = img;
          setImageSrc(e.target?.result as string);
          setIsLoaded(true);
          setShowControls(true);
          onImageLoaded?.();
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleClear = () => {
    setImageSrc(null);
    setIsLoaded(false);
    setShowControls(false);
    setZoom(1);
    setOffsetY(0);
    imageRef.current = null;
  };

  const handleReset = () => {
    setZoom(1);
    setOffsetY(0);
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-full flex items-center justify-center overflow-hidden bg-gradient-to-b from-background/50 to-background"
    >
      {!imageSrc ? (
        <div className="flex flex-col items-center gap-4 p-8">
          <div className="w-32 h-32 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
            <Upload className="w-12 h-12 text-muted-foreground/50" />
          </div>
          <p className="text-muted-foreground text-center text-sm">
            上传游戏角色图片<br />
            <span className="text-xs opacity-70">支持 PNG、JPG（推荐正面半身像）</span>
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
          <canvas
            ref={canvasRef}
            className="w-full h-full"
            style={{ imageRendering: 'auto' }}
          />

          <Button
            variant="ghost"
            size="icon"
            onClick={handleClear}
            className="absolute top-2 right-2 bg-background/50 backdrop-blur-sm"
          >
            <X className="w-4 h-4" />
          </Button>

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
                onClick={() => setOffsetY(y => y - 0.3)}
              >
                <ArrowUp className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setOffsetY(y => y + 0.3)}
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

// Helper: Draw a textured triangle using affine transformation
function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  sx0: number, sy0: number,
  sx1: number, sy1: number,
  sx2: number, sy2: number,
  dx0: number, dy0: number,
  dx1: number, dy1: number,
  dx2: number, dy2: number
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dx0, dy0);
  ctx.lineTo(dx1, dy1);
  ctx.lineTo(dx2, dy2);
  ctx.closePath();
  ctx.clip();

  // Calculate affine transformation matrix
  const denom = (sx0 - sx2) * (sy1 - sy2) - (sx1 - sx2) * (sy0 - sy2);
  if (Math.abs(denom) < 0.001) {
    ctx.restore();
    return;
  }

  const m11 = ((dx0 - dx2) * (sy1 - sy2) - (dx1 - dx2) * (sy0 - sy2)) / denom;
  const m12 = ((dx1 - dx2) * (sx0 - sx2) - (dx0 - dx2) * (sx1 - sx2)) / denom;
  const m21 = ((dy0 - dy2) * (sy1 - sy2) - (dy1 - dy2) * (sy0 - sy2)) / denom;
  const m22 = ((dy1 - dy2) * (sx0 - sx2) - (dy0 - dy2) * (sx1 - sx2)) / denom;
  const m31 = dx2 - m11 * sx2 - m12 * sy2;
  const m32 = dy2 - m21 * sx2 - m22 * sy2;

  ctx.transform(m11, m21, m12, m22, m31, m32);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

export default Live2DAvatar;

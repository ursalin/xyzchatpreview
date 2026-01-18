import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, X, ZoomIn, ZoomOut, ArrowUp, ArrowDown, RotateCcw } from "lucide-react";

interface Live2DAvatarProps {
  isSpeaking?: boolean;
  onImageLoaded?: () => void;
}

type Hsl = { h: number; s: number; l: number };

type AvatarMetrics = {
  canvasW: number;
  canvasH: number;
  scale: number;
  drawW: number;
  drawH: number;
  baseX: number; // top-left of image in canvas coords (before avatar transform)
  baseY: number;
};

const DEFAULT_FEATURES = {
  // These are normalized (0..1) relative to the image.
  // They won't be perfect for every picture, but they won't deform the whole face.
  eyeL: { x: 0.33, y: 0.215, w: 0.12, h: 0.05 },
  eyeR: { x: 0.55, y: 0.215, w: 0.12, h: 0.05 },
  mouth: { x: 0.43, y: 0.325, w: 0.14, h: 0.065 },
} as const;

function parseHslVar(raw: string): Hsl | null {
  // expected formats like: "222.2 47.4% 11.2%" (Tailwind/Shadcn HSL variables)
  const cleaned = raw.trim().replace(/,/g, " ");
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;
  const h = Number(parts[0]);
  const s = Number(parts[1].replace("%", ""));
  const l = Number(parts[2].replace("%", ""));
  if ([h, s, l].some((n) => Number.isNaN(n))) return null;
  return { h, s, l };
}

function hsla(hsl: Hsl, a: number) {
  return `hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, ${a})`;
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

const Live2DAvatar: React.FC<Live2DAvatarProps> = ({ isSpeaking = false, onImageLoaded }) => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offsetY, setOffsetY] = useState(0);
  const [showControls, setShowControls] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rafRef = useRef<number | null>(null);
  const speakingRef = useRef(isSpeaking);

  // Blink scheduler
  const blinkRef = useRef({
    nextAt: 0,
    active: false,
    startAt: 0,
  });

  // Theme colors for canvas overlays
  const colorsRef = useRef<{ foreground: Hsl; primary: Hsl } | null>(null);

  useEffect(() => {
    speakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    const root = document.documentElement;
    const st = getComputedStyle(root);
    const fg = parseHslVar(st.getPropertyValue("--foreground")) ?? { h: 0, s: 0, l: 0 };
    const pr = parseHslVar(st.getPropertyValue("--primary")) ?? { h: 220, s: 90, l: 55 };
    colorsRef.current = { foreground: fg, primary: pr };
  }, []);

  const computeMetrics = useMemo(() => {
    return () => {
      const canvas = canvasRef.current;
      const img = imageRef.current;
      const container = containerRef.current;
      if (!canvas || !img || !container) return null;

      const canvasW = container.clientWidth;
      const canvasH = container.clientHeight;

      const imgW = img.naturalWidth;
      const imgH = img.naturalHeight;

      const scale =
        Math.min(canvasW / imgW, (canvasH * 0.86) / imgH) * Math.max(0.1, Math.min(zoom, 2));

      const drawW = imgW * scale;
      const drawH = imgH * scale;

      const baseX = (canvasW - drawW) / 2;
      const baseY = (canvasH - drawH) / 2 + offsetY * 50;

      return { canvasW, canvasH, scale, drawW, drawH, baseX, baseY } satisfies AvatarMetrics;
    };
  }, [zoom, offsetY]);

  const renderFrame = (t: number) => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const metrics = computeMetrics();
    if (!metrics) return;

    // Keep canvas in sync
    if (canvas.width !== metrics.canvasW) canvas.width = metrics.canvasW;
    if (canvas.height !== metrics.canvasH) canvas.height = metrics.canvasH;

    const elapsed = t / 1000;

    // === Animation values (small, natural) ===
    const breath = (Math.sin(elapsed * 1.6) + 1) / 2; // 0..1
    const breathY = (breath - 0.5) * 6; // px
    const breathScale = 1 + (breath - 0.5) * 0.012;

    const headSway = Math.sin(elapsed * 0.55) * (speakingRef.current ? 1.0 : 0.6);
    const headTiltRad = (headSway * Math.PI) / 180; // degrees -> rad (tiny)

    // Blink state
    const now = performance.now();
    if (blinkRef.current.nextAt === 0) {
      blinkRef.current.nextAt = now + 1800 + Math.random() * 2600;
    }

    const blinkDuration = 140;
    let blinkAmount = 0; // 0..1
    if (!blinkRef.current.active && now >= blinkRef.current.nextAt) {
      blinkRef.current.active = true;
      blinkRef.current.startAt = now;
    }
    if (blinkRef.current.active) {
      const p = (now - blinkRef.current.startAt) / blinkDuration;
      if (p >= 1) {
        blinkRef.current.active = false;
        blinkRef.current.nextAt = now + 2000 + Math.random() * 3500;
      } else {
        // ease in/out blink
        blinkAmount = Math.sin(Math.min(1, Math.max(0, p)) * Math.PI);
      }
    }

    // Mouth talking amount
    let mouthOpen = 0;
    if (speakingRef.current) {
      mouthOpen =
        (Math.sin(elapsed * 10.5) + 1) / 2 * 0.6 + (Math.sin(elapsed * 6.2) + 1) / 2 * 0.4;
      mouthOpen = Math.min(1, Math.max(0, mouthOpen));
    }

    // === Draw ===
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Transform around the image bottom-center (feels more "body")
    const originX = metrics.baseX + metrics.drawW / 2;
    const originY = metrics.baseY + metrics.drawH * 0.95;

    ctx.save();
    ctx.translate(originX, originY);
    ctx.rotate(headTiltRad * 0.18); // very subtle
    ctx.scale(breathScale, breathScale);
    ctx.translate(-originX, -originY);

    // Draw the base image (NO WARP) with slight breathing vertical motion
    ctx.drawImage(img, metrics.baseX, metrics.baseY + breathY, metrics.drawW, metrics.drawH);

    // === Overlays (no image deformation) ===
    const colors = colorsRef.current;
    const fg = colors?.foreground ?? { h: 0, s: 0, l: 0 };
    const pr = colors?.primary ?? { h: 220, s: 90, l: 55 };

    // Blink eyelids (cover eyes briefly)
    if (blinkAmount > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = hsla(fg, 0.55);

      const drawEye = (eye: { x: number; y: number; w: number; h: number }) => {
        const ex = metrics.baseX + eye.x * metrics.drawW;
        const ey = metrics.baseY + eye.y * metrics.drawH + breathY;
        const ew = eye.w * metrics.drawW;
        const eh = eye.h * metrics.drawH;

        // eyelid height grows with blinkAmount
        const lidH = eh * blinkAmount;
        const centerY = ey + eh / 2;
        const yTop = centerY - lidH / 2;

        roundedRectPath(ctx, ex, yTop, ew, lidH, ew * 0.18);
        ctx.fill();
      };

      drawEye(DEFAULT_FEATURES.eyeL);
      drawEye(DEFAULT_FEATURES.eyeR);
      ctx.restore();
    }

    // Mouth talking: draw a small dark "opening" + subtle highlight
    if (mouthOpen > 0.01) {
      const m = DEFAULT_FEATURES.mouth;
      const mx = metrics.baseX + m.x * metrics.drawW;
      const my = metrics.baseY + m.y * metrics.drawH + breathY;
      const mw = m.w * metrics.drawW;
      const mh = m.h * metrics.drawH;

      const openH = mh * (0.25 + mouthOpen * 0.65);
      const openY = my + mh * 0.35;

      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = hsla(fg, 0.35);
      roundedRectPath(ctx, mx + mw * 0.18, openY, mw * 0.64, openH, mw * 0.22);
      ctx.fill();

      // tiny highlight (looks like lip sheen)
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = hsla(pr, 0.12 + mouthOpen * 0.08);
      roundedRectPath(ctx, mx + mw * 0.22, openY + openH * 0.15, mw * 0.56, openH * 0.18, mw * 0.2);
      ctx.fill();
      ctx.restore();
    }

    // Speaking glow (very subtle)
    if (speakingRef.current) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = hsla(pr, 0.04);
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    ctx.restore();

    rafRef.current = requestAnimationFrame(renderFrame);
  };

  useEffect(() => {
    if (!isLoaded) return;
    rafRef.current = requestAnimationFrame(renderFrame);
    return () => {
    
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, computeMetrics]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        imageRef.current = img;
        setImageSrc(url);
        setIsLoaded(true);
        setShowControls(true);
        onImageLoaded?.();
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
  };

  const handleClear = () => {
    setImageSrc(null);
    setIsLoaded(false);
    setShowControls(false);
    setZoom(1);
    setOffsetY(0);
    imageRef.current = null;
    blinkRef.current = { nextAt: 0, active: false, startAt: 0 };
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
            上传游戏角色图片
            <br />
            <span className="text-xs opacity-70">建议：正面半身照（脸更居中效果更好）</span>
          </p>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
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
          <canvas ref={canvasRef} className="w-full h-full" style={{ imageRendering: "auto" }} />

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
                onClick={() => setZoom((z) => Math.min(z + 0.1, 2))}
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setZoom((z) => Math.max(z - 0.1, 0.3))}
              >
                <ZoomOut className="w-4 h-4" />
              </Button>
              <div className="w-px h-6 bg-border mx-1" />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setOffsetY((y) => y - 0.3)}
              >
                <ArrowUp className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setOffsetY((y) => y + 0.3)}
              >
                <ArrowDown className="w-4 h-4" />
              </Button>
              <div className="w-px h-6 bg-border mx-1" />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleReset}>
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

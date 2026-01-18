import React, { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Upload, X, ZoomIn, ZoomOut, ArrowUp, ArrowDown, RotateCcw } from "lucide-react";
import characterAvatar from "@/assets/character-avatar.jpg";

interface Live2DAvatarProps {
  isSpeaking?: boolean;
  onImageLoaded?: () => void;
}

// 针对这张角色图精确校准的五官位置 (归一化坐标 0-1)
// 基于图片分析: 眼睛在约 14-16% 高度, 嘴巴在约 22% 高度
const FEATURES = {
  // 左眼 (从观众角度)
  eyeL: { cx: 0.38, cy: 0.145, w: 0.08, h: 0.025 },
  // 右眼
  eyeR: { cx: 0.54, cy: 0.145, w: 0.08, h: 0.025 },
  // 嘴巴
  mouth: { cx: 0.465, cy: 0.215, w: 0.09, h: 0.025 },
  // 胸部区域 (用于呼吸)
  chest: { top: 0.30, bottom: 0.75 },
};

const Live2DAvatar: React.FC<Live2DAvatarProps> = ({ isSpeaking = false, onImageLoaded }) => {
  const [imageSrc, setImageSrc] = useState<string | null>(characterAvatar);
  const [isLoaded, setIsLoaded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offsetY, setOffsetY] = useState(0);
  const [showControls, setShowControls] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rafRef = useRef<number>(0);
  const speakingRef = useRef(isSpeaking);
  const skinColorRef = useRef<string>("rgb(220, 190, 170)");

  // Blink state
  const blinkRef = useRef({ nextAt: 0, phase: 0 });

  useEffect(() => {
    speakingRef.current = isSpeaking;
  }, [isSpeaking]);

  // 从图片采样皮肤颜色
  const sampleSkinColor = useCallback((img: HTMLImageElement) => {
    const tempCanvas = document.createElement("canvas");
    const size = 20;
    tempCanvas.width = size;
    tempCanvas.height = size;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) return;

    // 采样眼睛上方额头区域
    const sx = img.naturalWidth * 0.45;
    const sy = img.naturalHeight * 0.10;
    const sw = img.naturalWidth * 0.1;
    const sh = img.naturalHeight * 0.03;

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;

    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
    r = Math.round(r / count);
    g = Math.round(g / count);
    b = Math.round(b / count);
    skinColorRef.current = `rgb(${r}, ${g}, ${b})`;
  }, []);

  // 加载默认图片
  useEffect(() => {
    if (imageSrc && !isLoaded) {
      const img = new Image();
      img.onload = () => {
        imageRef.current = img;
        sampleSkinColor(img);
        setIsLoaded(true);
        setShowControls(true);
        onImageLoaded?.();
      };
      img.src = imageSrc;
    }
  }, [imageSrc, isLoaded, sampleSkinColor, onImageLoaded]);

  // 主渲染循环
  const render = useCallback((time: number) => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    const container = containerRef.current;
    if (!canvas || !img || !container) {
      rafRef.current = requestAnimationFrame(render);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;

    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;
    const baseScale = Math.min(cw / imgW, (ch * 0.9) / imgH);
    const scale = baseScale * zoom;
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const baseX = (cw - drawW) / 2;
    const baseY = (ch - drawH) / 2 + offsetY * 50;

    const elapsed = time / 1000;
    const now = performance.now();

    // === 呼吸动画 (只影响胸部以下) ===
    const breathCycle = (Math.sin(elapsed * 1.5) + 1) / 2; // 0-1
    const breathExpand = breathCycle * 0.008; // 非常微小的缩放

    // === 眨眼 ===
    if (blinkRef.current.nextAt === 0 || now > blinkRef.current.nextAt + 180) {
      blinkRef.current.nextAt = now + 2000 + Math.random() * 4000;
      blinkRef.current.phase = 0;
    }
    const blinkElapsed = now - blinkRef.current.nextAt + 2000;
    let blinkAmount = 0;
    if (blinkElapsed > 0 && blinkElapsed < 180) {
      blinkAmount = Math.sin((blinkElapsed / 180) * Math.PI);
    }

    // === 嘴巴说话 ===
    let mouthOpen = 0;
    if (speakingRef.current) {
      mouthOpen = (Math.sin(elapsed * 11) + 1) / 2 * 0.7 +
                  (Math.sin(elapsed * 7.3) + 1) / 2 * 0.3;
    }

    // === 轻微摇头 ===
    const headSway = Math.sin(elapsed * 0.6) * 0.3 +
                     (speakingRef.current ? Math.sin(elapsed * 2.8) * 0.25 : 0);

    ctx.clearRect(0, 0, cw, ch);

    // ======= 分层绘制 =======

    // 1. 绘制头部区域 (不变形, 只有轻微摇晃)
    const headBottom = baseY + drawH * FEATURES.chest.top;
    
    ctx.save();
    // 头部以脖子为轴心轻微转动
    const headPivotX = baseX + drawW / 2;
    const headPivotY = headBottom;
    ctx.translate(headPivotX, headPivotY);
    ctx.rotate((headSway * Math.PI) / 180 * 0.3);
    ctx.translate(-headPivotX, -headPivotY);

    // 只绘制头部
    ctx.drawImage(
      img,
      0, 0, imgW, imgH * FEATURES.chest.top, // 源: 头部
      baseX, baseY, drawW, drawH * FEATURES.chest.top // 目标
    );

    // 2. 绘制眨眼效果 (皮肤色眼睑)
    if (blinkAmount > 0.02) {
      ctx.fillStyle = skinColorRef.current;

      const drawEyelid = (eye: { cx: number; cy: number; w: number; h: number }) => {
        const ex = baseX + eye.cx * drawW;
        const ey = baseY + eye.cy * drawH;
        const ew = eye.w * drawW;
        const eh = eye.h * drawH * 2.5; // 眼睑高度

        // 上眼睑从上往下闭合
        const lidClosedH = eh * blinkAmount;
        
        ctx.beginPath();
        ctx.ellipse(ex, ey - eh / 2 + lidClosedH / 2, ew / 2, lidClosedH / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      };

      drawEyelid(FEATURES.eyeL);
      drawEyelid(FEATURES.eyeR);
    }

    // 3. 绘制嘴巴动画 (阴影表示张嘴)
    if (mouthOpen > 0.05) {
      const m = FEATURES.mouth;
      const mx = baseX + m.cx * drawW;
      const my = baseY + m.cy * drawH;
      const mw = m.w * drawW;
      const mh = m.h * drawH;

      // 嘴巴张开的黑色内部
      const openH = mh * (0.8 + mouthOpen * 2);
      
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = `rgba(40, 20, 20, ${0.4 + mouthOpen * 0.3})`;
      ctx.beginPath();
      ctx.ellipse(mx, my + openH * 0.3, mw * 0.45, openH * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // 牙齿高光
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = `rgba(255, 255, 255, ${mouthOpen * 0.25})`;
      ctx.beginPath();
      ctx.ellipse(mx, my, mw * 0.35, openH * 0.15, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();

    // 4. 绘制身体区域 (带呼吸效果)
    ctx.save();
    const bodyTop = FEATURES.chest.top;
    const bodyPivotX = baseX + drawW / 2;
    const bodyPivotY = baseY + drawH * bodyTop;
    
    ctx.translate(bodyPivotX, bodyPivotY);
    ctx.scale(1 + breathExpand, 1 + breathExpand * 0.5);
    ctx.translate(-bodyPivotX, -bodyPivotY);

    // 绘制身体
    ctx.drawImage(
      img,
      0, imgH * bodyTop, imgW, imgH * (1 - bodyTop), // 源: 身体
      baseX, baseY + drawH * bodyTop, drawW, drawH * (1 - bodyTop) // 目标
    );
    ctx.restore();

    // 说话时的微光效果
    if (speakingRef.current) {
      const gradient = ctx.createRadialGradient(
        baseX + drawW / 2, baseY + drawH * 0.2, 0,
        baseX + drawW / 2, baseY + drawH * 0.2, drawW * 0.5
      );
      gradient.addColorStop(0, `rgba(100, 150, 255, ${0.08 + mouthOpen * 0.05})`);
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, cw, ch);
    }

    rafRef.current = requestAnimationFrame(render);
  }, [zoom, offsetY]);

  useEffect(() => {
    if (!isLoaded) return;
    rafRef.current = requestAnimationFrame(render);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isLoaded, render]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        imageRef.current = img;
        sampleSkinColor(img);
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
            <span className="text-xs opacity-70">或使用默认角色</span>
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
          <canvas ref={canvasRef} className="w-full h-full" />

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
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom(z => Math.min(z + 0.1, 2))}>
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom(z => Math.max(z - 0.1, 0.3))}>
                <ZoomOut className="w-4 h-4" />
              </Button>
              <div className="w-px h-6 bg-border mx-1" />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOffsetY(y => y - 0.3)}>
                <ArrowUp className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOffsetY(y => y + 0.3)}>
                <ArrowDown className="w-4 h-4" />
              </Button>
              <div className="w-px h-6 bg-border mx-1" />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleReset}>
                <RotateCcw className="w-4 h-4" />
              </Button>
              <div className="w-px h-6 bg-border mx-1" />
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => fileInputRef.current?.click()}>
                换图
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Live2DAvatar;

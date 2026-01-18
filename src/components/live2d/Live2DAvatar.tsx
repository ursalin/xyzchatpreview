import React, { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Upload, X, ZoomIn, ZoomOut, ArrowUp, ArrowDown, RotateCcw, Settings, Check } from "lucide-react";
import characterAvatar from "@/assets/character-avatar.jpg";

interface Live2DAvatarProps {
  isSpeaking?: boolean;
  onImageLoaded?: () => void;
}

interface FeatureRegion {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

interface Features {
  eyeL: FeatureRegion;
  eyeR: FeatureRegion;
  mouth: FeatureRegion;
  chest: { top: number; bottom: number };
}

// 默认五官位置
const DEFAULT_FEATURES: Features = {
  eyeL: { cx: 0.42, cy: 0.23, w: 0.055, h: 0.018 },
  eyeR: { cx: 0.56, cy: 0.23, w: 0.055, h: 0.018 },
  mouth: { cx: 0.49, cy: 0.32, w: 0.06, h: 0.018 },
  chest: { top: 0.40, bottom: 0.95 },
};

const Live2DAvatar: React.FC<Live2DAvatarProps> = ({ isSpeaking = false, onImageLoaded }) => {
  const [imageSrc, setImageSrc] = useState<string | null>(characterAvatar);
  const [isLoaded, setIsLoaded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offsetY, setOffsetY] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [features, setFeatures] = useState<Features>(DEFAULT_FEATURES);
  const [dragTarget, setDragTarget] = useState<{ type: 'eyeL' | 'eyeR' | 'mouth'; mode: 'move' | 'resize' } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rafRef = useRef<number>(0);
  const speakingRef = useRef(isSpeaking);
  const skinColorRef = useRef<string>("rgb(220, 190, 170)");
  const featuresRef = useRef(features);
  const drawInfoRef = useRef({ baseX: 0, baseY: 0, drawW: 0, drawH: 0 });

  // Blink state
  const blinkRef = useRef({ nextAt: 0, phase: 0 });

  useEffect(() => {
    speakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    featuresRef.current = features;
  }, [features]);

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

    // 保存绘制信息用于校准模式
    drawInfoRef.current = { baseX, baseY, drawW, drawH };
    const feat = featuresRef.current;

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
    const headBottom = baseY + drawH * feat.chest.top;
    
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
      0, 0, imgW, imgH * feat.chest.top, // 源: 头部
      baseX, baseY, drawW, drawH * feat.chest.top // 目标
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

      drawEyelid(feat.eyeL);
      drawEyelid(feat.eyeR);
    }

    // 3. 绘制嘴巴动画 (阴影表示张嘴)
    if (mouthOpen > 0.05) {
      const m = feat.mouth;
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
    const bodyTop = feat.chest.top;
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

  // 拖拽处理
  const handleMouseDown = (type: 'eyeL' | 'eyeR' | 'mouth', mode: 'move' | 'resize') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragTarget({ type, mode });
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragTarget || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const { baseX, baseY, drawW, drawH } = drawInfoRef.current;
    
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // 转换为归一化坐标
    const normX = (mouseX - baseX) / drawW;
    const normY = (mouseY - baseY) / drawH;

    setFeatures(prev => {
      const updated = { ...prev };
      const target = updated[dragTarget.type];
      
      if (dragTarget.mode === 'move') {
        target.cx = Math.max(0, Math.min(1, normX));
        target.cy = Math.max(0, Math.min(1, normY));
      } else {
        // resize - 根据鼠标距离中心调整大小
        const dx = Math.abs(normX - target.cx);
        const dy = Math.abs(normY - target.cy);
        target.w = Math.max(0.02, Math.min(0.2, dx * 2));
        target.h = Math.max(0.01, Math.min(0.1, dy * 2));
      }
      
      return updated;
    });
  }, [dragTarget]);

  const handleMouseUp = () => {
    setDragTarget(null);
  };

  // 计算校准点的屏幕位置
  const getScreenPos = (region: FeatureRegion) => {
    const { baseX, baseY, drawW, drawH } = drawInfoRef.current;
    return {
      x: baseX + region.cx * drawW,
      y: baseY + region.cy * drawH,
      w: region.w * drawW,
      h: region.h * drawH * 3,
    };
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex items-center justify-center overflow-hidden bg-gradient-to-b from-background/50 to-background"
      onMouseMove={calibrationMode ? handleMouseMove : undefined}
      onMouseUp={calibrationMode ? handleMouseUp : undefined}
      onMouseLeave={calibrationMode ? handleMouseUp : undefined}
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

          {/* 校准模式覆盖层 */}
          {calibrationMode && isLoaded && (
            <div className="absolute inset-0 pointer-events-none">
              {/* 左眼 */}
              <CalibrationHandle
                label="左眼"
                color="hsl(var(--primary))"
                pos={getScreenPos(features.eyeL)}
                onMoveStart={handleMouseDown('eyeL', 'move')}
                onResizeStart={handleMouseDown('eyeL', 'resize')}
              />
              {/* 右眼 */}
              <CalibrationHandle
                label="右眼"
                color="hsl(var(--primary))"
                pos={getScreenPos(features.eyeR)}
                onMoveStart={handleMouseDown('eyeR', 'move')}
                onResizeStart={handleMouseDown('eyeR', 'resize')}
              />
              {/* 嘴巴 */}
              <CalibrationHandle
                label="嘴巴"
                color="hsl(var(--destructive))"
                pos={getScreenPos(features.mouth)}
                onMoveStart={handleMouseDown('mouth', 'move')}
                onResizeStart={handleMouseDown('mouth', 'resize')}
              />
            </div>
          )}

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
              <Button 
                variant={calibrationMode ? "default" : "ghost"} 
                size="icon" 
                className="h-8 w-8" 
                onClick={() => setCalibrationMode(!calibrationMode)}
              >
                {calibrationMode ? <Check className="w-4 h-4" /> : <Settings className="w-4 h-4" />}
              </Button>
              <div className="w-px h-6 bg-border mx-1" />
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => fileInputRef.current?.click()}>
                换图
              </Button>
            </div>
          )}

          {calibrationMode && (
            <div className="absolute top-2 left-2 bg-background/90 backdrop-blur-sm rounded-lg p-3 text-xs border border-border/50">
              <p className="font-medium mb-1">校准模式</p>
              <p className="text-muted-foreground">拖拽中心点移动位置</p>
              <p className="text-muted-foreground">拖拽边角调整大小</p>
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-2 w-full text-xs h-7"
                onClick={() => setFeatures(DEFAULT_FEATURES)}
              >
                重置默认
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// 校准手柄组件
interface CalibrationHandleProps {
  label: string;
  color: string;
  pos: { x: number; y: number; w: number; h: number };
  onMoveStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent) => void;
}

const CalibrationHandle: React.FC<CalibrationHandleProps> = ({ label, color, pos, onMoveStart, onResizeStart }) => {
  return (
    <>
      {/* 区域框 */}
      <div
        className="absolute border-2 rounded-sm pointer-events-none"
        style={{
          left: pos.x - pos.w / 2,
          top: pos.y - pos.h / 2,
          width: pos.w,
          height: pos.h,
          borderColor: color,
          backgroundColor: `${color}20`,
        }}
      />
      {/* 标签 */}
      <div
        className="absolute text-[10px] font-medium px-1 rounded pointer-events-none"
        style={{
          left: pos.x - pos.w / 2,
          top: pos.y - pos.h / 2 - 16,
          color: color,
          backgroundColor: 'hsl(var(--background) / 0.8)',
        }}
      >
        {label}
      </div>
      {/* 中心拖拽点 */}
      <div
        className="absolute w-4 h-4 rounded-full cursor-move pointer-events-auto border-2 bg-background"
        style={{
          left: pos.x - 8,
          top: pos.y - 8,
          borderColor: color,
        }}
        onMouseDown={onMoveStart}
      />
      {/* 调整大小拖拽点 (右下角) */}
      <div
        className="absolute w-3 h-3 rounded-sm cursor-se-resize pointer-events-auto border-2 bg-background"
        style={{
          left: pos.x + pos.w / 2 - 6,
          top: pos.y + pos.h / 2 - 6,
          borderColor: color,
        }}
        onMouseDown={onResizeStart}
      />
    </>
  );
};

export default Live2DAvatar;

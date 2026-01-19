import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Upload, RefreshCw, Settings2, Scan, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import idleVideo from '@/assets/character-idle.mp4';
import posterImg from '@/assets/character-front.jpg';

interface VideoAvatarProps {
  isSpeaking?: boolean;
  onImageLoaded?: () => void;
}

interface LoopConfig {
  loopStartPercent: number;   // 循环起点百分比 (0-50)
  loopEndPercent: number;     // 循环终点百分比 (50-100，实际 = 100 - value)
  crossfadeMs: number;        // 交叉淡入淡出时长 (50-500ms)
}

interface FrameAnalysis {
  position: number;      // 帧位置百分比
  diffScore: number;     // 与首帧差异分数 (0-100, 越小越相似)
}

interface AnalysisResult {
  bestStartPercent: number;
  bestEndPercent: number;
  startFrames: FrameAnalysis[];
  endFrames: FrameAnalysis[];
  confidence: number;    // 推荐置信度 (0-100)
}

const DEFAULT_CONFIG: LoopConfig = {
  loopStartPercent: 0,
  loopEndPercent: 0,
  crossfadeMs: 120,
};

// 计算两帧之间的差异分数 (0-100)
const calculateFrameDiff = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  frameA: ImageData,
  frameB: ImageData
): number => {
  const dataA = frameA.data;
  const dataB = frameB.data;
  let totalDiff = 0;
  const pixelCount = width * height;
  
  // 采样计算（每隔4个像素采样一次以提高性能）
  const step = 4;
  let samples = 0;
  
  for (let i = 0; i < dataA.length; i += 4 * step) {
    const rDiff = Math.abs(dataA[i] - dataB[i]);
    const gDiff = Math.abs(dataA[i + 1] - dataB[i + 1]);
    const bDiff = Math.abs(dataA[i + 2] - dataB[i + 2]);
    totalDiff += (rDiff + gDiff + bDiff) / 3;
    samples++;
  }
  
  // 归一化到 0-100
  return (totalDiff / samples / 255) * 100;
};

// 从视频特定时间点捕获帧
const captureFrame = (
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  time: number
): Promise<ImageData> => {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve(imageData);
      } catch (e) {
        reject(e);
      }
    };
    
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  });
};

// 分析视频首尾帧差异（两阶段：粗扫描 + 密集精确扫描）
const analyzeVideoFrames = async (
  videoSrc: string,
  onProgress: (percent: number) => void
): Promise<AnalysisResult> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.src = videoSrc;
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    if (!ctx) {
      reject(new Error('无法创建 Canvas 上下文'));
      return;
    }
    
    video.onloadedmetadata = async () => {
      const duration = video.duration;
      const width = Math.min(video.videoWidth, 320);
      const height = Math.min(video.videoHeight, 180);
      canvas.width = width;
      canvas.height = height;
      
      // === 第一阶段：粗扫描（找候选区域）===
      const coarseSampleCount = 10;
      const startFrames: FrameAnalysis[] = [];
      const endFrames: FrameAnalysis[] = [];
      
      try {
        // 捕获参考帧
        onProgress(2);
        const firstFrame = await captureFrame(video, canvas, ctx, 0.1);
        onProgress(4);
        const lastFrame = await captureFrame(video, canvas, ctx, duration - 0.1);
        
        // 粗扫描开头区域（0-30%）
        for (let i = 0; i <= coarseSampleCount; i++) {
          const percent = (i / coarseSampleCount) * 30;
          const time = (percent / 100) * duration;
          const frame = await captureFrame(video, canvas, ctx, time);
          const diffWithLast = calculateFrameDiff(ctx, width, height, frame, lastFrame);
          startFrames.push({ position: percent, diffScore: diffWithLast });
          onProgress(4 + (i / coarseSampleCount) * 18);
        }
        
        // 粗扫描结尾区域（70-100%）
        for (let i = 0; i <= coarseSampleCount; i++) {
          const percent = 70 + (i / coarseSampleCount) * 30;
          const time = (percent / 100) * duration;
          const frame = await captureFrame(video, canvas, ctx, time);
          const diffWithFirst = calculateFrameDiff(ctx, width, height, frame, firstFrame);
          endFrames.push({ position: 100 - percent, diffScore: diffWithFirst });
          onProgress(22 + (i / coarseSampleCount) * 18);
        }
        
        // 找粗扫描最佳候选
        const coarseBestStart = startFrames.reduce((best, curr) => 
          curr.diffScore < best.diffScore ? curr : best
        );
        const coarseBestEnd = endFrames.reduce((best, curr) => 
          curr.diffScore < best.diffScore ? curr : best
        );
        
        // === 第二阶段：密集精确扫描（±1%范围，0.05%步长）===
        const fineStep = 0.05; // 0.05% 步长
        const fineRange = 1.0; // ±1% 范围
        
        // 密集扫描开头区域
        const fineStartFrames: FrameAnalysis[] = [];
        const fineStartMin = Math.max(0, coarseBestStart.position - fineRange);
        const fineStartMax = Math.min(30, coarseBestStart.position + fineRange);
        const fineStartCount = Math.ceil((fineStartMax - fineStartMin) / fineStep);
        
        for (let i = 0; i <= fineStartCount; i++) {
          const percent = fineStartMin + (i * fineStep);
          if (percent > fineStartMax) break;
          const time = (percent / 100) * duration;
          const frame = await captureFrame(video, canvas, ctx, time);
          const diffWithLast = calculateFrameDiff(ctx, width, height, frame, lastFrame);
          fineStartFrames.push({ position: percent, diffScore: diffWithLast });
          onProgress(40 + (i / fineStartCount) * 25);
        }
        
        // 密集扫描结尾区域
        const fineEndFrames: FrameAnalysis[] = [];
        const actualEndPercent = 100 - coarseBestEnd.position; // 转回实际位置
        const fineEndMin = Math.max(70, actualEndPercent - fineRange);
        const fineEndMax = Math.min(100, actualEndPercent + fineRange);
        const fineEndCount = Math.ceil((fineEndMax - fineEndMin) / fineStep);
        
        for (let i = 0; i <= fineEndCount; i++) {
          const percent = fineEndMin + (i * fineStep);
          if (percent > fineEndMax) break;
          const time = (percent / 100) * duration;
          const frame = await captureFrame(video, canvas, ctx, time);
          const diffWithFirst = calculateFrameDiff(ctx, width, height, frame, firstFrame);
          fineEndFrames.push({ position: 100 - percent, diffScore: diffWithFirst });
          onProgress(65 + (i / fineEndCount) * 30);
        }
        
        // 合并精细结果到总列表
        fineStartFrames.forEach(f => {
          if (!startFrames.some(s => Math.abs(s.position - f.position) < 0.01)) {
            startFrames.push(f);
          }
        });
        fineEndFrames.forEach(f => {
          if (!endFrames.some(e => Math.abs(e.position - f.position) < 0.01)) {
            endFrames.push(f);
          }
        });
        
        // 从精细扫描中找最佳点（保留小数）
        const fineBestStart = fineStartFrames.reduce((best, curr) => 
          curr.diffScore < best.diffScore ? curr : best
        );
        const fineBestEnd = fineEndFrames.reduce((best, curr) => 
          curr.diffScore < best.diffScore ? curr : best
        );
        
        // 计算置信度
        const avgMinDiff = (fineBestStart.diffScore + fineBestEnd.diffScore) / 2;
        const confidence = Math.max(0, Math.min(100, 100 - avgMinDiff * 5));
        
        onProgress(100);
        
        // 保留两位小数
        resolve({
          bestStartPercent: Math.round(fineBestStart.position * 100) / 100,
          bestEndPercent: Math.round(fineBestEnd.position * 100) / 100,
          startFrames: startFrames.sort((a, b) => a.position - b.position),
          endFrames: endFrames.sort((a, b) => a.position - b.position),
          confidence
        });
        
      } catch (e) {
        reject(e);
      } finally {
        video.src = '';
        video.load();
      }
    };
    
    video.onerror = () => {
      reject(new Error('视频加载失败'));
    };
  });
};

const VideoAvatar: React.FC<VideoAvatarProps> = ({ 
  isSpeaking = false,
  onImageLoaded 
}) => {
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeVideoRef = useRef<'A' | 'B'>('A');
  const switchingRef = useRef(false);
  const configRef = useRef<LoopConfig>(DEFAULT_CONFIG);

  const [customVideo, setCustomVideo] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeVideo, setActiveVideo] = useState<'A' | 'B'>('A');
  const [config, setConfig] = useState<LoopConfig>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);
  
  // 分析相关状态
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisApplied, setAnalysisApplied] = useState(false);

  const src = customVideo || idleVideo;

  // 同步 config 到 ref，供 rAF 回调使用
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // 自动分析视频帧
  const handleAnalyze = useCallback(async () => {
    if (isAnalyzing) return;
    
    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisResult(null);
    setAnalysisApplied(false);
    
    try {
      const result = await analyzeVideoFrames(src, setAnalysisProgress);
      setAnalysisResult(result);
    } catch (e) {
      console.error('帧分析失败:', e);
    } finally {
      setIsAnalyzing(false);
    }
  }, [src, isAnalyzing]);

  // 应用推荐配置
  const applyRecommendation = useCallback(() => {
    if (!analysisResult) return;
    
    setConfig(c => ({
      ...c,
      loopStartPercent: analysisResult.bestStartPercent,
      loopEndPercent: analysisResult.bestEndPercent,
    }));
    setAnalysisApplied(true);
  }, [analysisResult]);

  // 行业标杆无缝循环 + 可调循环区间 + 交叉淡入淡出
  const setupSeamlessLoop = useCallback((currentSrc: string) => {
    const videoA = videoARef.current;
    const videoB = videoBRef.current;
    if (!videoA || !videoB) return;

    const FRESH_FRAME_TIMEOUT_MS = 200;

    let rafId: number | null = null;
    let destroyed = false;
    let resetTimeoutId: number | null = null;

    const armedRef = { current: false };

    const safePlay = async (v: HTMLVideoElement) => {
      try {
        await v.play();
      } catch {
        // muted + playsInline 通常允许自动播放
      }
    };

    const waitNextFrame = (v: HTMLVideoElement) =>
      new Promise<void>((resolve) => {
        const anyV = v as any;
        if (typeof anyV.requestVideoFrameCallback === 'function') {
          anyV.requestVideoFrameCallback(() => resolve());
          return;
        }
        setTimeout(() => requestAnimationFrame(() => resolve()), 0);
      });

    const waitFreshPresentedFrame = (v: HTMLVideoElement, timeoutMs: number) =>
      new Promise<void>((resolve) => {
        const start = performance.now();
        const baseTime = v.currentTime;
        const anyV = v as any;

        if (typeof anyV.requestVideoFrameCallback === 'function') {
          const tick = () => {
            anyV.requestVideoFrameCallback((_now: number, metadata: any) => {
              const mediaTime = typeof metadata?.mediaTime === 'number' ? metadata.mediaTime : v.currentTime;
              if (mediaTime > baseTime + 0.0005) return resolve();
              if (performance.now() - start > timeoutMs) return resolve();
              tick();
            });
          };
          tick();
          return;
        }

        const check = () => {
          if (v.currentTime > baseTime + 0.0005) return resolve();
          if (performance.now() - start > timeoutMs) return resolve();
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });

    // 计算实际循环区间
    const getLoopBounds = (duration: number) => {
      const cfg = configRef.current;
      const loopStart = (cfg.loopStartPercent / 100) * duration;
      const loopEnd = duration - (cfg.loopEndPercent / 100) * duration;
      return { loopStart, loopEnd: Math.max(loopEnd, loopStart + 0.5) };
    };

    const parkVideoAt = async (v: HTMLVideoElement, time: number) => {
      // 让隐藏视频“停在”目标时间点：解码出一帧后暂停。
      // 如果隐藏视频在后台继续播放，切换时可能出现跳帧/闪一下。
      try {
        v.pause();
      } catch {
        // ignore
      }

      try {
        v.currentTime = time;
      } catch {
        // ignore
      }

      await safePlay(v);
      await waitNextFrame(v);

      try {
        v.pause();
      } catch {
        // ignore
      }

      // 再停回目标点（有些浏览器 play 后会前进一小步）
      try {
        v.currentTime = time;
      } catch {
        // ignore
      }
    };

    const primeVideo = async (v: HTMLVideoElement, startTime: number) => {
      await parkVideoAt(v, startTime);
    };

    const resetHiddenToLoopStart = async (v: HTMLVideoElement, loopStart: number) => {
      await parkVideoAt(v, loopStart);
    };

    const switchTo = async (nextKey: 'A' | 'B', loopStart: number) => {
      if (switchingRef.current || destroyed) return;

      const currentVideo = nextKey === 'A' ? videoB : videoA;
      const nextVideo = nextKey === 'A' ? videoA : videoB;

      switchingRef.current = true;
      try {
        // 如果掉帧错过预热窗口，这里补一次预热，避免切换到未解码画面
        if (!armedRef.current) {
          await primeVideo(nextVideo, loopStart);
        } else {
          // 防御：确保 nextVideo 仍停在 loopStart 附近
          try {
            if (Math.abs(nextVideo.currentTime - loopStart) > 0.08) nextVideo.currentTime = loopStart;
          } catch {
            // ignore
          }
        }

        // 确保 nextVideo 已经在播放并产生过至少一帧
        await safePlay(nextVideo);
        await waitFreshPresentedFrame(nextVideo, FRESH_FRAME_TIMEOUT_MS);

        activeVideoRef.current = nextKey;
        setActiveVideo(nextKey);

        // 重要：等淡出完成后再去 pause/seek 旧视频。
        // 否则旧视频在 opacity 仍 > 0 时被 seek，会在画面上“闪一下”。
        if (resetTimeoutId) window.clearTimeout(resetTimeoutId);
        const delayMs = Math.max(0, configRef.current.crossfadeMs) + 34;
        resetTimeoutId = window.setTimeout(() => {
          if (destroyed) return;
          void resetHiddenToLoopStart(currentVideo, loopStart);
        }, delayMs);

        armedRef.current = false;
      } finally {
        switchingRef.current = false;
      }
    };

    const getActive = () => (activeVideoRef.current === 'A' ? videoA : videoB);
    const getInactive = () => (activeVideoRef.current === 'A' ? videoB : videoA);

    const monitor = async () => {
      if (destroyed) return;

      const current = getActive();
      const inactive = getInactive();
      const d = current.duration;

      if (Number.isFinite(d) && d > 0) {
        const { loopStart, loopEnd } = getLoopBounds(d);
        const remaining = loopEnd - current.currentTime;

        const switchLeadS = (() => {
          const ms = Math.max(0, configRef.current.crossfadeMs);
          // 切换尽量贴近 loopEnd：越贴近，首尾帧越容易匹配，闪烁越少
          return Math.min(0.5, Math.max(0.08, ms / 1000));
        })();
        const armLeadS = Math.min(1.2, switchLeadS + 0.55);

        // 提前预热下一段（让隐藏视频停在 loopStart，避免切换时解码/跳帧）
        if (!armedRef.current && remaining <= armLeadS && remaining > switchLeadS) {
          armedRef.current = true;
          void primeVideo(inactive, loopStart);
        }

        // 临近结尾：切换到另一路
        if (remaining <= switchLeadS) {
          void switchTo(activeVideoRef.current === 'A' ? 'B' : 'A', loopStart);
        }
      }

      rafId = requestAnimationFrame(() => {
        void monitor();
      });
    };

    // 初始化
    destroyed = false;
    switchingRef.current = false;
    activeVideoRef.current = 'A';
    setActiveVideo('A');

    videoA.src = currentSrc;
    videoB.src = currentSrc;

    try {
      videoA.pause();
      videoB.pause();
      videoA.currentTime = 0;
      videoB.currentTime = 0;
    } catch {
      // ignore
    }

    videoA.load();
    videoB.load();

    const onCanPlayA = () => {
      const d = videoA.duration;
      const { loopStart } = Number.isFinite(d) ? getLoopBounds(d) : { loopStart: 0 };
      videoA.currentTime = loopStart;
      void safePlay(videoA);
      if (Number.isFinite(d)) {
        void primeVideo(videoB, loopStart);
      }
    };

    const onEndedA = () => {
      if (activeVideoRef.current === 'A') {
        const d = videoA.duration;
        const { loopStart } = Number.isFinite(d) ? getLoopBounds(d) : { loopStart: 0 };
        videoA.currentTime = loopStart;
        void safePlay(videoA);
      }
    };

    const onEndedB = () => {
      if (activeVideoRef.current === 'B') {
        const d = videoB.duration;
        const { loopStart } = Number.isFinite(d) ? getLoopBounds(d) : { loopStart: 0 };
        videoB.currentTime = loopStart;
        void safePlay(videoB);
      }
    };

    videoA.addEventListener('canplay', onCanPlayA, { once: true });
    videoA.addEventListener('ended', onEndedA);
    videoB.addEventListener('ended', onEndedB);

    void monitor();

     return () => {
       destroyed = true;
       if (rafId) cancelAnimationFrame(rafId);
       if (resetTimeoutId) window.clearTimeout(resetTimeoutId);
       videoA.removeEventListener('ended', onEndedA);
       videoB.removeEventListener('ended', onEndedB);
     };
  }, []);

  useEffect(() => {
    const cleanup = setupSeamlessLoop(src);
    return cleanup;
  }, [src, setupSeamlessLoop]);

  // Adjust playback rate based on speaking state
  useEffect(() => {
    const rate = isSpeaking ? 1.15 : 1.0;
    if (videoARef.current) videoARef.current.playbackRate = rate;
    if (videoBRef.current) videoBRef.current.playbackRate = rate;
  }, [isSpeaking]);

  const handleVideoLoad = () => {
    setIsLoaded(true);
    onImageLoaded?.();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file);
      setCustomVideo(url);
      setIsLoaded(false);
      setAnalysisResult(null);
      setAnalysisApplied(false);
    }
  };

  const handleReset = () => {
    if (customVideo) {
      URL.revokeObjectURL(customVideo);
    }
    setCustomVideo(null);
    setIsLoaded(false);
    setConfig(DEFAULT_CONFIG);
    setAnalysisResult(null);
    setAnalysisApplied(false);
  };

  // 动态计算 crossfade transition
  const crossfadeTransition = `opacity ${config.crossfadeMs}ms linear, filter 0.3s ease`;

  // 获取置信度颜色
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 70) return 'text-green-500';
    if (confidence >= 40) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 rounded-xl overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleFileSelect}
        className="hidden"
      />
      
      {/* 双缓冲视频 - 交叉淡入淡出实现无缝循环 */}
      <video
        ref={videoARef}
        src={src}
        muted
        playsInline
        preload="auto"
        poster={posterImg}
        onLoadedData={handleVideoLoad}
        className="absolute inset-0 w-full h-full object-contain"
        style={{
          filter: isSpeaking ? 'brightness(1.05)' : 'brightness(1)',
          transition: crossfadeTransition,
          opacity: activeVideo === 'A' ? 1 : 0,
          pointerEvents: activeVideo === 'A' ? 'auto' : 'none',
        }}
      />
      <video
        ref={videoBRef}
        src={src}
        muted
        playsInline
        preload="auto"
        poster={posterImg}
        className="absolute inset-0 w-full h-full object-contain"
        style={{
          filter: isSpeaking ? 'brightness(1.05)' : 'brightness(1)',
          transition: crossfadeTransition,
          opacity: activeVideo === 'B' ? 1 : 0,
          pointerEvents: activeVideo === 'B' ? 'auto' : 'none',
        }}
      />

      {/* Loading spinner */}
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent"></div>
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-4 right-4 flex gap-2">
        {/* 调参面板 */}
        <Popover open={showSettings} onOpenChange={setShowSettings}>
          <PopoverTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              className="h-8 w-8 bg-background/80 backdrop-blur-sm hover:bg-background/90"
              title="循环调参"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" side="top" align="end">
            <div className="space-y-4">
              <h4 className="font-medium text-sm">无缝循环调参</h4>
              
              {/* 智能分析按钮 */}
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleAnalyze}
                  disabled={isAnalyzing}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      分析中...
                    </>
                  ) : (
                    <>
                      <Scan className="h-4 w-4 mr-2" />
                      智能分析首尾帧差异
                    </>
                  )}
                </Button>
                
                {isAnalyzing && (
                  <Progress value={analysisProgress} className="h-1" />
                )}
                
                {/* 分析结果 */}
                {analysisResult && !isAnalyzing && (
                  <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">推荐配置</span>
                      <span className={`text-xs ${getConfidenceColor(analysisResult.confidence)}`}>
                        置信度: {analysisResult.confidence.toFixed(0)}%
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">起点裁剪:</span>
                        <span className="ml-1 font-mono">{analysisResult.bestStartPercent}%</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">终点裁剪:</span>
                        <span className="ml-1 font-mono">{analysisResult.bestEndPercent}%</span>
                      </div>
                    </div>
                    <Button
                      variant={analysisApplied ? "secondary" : "default"}
                      size="sm"
                      className="w-full mt-2"
                      onClick={applyRecommendation}
                      disabled={analysisApplied}
                    >
                      {analysisApplied ? (
                        <>
                          <Check className="h-4 w-4 mr-2" />
                          已应用
                        </>
                      ) : (
                        '应用推荐配置'
                      )}
                    </Button>
                  </div>
                )}
              </div>
              
              {/* 循环起点 */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <Label>循环起点裁剪</Label>
                  <span className="text-muted-foreground">{config.loopStartPercent.toFixed(0)}%</span>
                </div>
                <Slider
                  value={[config.loopStartPercent]}
                  onValueChange={([v]) => {
                    setConfig(c => ({ ...c, loopStartPercent: v }));
                    setAnalysisApplied(false);
                  }}
                  min={0}
                  max={30}
                  step={1}
                  className="w-full"
                />
              </div>

              {/* 循环终点 */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <Label>循环终点裁剪</Label>
                  <span className="text-muted-foreground">{config.loopEndPercent.toFixed(0)}%</span>
                </div>
                <Slider
                  value={[config.loopEndPercent]}
                  onValueChange={([v]) => {
                    setConfig(c => ({ ...c, loopEndPercent: v }));
                    setAnalysisApplied(false);
                  }}
                  min={0}
                  max={30}
                  step={1}
                  className="w-full"
                />
              </div>

              {/* 交叉淡入淡出 */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <Label>交叉淡入淡出</Label>
                  <span className="text-muted-foreground">{config.crossfadeMs}ms</span>
                </div>
                <Slider
                  value={[config.crossfadeMs]}
                  onValueChange={([v]) => setConfig(c => ({ ...c, crossfadeMs: v }))}
                  min={50}
                  max={400}
                  step={10}
                  className="w-full"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                点击"智能分析"自动检测最佳循环点，或手动调整参数
              </p>
            </div>
          </PopoverContent>
        </Popover>

        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8 bg-background/80 backdrop-blur-sm hover:bg-background/90"
          onClick={() => fileInputRef.current?.click()}
          title="上传自定义视频"
        >
          <Upload className="h-4 w-4" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8 bg-background/80 backdrop-blur-sm hover:bg-background/90"
          onClick={handleReset}
          title="恢复默认"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default VideoAvatar;

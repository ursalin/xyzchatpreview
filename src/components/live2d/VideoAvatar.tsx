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
  loopStartPercent: number;
  loopEndPercent: number;
  crossfadeMs: number;
}

interface FrameAnalysis {
  position: number;
  diffScore: number;
}

interface AnalysisResult {
  bestStartPercent: number;
  bestEndPercent: number;
  startFrames: FrameAnalysis[];
  endFrames: FrameAnalysis[];
  confidence: number;
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
  const step = 4;
  let samples = 0;
  
  for (let i = 0; i < dataA.length; i += 4 * step) {
    const rDiff = Math.abs(dataA[i] - dataB[i]);
    const gDiff = Math.abs(dataA[i + 1] - dataB[i + 1]);
    const bDiff = Math.abs(dataA[i + 2] - dataB[i + 2]);
    totalDiff += (rDiff + gDiff + bDiff) / 3;
    samples++;
  }
  
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

// 两阶段分析：粗扫描 + 密集精确扫描
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
      
      const coarseSampleCount = 10;
      const startFrames: FrameAnalysis[] = [];
      const endFrames: FrameAnalysis[] = [];
      
      try {
        onProgress(2);
        const firstFrame = await captureFrame(video, canvas, ctx, 0.1);
        onProgress(4);
        const lastFrame = await captureFrame(video, canvas, ctx, duration - 0.1);
        
        for (let i = 0; i <= coarseSampleCount; i++) {
          const percent = (i / coarseSampleCount) * 30;
          const time = (percent / 100) * duration;
          const frame = await captureFrame(video, canvas, ctx, time);
          const diffWithLast = calculateFrameDiff(ctx, width, height, frame, lastFrame);
          startFrames.push({ position: percent, diffScore: diffWithLast });
          onProgress(4 + (i / coarseSampleCount) * 18);
        }
        
        for (let i = 0; i <= coarseSampleCount; i++) {
          const percent = 70 + (i / coarseSampleCount) * 30;
          const time = (percent / 100) * duration;
          const frame = await captureFrame(video, canvas, ctx, time);
          const diffWithFirst = calculateFrameDiff(ctx, width, height, frame, firstFrame);
          endFrames.push({ position: 100 - percent, diffScore: diffWithFirst });
          onProgress(22 + (i / coarseSampleCount) * 18);
        }
        
        const coarseBestStart = startFrames.reduce((best, curr) => 
          curr.diffScore < best.diffScore ? curr : best
        );
        const coarseBestEnd = endFrames.reduce((best, curr) => 
          curr.diffScore < best.diffScore ? curr : best
        );
        
        const fineStep = 0.05;
        const fineRange = 1.0;
        
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
        
        const fineEndFrames: FrameAnalysis[] = [];
        const actualEndPercent = 100 - coarseBestEnd.position;
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
        
        const fineBestStart = fineStartFrames.reduce((best, curr) => 
          curr.diffScore < best.diffScore ? curr : best
        );
        const fineBestEnd = fineEndFrames.reduce((best, curr) => 
          curr.diffScore < best.diffScore ? curr : best
        );
        
        const avgMinDiff = (fineBestStart.diffScore + fineBestEnd.diffScore) / 2;
        const confidence = Math.max(0, Math.min(100, 100 - avgMinDiff * 5));
        
        onProgress(100);
        
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const configRef = useRef<LoopConfig>(DEFAULT_CONFIG);
  const activeVideoRef = useRef<'A' | 'B'>('A');
  const crossfadeRef = useRef(0); // 0 = 全A, 1 = 全B

  const [customVideo, setCustomVideo] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [config, setConfig] = useState<LoopConfig>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisApplied, setAnalysisApplied] = useState(false);

  const src = customVideo || idleVideo;

  useEffect(() => {
    configRef.current = config;
  }, [config]);

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

  const applyRecommendation = useCallback(() => {
    if (!analysisResult) return;
    
    setConfig(c => ({
      ...c,
      loopStartPercent: analysisResult.bestStartPercent,
      loopEndPercent: analysisResult.bestEndPercent,
    }));
    setAnalysisApplied(true);
  }, [analysisResult]);

  // === Canvas 渲染循环 - 彻底避免 DOM opacity 闪烁 ===
  useEffect(() => {
    const canvas = canvasRef.current;
    const videoA = videoARef.current;
    const videoB = videoBRef.current;
    if (!canvas || !videoA || !videoB) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let destroyed = false;
    let rafId: number | null = null;
    let switching = false;

    const getLoopBounds = (duration: number) => {
      const cfg = configRef.current;
      const loopStart = (cfg.loopStartPercent / 100) * duration;
      const loopEnd = duration - (cfg.loopEndPercent / 100) * duration;
      return { loopStart, loopEnd: Math.max(loopEnd, loopStart + 0.5) };
    };

    const safePlay = async (v: HTMLVideoElement) => {
      try {
        await v.play();
      } catch {
        // ignore
      }
    };

    const seekAndPark = (v: HTMLVideoElement, time: number): Promise<void> => {
      return new Promise((resolve) => {
        const onSeeked = () => {
          v.removeEventListener('seeked', onSeeked);
          resolve();
        };
        v.addEventListener('seeked', onSeeked);
        try {
          v.pause();
          v.currentTime = time;
        } catch {
          resolve();
        }
      });
    };

    // 渲染单帧到 Canvas（可选混合两个视频）
    const renderFrame = () => {
      if (destroyed) return;

      const w = canvas.width;
      const h = canvas.height;
      const cf = crossfadeRef.current;

      ctx.clearRect(0, 0, w, h);

      // 如果正在 crossfade，绘制两个视频并混合
      if (cf > 0 && cf < 1) {
        // 先绘制 A (底层)
        ctx.globalAlpha = 1 - cf;
        try {
          ctx.drawImage(videoA, 0, 0, w, h);
        } catch {
          // ignore decode errors
        }
        // 再绘制 B (叠加)
        ctx.globalAlpha = cf;
        try {
          ctx.drawImage(videoB, 0, 0, w, h);
        } catch {
          // ignore
        }
        ctx.globalAlpha = 1;
      } else {
        // 单视频绘制
        const activeV = activeVideoRef.current === 'A' ? videoA : videoB;
        try {
          ctx.drawImage(activeV, 0, 0, w, h);
        } catch {
          // ignore
        }
      }
    };

    // 主循环：检测循环点、执行 crossfade、渲染 Canvas
    const loop = () => {
      if (destroyed) return;

      const currentVideo = activeVideoRef.current === 'A' ? videoA : videoB;
      const nextVideo = activeVideoRef.current === 'A' ? videoB : videoA;
      const d = currentVideo.duration;

      if (Number.isFinite(d) && d > 0) {
        const { loopStart, loopEnd } = getLoopBounds(d);
        const remaining = loopEnd - currentVideo.currentTime;
        const crossfadeS = configRef.current.crossfadeMs / 1000;

        // 开始 crossfade
        if (!switching && remaining <= crossfadeS && remaining > 0) {
          switching = true;

          // 确保 nextVideo 从 loopStart 开始播放
          (async () => {
            await seekAndPark(nextVideo, loopStart);
            await safePlay(nextVideo);

            const startTime = performance.now();
            const duration = configRef.current.crossfadeMs;

            const animateCrossfade = () => {
              if (destroyed) return;

              const elapsed = performance.now() - startTime;
              const progress = Math.min(1, elapsed / duration);

              crossfadeRef.current = activeVideoRef.current === 'A' ? progress : 1 - progress;

              if (progress < 1) {
                requestAnimationFrame(animateCrossfade);
              } else {
                // crossfade 完成
                crossfadeRef.current = 0;
                activeVideoRef.current = activeVideoRef.current === 'A' ? 'B' : 'A';
                
                // 停止并重置旧视频
                const oldVideo = activeVideoRef.current === 'A' ? videoB : videoA;
                oldVideo.pause();
                oldVideo.currentTime = loopStart;

                switching = false;
              }
            };

            requestAnimationFrame(animateCrossfade);
          })();
        }
      }

      renderFrame();
      rafId = requestAnimationFrame(loop);
    };

    // 初始化视频
    const initVideos = () => {
      videoA.src = src;
      videoB.src = src;
      videoA.load();
      videoB.load();
    };

    const onCanPlayA = async () => {
      // 设置 Canvas 尺寸
      canvas.width = videoA.videoWidth || 640;
      canvas.height = videoA.videoHeight || 480;

      const d = videoA.duration;
      const { loopStart } = Number.isFinite(d) ? getLoopBounds(d) : { loopStart: 0 };

      videoA.currentTime = loopStart;
      await safePlay(videoA);

      // 预加载 B
      if (Number.isFinite(d)) {
        await seekAndPark(videoB, loopStart);
      }

      setIsLoaded(true);
      onImageLoaded?.();

      // 开始渲染循环
      loop();
    };

    videoA.addEventListener('canplay', onCanPlayA, { once: true });
    initVideos();

    return () => {
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      videoA.pause();
      videoB.pause();
    };
  }, [src, onImageLoaded]);

  // 播放速率调整
  useEffect(() => {
    const rate = isSpeaking ? 1.15 : 1.0;
    if (videoARef.current) videoARef.current.playbackRate = rate;
    if (videoBRef.current) videoBRef.current.playbackRate = rate;
  }, [isSpeaking]);

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
      
      {/* 隐藏的双视频元素 - 仅用于解码 */}
      <video
        ref={videoARef}
        muted
        playsInline
        preload="auto"
        className="hidden"
      />
      <video
        ref={videoBRef}
        muted
        playsInline
        preload="auto"
        className="hidden"
      />

      {/* Canvas 渲染 - 无闪烁 */}
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain"
        style={{
          filter: isSpeaking ? 'brightness(1.05)' : 'brightness(1)',
          transition: 'filter 0.3s ease',
        }}
      />

      {/* Poster 图片 - 加载时显示 */}
      {!isLoaded && (
        <img
          src={posterImg}
          alt="Loading"
          className="absolute inset-0 w-full h-full object-contain"
        />
      )}

      {/* Loading spinner */}
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent"></div>
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-4 right-4 flex gap-2">
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
              
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <Label>循环起点裁剪</Label>
                  <span className="text-muted-foreground">{config.loopStartPercent.toFixed(2)}%</span>
                </div>
                <Slider
                  value={[config.loopStartPercent]}
                  onValueChange={([v]) => {
                    setConfig(c => ({ ...c, loopStartPercent: v }));
                    setAnalysisApplied(false);
                  }}
                  min={0}
                  max={30}
                  step={0.05}
                  className="w-full"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <Label>循环终点裁剪</Label>
                  <span className="text-muted-foreground">{config.loopEndPercent.toFixed(2)}%</span>
                </div>
                <Slider
                  value={[config.loopEndPercent]}
                  onValueChange={([v]) => {
                    setConfig(c => ({ ...c, loopEndPercent: v }));
                    setAnalysisApplied(false);
                  }}
                  min={0}
                  max={30}
                  step={0.05}
                  className="w-full"
                />
              </div>

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
                Canvas 渲染模式 - 像素级混合无闪烁
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

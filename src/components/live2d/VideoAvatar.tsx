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

// 分析视频首尾帧差异
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
      const width = Math.min(video.videoWidth, 320);  // 降低分辨率提高性能
      const height = Math.min(video.videoHeight, 180);
      canvas.width = width;
      canvas.height = height;
      
      // 采样点数量
      const sampleCount = 10;
      const startFrames: FrameAnalysis[] = [];
      const endFrames: FrameAnalysis[] = [];
      
      try {
        // 捕获第一帧（作为参考）
        onProgress(5);
        const firstFrame = await captureFrame(video, canvas, ctx, 0.1);
        
        // 捕获最后一帧（作为参考）
        onProgress(10);
        const lastFrame = await captureFrame(video, canvas, ctx, duration - 0.1);
        
        // 分析开头区域（0-30%）
        for (let i = 0; i <= sampleCount; i++) {
          const percent = (i / sampleCount) * 30;
          const time = (percent / 100) * duration;
          const frame = await captureFrame(video, canvas, ctx, time);
          const diffWithLast = calculateFrameDiff(ctx, width, height, frame, lastFrame);
          
          startFrames.push({
            position: percent,
            diffScore: diffWithLast
          });
          
          onProgress(10 + (i / sampleCount) * 40);
        }
        
        // 分析结尾区域（70-100%）
        for (let i = 0; i <= sampleCount; i++) {
          const percent = 70 + (i / sampleCount) * 30;
          const time = (percent / 100) * duration;
          const frame = await captureFrame(video, canvas, ctx, time);
          const diffWithFirst = calculateFrameDiff(ctx, width, height, frame, firstFrame);
          
          endFrames.push({
            position: 100 - percent,  // 转换为"从结尾裁剪"的百分比
            diffScore: diffWithFirst
          });
          
          onProgress(50 + (i / sampleCount) * 45);
        }
        
        // 找到最佳裁剪点（差异最小的位置）
        const bestStart = startFrames.reduce((best, curr) => 
          curr.diffScore < best.diffScore ? curr : best
        );
        
        const bestEnd = endFrames.reduce((best, curr) => 
          curr.diffScore < best.diffScore ? curr : best
        );
        
        // 计算置信度（基于最小差异值）
        const avgMinDiff = (bestStart.diffScore + bestEnd.diffScore) / 2;
        const confidence = Math.max(0, Math.min(100, 100 - avgMinDiff * 5));
        
        onProgress(100);
        
        resolve({
          bestStartPercent: Math.round(bestStart.position),
          bestEndPercent: Math.round(bestEnd.position),
          startFrames,
          endFrames,
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

    // 预热阈值
    const ARM_THRESHOLD_S = 0.8;
    const SWITCH_THRESHOLD_S = 0.32;
    const FRESH_FRAME_TIMEOUT_MS = 200;

    let rafId: number | null = null;
    let destroyed = false;

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

    const primeVideo = async (v: HTMLVideoElement, startTime: number) => {
      // 让“隐藏视频”提前跑起来，避免切换时黑帧/闪烁
      try {
        v.currentTime = startTime;
      } catch {
        // ignore
      }

      await safePlay(v);
      await waitNextFrame(v);
    };

    const resetHiddenToLoopStart = async (v: HTMLVideoElement, loopStart: number) => {
      // 隐藏态重置：pause -> seek -> play（不再 load，避免 poster/黑帧闪一下）
      try {
        v.pause();
      } catch {
        // ignore
      }

      try {
        v.currentTime = loopStart;
      } catch {
        // ignore
      }

      await safePlay(v);
    };

    const switchTo = async (nextKey: 'A' | 'B', loopStart: number) => {
      if (switchingRef.current || destroyed) return;

      const currentVideo = nextKey === 'A' ? videoB : videoA;
      const nextVideo = nextKey === 'A' ? videoA : videoB;

      switchingRef.current = true;
      try {
        // 确保 nextVideo 已经在播放并产生过至少一帧
        await safePlay(nextVideo);
        await waitFreshPresentedFrame(nextVideo, FRESH_FRAME_TIMEOUT_MS);

        activeVideoRef.current = nextKey;
        setActiveVideo(nextKey);

        // 等 UI 完成 opacity 切换后，再重置旧视频（避免同一帧内被操作导致闪烁）
        requestAnimationFrame(() => {
          void resetHiddenToLoopStart(currentVideo, loopStart);
        });

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

        // 提前预热下一段（让隐藏视频跑起来）
        if (!armedRef.current && remaining <= ARM_THRESHOLD_S && remaining > SWITCH_THRESHOLD_S) {
          armedRef.current = true;
          void primeVideo(inactive, loopStart);
        }

        // 临近结尾：切换到另一路（不再对“可见视频”做跳回 seek，避免闪一下）
        if (remaining <= SWITCH_THRESHOLD_S) {
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

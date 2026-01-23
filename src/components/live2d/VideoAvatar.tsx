import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Upload, RefreshCw, Settings2, Scan, Loader2, Check, Bug, Trash2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import idleVideo from '@/assets/character-idle.mp4';
import posterImg from '@/assets/character-front.jpg';

interface VideoAvatarProps {
  isSpeaking?: boolean;
  lipsyncVideoUrl?: string | null;
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

interface DiagnosticsState {
  activeVideo: 'A' | 'B';
  crossfade: number;
  videoA: {
    readyState: number;
    seeking: boolean;
    currentTime: number;
    paused: boolean;
  };
  videoB: {
    readyState: number;
    seeking: boolean;
    currentTime: number;
    paused: boolean;
  };
  loopStart: number;
  loopEnd: number;
  remaining: number;
}

interface DrawFailLog {
  time: number;
  video: 'A' | 'B';
  readyState: number;
  seeking: boolean;
  currentTime: number;
  reason: string;
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
  lipsyncVideoUrl = null,
  onImageLoaded 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const lipsyncVideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const configRef = useRef<LoopConfig>(DEFAULT_CONFIG);
  const activeVideoRef = useRef<'A' | 'B'>('A');
  const crossfadeRef = useRef(0); // 0 = 全A, 1 = 全B

  const [customVideo, setCustomVideo] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<LoopConfig>(DEFAULT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);
  const [isPlayingLipsync, setIsPlayingLipsync] = useState(false);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisApplied, setAnalysisApplied] = useState(false);
  
  // 诊断面板状态
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsState | null>(null);
  const [drawFailLogs, setDrawFailLogs] = useState<DrawFailLog[]>([]);
  const diagnosticsRef = useRef({ enabled: false });
  const drawFailLogsRef = useRef<DrawFailLog[]>([]);
  
  // 自动播放被阻止时需要用户交互
  const [needsUserInteraction, setNeedsUserInteraction] = useState(false);
  const pendingPlayRef = useRef<(() => Promise<void>) | null>(null);

  // 同步诊断面板开关
  useEffect(() => {
    diagnosticsRef.current.enabled = showDiagnostics;
    if (showDiagnostics) {
      setDrawFailLogs([...drawFailLogsRef.current]);
    }
  }, [showDiagnostics]);

  // 当有新的唇形动画视频时自动播放
  useEffect(() => {
    if (lipsyncVideoUrl && lipsyncVideoRef.current) {
      console.log('Playing lipsync video:', lipsyncVideoUrl);
      lipsyncVideoRef.current.src = lipsyncVideoUrl;
      lipsyncVideoRef.current.load();
      lipsyncVideoRef.current.play().then(() => {
        setIsPlayingLipsync(true);
      }).catch(err => {
        console.error('Failed to play lipsync video:', err);
      });
    }
  }, [lipsyncVideoUrl]);

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

  const clearDrawFailLogs = useCallback(() => {
    drawFailLogsRef.current = [];
    setDrawFailLogs([]);
  }, []);

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
    let hasDrawnOnce = false;

    const waitForEvent = (el: EventTarget, event: string, timeoutMs = 2000) => {
      return new Promise<void>((resolve) => {
        let done = false;
        const onDone = () => {
          if (done) return;
          done = true;
          el.removeEventListener(event, onDone as EventListener);
          resolve();
        };
        el.addEventListener(event, onDone as EventListener, { once: true });
        window.setTimeout(onDone, timeoutMs);
      });
    };

    const waitForFrame = (v: HTMLVideoElement) => {
      const anyV = v as unknown as {
        requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
      };

      if (typeof anyV.requestVideoFrameCallback === 'function') {
        return new Promise<void>((resolve) => {
          anyV.requestVideoFrameCallback?.(() => resolve());
        });
      }

      // rVFC 不可用时的保底：给解码器一点时间
      return new Promise<void>((resolve) => window.setTimeout(resolve, 34));
    };

    const waitUntilDrawable = async (v: HTMLVideoElement) => {
      if (v.readyState < 2) {
        await waitForEvent(v, 'loadeddata', 2500);
      }
      if (v.seeking) {
        await waitForEvent(v, 'seeked', 2500);
      }
    };

    const getLoopBounds = (duration: number) => {
      const cfg = configRef.current;
      const loopStart = (cfg.loopStartPercent / 100) * duration;
      const loopEnd = duration - (cfg.loopEndPercent / 100) * duration;
      return { loopStart, loopEnd: Math.max(loopEnd, loopStart + 0.5) };
    };

    const safePlay = async (v: HTMLVideoElement): Promise<boolean> => {
      try {
        await v.play();
        return true;
      } catch (e) {
        // 检测是否是自动播放被阻止
        if (e instanceof Error && e.name === 'NotAllowedError') {
          console.warn('Autoplay blocked, waiting for user interaction');
          return false;
        }
        return true; // 其他错误忽略
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
          v.removeEventListener('seeked', onSeeked);
          resolve();
        }
      });
    };

    const logDrawFail = (video: 'A' | 'B', v: HTMLVideoElement, reason: string) => {
      if (!diagnosticsRef.current.enabled) return;
      const log: DrawFailLog = {
        time: performance.now(),
        video,
        readyState: v.readyState,
        seeking: v.seeking,
        currentTime: v.currentTime,
        reason
      };
      drawFailLogsRef.current = [...drawFailLogsRef.current.slice(-49), log];
      setDrawFailLogs([...drawFailLogsRef.current]);
    };

    const drawVideo = (v: HTMLVideoElement, videoLabel: 'A' | 'B') => {
      // 关键：不要 clearRect。否则 drawImage 失败/解码空窗时会直接"黑一下"。
      if (v.readyState < 2) {
        logDrawFail(videoLabel, v, `readyState=${v.readyState} < 2`);
        return false;
      }
      if (v.seeking) {
        logDrawFail(videoLabel, v, 'seeking=true');
        return false;
      }
      try {
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        hasDrawnOnce = true;
        return true;
      } catch (e) {
        logDrawFail(videoLabel, v, `drawImage error: ${e}`);
        return false;
      }
    };

    const updateDiagnostics = () => {
      if (!diagnosticsRef.current.enabled) return;
      const d = videoA.duration;
      const { loopStart, loopEnd } = Number.isFinite(d) && d > 0 ? getLoopBounds(d) : { loopStart: 0, loopEnd: 0 };
      const currentVideo = activeVideoRef.current === 'A' ? videoA : videoB;
      setDiagnostics({
        activeVideo: activeVideoRef.current,
        crossfade: crossfadeRef.current,
        videoA: {
          readyState: videoA.readyState,
          seeking: videoA.seeking,
          currentTime: videoA.currentTime,
          paused: videoA.paused
        },
        videoB: {
          readyState: videoB.readyState,
          seeking: videoB.seeking,
          currentTime: videoB.currentTime,
          paused: videoB.paused
        },
        loopStart,
        loopEnd,
        remaining: loopEnd - currentVideo.currentTime
      });
    };

    // 渲染单帧到 Canvas（可选混合两个视频）
    const renderFrame = () => {
      if (destroyed) return;

      const cf = crossfadeRef.current;

      if (cf > 0 && cf < 1) {
        // A/B 混合：只绘制"可画"的那一方；两者都不可画则保留上一帧
        const canA = videoA.readyState >= 2 && !videoA.seeking;
        const canB = videoB.readyState >= 2 && !videoB.seeking;

        if (!canA && !canB) {
          logDrawFail('A', videoA, 'crossfade: both videos not drawable');
          return;
        }

        if (canA && canB) {
          ctx.globalAlpha = 1 - cf;
          drawVideo(videoA, 'A');
          ctx.globalAlpha = cf;
          drawVideo(videoB, 'B');
          ctx.globalAlpha = 1;
          return;
        }

        // 只剩一边可画时直接全量绘制，避免 alpha 清空导致闪
        ctx.globalAlpha = 1;
        if (canA) drawVideo(videoA, 'A');
        else if (canB) drawVideo(videoB, 'B');
        return;
      }

      const activeV = activeVideoRef.current === 'A' ? videoA : videoB;
      const activeLabel = activeVideoRef.current;
      const ok = drawVideo(activeV, activeLabel);
      if (!ok && !hasDrawnOnce) {
        // 首帧还没拿到：让 poster 继续盖住
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

          (async () => {
            // 1) 先把 nextVideo seek 到 loopStart
            await seekAndPark(nextVideo, loopStart);
            await waitUntilDrawable(nextVideo);

            // 2) 播放并等待至少一帧解码到位，再启动 crossfade（否则第一帧可能是黑/旧帧）
            await safePlay(nextVideo);
            await waitForFrame(nextVideo);

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

                // 停止并预置旧视频到 loopStart（异步，不阻塞渲染）
                const oldVideo = activeVideoRef.current === 'A' ? videoB : videoA;
                oldVideo.pause();
                void seekAndPark(oldVideo, loopStart);

                switching = false;
              }
            };

            requestAnimationFrame(animateCrossfade);
          })();
        }
      }

      renderFrame();
      updateDiagnostics();
      rafId = requestAnimationFrame(loop);
    };

    // 初始化视频
    const initVideos = () => {
      setLoadError(null);
      videoA.src = src;
      videoB.src = src;
      videoA.load();
      videoB.load();
    };

    // 使用标记确保只初始化一次
    let initialized = false;
    
    // 完成初始化并启动循环的函数（可能在用户点击后调用）
    const completeInit = async () => {
      const d = videoA.duration;
      const { loopStart } = Number.isFinite(d) ? getLoopBounds(d) : { loopStart: 0 };

      await seekAndPark(videoA, loopStart);
      const playSuccess = await safePlay(videoA);
      
      if (!playSuccess) {
        // 自动播放被阻止，需要用户交互
        pendingPlayRef.current = async () => {
          setNeedsUserInteraction(false);
          await videoA.play();
          await waitForFrame(videoA);
          renderFrame();
          loop();
        };
        setNeedsUserInteraction(true);
        // 仍然先画一帧静态图
        renderFrame();
        setIsLoaded(true);
        onImageLoaded?.();
        return;
      }
      
      await waitForFrame(videoA);

      // 预置 B 到 loopStart（保持暂停即可）
      if (Number.isFinite(d)) {
        await seekAndPark(videoB, loopStart);
      }

      // 先画一帧再切走 poster
      renderFrame();
      setIsLoaded(true);
      onImageLoaded?.();

      loop();
    };
    
    const onCanPlayA = async () => {
      // 关键：防止 canplay 和 loadeddata 双重触发
      if (initialized || destroyed) return;
      initialized = true;
      
      // 移除所有监听器，防止重复调用
      videoA.removeEventListener('canplay', onCanPlayA);
      videoA.removeEventListener('loadeddata', onCanPlayA);
      
      // 设置 Canvas 尺寸
      canvas.width = videoA.videoWidth || 640;
      canvas.height = videoA.videoHeight || 480;

      await completeInit();
    };

    const onVideoError = () => {
      // 关键：不要一直转圈，让用户看到明确的失败状态
      if (!initialized) {
        setLoadError('视频素材加载失败');
      }
    };

    // 有些浏览器/场景下 canplay 事件可能不稳定，增加 loadeddata 作为兜底
    videoA.addEventListener('canplay', onCanPlayA);
    videoA.addEventListener('loadeddata', onCanPlayA);
    videoA.addEventListener('error', onVideoError);
    initVideos();

    return () => {
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      videoA.pause();
      videoB.pause();

      videoA.removeEventListener('canplay', onCanPlayA);
      videoA.removeEventListener('loadeddata', onCanPlayA);
      videoA.removeEventListener('error', onVideoError);
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
      setLoadError(null);
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
    setLoadError(null);
    setConfig(DEFAULT_CONFIG);
    setAnalysisResult(null);
    setAnalysisApplied(false);
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 70) return 'text-green-500';
    if (confidence >= 40) return 'text-yellow-500';
    return 'text-red-500';
  };

  const formatTime = (ms: number) => {
    const s = (ms / 1000).toFixed(2);
    return `${s}s`;
  };

  // 用户点击启动动画
  const handleStartAnimation = useCallback(async () => {
    if (pendingPlayRef.current) {
      try {
        await pendingPlayRef.current();
        pendingPlayRef.current = null;
      } catch (e) {
        console.error('Failed to start animation:', e);
      }
    }
  }, []);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 rounded-xl overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleFileSelect}
        className="hidden"
      />
      
      {/*
        双视频元素用于解码与读取帧。
        注意：不能用 `display:none`（Tailwind 的 hidden），部分浏览器（尤其 iOS Safari）会停止加载/解码，导致 Canvas 永远不“动”。
        这里用“视觉隐藏但仍在布局树中”的方式。
      */}
      <video
        ref={videoARef}
        muted
        playsInline
        preload="auto"
        className="absolute w-px h-px opacity-0 pointer-events-none -z-10"
        aria-hidden="true"
      />
      <video
        ref={videoBRef}
        muted
        playsInline
        preload="auto"
        className="absolute w-px h-px opacity-0 pointer-events-none -z-10"
        aria-hidden="true"
      />
      
      {/* 唇形动画视频 - OmniHuman 生成 */}
      <video
        ref={lipsyncVideoRef}
        muted
        playsInline
        onEnded={() => setIsPlayingLipsync(false)}
        onError={() => setIsPlayingLipsync(false)}
        className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${
          isPlayingLipsync ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Canvas 渲染 - 无闪烁 (当唇形动画播放时隐藏) */}
      <canvas
        ref={canvasRef}
        className={`w-full h-full object-contain transition-opacity duration-300 ${
          isPlayingLipsync ? 'opacity-0' : 'opacity-100'
        }`}
        style={{
          filter: isSpeaking ? 'brightness(1.05)' : 'brightness(1)',
          transition: 'filter 0.3s ease',
        }}
      />

      {/* Poster 图片 - 加载时显示 */}
      {!isLoaded && !isPlayingLipsync && (
        <img
          src={posterImg}
          alt="Loading"
          className="absolute inset-0 w-full h-full object-contain"
        />
      )}

      {/* Loading spinner */}
      {!isLoaded && !loadError && !isPlayingLipsync && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent"></div>
        </div>
      )}

      {/* Load error (stop infinite spinner) */}
      {!isLoaded && loadError && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <div className="rounded-lg border border-border bg-background/80 px-4 py-3 text-sm text-foreground shadow-sm">
            {loadError}
          </div>
        </div>
      )}

      {/* 点击启动动画覆盖层 - 当浏览器阻止自动播放时显示 */}
      {needsUserInteraction && (
        <div 
          className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm cursor-pointer z-20 transition-opacity"
          onClick={handleStartAnimation}
        >
          <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-background/90 border border-border shadow-lg">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Play className="w-8 h-8 text-primary fill-primary" />
            </div>
            <span className="text-sm font-medium text-foreground">点击启动动画</span>
            <span className="text-xs text-muted-foreground">浏览器需要用户交互才能播放</span>
          </div>
        </div>
      )}

      {/* 诊断面板 */}
      {showDiagnostics && diagnostics && (
        <div className="absolute top-2 left-2 right-2 bg-black/80 text-white text-xs font-mono p-3 rounded-lg space-y-2 max-h-[60%] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between">
            <span className="text-green-400 font-bold">🔧 闪动诊断面板</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-2 text-xs text-red-400 hover:text-red-300"
              onClick={clearDrawFailLogs}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              清空日志
            </Button>
          </div>
          
          {/* 实时状态 */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div>
              <span className="text-gray-400">活动视频:</span>
              <span className={`ml-1 font-bold ${diagnostics.activeVideo === 'A' ? 'text-blue-400' : 'text-orange-400'}`}>
                {diagnostics.activeVideo}
              </span>
            </div>
            <div>
              <span className="text-gray-400">Crossfade:</span>
              <span className={`ml-1 ${diagnostics.crossfade > 0 ? 'text-yellow-400' : 'text-gray-500'}`}>
                {(diagnostics.crossfade * 100).toFixed(1)}%
              </span>
            </div>
            <div>
              <span className="text-gray-400">loopStart:</span>
              <span className="ml-1">{diagnostics.loopStart.toFixed(3)}s</span>
            </div>
            <div>
              <span className="text-gray-400">loopEnd:</span>
              <span className="ml-1">{diagnostics.loopEnd.toFixed(3)}s</span>
            </div>
            <div className="col-span-2">
              <span className="text-gray-400">剩余时间:</span>
              <span className={`ml-1 ${diagnostics.remaining < 0.2 ? 'text-red-400 font-bold' : ''}`}>
                {diagnostics.remaining.toFixed(3)}s
              </span>
            </div>
          </div>

          {/* A/B 视频状态 */}
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-700">
            <div className="space-y-0.5">
              <div className="text-blue-400 font-bold">Video A</div>
              <div>readyState: <span className={diagnostics.videoA.readyState >= 2 ? 'text-green-400' : 'text-red-400'}>{diagnostics.videoA.readyState}</span></div>
              <div>seeking: <span className={diagnostics.videoA.seeking ? 'text-red-400' : 'text-green-400'}>{String(diagnostics.videoA.seeking)}</span></div>
              <div>currentTime: {diagnostics.videoA.currentTime.toFixed(3)}s</div>
              <div>paused: <span className={diagnostics.videoA.paused ? 'text-yellow-400' : 'text-green-400'}>{String(diagnostics.videoA.paused)}</span></div>
            </div>
            <div className="space-y-0.5">
              <div className="text-orange-400 font-bold">Video B</div>
              <div>readyState: <span className={diagnostics.videoB.readyState >= 2 ? 'text-green-400' : 'text-red-400'}>{diagnostics.videoB.readyState}</span></div>
              <div>seeking: <span className={diagnostics.videoB.seeking ? 'text-red-400' : 'text-green-400'}>{String(diagnostics.videoB.seeking)}</span></div>
              <div>currentTime: {diagnostics.videoB.currentTime.toFixed(3)}s</div>
              <div>paused: <span className={diagnostics.videoB.paused ? 'text-yellow-400' : 'text-green-400'}>{String(diagnostics.videoB.paused)}</span></div>
            </div>
          </div>

          {/* Draw 失败日志 */}
          {drawFailLogs.length > 0 && (
            <div className="pt-1 border-t border-gray-700 flex-1 min-h-0">
              <div className="text-red-400 font-bold mb-1">⚠️ Draw 失败日志 ({drawFailLogs.length})</div>
              <ScrollArea className="h-24">
                <div className="space-y-0.5">
                  {drawFailLogs.slice(-10).reverse().map((log, i) => (
                    <div key={i} className="text-[10px] text-red-300">
                      [{formatTime(log.time)}] <span className={log.video === 'A' ? 'text-blue-300' : 'text-orange-300'}>{log.video}</span>: {log.reason}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-4 right-4 flex gap-2">
        {/* 诊断按钮 */}
        <Button
          variant={showDiagnostics ? "default" : "secondary"}
          size="icon"
          className={`h-8 w-8 ${showDiagnostics ? 'bg-red-500 hover:bg-red-600' : 'bg-background/80 backdrop-blur-sm hover:bg-background/90'}`}
          onClick={() => setShowDiagnostics(!showDiagnostics)}
          title="闪动诊断面板"
        >
          <Bug className="h-4 w-4" />
        </Button>

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

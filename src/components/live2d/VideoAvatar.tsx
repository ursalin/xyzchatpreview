import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Upload, RefreshCw, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
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

const DEFAULT_CONFIG: LoopConfig = {
  loopStartPercent: 0,
  loopEndPercent: 0,
  crossfadeMs: 120,
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

  const src = customVideo || idleVideo;

  // 同步 config 到 ref，供 rAF 回调使用
  useEffect(() => {
    configRef.current = config;
  }, [config]);

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
      try {
        v.pause();
        v.currentTime = startTime;
      } catch {
        // ignore
      }

      v.load();
      await safePlay(v);
      await waitNextFrame(v);
      v.pause();
    };

    const switchTo = async (nextKey: 'A' | 'B', loopStart: number) => {
      if (switchingRef.current || destroyed) return;

      const currentVideo = nextKey === 'A' ? videoB : videoA;
      const nextVideo = nextKey === 'A' ? videoA : videoB;

      switchingRef.current = true;
      try {
        await safePlay(nextVideo);
        await waitFreshPresentedFrame(nextVideo, FRESH_FRAME_TIMEOUT_MS);

        activeVideoRef.current = nextKey;
        setActiveVideo(nextKey);

        currentVideo.pause();
        try {
          currentVideo.currentTime = loopStart;
        } catch {
          // ignore
        }
        currentVideo.load();

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

        // 提前预热下一段
        if (!armedRef.current && remaining <= ARM_THRESHOLD_S && remaining > SWITCH_THRESHOLD_S) {
          armedRef.current = true;
          void primeVideo(inactive, loopStart);
        }

        // 临近结尾：瞬时切换
        if (remaining <= SWITCH_THRESHOLD_S && remaining > 0) {
          void switchTo(activeVideoRef.current === 'A' ? 'B' : 'A', loopStart);
        }

        // 如果超过 loopEnd（极端情况），立即跳回
        if (current.currentTime >= loopEnd) {
          current.currentTime = loopStart;
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
    }
  };

  const handleReset = () => {
    if (customVideo) {
      URL.revokeObjectURL(customVideo);
    }
    setCustomVideo(null);
    setIsLoaded(false);
    setConfig(DEFAULT_CONFIG);
  };

  // 动态计算 crossfade transition
  const crossfadeTransition = `opacity ${config.crossfadeMs}ms linear, filter 0.3s ease`;

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
          <PopoverContent className="w-72" side="top" align="end">
            <div className="space-y-4">
              <h4 className="font-medium text-sm">无缝循环调参</h4>
              
              {/* 循环起点 */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <Label>循环起点裁剪</Label>
                  <span className="text-muted-foreground">{config.loopStartPercent.toFixed(0)}%</span>
                </div>
                <Slider
                  value={[config.loopStartPercent]}
                  onValueChange={([v]) => setConfig(c => ({ ...c, loopStartPercent: v }))}
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
                  onValueChange={([v]) => setConfig(c => ({ ...c, loopEndPercent: v }))}
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
                裁剪掉首尾不连贯帧，配合淡入淡出实现平滑过渡
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

import { useRef, useCallback, useState } from 'react';

// 将 PCM16 base64 转换为 WAV data URL
export function pcm16ToWavDataUrl(pcmBase64: string, sampleRate = 24000): string {
  const binaryString = atob(pcmBase64);
  const pcmData = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    pcmData[i] = binaryString.charCodeAt(i);
  }

  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length;

  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const wavArray = new Uint8Array(44 + dataSize);
  wavArray.set(new Uint8Array(wavHeader), 0);
  wavArray.set(pcmData, 44);

  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < wavArray.length; i += chunkSize) {
    const chunk = wavArray.subarray(i, Math.min(i + chunkSize, wavArray.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

// 检测音频格式并返回正确的 data URL
function getAudioDataUrl(audioBase64: string): string {
  if (audioBase64.startsWith('SUQ') || audioBase64.startsWith('//')) {
    return `data:audio/mpeg;base64,${audioBase64}`;
  } else if (audioBase64.startsWith('UklG')) {
    return `data:audio/wav;base64,${audioBase64}`;
  } else {
    console.log('Detected PCM16 audio, converting to WAV...');
    return pcm16ToWavDataUrl(audioBase64);
  }
}

// 获取音频时长（毫秒）
export function getAudioDuration(audioBase64: string): Promise<number> {
  return new Promise((resolve) => {
    const audioUrl = getAudioDataUrl(audioBase64);
    const audio = new Audio();
    
    audio.onloadedmetadata = () => {
      resolve(audio.duration * 1000);
    };
    
    audio.onerror = () => {
      resolve(3000);
    };
    
    setTimeout(() => resolve(3000), 2000);
    audio.src = audioUrl;
  });
}

export function usePresetAnimations() {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 纯音频播放（不再同步视频动画）
  const playSynced = useCallback(async (
    audioBase64: string,
    onStart?: () => void,
    onEnd?: () => void
  ): Promise<void> => {
    const audioUrl = getAudioDataUrl(audioBase64);
    const audio = new Audio();
    audio.preload = 'auto';
    (audio as any).playsInline = true;
    (audio as any).webkitPlaysInline = true;
    audio.src = audioUrl;
    audioRef.current = audio;

    return new Promise((resolve) => {
      audio.oncanplaythrough = () => {
        setIsPlaying(true);
        onStart?.();
        audio.play().catch(() => {});
      };

      audio.onended = () => {
        setIsPlaying(false);
        onEnd?.();
        resolve();
      };

      audio.onerror = () => {
        setIsPlaying(false);
        onEnd?.();
        resolve();
      };

      // 超时保护
      setTimeout(() => {
        if (!audio.ended && audio.paused) {
          setIsPlaying(false);
          onEnd?.();
          resolve();
        }
      }, 30000);

      audio.load();
    });
  }, []);

  // 停止播放
  const stopPlaying = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  return {
    animations: [],
    isPlaying,
    currentAnimationId: null,
    addAnimation: async () => ({} as any),
    removeAnimation: () => {},
    getRandomAnimation: () => null,
    getBestAnimation: () => null,
    playSynced,
    stopPlaying,
    hasAnimations: false,
  };
}

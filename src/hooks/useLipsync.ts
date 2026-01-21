import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface LipsyncResult {
  videoUrl: string;
}

export interface UseLipsyncOptions {
  resolution?: '540p' | '720p' | '1080p';
  turboMode?: boolean;
}

export function useLipsync(options: UseLipsyncOptions = {}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');

  const generateLipsyncVideo = useCallback(async (
    imageUrl: string,
    audioBase64: string
  ): Promise<LipsyncResult | null> => {
    setIsGenerating(true);
    setError(null);
    setProgress('提交任务中...');

    try {
      console.log('Generating lipsync video...');
      console.log('Image URL:', imageUrl);
      console.log('Audio base64 length:', audioBase64.length);

      const { data, error: fnError } = await supabase.functions.invoke('omnihuman-lipsync', {
        body: {
          imageUrl,
          audioBase64,
          resolution: options.resolution || '720p',
          turboMode: options.turboMode !== false,
        },
      });

      if (fnError) {
        throw new Error(fnError.message || 'Failed to call lipsync function');
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      if (!data?.videoUrl) {
        throw new Error('No video URL in response');
      }

      setProgress('视频生成完成！');
      console.log('Lipsync video generated:', data.videoUrl);

      return { videoUrl: data.videoUrl };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Lipsync generation error:', message);
      setError(message);
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, [options.resolution, options.turboMode]);

  return {
    generateLipsyncVideo,
    isGenerating,
    error,
    progress,
  };
}

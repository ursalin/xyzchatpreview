import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MuseTalkRequest {
  imageUrl: string;      // 角色静态图片 URL
  audioBase64: string;   // base64 编码的音频
  audioUrl?: string;     // 或者直接传音频 URL
}

// 将 base64 音频上传到临时存储并获取 URL
async function uploadAudioToFal(audioBase64: string, apiKey: string): Promise<string> {
  console.log('Uploading audio to fal.ai storage...');
  
  // 解码 base64 音频
  const binaryString = atob(audioBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  // 创建 WAV 格式的音频（如果不是的话）
  // MuseTalk 支持 wav, mp3 等格式
  const audioBlob = new Blob([bytes], { type: 'audio/wav' });
  
  // 使用 fal.ai 的文件上传 API
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.wav');
  
  const uploadResponse = await fetch('https://fal.run/fal-ai/any/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
    },
    body: formData,
  });
  
  if (!uploadResponse.ok) {
    // 如果上传失败，尝试使用 data URL
    console.log('Direct upload failed, using data URL approach');
    return `data:audio/wav;base64,${audioBase64}`;
  }
  
  const uploadResult = await uploadResponse.json();
  console.log('Audio uploaded:', uploadResult.url);
  return uploadResult.url;
}

async function generateLipsyncVideo(
  imageUrl: string,
  audioUrl: string,
  apiKey: string
): Promise<{ videoUrl: string }> {
  console.log('Starting MuseTalk lipsync generation...');
  console.log('Image URL:', imageUrl);
  console.log('Audio URL:', audioUrl.substring(0, 100) + '...');

  // 调用 MuseTalk API
  const response = await fetch('https://fal.run/fal-ai/musetalk', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source_video_url: imageUrl, // MuseTalk 也接受静态图片
      audio_url: audioUrl,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('MuseTalk API error:', response.status, errorText);
    
    // 如果同步调用失败，尝试异步队列
    return await generateLipsyncVideoAsync(imageUrl, audioUrl, apiKey);
  }

  const result = await response.json();
  console.log('MuseTalk result:', JSON.stringify(result));

  if (result.video?.url) {
    return { videoUrl: result.video.url };
  }
  
  if (result.output?.url) {
    return { videoUrl: result.output.url };
  }

  throw new Error('No video URL in response: ' + JSON.stringify(result));
}

async function generateLipsyncVideoAsync(
  imageUrl: string,
  audioUrl: string,
  apiKey: string
): Promise<{ videoUrl: string }> {
  console.log('Using async queue for MuseTalk...');

  // 提交到队列
  const submitResponse = await fetch('https://queue.fal.run/fal-ai/musetalk', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source_video_url: imageUrl,
      audio_url: audioUrl,
    }),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    throw new Error(`Queue submit failed: ${submitResponse.status} - ${errorText}`);
  }

  const submitResult = await submitResponse.json();
  const requestId = submitResult.request_id;
  console.log('Queued request ID:', requestId);

  // 轮询等待结果（最多等待 120 秒）
  const maxWaitTime = 120000;
  const pollInterval = 2000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    const statusResponse = await fetch(
      `https://queue.fal.run/fal-ai/musetalk/requests/${requestId}/status`,
      {
        headers: {
          'Authorization': `Key ${apiKey}`,
        },
      }
    );

    if (!statusResponse.ok) {
      console.error('Status check failed:', statusResponse.status);
      continue;
    }

    const statusResult = await statusResponse.json();
    console.log('Queue status:', statusResult.status);

    if (statusResult.status === 'COMPLETED') {
      // 获取结果
      const resultResponse = await fetch(
        `https://queue.fal.run/fal-ai/musetalk/requests/${requestId}`,
        {
          headers: {
            'Authorization': `Key ${apiKey}`,
          },
        }
      );

      const finalResult = await resultResponse.json();
      console.log('Final result:', JSON.stringify(finalResult));

      if (finalResult.video?.url) {
        return { videoUrl: finalResult.video.url };
      }
      if (finalResult.output?.url) {
        return { videoUrl: finalResult.output.url };
      }
      
      throw new Error('No video URL in final result');
    }

    if (statusResult.status === 'FAILED') {
      throw new Error('MuseTalk generation failed: ' + JSON.stringify(statusResult));
    }
  }

  throw new Error('MuseTalk generation timeout after 120 seconds');
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('FAL_KEY');
    if (!apiKey) {
      throw new Error('FAL_KEY not configured');
    }

    const body: MuseTalkRequest = await req.json();
    console.log('Received request:', {
      hasImageUrl: !!body.imageUrl,
      hasAudioBase64: !!body.audioBase64,
      hasAudioUrl: !!body.audioUrl,
    });

    if (!body.imageUrl) {
      throw new Error('imageUrl is required');
    }

    if (!body.audioBase64 && !body.audioUrl) {
      throw new Error('audioBase64 or audioUrl is required');
    }

    // 获取音频 URL
    let audioUrl = body.audioUrl;
    if (!audioUrl && body.audioBase64) {
      audioUrl = await uploadAudioToFal(body.audioBase64, apiKey);
    }

    // 生成口型同步视频
    const result = await generateLipsyncVideo(body.imageUrl, audioUrl!, apiKey);

    return new Response(
      JSON.stringify({
        success: true,
        videoUrl: result.videoUrl,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: unknown) {
    console.error('MuseTalk error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

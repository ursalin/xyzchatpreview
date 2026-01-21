import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OmniHumanRequest {
  imageUrl: string;      // URL of the character image
  audioBase64: string;   // Base64 encoded audio (MP3)
  resolution?: "540p" | "720p" | "1080p";
  turboMode?: boolean;
}

// Upload image from URL to fal storage (for local images that fal can't access)
async function uploadImageFromUrl(imageUrl: string, apiKey: string): Promise<string> {
  // If it's already a fal.media URL or a public URL, return as is
  if (imageUrl.includes('fal.media') || imageUrl.includes('storage.googleapis.com')) {
    return imageUrl;
  }
  
  console.log("Uploading image to fal storage from URL...");
  
  // Use fal's URL upload endpoint
  const response = await fetch("https://fal.run/fal-ai/any-llm", {
    method: "POST",
    headers: {
      "Authorization": `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // This is a workaround - we'll use a different approach
      prompt: "test"
    }),
  });
  
  // For now, let's try using data URL directly
  // fal.ai models can accept data URLs
  return imageUrl;
}

// Submit job to OmniHuman using synchronous endpoint with data URL
async function generateLipsyncVideo(
  imageUrl: string,
  audioBase64: string,
  apiKey: string,
  resolution: string = "720p",
  turboMode: boolean = true
): Promise<{ videoUrl: string }> {
  console.log("Submitting OmniHuman job...");
  console.log("Image URL:", imageUrl.substring(0, 100) + "...");
  console.log("Resolution:", resolution, "Turbo:", turboMode);
  
  // Create audio data URL
  const audioDataUrl = `data:audio/mpeg;base64,${audioBase64}`;
  
  // Submit the job using synchronous endpoint (fal.run)
  const submitResponse = await fetch("https://fal.run/fal-ai/bytedance/omnihuman/v1.5", {
    method: "POST",
    headers: {
      "Authorization": `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_url: imageUrl,
      audio_url: audioDataUrl,
      resolution: resolution,
      turbo_mode: turboMode,
    }),
  });
  
  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    console.error("OmniHuman sync request failed:", submitResponse.status, errorText);
    
    // Try with queue endpoint if sync fails
    console.log("Trying queue endpoint...");
    return await generateLipsyncVideoAsync(imageUrl, audioDataUrl, apiKey, resolution, turboMode);
  }
  
  const result = await submitResponse.json();
  console.log("OmniHuman sync result:", JSON.stringify(result).substring(0, 500));
  
  if (result.video?.url) {
    return { videoUrl: result.video.url };
  }
  
  throw new Error("No video URL in result: " + JSON.stringify(result));
}

// Async version using queue endpoint
async function generateLipsyncVideoAsync(
  imageUrl: string,
  audioDataUrl: string,
  apiKey: string,
  resolution: string = "720p",
  turboMode: boolean = true
): Promise<{ videoUrl: string }> {
  console.log("Submitting OmniHuman async job...");
  
  // Submit the job
  const submitResponse = await fetch("https://queue.fal.run/fal-ai/bytedance/omnihuman/v1.5", {
    method: "POST",
    headers: {
      "Authorization": `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_url: imageUrl,
      audio_url: audioDataUrl,
      resolution: resolution,
      turbo_mode: turboMode,
    }),
  });
  
  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    console.error("Failed to submit OmniHuman job:", errorText);
    throw new Error(`OmniHuman submission failed: ${errorText}`);
  }
  
  const { request_id, status: initialStatus } = await submitResponse.json();
  console.log("Job submitted, request_id:", request_id, "initial status:", initialStatus);
  
  // Poll for completion
  const maxAttempts = 180; // 3 minutes max
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const statusResponse = await fetch(
      `https://queue.fal.run/fal-ai/bytedance/omnihuman/v1.5/requests/${request_id}/status`,
      {
        method: "GET",
        headers: {
          "Authorization": `Key ${apiKey}`,
        },
      }
    );
    
    if (!statusResponse.ok) {
      console.error("Status check failed:", await statusResponse.text());
      continue;
    }
    
    const statusData = await statusResponse.json();
    if (attempt % 10 === 0) {
      console.log(`Attempt ${attempt + 1}: status = ${statusData.status}`);
    }
    
    if (statusData.status === "COMPLETED") {
      // Get the result
      const resultResponse = await fetch(
        `https://queue.fal.run/fal-ai/bytedance/omnihuman/v1.5/requests/${request_id}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Key ${apiKey}`,
          },
        }
      );
      
      if (!resultResponse.ok) {
        throw new Error("Failed to get result: " + await resultResponse.text());
      }
      
      const result = await resultResponse.json();
      console.log("OmniHuman result:", JSON.stringify(result).substring(0, 500));
      
      if (result.video?.url) {
        return { videoUrl: result.video.url };
      }
      throw new Error("No video URL in result");
    }
    
    if (statusData.status === "FAILED") {
      throw new Error(`OmniHuman job failed: ${statusData.error || "Unknown error"}`);
    }
  }
  
  throw new Error("OmniHuman job timed out after 3 minutes");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("FAL_KEY");
    if (!apiKey) {
      throw new Error("FAL_KEY not configured");
    }

    const { imageUrl, audioBase64, resolution, turboMode }: OmniHumanRequest = await req.json();

    if (!imageUrl) {
      throw new Error("imageUrl is required");
    }
    if (!audioBase64) {
      throw new Error("audioBase64 is required");
    }

    console.log("Processing OmniHuman lipsync request...");
    console.log("Image URL:", imageUrl.substring(0, 100));
    console.log("Audio base64 length:", audioBase64.length);

    // Generate lipsync video (using data URL for audio)
    const result = await generateLipsyncVideo(
      imageUrl,
      audioBase64,
      apiKey,
      resolution || "720p",
      turboMode !== false
    );

    console.log("Lipsync video generated successfully:", result.videoUrl);

    return new Response(
      JSON.stringify({ 
        success: true,
        videoUrl: result.videoUrl 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("OmniHuman lipsync error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

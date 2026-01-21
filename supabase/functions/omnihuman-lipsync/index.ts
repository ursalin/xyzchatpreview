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

// Upload base64 audio to fal storage and get URL
async function uploadAudioToFal(audioBase64: string, apiKey: string): Promise<string> {
  console.log("Uploading audio to fal.ai storage...");
  
  // Decode base64 to binary
  const binaryString = atob(audioBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  // Get upload URL from fal
  const initiateResponse = await fetch("https://fal.ai/api/storage/upload/initiate", {
    method: "POST",
    headers: {
      "Authorization": `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file_name: "audio.mp3",
      content_type: "audio/mpeg",
    }),
  });
  
  if (!initiateResponse.ok) {
    const errorText = await initiateResponse.text();
    console.error("Failed to initiate upload:", errorText);
    throw new Error(`Failed to initiate fal upload: ${errorText}`);
  }
  
  const { upload_url, file_url } = await initiateResponse.json();
  console.log("Got upload URL, uploading file...");
  
  // Upload the file
  const uploadResponse = await fetch(upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": "audio/mpeg",
    },
    body: bytes,
  });
  
  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    console.error("Failed to upload audio:", errorText);
    throw new Error(`Failed to upload audio to fal: ${errorText}`);
  }
  
  console.log("Audio uploaded successfully:", file_url);
  return file_url;
}

// Submit job to OmniHuman and poll for result
async function generateLipsyncVideo(
  imageUrl: string,
  audioUrl: string,
  apiKey: string,
  resolution: string = "720p",
  turboMode: boolean = true
): Promise<{ videoUrl: string }> {
  console.log("Submitting OmniHuman job...");
  console.log("Image URL:", imageUrl);
  console.log("Audio URL:", audioUrl);
  console.log("Resolution:", resolution, "Turbo:", turboMode);
  
  // Submit the job
  const submitResponse = await fetch("https://queue.fal.run/fal-ai/bytedance/omnihuman/v1.5", {
    method: "POST",
    headers: {
      "Authorization": `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_url: imageUrl,
      audio_url: audioUrl,
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
  const maxAttempts = 120; // 2 minutes max (1 second intervals)
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
    console.log(`Attempt ${attempt + 1}: status = ${statusData.status}`);
    
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
      console.log("OmniHuman result:", JSON.stringify(result));
      
      if (result.video?.url) {
        return { videoUrl: result.video.url };
      }
      throw new Error("No video URL in result");
    }
    
    if (statusData.status === "FAILED") {
      throw new Error(`OmniHuman job failed: ${statusData.error || "Unknown error"}`);
    }
  }
  
  throw new Error("OmniHuman job timed out after 2 minutes");
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
    console.log("Image URL:", imageUrl);
    console.log("Audio base64 length:", audioBase64.length);

    // Step 1: Upload audio to fal storage
    const audioUrl = await uploadAudioToFal(audioBase64, apiKey);

    // Step 2: Generate lipsync video
    const result = await generateLipsyncVideo(
      imageUrl,
      audioUrl,
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

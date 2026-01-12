import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Convert hex string to base64 in chunks to avoid stack overflow
function hexToBase64(hexString: string): string {
  const bytes = new Uint8Array(hexString.length / 2);
  for (let i = 0; i < hexString.length; i += 2) {
    bytes[i / 2] = parseInt(hexString.substring(i, i + 2), 16);
  }
  
  // Convert to base64 in chunks to avoid stack overflow
  const chunkSize = 8192;
  let base64 = "";
  
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    let binary = "";
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
    base64 += btoa(binary);
  }
  
  return base64;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, apiKey, groupId, voiceId } = await req.json();

    if (!text) {
      throw new Error("Text is required");
    }

    if (!apiKey || !groupId) {
      throw new Error("Minimax API Key and Group ID are required");
    }

    const voice = voiceId || "male-qn-qingse";

    console.log("Generating speech with Minimax TTS for text:", text.substring(0, 50) + "...");

    // Minimax T2A v2 API
    const response = await fetch(
      `https://api.minimax.chat/v1/t2a_v2?GroupId=${groupId}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "speech-01-turbo",
          text: text,
          stream: false,
          voice_setting: {
            voice_id: voice,
            speed: 1.0,
            vol: 1.0,
            pitch: 0,
          },
          audio_setting: {
            sample_rate: 32000,
            bitrate: 128000,
            format: "mp3",
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Minimax API error:", response.status, errorText);
      throw new Error(`Minimax API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    if (result.base_resp?.status_code !== 0) {
      console.error("Minimax API returned error:", result.base_resp);
      throw new Error(result.base_resp?.status_msg || "Minimax API error");
    }

    // Return the audio data (hex encoded)
    const audioHex = result.data?.audio;
    if (!audioHex) {
      throw new Error("No audio data in response");
    }

    console.log("Audio hex length:", audioHex.length);

    // Convert hex to base64 using chunked approach
    const base64Audio = hexToBase64(audioHex);

    console.log("Base64 audio length:", base64Audio.length);

    return new Response(
      JSON.stringify({ audioContent: base64Audio }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Minimax TTS error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

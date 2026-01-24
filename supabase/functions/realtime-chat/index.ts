import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, upgrade, connection, sec-websocket-key, sec-websocket-version, sec-websocket-extensions, sec-websocket-protocol",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const upgrade = req.headers.get("upgrade") || "";

  // WebSocket upgrade request
  if (upgrade.toLowerCase() === "websocket") {
    console.log("WebSocket upgrade request received");
    
    const OPENAI_API_KEY = Deno.env.get("fanxaingdaili");
    if (!OPENAI_API_KEY) {
      console.error("API key not configured");
      return new Response("API key not configured", { status: 500 });
    }

    // Connect to OpenAI Realtime API through reverse proxy
    // Try different connection methods for the reverse proxy
    const openaiWsUrl = `wss://liu-api.fun/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01`;
    console.log("Connecting to OpenAI Realtime API via reverse proxy:", openaiWsUrl);
    console.log("API Key length:", OPENAI_API_KEY.length);

    try {
      // Method 1: Use headers for authentication (most common for reverse proxies)
      const openaiWs = new WebSocket(openaiWsUrl, {
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1"
        }
      } as any);

      const { socket: clientSocket, response } = Deno.upgradeWebSocket(req);
      
      let isOpenAIConnected = false;
      const pendingMessages: string[] = [];

      openaiWs.onopen = () => {
        console.log("Connected to OpenAI Realtime API");
        isOpenAIConnected = true;
        // Send any pending messages
        for (const msg of pendingMessages) {
          openaiWs.send(msg);
        }
        pendingMessages.length = 0;
      };

      openaiWs.onmessage = (event) => {
        try {
          const data = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data);
          console.log("OpenAI -> Client:", data.substring(0, 200));
          if (clientSocket.readyState === WebSocket.OPEN) {
            clientSocket.send(data);
          }
        } catch (e) {
          console.error("Error forwarding OpenAI message:", e);
        }
      };

      openaiWs.onerror = (event) => {
        console.error("OpenAI WebSocket error:", event);
      };

      openaiWs.onclose = (event) => {
        console.log("OpenAI WebSocket closed:", event.code, event.reason);
        if (clientSocket.readyState === WebSocket.OPEN) {
          clientSocket.close(1000, "OpenAI connection closed");
        }
      };

      clientSocket.onopen = () => {
        console.log("Client WebSocket connected");
      };

      clientSocket.onmessage = (event) => {
        try {
          const data = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data);
          console.log("Client -> OpenAI:", data.substring(0, 200));
          if (isOpenAIConnected && openaiWs.readyState === WebSocket.OPEN) {
            openaiWs.send(data);
          } else {
            pendingMessages.push(data);
          }
        } catch (e) {
          console.error("Error forwarding client message:", e);
        }
      };

      clientSocket.onerror = (event) => {
        console.error("Client WebSocket error:", event);
      };

      clientSocket.onclose = (event) => {
        console.log("Client WebSocket closed:", event.code, event.reason);
        if (openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.close(1000, "Client disconnected");
        }
      };

      return response;
    } catch (error) {
      console.error("WebSocket setup error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return new Response(`WebSocket setup failed: ${errorMessage}`, { status: 500, headers: corsHeaders });
    }
  }

  // Regular HTTP request - return connection info
  return new Response(
    JSON.stringify({ 
      status: "ready",
      message: "Connect via WebSocket for realtime audio" 
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

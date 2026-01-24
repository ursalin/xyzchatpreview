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
    
    const OPENAI_API_KEY = Deno.env.get("FDCE2");
    if (!OPENAI_API_KEY) {
      console.error("Missing FDCE2 API key");
      return new Response("Missing API key", { status: 500 });
    }

    // Connect to OpenAI Realtime API through reverse proxy
    const openaiWsUrlBase = `wss://max.openai365.top/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01`;
    console.log("Connecting to OpenAI Realtime API via proxy:", openaiWsUrlBase);
    console.log("API Key length:", OPENAI_API_KEY.length);

    // WebSocket subprotocol values must be RFC token chars only.
    // Some proxy/API keys may contain characters that are invalid as subprotocols (e.g. '=', '/', space),
    // which will throw: "SyntaxError: Invalid protocol value".
    const isValidWsToken = (value: string) => /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value);
    const keyToken = `openai-insecure-api-key.${OPENAI_API_KEY}`;

    try {
      // IMPORTANT: This runtime's WebSocket constructor does NOT accept custom headers.
      // The 2nd argument is *subprotocol(s)*.
      // Strategy:
      // - If the key is a valid WS token, pass it via the official subprotocol.
      // - Otherwise, fallback to passing key via query param (proxy-dependent) while keeping beta subprotocol.
      let openaiSocket: WebSocket;

      if (isValidWsToken(keyToken)) {
        console.log("Upstream auth: subprotocol (openai-insecure-api-key.*)");
        openaiSocket = new WebSocket(openaiWsUrlBase, [
          "realtime",
          keyToken,
          "openai-beta.realtime=v1",
        ]);
      } else {
        console.warn(
          "API key contains chars invalid for WS subprotocol; falling back to query param auth (proxy-dependent).",
        );
        const openaiWsUrl = `${openaiWsUrlBase}&api_key=${encodeURIComponent(OPENAI_API_KEY)}`;
        // Keep beta subprotocol (valid token) so upstream can still enable realtime=v1 behavior if supported.
        openaiSocket = new WebSocket(openaiWsUrl, ["realtime", "openai-beta.realtime=v1"]);
      }

      const { socket: clientSocket, response } = Deno.upgradeWebSocket(req);
      
      let isOpenAIConnected = false;
      const pendingMessages: string[] = [];

      openaiSocket.onopen = () => {
        console.log("Connected to OpenAI Realtime API");
        isOpenAIConnected = true;
        // Send any pending messages
        for (const msg of pendingMessages) {
          openaiSocket.send(msg);
        }
        pendingMessages.length = 0;
      };

      openaiSocket.onmessage = (event: MessageEvent) => {
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

      openaiSocket.onerror = (event: Event) => {
        console.error("OpenAI WebSocket error:", event);
        try {
          if (clientSocket.readyState === WebSocket.OPEN) {
            clientSocket.send(
              JSON.stringify({
                type: "proxy.error",
                message: "Upstream WebSocket error",
              }),
            );
          }
        } catch {
          // ignore
        }
      };

      openaiSocket.onclose = (event: CloseEvent) => {
        console.log("OpenAI WebSocket closed:", event.code, event.reason);
        try {
          if (clientSocket.readyState === WebSocket.OPEN) {
            clientSocket.send(
              JSON.stringify({
                type: "proxy.closed",
                code: event.code,
                reason: event.reason,
              }),
            );
          }
        } catch {
          // ignore
        }
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
          if (isOpenAIConnected && openaiSocket.readyState === WebSocket.OPEN) {
            openaiSocket.send(data);
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
        if (openaiSocket.readyState === WebSocket.OPEN) {
          openaiSocket.close(1000, "Client disconnected");
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

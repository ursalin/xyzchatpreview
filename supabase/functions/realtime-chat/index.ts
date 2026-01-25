import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, upgrade, connection, sec-websocket-key, sec-websocket-version, sec-websocket-extensions, sec-websocket-protocol",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// 豆包 Realtime API 常量
const DOUBAO_WS_URL = "wss://openspeech.bytedance.com/api/v3/realtime/dialogue";

// 事件ID定义
const EVENT_ID = {
  // 客户端事件
  START_CONNECTION: 1,
  FINISH_CONNECTION: 2,
  START_SESSION: 100,
  FINISH_SESSION: 102,
  TASK_REQUEST: 200,  // 音频数据
  SAY_HELLO: 300,
  CHAT_TTS_TEXT: 500,
  CHAT_TEXT_QUERY: 501,
  
  // 服务端事件
  CONNECTION_STARTED: 50,
  CONNECTION_FAILED: 51,
  SESSION_STARTED: 150,
  SESSION_FAILED: 151,
  TASK_STARTED: 250,
  TASK_FINISHED: 252,
  TASK_FAILED: 253,
  TASK_AUDIO_RESPONSE: 254,
  TASK_TEXT_RESPONSE: 255,
};

// 消息类型
const MESSAGE_TYPE = {
  FULL_CLIENT_REQUEST: 0b0001,
  FULL_SERVER_RESPONSE: 0b1001,
  AUDIO_ONLY_REQUEST: 0b0010,
  AUDIO_ONLY_RESPONSE: 0b1011,
  ERROR_INFO: 0b1111,
};

// 生成随机 session ID
function generateSessionId(): string {
  return crypto.randomUUID();
}

// 构建二进制协议头
function buildHeader(messageType: number, flags: number, isJson: boolean, compressed: boolean = false): Uint8Array {
  const header = new Uint8Array(4);
  header[0] = (0b0001 << 4) | 0b0001; // Protocol version 1, header size 1 (4 bytes)
  header[1] = (messageType << 4) | flags;
  header[2] = (isJson ? 0b0001 : 0b0000) << 4 | (compressed ? 0b0001 : 0b0000);
  header[3] = 0x00; // Reserved
  return header;
}

// 构建带事件的完整消息帧
function buildEventFrame(eventId: number, sessionId: string, payload: object | null): Uint8Array {
  const sessionIdBytes = new TextEncoder().encode(sessionId);
  const payloadBytes = payload ? new TextEncoder().encode(JSON.stringify(payload)) : new TextEncoder().encode("{}");
  
  // Header (4) + event (4) + session id size (4) + session id + payload size (4) + payload
  const totalSize = 4 + 4 + 4 + sessionIdBytes.length + 4 + payloadBytes.length;
  const frame = new Uint8Array(totalSize);
  const view = new DataView(frame.buffer);
  
  let offset = 0;
  
  // Header: message type 0b0001, flags 0b0100 (has event)
  frame.set(buildHeader(MESSAGE_TYPE.FULL_CLIENT_REQUEST, 0b0100, true), offset);
  offset += 4;
  
  // Event ID (4 bytes, big endian)
  view.setUint32(offset, eventId, false);
  offset += 4;
  
  // Session ID size (4 bytes, big endian)
  view.setUint32(offset, sessionIdBytes.length, false);
  offset += 4;
  
  // Session ID
  frame.set(sessionIdBytes, offset);
  offset += sessionIdBytes.length;
  
  // Payload size (4 bytes, big endian)
  view.setUint32(offset, payloadBytes.length, false);
  offset += 4;
  
  // Payload
  frame.set(payloadBytes, offset);
  
  return frame;
}

// 构建音频数据帧
function buildAudioFrame(sessionId: string, audioData: Uint8Array): Uint8Array {
  const sessionIdBytes = new TextEncoder().encode(sessionId);
  
  // Header (4) + event (4) + session id size (4) + session id + payload size (4) + audio
  const totalSize = 4 + 4 + 4 + sessionIdBytes.length + 4 + audioData.length;
  const frame = new Uint8Array(totalSize);
  const view = new DataView(frame.buffer);
  
  let offset = 0;
  
  // Header: message type 0b0010 (audio), flags 0b0100 (has event)
  frame.set(buildHeader(MESSAGE_TYPE.AUDIO_ONLY_REQUEST, 0b0100, false), offset);
  offset += 4;
  
  // Event ID (TASK_REQUEST = 200)
  view.setUint32(offset, EVENT_ID.TASK_REQUEST, false);
  offset += 4;
  
  // Session ID size
  view.setUint32(offset, sessionIdBytes.length, false);
  offset += 4;
  
  // Session ID
  frame.set(sessionIdBytes, offset);
  offset += sessionIdBytes.length;
  
  // Payload size
  view.setUint32(offset, audioData.length, false);
  offset += 4;
  
  // Audio data
  frame.set(audioData, offset);
  
  return frame;
}

// 解析服务端响应帧
function parseServerFrame(data: ArrayBuffer): { eventId: number; sessionId: string; payload: any; audioData?: Uint8Array; isAudio: boolean; isError: boolean } | null {
  try {
    const view = new DataView(data);
    const bytes = new Uint8Array(data);
    
    if (data.byteLength < 4) return null;
    
    let offset = 0;
    
    // Parse header
    const byte0 = bytes[offset];
    const byte1 = bytes[offset + 1];
    const byte2 = bytes[offset + 2];
    offset += 4;
    
    const messageType = (byte1 >> 4) & 0x0F;
    const flags = byte1 & 0x0F;
    const serializationMethod = (byte2 >> 4) & 0x0F;
    
    const isError = messageType === MESSAGE_TYPE.ERROR_INFO;
    const isAudio = messageType === MESSAGE_TYPE.AUDIO_ONLY_RESPONSE;
    const hasEvent = (flags & 0b0100) !== 0;
    
    let eventId = 0;
    let sessionId = "";
    
    // Error frame has error code first
    if (isError && data.byteLength >= offset + 4) {
      const errorCode = view.getUint32(offset, false);
      offset += 4;
      console.log("Error code:", errorCode);
    }
    
    // Parse event ID if present
    if (hasEvent && data.byteLength >= offset + 4) {
      eventId = view.getUint32(offset, false);
      offset += 4;
    }
    
    // Parse session ID if present (session-level events)
    if (eventId >= 100 && data.byteLength >= offset + 4) {
      const sessionIdSize = view.getUint32(offset, false);
      offset += 4;
      
      if (sessionIdSize > 0 && data.byteLength >= offset + sessionIdSize) {
        sessionId = new TextDecoder().decode(bytes.slice(offset, offset + sessionIdSize));
        offset += sessionIdSize;
      }
    }
    
    // Parse payload
    if (data.byteLength >= offset + 4) {
      const payloadSize = view.getUint32(offset, false);
      offset += 4;
      
      if (payloadSize > 0 && data.byteLength >= offset + payloadSize) {
        const payloadBytes = bytes.slice(offset, offset + payloadSize);
        
        if (isAudio) {
          return { eventId, sessionId, payload: null, audioData: payloadBytes, isAudio: true, isError: false };
        } else {
          try {
            const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
            return { eventId, sessionId, payload, isAudio: false, isError };
          } catch {
            return { eventId, sessionId, payload: new TextDecoder().decode(payloadBytes), isAudio: false, isError };
          }
        }
      }
    }
    
    return { eventId, sessionId, payload: null, isAudio: false, isError };
  } catch (e) {
    console.error("Failed to parse server frame:", e);
    return null;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const upgrade = req.headers.get("upgrade") || "";

  // WebSocket upgrade request
  if (upgrade.toLowerCase() === "websocket") {
    console.log("WebSocket upgrade request received");
    
    const VOLCENGINE_APP_ID = Deno.env.get("VOLCENGINE_APP_ID");
    const VOLCENGINE_ACCESS_KEY = Deno.env.get("VOLCENGINE_ACCESS_KEY"); // 这是 Secret Key
    const VOLCENGINE_APP_KEY = Deno.env.get("VOLCENGINE_APP_KEY"); // 这是 API Key (Access Token)
    
    if (!VOLCENGINE_APP_ID || !VOLCENGINE_APP_KEY) {
      console.error("Missing Volcengine credentials: APP_ID or APP_KEY (Access Token)");
      return new Response("Missing API credentials", { status: 500 });
    }
    
    // VOLCENGINE_APP_KEY 现在存储的是 Access Token，用于 Bearer 认证
    const accessToken = VOLCENGINE_APP_KEY;

    console.log("Connecting to Doubao Realtime API with Bearer Token auth...");
    console.log("App ID length:", VOLCENGINE_APP_ID.length);
    console.log("Access Token length:", accessToken.length);
    console.log("Access Token prefix:", accessToken.substring(0, 8) + "...");

    try {
      const connectId = crypto.randomUUID();
      const { socket: clientSocket, response } = Deno.upgradeWebSocket(req);

      const sendProxyError = (message: string) => {
        try {
          if (clientSocket.readyState === WebSocket.OPEN) {
            clientSocket.send(JSON.stringify({ type: "proxy.error", message }));
          }
        } catch {
          // ignore
        }
      };

      console.log("Connecting to URL:", DOUBAO_WS_URL);

      // 连接到豆包 Realtime API
      // 使用 Bearer Token 认证方式（火山引擎语音 API 标准认证）
      // Header 格式: "Authorization": "Bearer; {token}"
      let doubaoSocket: WebSocket;
      const upstreamHeaders: Record<string, string> = {
        "Authorization": `Bearer; ${accessToken}`,
        "X-Api-App-ID": VOLCENGINE_APP_ID,
        "X-Api-Resource-Id": "volc.speech.dialog",
        "X-Api-Connect-Id": connectId,
      };
      
      console.log("Using Bearer Token auth, headers configured");

      try {
        const upstreamResp = await fetch(DOUBAO_WS_URL, {
          headers: upstreamHeaders,
        });

        console.log(
          "Upstream handshake status:",
          upstreamResp.status,
          upstreamResp.statusText,
        );

        if (upstreamResp.status !== 101) {
          let body = "";
          try {
            body = await upstreamResp.text();
          } catch {
            body = "";
          }

          const bodySnippet = body ? body.slice(0, 240) : "";
          console.error("Upstream handshake failed (non-101)");
          sendProxyError(
            `上游握手失败：${upstreamResp.status} ${upstreamResp.statusText}${bodySnippet ? `；${bodySnippet}` : ""}`,
          );

          try {
            clientSocket.close(1011, "Upstream handshake failed");
          } catch {
            // ignore
          }
          return response;
        }

        const maybeWs = (upstreamResp as any).webSocket as WebSocket | undefined;
        if (!maybeWs) {
          throw new Error("Response.webSocket not available in this runtime");
        }

        doubaoSocket = maybeWs;
        // Deno 的 fetch WebSocket upgrade 需要 accept()
        (doubaoSocket as any).accept?.();
        console.log("Upstream connect: using fetch upgrade with headers");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          "Upstream connect via fetch-upgrade failed, falling back to query auth with Bearer token. reason:",
          msg,
        );

        // 回退：使用 query 参数传递认证信息（Bearer Token 方式）
        const wsUrlWithAuth =
          `${DOUBAO_WS_URL}?X-Api-App-ID=${encodeURIComponent(VOLCENGINE_APP_ID)}` +
          `&Authorization=${encodeURIComponent(`Bearer; ${accessToken}`)}` +
          `&X-Api-Resource-Id=volc.speech.dialog` +
          `&X-Api-Connect-Id=${connectId}`;
        // ⚠️ 不要 console.log(wsUrlWithAuth)（包含敏感信息）
        doubaoSocket = new WebSocket(wsUrlWithAuth);
      }
      
      let isDoubaoConnected = false;
      let currentSessionId = "";
      const pendingMessages: Uint8Array[] = [];
      

      // 处理豆包连接
      doubaoSocket.onopen = () => {
        console.log("Connected to Doubao Realtime API");
        isDoubaoConnected = true;
        
        // 发送 StartConnection 事件
        const startConnectionFrame = buildEventFrame(EVENT_ID.START_CONNECTION, "", {});
        // 重新构建 StartConnection 帧（不需要 session id）
        const header = buildHeader(MESSAGE_TYPE.FULL_CLIENT_REQUEST, 0b0100, true);
        const eventBytes = new Uint8Array(4);
        new DataView(eventBytes.buffer).setUint32(0, EVENT_ID.START_CONNECTION, false);
        const connectIdBytes = new TextEncoder().encode(crypto.randomUUID());
        const payloadBytes = new TextEncoder().encode("{}");
        
        const frame = new Uint8Array(4 + 4 + 4 + connectIdBytes.length + 4 + payloadBytes.length);
        const view = new DataView(frame.buffer);
        let offset = 0;
        
        frame.set(header, offset); offset += 4;
        view.setUint32(offset, EVENT_ID.START_CONNECTION, false); offset += 4;
        view.setUint32(offset, connectIdBytes.length, false); offset += 4;
        frame.set(connectIdBytes, offset); offset += connectIdBytes.length;
        view.setUint32(offset, payloadBytes.length, false); offset += 4;
        frame.set(payloadBytes, offset);
        
        doubaoSocket.send(frame);
        console.log("Sent StartConnection event");
        
        // 发送队列中的消息
        for (const msg of pendingMessages) {
          doubaoSocket.send(msg);
        }
        pendingMessages.length = 0;
      };

      doubaoSocket.onmessage = (event: MessageEvent) => {
        try {
          let data: ArrayBuffer;
          if (event.data instanceof ArrayBuffer) {
            data = event.data;
          } else if (event.data instanceof Blob) {
            // Blob 需要异步处理
            event.data.arrayBuffer().then((buffer) => {
              processDoubaoMessage(buffer);
            });
            return;
          } else {
            console.log("Received non-binary message:", event.data);
            return;
          }
          
          processDoubaoMessage(data);
        } catch (e) {
          console.error("Error processing Doubao message:", e);
        }
      };
      
      function processDoubaoMessage(data: ArrayBuffer) {
        const parsed = parseServerFrame(data);
        if (!parsed) {
          console.log("Failed to parse frame, length:", data.byteLength);
          return;
        }
        
        console.log("Doubao event:", parsed.eventId, "isAudio:", parsed.isAudio);
        
        // 转换为客户端可理解的 JSON 格式
        let clientMessage: any = null;
        
        switch (parsed.eventId) {
          case EVENT_ID.CONNECTION_STARTED:
            console.log("Connection established, starting session...");
            // 自动开始会话
            currentSessionId = generateSessionId();
            if (clientSocket.readyState === WebSocket.OPEN) {
              clientSocket.send(JSON.stringify({
                type: "connection.ready",
                sessionId: currentSessionId
              }));
            }
            break;
            
          case EVENT_ID.CONNECTION_FAILED:
            console.error("Connection failed:", parsed.payload);
            clientMessage = {
              type: "error",
              error: { message: parsed.payload?.error || "Connection failed" }
            };
            break;
            
          case EVENT_ID.SESSION_STARTED:
            console.log("Session started:", parsed.sessionId);
            clientMessage = {
              type: "session.created",
              session: { id: parsed.sessionId }
            };
            break;
            
          case EVENT_ID.SESSION_FAILED:
            console.error("Session failed:", parsed.payload);
            clientMessage = {
              type: "error",
              error: { message: parsed.payload?.error || "Session failed" }
            };
            break;
            
          case EVENT_ID.TASK_AUDIO_RESPONSE:
            // 音频响应
            if (parsed.audioData) {
              // 转换为 base64 发送给客户端
              const base64Audio = btoa(String.fromCharCode(...parsed.audioData));
              clientMessage = {
                type: "response.audio.delta",
                delta: base64Audio
              };
            }
            break;
            
          case EVENT_ID.TASK_TEXT_RESPONSE:
            // 文本响应 (ASR 或 Chat)
            if (parsed.payload) {
              const text = parsed.payload.text || parsed.payload.content || "";
              const role = parsed.payload.role || "assistant";
              
              if (role === "user") {
                // ASR 识别结果
                clientMessage = {
                  type: "conversation.item.input_audio_transcription.completed",
                  transcript: text
                };
              } else {
                // AI 回复
                clientMessage = {
                  type: "response.audio_transcript.delta",
                  delta: text
                };
              }
            }
            break;
            
          case EVENT_ID.TASK_FINISHED:
            console.log("Task finished");
            clientMessage = {
              type: "response.audio.done"
            };
            // 发送 response.done
            if (clientSocket.readyState === WebSocket.OPEN) {
              clientSocket.send(JSON.stringify({ type: "response.done" }));
            }
            break;
            
          case EVENT_ID.TASK_STARTED:
            console.log("Task started");
            break;
            
          case EVENT_ID.TASK_FAILED:
            console.error("Task failed:", parsed.payload);
            clientMessage = {
              type: "error",
              error: { message: parsed.payload?.error || "Task failed" }
            };
            break;
            
          default:
            if (parsed.isAudio && parsed.audioData) {
              const base64Audio = btoa(String.fromCharCode(...parsed.audioData));
              clientMessage = {
                type: "response.audio.delta",
                delta: base64Audio
              };
            } else {
              console.log("Unknown event:", parsed.eventId, parsed.payload);
            }
        }
        
        if (clientMessage && clientSocket.readyState === WebSocket.OPEN) {
          clientSocket.send(JSON.stringify(clientMessage));
        }
      }

      doubaoSocket.onerror = (event: Event) => {
        // 避免直接打印 event（其中可能包含带 query 的 url）
        console.error("Doubao WebSocket error");
        try {
          const msg = (event as any)?.message ? String((event as any).message) : "WebSocket error";
          sendProxyError(`上游 WebSocket 错误：${msg}`);
        } catch {
          sendProxyError("上游 WebSocket 连接错误（可能是鉴权/资源未开通/网络问题）");
        }
      };

      doubaoSocket.onclose = (event: CloseEvent) => {
        console.log("Doubao WebSocket closed:", event.code, event.reason);
        if (clientSocket.readyState === WebSocket.OPEN) {
          clientSocket.send(JSON.stringify({
            type: "proxy.closed",
            code: event.code,
            reason: event.reason
          }));
          clientSocket.close(1000, "Doubao connection closed");
        }
      };

      // 处理客户端消息
      clientSocket.onopen = () => {
        console.log("Client WebSocket connected");
      };

      clientSocket.onmessage = (event) => {
        try {
          const data = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
          console.log("Client -> Doubao:", data.substring(0, 200));
          
          const message = JSON.parse(data);
          
          // 根据消息类型转换为豆包协议
          switch (message.type) {
            case "session.update":
              // 开始会话
              if (!currentSessionId) {
                currentSessionId = generateSessionId();
              }
              
              // 从客户端消息中获取语音ID，如果没有则使用默认
              const customVoiceId = message.session?.voice;
              const speakerVoice = customVoiceId || "zh_female_vv_jupiter_bigtts"; // 默认 vv 音色
              console.log("Using voice:", speakerVoice, "custom:", !!customVoiceId);
              
              const sessionConfig = {
                asr: {
                  extra: {
                    end_smooth_window_ms: 800,
                    enable_custom_vad: false,
                  }
                },
                dialog: {
                  bot_name: "小爱",
                  system_role: message.session?.instructions || "你是一个友好的AI助手，请用中文回复。保持回答简洁自然。",
                  speaking_style: "温柔亲切",
                  extra: {
                    strict_audit: false,
                    model: "O"  // 使用 O 版本
                  }
                },
                tts: {
                  speaker: speakerVoice,  // 使用自定义或默认音色
                  audio_config: {
                    channel: 1,
                    format: "pcm_s16le",
                    sample_rate: 24000
                  }
                }
              };
              
              const sessionFrame = buildEventFrame(EVENT_ID.START_SESSION, currentSessionId, sessionConfig);
              
              if (isDoubaoConnected && doubaoSocket.readyState === WebSocket.OPEN) {
                doubaoSocket.send(sessionFrame);
                console.log("Sent StartSession with config, voice:", speakerVoice);
              } else {
                pendingMessages.push(sessionFrame);
              }
              break;
              
            case "input_audio_buffer.append":
              // 发送音频数据
              if (message.audio && currentSessionId) {
                const binaryString = atob(message.audio);
                const audioBytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  audioBytes[i] = binaryString.charCodeAt(i);
                }
                
                const audioFrame = buildAudioFrame(currentSessionId, audioBytes);
                
                if (isDoubaoConnected && doubaoSocket.readyState === WebSocket.OPEN) {
                  doubaoSocket.send(audioFrame);
                } else {
                  pendingMessages.push(audioFrame);
                }
              }
              break;
              
            case "conversation.item.create":
              // 文本输入
              if (message.item?.content?.[0]?.text && currentSessionId) {
                const textQuery = {
                  content: message.item.content[0].text
                };
                const textFrame = buildEventFrame(EVENT_ID.CHAT_TEXT_QUERY, currentSessionId, textQuery);
                
                if (isDoubaoConnected && doubaoSocket.readyState === WebSocket.OPEN) {
                  doubaoSocket.send(textFrame);
                } else {
                  pendingMessages.push(textFrame);
                }
              }
              break;
              
            case "response.create":
              // 豆包会自动响应，不需要显式触发
              break;
              
            default:
              console.log("Unknown client message type:", message.type);
          }
        } catch (e) {
          console.error("Error processing client message:", e);
        }
      };

      clientSocket.onerror = (event) => {
        console.error("Client WebSocket error:", event);
      };

      clientSocket.onclose = (event) => {
        console.log("Client WebSocket closed:", event.code, event.reason);
        
        // 结束会话
        if (currentSessionId && doubaoSocket.readyState === WebSocket.OPEN) {
          const finishSessionFrame = buildEventFrame(EVENT_ID.FINISH_SESSION, currentSessionId, {});
          doubaoSocket.send(finishSessionFrame);
        }
        
        if (doubaoSocket.readyState === WebSocket.OPEN) {
          doubaoSocket.close(1000, "Client disconnected");
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
      message: "Connect via WebSocket for Doubao realtime audio",
      provider: "doubao"
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

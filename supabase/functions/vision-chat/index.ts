import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, systemPrompt, image } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Vision chat request - has image:", !!image, "messages:", messages?.length || 0);

    // 构建消息数组
    const apiMessages: Array<{
      role: string;
      content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    }> = [
      { 
        role: "system", 
        content: systemPrompt || "你是一个友好的AI助手，可以看见用户的视频画面并与用户进行视频通话。请用中文回复，语气自然亲切，像真正的视频通话一样。"
      },
    ];

    // 添加历史消息
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        apiMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    // 如果有图片，添加到最后一条用户消息或创建新消息
    if (image) {
      const lastUserIndex = apiMessages.length - 1;
      const lastMsg = apiMessages[lastUserIndex];
      
      if (lastMsg && lastMsg.role === "user") {
        // 转换最后一条用户消息为多模态格式
        apiMessages[lastUserIndex] = {
          role: "user",
          content: [
            { type: "text", text: lastMsg.content as string },
            { 
              type: "image_url", 
              image_url: { 
                url: image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}` 
              } 
            }
          ]
        };
      } else {
        // 创建新的多模态消息
        apiMessages.push({
          role: "user",
          content: [
            { type: "text", text: "请根据我的视频画面回应我。" },
            { 
              type: "image_url", 
              image_url: { 
                url: image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}` 
              } 
            }
          ]
        });
      }
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: apiMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "请求过于频繁，请稍后再试。" }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "API额度已用完，请充值。" }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "AI服务暂时不可用" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Streaming vision response");

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("Vision chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

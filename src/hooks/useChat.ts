import { useState, useCallback, useEffect } from 'react';
import { Message, AppSettings } from '@/types/chat';

const CHAT_HISTORY_KEY = 'ai-companion-chat-history';
const MAX_STORED_MESSAGES = 100; // 最多保存100条消息

// 序列化消息用于存储
function serializeMessages(messages: Message[]): string {
  return JSON.stringify(messages.map(m => ({
    ...m,
    timestamp: m.timestamp.toISOString(),
  })));
}

// 反序列化存储的消息
function deserializeMessages(data: string): Message[] {
  try {
    const parsed = JSON.parse(data);
    return parsed.map((m: { id: string; role: 'user' | 'assistant'; content: string; timestamp: string }) => ({
      ...m,
      timestamp: new Date(m.timestamp),
    }));
  } catch {
    return [];
  }
}

// 从 localStorage 加载聊天记录
function loadStoredMessages(): Message[] {
  try {
    const stored = localStorage.getItem(CHAT_HISTORY_KEY);
    if (stored) {
      return deserializeMessages(stored);
    }
  } catch (e) {
    console.error('Failed to load chat history:', e);
  }
  return [];
}

export function useChat(settings: AppSettings, systemPrompt: string) {
  const [messages, setMessages] = useState<Message[]>(() => loadStoredMessages());
  const [isLoading, setIsLoading] = useState(false);

  // 保存聊天记录到 localStorage
  useEffect(() => {
    if (messages.length > 0) {
      try {
        // 只保存最近的消息
        const messagesToStore = messages.slice(-MAX_STORED_MESSAGES);
        localStorage.setItem(CHAT_HISTORY_KEY, serializeMessages(messagesToStore));
      } catch (e) {
        console.error('Failed to save chat history:', e);
      }
    }
  }, [messages]);

  const sendMessage = useCallback(async (content: string) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const { apiConfig } = settings;
      
      // Determine API endpoint and headers
      let apiUrl: string;
      let headers: Record<string, string>;
      let body: Record<string, unknown>;

      if (apiConfig.useCustomApi && apiConfig.apiEndpoint && apiConfig.apiKey) {
        // Use custom API directly from frontend
        apiUrl = apiConfig.apiEndpoint;
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiConfig.apiKey}`,
        };
        body = {
          model: apiConfig.model || 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            ...[...messages, userMessage].map(m => ({
              role: m.role,
              content: m.content,
            })),
          ],
          stream: true,
        };
      } else {
        // Use Lovable AI via edge function
        apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        };
        body = {
          messages: [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content,
          })),
          systemPrompt,
        };
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('请求过于频繁，请稍后再试');
        }
        if (response.status === 402) {
          throw new Error('API额度已用完，请充值');
        }
        if (response.status === 401) {
          throw new Error('API密钥无效，请检查设置');
        }
        throw new Error('AI回复失败');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应');

      const decoder = new TextDecoder();
      let assistantContent = '';
      let assistantMessageId = crypto.randomUUID();

      // Add empty assistant message first
      setMessages(prev => [
        ...prev,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          timestamp: new Date(),
        },
      ]);

      let textBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantContent += content;
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantMessageId
                    ? { ...m, content: assistantContent }
                    : m
                )
              );
            }
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: error instanceof Error ? error.message : '抱歉，我遇到了一些问题，请稍后再试。',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, settings, systemPrompt]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    try {
      localStorage.removeItem(CHAT_HISTORY_KEY);
    } catch (e) {
      console.error('Failed to clear chat history:', e);
    }
  }, []);

  return {
    messages,
    isLoading,
    sendMessage,
    clearMessages,
  };
}

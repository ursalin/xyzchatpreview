import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Message, AppSettings } from '@/types/chat';
import { useMemoryManager } from './useMemoryManager';

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

  // 撤回删除支持
  const lastDeletedRef = useRef<Message[] | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 使用记忆管理器
  const {
    memorySummary,
    isSummarizing,
    checkAndSummarize,
    buildContextMessages,
    clearMemory,
    updateMemorySummary,
  } = useMemoryManager();

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

  const sendMessage = useCallback(async (content: string, imageUrl?: string) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date(),
      imageUrl,
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const { apiConfig } = settings;

      // 检查是否需要总结旧对话
      const allMessages = [...messages, userMessage];
      await checkAndSummarize(
        allMessages,
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
      );

      // 构建上下文消息（包含记忆摘要 + 最近消息）
      const contextMessages = buildContextMessages(allMessages);
      
      // 如果最后一条消息有图片，构建 vision 格式
      const apiMessages = contextMessages.map((msg, idx) => {
        // 只对最后一条用户消息（带图片的）做 vision 格式
        if (idx === contextMessages.length - 1 && imageUrl && msg.role === 'user') {
          return {
            role: msg.role,
            content: [
              { type: 'text', text: msg.content },
              { 
                type: 'image_url', 
                image_url: { url: imageUrl, detail: 'low' }
              },
            ],
          };
        }
        return msg;
      });

      // Determine API endpoint and headers
      let apiUrl: string;
      let headers: Record<string, string>;
      let body: Record<string, unknown>;

      if (apiConfig.useCustomApi && apiConfig.apiEndpoint && apiConfig.apiKey) {
        // Use custom API directly from frontend
        // Auto-append /v1/chat/completions if not present (like SillyTavern)
        let endpoint = apiConfig.apiEndpoint.trim();
        if (!endpoint.endsWith('/v1/chat/completions') && !endpoint.endsWith('/chat/completions')) {
          endpoint = endpoint.replace(/\/$/, '') + '/v1/chat/completions';
        }
        apiUrl = endpoint;
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiConfig.apiKey}`,
        };
        // 每次发消息时实时注入当前时间
        const nowDate = new Date();
        const nowStr = nowDate.toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'long',
          hour: '2-digit',
          minute: '2-digit',
        });
        const cnHour = parseInt(nowDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false }));
        const period = cnHour < 6 ? '凌晨' : cnHour < 9 ? '早上' : cnHour < 12 ? '上午' : cnHour < 14 ? '中午' : cnHour < 18 ? '下午' : cnHour < 22 ? '晚上' : '深夜';
        const realtimePrompt = systemPrompt.replace(
          /当前时间：.*/,
          `当前时间：${nowStr}（${period}）`
        );
        body = {
          model: apiConfig.model || 'gpt-4o',
          messages: [
            { role: 'system', content: realtimePrompt },
            ...apiMessages,
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
          messages: contextMessages,
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
  }, [messages, settings, systemPrompt, checkAndSummarize, buildContextMessages]);

  const clearMessages = useCallback(() => {
    // 保存快照用于撤回
    setMessages(prev => {
      lastDeletedRef.current = prev;
      return [];
    });
    try {
      localStorage.removeItem(CHAT_HISTORY_KEY);
    } catch (e) {
      console.error('Failed to clear chat history:', e);
    }
    // 5秒后清除撤回快照
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => { lastDeletedRef.current = null; }, 5000);
  }, []);

  // 删除指定消息
  const deleteMessages = useCallback((messageIds: string[]) => {
    setMessages(prev => {
      const deleted = prev.filter(m => messageIds.includes(m.id));
      if (deleted.length > 0) {
        lastDeletedRef.current = prev; // 保存完整快照
      }
      return prev.filter(m => !messageIds.includes(m.id));
    });
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => { lastDeletedRef.current = null; }, 5000);
  }, []);

  // 撤回删除
  const undoDelete = useCallback(() => {
    if (lastDeletedRef.current) {
      setMessages(lastDeletedRef.current);
      lastDeletedRef.current = null;
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    }
  }, []);

  // 是否可以撤回
  const canUndo = lastDeletedRef.current !== null;

  // 切换收藏状态
  const toggleStarMessage = useCallback((messageId: string) => {
    setMessages(prev => prev.map(m => 
      m.id === messageId ? { ...m, starred: !m.starred } : m
    ));
  }, []);

  // 编辑消息内容
  const editMessage = useCallback((messageId: string, newContent: string) => {
    setMessages(prev => prev.map(m => 
      m.id === messageId ? { ...m, content: newContent } : m
    ));
  }, []);

  // 获取收藏的消息
  const starredMessages = useMemo(() => 
    messages.filter(m => m.starred), 
    [messages]
  );

  return {
    messages,
    isLoading,
    memorySummary,
    isSummarizing,
    sendMessage,
    clearMessages,
    deleteMessages,
    undoDelete,
    toggleStarMessage,
    editMessage,
    starredMessages,
    clearMemory,
    updateMemorySummary,
  };
}

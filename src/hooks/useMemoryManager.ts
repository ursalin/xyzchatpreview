import { useState, useCallback, useEffect } from 'react';
import { Message } from '@/types/chat';

const MEMORY_SUMMARY_KEY = 'ai-companion-memory-summary';
const RECENT_MESSAGE_LIMIT = 20; // 保留最近 20 条完整消息
const SUMMARIZE_THRESHOLD = 30; // 超过 30 条时触发总结

interface MemorySummary {
  content: string;
  summarizedCount: number;
  lastSummarizedAt: Date;
}

// 加载记忆摘要
function loadMemorySummary(): MemorySummary | null {
  try {
    const stored = localStorage.getItem(MEMORY_SUMMARY_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...parsed,
        lastSummarizedAt: new Date(parsed.lastSummarizedAt),
      };
    }
  } catch (e) {
    console.error('Failed to load memory summary:', e);
  }
  return null;
}

// 保存记忆摘要
function saveMemorySummary(summary: MemorySummary) {
  try {
    localStorage.setItem(MEMORY_SUMMARY_KEY, JSON.stringify(summary));
  } catch (e) {
    console.error('Failed to save memory summary:', e);
  }
}

export function useMemoryManager() {
  const [memorySummary, setMemorySummary] = useState<MemorySummary | null>(
    () => loadMemorySummary()
  );
  const [isSummarizing, setIsSummarizing] = useState(false);

  // 保存记忆摘要到 localStorage
  useEffect(() => {
    if (memorySummary) {
      saveMemorySummary(memorySummary);
    }
  }, [memorySummary]);

  // 生成对话摘要
  const summarizeMessages = useCallback(
    async (
      messages: Message[],
      apiEndpoint: string,
      apiKey: string
    ): Promise<string> => {
      setIsSummarizing(true);

      try {
        // 构建要总结的对话文本
        const conversationText = messages
          .map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`)
          .join('\n');

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vision-chat`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({
              messages: [
                {
                  role: 'user',
                  content: `请将以下对话提炼成角色记忆笔记。

要求：
1. 记录你对用户的认知（性格、喜好、习惯、称呼）
2. 记录重要事项（用户提到的计划、承诺、心情）
3. 记录你们关系的进展（亲密度、默契、共同话题）
4. 不要复述对话流水账，只提炼关键认知
5. 用第一人称（"我"）书写，像写日记一样
6. 信息量多就多写，少就少写，不要硬凑也不要遗漏

对话内容：
${conversationText}`,
                },
              ],
              systemPrompt:
                '你是一个角色的记忆系统。用精炼的语言记录对用户的认知和重要事项，像写私人日记一样。不要列举对话，只记住重要的东西。',
            }),
          }
        );

        if (!response.ok) {
          throw new Error('Summarization failed');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('无法读取响应');

        const decoder = new TextDecoder();
        let summary = '';
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
              const deltaContent = parsed.choices?.[0]?.delta?.content as
                | string
                | undefined;
              if (deltaContent) {
                summary += deltaContent;
              }
            } catch {
              textBuffer = line + '\n' + textBuffer;
              break;
            }
          }
        }

        return summary.trim();
      } catch (error) {
        console.error('Failed to summarize messages:', error);
        // 失败时返回简单的文本摘要
        return `对话包含 ${messages.length} 条消息，涉及用户与AI的交流。`;
      } finally {
        setIsSummarizing(false);
      }
    },
    []
  );

  // 检查是否需要总结并执行
  const checkAndSummarize = useCallback(
    async (
      messages: Message[],
      apiEndpoint: string,
      apiKey: string
    ): Promise<{ recentMessages: Message[]; needsSummary: boolean }> => {
      if (messages.length <= SUMMARIZE_THRESHOLD) {
        return { recentMessages: messages, needsSummary: false };
      }

      // 分离旧消息和最近消息
      const oldMessages = messages.slice(0, -RECENT_MESSAGE_LIMIT);
      const recentMessages = messages.slice(-RECENT_MESSAGE_LIMIT);

      // 如果已有摘要，合并旧消息到摘要中
      let summaryText = memorySummary?.content || '';

      if (oldMessages.length > 0) {
        const newSummary = await summarizeMessages(
          oldMessages,
          apiEndpoint,
          apiKey
        );

        // 合并新旧记忆
        if (summaryText) {
          // 调用 API 合并精炼（去重，但保留所有重要信息）
          const refinedSummary = await summarizeMessages(
            [{
              id: 'merge',
              role: 'user' as const,
              content: `请将以下新旧记忆合并成一份完整的记忆笔记。

要求：
1. 去掉重复的内容
2. 保留所有重要的认知和事项
3. 按主题整理（对用户的认知、重要事项、关系进展等）
4. 用第一人称书写
5. 信息可以多，但不要啰嗦

旧记忆：
${summaryText}

新记忆：
${newSummary}`,
              timestamp: new Date(),
            }],
            apiEndpoint,
            apiKey
          );
          summaryText = refinedSummary;
        } else {
          summaryText = newSummary;
        }

        setMemorySummary({
          content: summaryText,
          summarizedCount:
            (memorySummary?.summarizedCount || 0) + oldMessages.length,
          lastSummarizedAt: new Date(),
        });
      }

      return { recentMessages, needsSummary: true };
    },
    [memorySummary, summarizeMessages]
  );

  // 构建发送给 API 的消息（包含摘要 + 最近消息）
  const buildContextMessages = useCallback(
    (messages: Message[]): Array<{ role: string; content: string }> => {
      const contextMessages: Array<{ role: string; content: string }> = [];

      // 如果有记忆摘要，作为系统消息添加
      if (memorySummary?.content) {
        contextMessages.push({
          role: 'user',
          content: `[历史记忆摘要]\n${memorySummary.content}\n\n[以下是最近的对话]`,
        });
        contextMessages.push({
          role: 'assistant',
          content: '好的，我记住了之前的对话内容。',
        });
      }

      // 添加最近的消息
      const recentMessages = messages.slice(-RECENT_MESSAGE_LIMIT);
      contextMessages.push(
        ...recentMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }))
      );

      return contextMessages;
    },
    [memorySummary]
  );

  // 清空记忆
  const clearMemory = useCallback(() => {
    setMemorySummary(null);
    try {
      localStorage.removeItem(MEMORY_SUMMARY_KEY);
    } catch (e) {
      console.error('Failed to clear memory:', e);
    }
  }, []);

  // 手动更新记忆摘要
  const updateMemorySummary = useCallback((content: string) => {
    setMemorySummary({
      content,
      summarizedCount: 0,
      lastSummarizedAt: new Date(),
    });
  }, []);

  return {
    memorySummary,
    isSummarizing,
    checkAndSummarize,
    buildContextMessages,
    clearMemory,
    updateMemorySummary,
  };
}

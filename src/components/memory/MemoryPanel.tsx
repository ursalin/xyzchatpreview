import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Trash2, Save, Brain, Loader2, CheckSquare, Square } from 'lucide-react';
import { Message } from '@/types/chat';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

interface MemoryPanelProps {
  messages: Message[];
  memorySummary: {
    content: string;
    summarizedCount: number;
    lastSummarizedAt: Date;
  } | null;
  isSummarizing: boolean;
  onClearMemory: () => void;
  onUpdateMemory: (content: string) => void;
  onClearMessages: () => void;
  onDeleteMessages?: (messageIds: string[]) => void;
}

const MemoryPanel: React.FC<MemoryPanelProps> = ({
  messages,
  memorySummary,
  isSummarizing,
  onClearMemory,
  onUpdateMemory,
  onClearMessages,
  onDeleteMessages,
}) => {
  const [editingMemory, setEditingMemory] = React.useState(false);
  const [memoryText, setMemoryText] = React.useState(memorySummary?.content || '');
  const [selectedMessages, setSelectedMessages] = React.useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = React.useState(false);

  React.useEffect(() => {
    setMemoryText(memorySummary?.content || '');
  }, [memorySummary]);

  const handleSaveMemory = () => {
    onUpdateMemory(memoryText);
    setEditingMemory(false);
  };

  const toggleMessageSelection = (messageId: string) => {
    const newSelection = new Set(selectedMessages);
    if (newSelection.has(messageId)) {
      newSelection.delete(messageId);
    } else {
      newSelection.add(messageId);
    }
    setSelectedMessages(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedMessages.size === messages.length) {
      setSelectedMessages(new Set());
    } else {
      setSelectedMessages(new Set(messages.map(m => m.id)));
    }
  };

  const handleDeleteSelected = () => {
    if (onDeleteMessages && selectedMessages.size > 0) {
      onDeleteMessages(Array.from(selectedMessages));
      setSelectedMessages(new Set());
      setIsSelectionMode(false);
    }
  };

  const handleCancelSelection = () => {
    setSelectedMessages(new Set());
    setIsSelectionMode(false);
  };

  return (
    <div className="flex flex-col h-full gap-4 p-4">
      {/* 记忆摘要卡片 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary" />
              <CardTitle>记忆摘要</CardTitle>
            </div>
            <div className="flex gap-2">
              {!editingMemory && memorySummary && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingMemory(true)}
                >
                  编辑
                </Button>
              )}
              {memorySummary && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onClearMemory}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
          {memorySummary && (
            <CardDescription>
              已总结 {memorySummary.summarizedCount} 条对话 •{' '}
              {formatDistanceToNow(memorySummary.lastSummarizedAt, {
                addSuffix: true,
                locale: zhCN,
              })}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {isSummarizing ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              正在生成记忆摘要...
            </div>
          ) : memorySummary || editingMemory ? (
            editingMemory ? (
              <div className="space-y-2">
                <Textarea
                  value={memoryText}
                  onChange={(e) => setMemoryText(e.target.value)}
                  placeholder="编辑记忆摘要..."
                  className="min-h-[200px]"
                />
                <div className="flex gap-2">
                  <Button onClick={handleSaveMemory} size="sm">
                    <Save className="w-4 h-4 mr-2" />
                    保存
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingMemory(false);
                      setMemoryText(memorySummary?.content || '');
                    }}
                    size="sm"
                  >
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              <ScrollArea className="h-[200px]">
                <p className="text-sm whitespace-pre-wrap">{memorySummary?.content}</p>
              </ScrollArea>
            )
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Brain className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>暂无记忆摘要</p>
              <p className="text-xs mt-1">
                当对话超过 30 条时会自动生成摘要
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 聊天记录卡片 */}
      <Card className="flex-1 min-h-0">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>聊天记录</CardTitle>
              <CardDescription>
                共 {messages.length} 条消息 • 最近 20 条会完整发送给 AI
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {!isSelectionMode && messages.length > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsSelectionMode(true)}
                  >
                    <CheckSquare className="w-4 h-4 mr-2" />
                    选择
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={onClearMessages}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    清空全部
                  </Button>
                </>
              )}
              {isSelectionMode && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleSelectAll}
                  >
                    {selectedMessages.size === messages.length ? (
                      <>
                        <Square className="w-4 h-4 mr-2" />
                        取消全选
                      </>
                    ) : (
                      <>
                        <CheckSquare className="w-4 h-4 mr-2" />
                        全选
                      </>
                    )}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteSelected}
                    disabled={selectedMessages.size === 0}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    删除 ({selectedMessages.size})
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelSelection}
                  >
                    取消
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 min-h-0">
          {messages.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>暂无聊天记录</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                {messages.map((message, index) => (
                  <div
                    key={message.id}
                    className={`relative p-3 rounded-lg ${
                      message.role === 'user'
                        ? 'bg-primary/10 ml-8'
                        : 'bg-muted mr-8'
                    } ${
                      selectedMessages.has(message.id)
                        ? 'ring-2 ring-primary'
                        : ''
                    }`}
                    onClick={() => isSelectionMode && toggleMessageSelection(message.id)}
                    style={{ cursor: isSelectionMode ? 'pointer' : 'default' }}
                  >
                    {isSelectionMode && (
                      <div className="absolute top-2 left-2">
                        <Checkbox
                          checked={selectedMessages.has(message.id)}
                          onCheckedChange={() => toggleMessageSelection(message.id)}
                        />
                      </div>
                    )}
                    <div className={`flex items-center justify-between mb-1 ${isSelectionMode ? 'ml-6' : ''}`}>
                      <span className="text-xs font-medium">
                        {message.role === 'user' ? '用户' : 'AI'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        #{index + 1} •{' '}
                        {formatDistanceToNow(message.timestamp, {
                          addSuffix: true,
                          locale: zhCN,
                        })}
                      </span>
                    </div>
                    <p className={`text-sm whitespace-pre-wrap ${isSelectionMode ? 'ml-6' : ''}`}>
                      {message.content}
                    </p>
                    {index < messages.length - 20 && (
                      <div className={`mt-2 text-xs text-amber-600 dark:text-amber-400 ${isSelectionMode ? 'ml-6' : ''}`}>
                        ⚠️ 此消息将被总结为记忆摘要
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default MemoryPanel;

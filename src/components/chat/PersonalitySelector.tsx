import { Personality, defaultPersonalities } from '@/types/chat';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings, Sparkles, Plus } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface PersonalitySelectorProps {
  current: Personality;
  onSelect: (personality: Personality) => void;
}

export function PersonalitySelector({ current, onSelect }: PersonalitySelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');

  const handleSelectPreset = (personality: Personality) => {
    onSelect(personality);
    setIsOpen(false);
  };

  const handleCreateCustom = () => {
    if (customName.trim() && customPrompt.trim()) {
      const custom: Personality = {
        id: `custom-${Date.now()}`,
        name: customName.trim(),
        description: customDescription.trim() || '自定义性格',
        systemPrompt: customPrompt.trim(),
      };
      onSelect(custom);
      setIsCustomOpen(false);
      setIsOpen(false);
      setCustomName('');
      setCustomDescription('');
      setCustomPrompt('');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <Sparkles className="w-4 h-4" />
          <span className="hidden sm:inline">{current.name}</span>
          <Settings className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>选择角色性格</DialogTitle>
          <DialogDescription>
            选择一个预设性格或创建自定义性格
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-4">
          {defaultPersonalities.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelectPreset(p)}
              className={cn(
                'text-left p-4 rounded-xl border transition-all hover:border-primary/50',
                current.id === p.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border'
              )}
            >
              <div className="font-medium">{p.name}</div>
              <div className="text-sm text-muted-foreground mt-1">
                {p.description}
              </div>
            </button>
          ))}

          <Dialog open={isCustomOpen} onOpenChange={setIsCustomOpen}>
            <DialogTrigger asChild>
              <button className="flex items-center justify-center gap-2 p-4 rounded-xl border border-dashed border-border hover:border-primary/50 transition-all text-muted-foreground hover:text-foreground">
                <Plus className="w-4 h-4" />
                创建自定义性格
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>创建自定义性格</DialogTitle>
                <DialogDescription>
                  设定角色的名称和性格描述
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">性格名称</Label>
                  <Input
                    id="name"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="例如：神秘优雅"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="description">简短描述</Label>
                  <Input
                    id="description"
                    value={customDescription}
                    onChange={(e) => setCustomDescription(e.target.value)}
                    placeholder="例如：神秘莫测、优雅从容"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="prompt">性格设定（详细描述）</Label>
                  <Textarea
                    id="prompt"
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="描述这个角色的性格特点、说话方式、行为习惯等..."
                    className="min-h-[100px]"
                  />
                </div>
              </div>
              <Button onClick={handleCreateCustom} disabled={!customName.trim() || !customPrompt.trim()}>
                创建性格
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </DialogContent>
    </Dialog>
  );
}

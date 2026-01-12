import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings, User, Key, Type } from 'lucide-react';
import { AppSettings, defaultSettings, CharacterPreset, ApiConfig } from '@/types/chat';

interface SettingsPanelProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

export function SettingsPanel({ settings, onSettingsChange }: SettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleSave = () => {
    onSettingsChange(localSettings);
    setIsOpen(false);
  };

  const updateCharacter = (updates: Partial<CharacterPreset>) => {
    setLocalSettings(prev => ({
      ...prev,
      character: { ...prev.character, ...updates },
    }));
  };

  const updateApiConfig = (updates: Partial<ApiConfig>) => {
    setLocalSettings(prev => ({
      ...prev,
      apiConfig: { ...prev.apiConfig, ...updates },
    }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Settings className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>
            自定义应用标题、角色预设和API配置
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="general" className="gap-1">
              <Type className="w-3 h-3" />
              <span className="hidden sm:inline">基本</span>
            </TabsTrigger>
            <TabsTrigger value="character" className="gap-1">
              <User className="w-3 h-3" />
              <span className="hidden sm:inline">角色</span>
            </TabsTrigger>
            <TabsTrigger value="api" className="gap-1">
              <Key className="w-3 h-3" />
              <span className="hidden sm:inline">API</span>
            </TabsTrigger>
          </TabsList>

          {/* 基本设置 */}
          <TabsContent value="general" className="space-y-4 mt-4">
            <div className="grid gap-2">
              <Label htmlFor="title">应用标题</Label>
              <Input
                id="title"
                value={localSettings.title}
                onChange={(e) => setLocalSettings(prev => ({ ...prev, title: e.target.value }))}
                placeholder="AI 伴侣"
              />
              <p className="text-xs text-muted-foreground">显示在页面顶部的标题</p>
            </div>
          </TabsContent>

          {/* 角色设置 */}
          <TabsContent value="character" className="space-y-4 mt-4">
            <div className="grid gap-2">
              <Label htmlFor="charName">角色名称</Label>
              <Input
                id="charName"
                value={localSettings.character.name}
                onChange={(e) => updateCharacter({ name: e.target.value })}
                placeholder="小爱"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="persona">人设描述</Label>
              <Textarea
                id="persona"
                value={localSettings.character.persona}
                onChange={(e) => updateCharacter({ persona: e.target.value })}
                placeholder="温柔体贴、善解人意的虚拟伴侣"
                className="min-h-[80px]"
              />
              <p className="text-xs text-muted-foreground">角色的性格特点和身份定位</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="background">背景故事</Label>
              <Textarea
                id="background"
                value={localSettings.character.background}
                onChange={(e) => updateCharacter({ background: e.target.value })}
                placeholder="一个充满爱心和智慧的AI伴侣..."
                className="min-h-[80px]"
              />
              <p className="text-xs text-muted-foreground">角色的背景设定和故事</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="speakingStyle">说话风格</Label>
              <Input
                id="speakingStyle"
                value={localSettings.character.speakingStyle}
                onChange={(e) => updateCharacter({ speakingStyle: e.target.value })}
                placeholder="温暖、亲切、自然"
              />
              <p className="text-xs text-muted-foreground">角色的语言风格和表达方式</p>
            </div>
          </TabsContent>

          {/* API设置 */}
          <TabsContent value="api" className="space-y-4 mt-4">
            <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
              <div className="space-y-0.5">
                <Label>使用自定义API</Label>
                <p className="text-xs text-muted-foreground">
                  启用后将使用您自己的API密钥
                </p>
              </div>
              <Switch
                checked={localSettings.apiConfig.useCustomApi}
                onCheckedChange={(checked) => updateApiConfig({ useCustomApi: checked })}
              />
            </div>

            {localSettings.apiConfig.useCustomApi && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="apiEndpoint">API端点</Label>
                  <Input
                    id="apiEndpoint"
                    value={localSettings.apiConfig.apiEndpoint}
                    onChange={(e) => updateApiConfig({ apiEndpoint: e.target.value })}
                    placeholder="https://api.openai.com/v1/chat/completions"
                  />
                  <p className="text-xs text-muted-foreground">
                    支持OpenAI兼容的API端点
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="apiKey">API密钥</Label>
                  <Input
                    id="apiKey"
                    type="password"
                    value={localSettings.apiConfig.apiKey}
                    onChange={(e) => updateApiConfig({ apiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                  <p className="text-xs text-muted-foreground">
                    您的API密钥将仅保存在本地
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="model">模型名称</Label>
                  <Input
                    id="model"
                    value={localSettings.apiConfig.model}
                    onChange={(e) => updateApiConfig({ model: e.target.value })}
                    placeholder="gpt-4o, claude-3-opus, etc."
                  />
                </div>
              </>
            )}

            {!localSettings.apiConfig.useCustomApi && (
              <div className="rounded-lg bg-muted p-4 text-sm">
                <p className="font-medium mb-1">默认使用 Lovable AI</p>
                <p className="text-muted-foreground">
                  当前使用内置的 Gemini 3 Flash 模型，无需配置。如需使用其他模型，请开启自定义API。
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>
            保存设置
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

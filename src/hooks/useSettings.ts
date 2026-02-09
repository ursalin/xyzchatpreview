import { useState, useEffect, useCallback } from 'react';
import { AppSettings, defaultSettings, defaultVoiceConfig } from '@/types/chat';

const SETTINGS_KEY = 'ai-companion-settings';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // If saved voiceConfig has empty API key, use defaults instead
        const savedVoice = parsed.voiceConfig || {};
        const voiceConfig = savedVoice.minimaxApiKey
          ? { ...defaultVoiceConfig, ...savedVoice }
          : { ...defaultVoiceConfig };
        return { 
          ...defaultSettings, 
          ...parsed,
          voiceConfig,
        };
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
    return defaultSettings;
  });

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  }, [settings]);

  const updateSettings = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings);
  }, []);

  const buildSystemPrompt = useCallback(() => {
    const { character } = settings;
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
    return `你是${character.name}，${character.persona}。

背景故事：${character.background}

说话风格：${character.speakingStyle}

当前时间：${timeStr}

请始终保持角色设定，用中文回复，语气要自然亲切。注意当前时间，根据时间自然地调整对话（比如早上说早安，晚上说晚安等）。`;
  }, [settings]);

  return {
    settings,
    updateSettings,
    buildSystemPrompt,
  };
}

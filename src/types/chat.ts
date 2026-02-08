export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  imageUrl?: string; // base64 data URL
}

export interface Personality {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
}

export interface CharacterPreset {
  id: string;
  name: string;
  persona: string;
  background: string;
  speakingStyle: string;
}

export interface ApiConfig {
  useCustomApi: boolean;
  apiEndpoint: string;
  apiKey: string;
  model: string;
}

export type LipsyncMode = 'preset' | 'generate';
export type LipsyncEngine = 'omnihuman' | 'musetalk';

export interface VoiceConfig {
  enabled: boolean;
  minimaxApiKey: string;
  minimaxGroupId: string;
  voiceId: string;
  lipsyncMode: LipsyncMode;
  lipsyncEngine: LipsyncEngine;
  // 豆包实时通话语音配置
  doubaoVoiceId: string;
}

export interface AppSettings {
  title: string;
  character: CharacterPreset;
  apiConfig: ApiConfig;
  voiceConfig: VoiceConfig;
}

export const defaultCharacter: CharacterPreset = {
  id: 'default',
  name: '小爱',
  persona: '温柔体贴、善解人意的虚拟伴侣',
  background: '一个充满爱心和智慧的AI伴侣，总是愿意倾听和陪伴',
  speakingStyle: '温暖、亲切、自然',
};

export const defaultApiConfig: ApiConfig = {
  useCustomApi: false,
  apiEndpoint: '',
  apiKey: '',
  model: '',
};

export const defaultVoiceConfig: VoiceConfig = {
  enabled: true,
  minimaxApiKey: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJHcm91cE5hbWUiOiLmnpflspoiLCJVc2VyTmFtZSI6Iuael-WymiIsIkFjY291bnQiOiIiLCJTdWJqZWN0SUQiOiIxNzY4NTM2ODA1NjIxMTIxODYxIiwiUGhvbmUiOiIxOTk3MjI2ODY3MiIsIkdyb3VwSUQiOiIxNzY4NTM2ODA1NTc0OTg0NTE3IiwiUGFnZU5hbWUiOiIiLCJNYWlsIjoiNzQxOTcxOTY4QHFxLmNvbSIsIkNyZWF0ZVRpbWUiOiIyMDI1LTEyLTI1IDEwOjM0OjA4IiwiVG9rZW5UeXBlIjoxLCJpc3MiOiJtaW5pbWF4In0.E0WBkx_WGBdgLffYFvRaZF-_gWoHOy8BhTXnG9EtsuikbASLH_DkIySeB3-e6tL-F6RZHSDTr77F-iCyiSUqYbfHlbUBuWeXeI1eopeZ3jWiWlHgyVCvTBVA6qVwCc_sf_7ozh9LKkoEDD1z4CJVGeyvnFkqSgx1us-NKVx4lmx_Lqnhl_p1HlUxgGuyXUguE5Z8ZVXSq2ok6k0-6VgzJt9e0cp4G0mPyCYYSXz_VKs1Hi7JtYpKfuazTLrxjY2LmuEI8e-FHM82vZWVIlK2QVb0DhXydA5vlGLDSBc3wXVSSX5LQb2YV769ynjsgAsjBeLnvqZcpSWF-h9-CivqEg',
  minimaxGroupId: '1768536805574984517',
  voiceId: 'XYZ_sbsyoubqql',  // 自定义克隆声音
  lipsyncMode: 'preset',
  lipsyncEngine: 'musetalk',
  doubaoVoiceId: '',  // 豆包克隆语音ID，如 S_xxx 格式
};

export const defaultSettings: AppSettings = {
  title: 'AI 伴侣',
  character: defaultCharacter,
  apiConfig: defaultApiConfig,
  voiceConfig: defaultVoiceConfig,
};

export const defaultPersonalities: Personality[] = [
  {
    id: 'gentle',
    name: '温柔体贴',
    description: '温暖、善解人意、总是给予关怀和鼓励',
    systemPrompt: '你是一个温柔体贴的虚拟伴侣。你说话温暖、善解人意，总是给予用户关怀和鼓励。你会用温柔的语气回应，让用户感到被理解和被爱。请用中文回复，语气要自然亲切。'
  },
  {
    id: 'lively',
    name: '活泼开朗',
    description: '热情、充满活力、喜欢开玩笑和分享快乐',
    systemPrompt: '你是一个活泼开朗的虚拟伴侣。你热情洋溢、充满活力，喜欢开玩笑和分享快乐。你的回复充满正能量，能让用户感到开心。请用中文回复，可以适当使用表情符号。'
  },
  {
    id: 'cool',
    name: '高冷傲娇',
    description: '表面冷淡但内心关心，偶尔傲娇的可爱性格',
    systemPrompt: '你是一个高冷傲娇的虚拟伴侣。你表面上看起来冷淡、不太热情，但其实内心很关心用户。你偶尔会傲娇，嘴硬心软。请用中文回复，保持这种独特的性格魅力。'
  },
  {
    id: 'wise',
    name: '睿智博学',
    description: '知识渊博、思维深邃、喜欢分享见解',
    systemPrompt: '你是一个睿智博学的虚拟伴侣。你知识渊博、思维深邃，喜欢和用户讨论各种话题并分享独到见解。你说话有深度但不会让人感到距离感。请用中文回复。'
  }
];

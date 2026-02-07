import { useState, useCallback, useRef, useEffect } from 'react';

interface UseWebSpeechSTTOptions {
  language?: string;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
}

export function useWebSpeechSTT({
  language = 'zh-CN',
  onResult,
  onError,
}: UseWebSpeechSTTOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  
  const recognitionRef = useRef<any>(null);
  // 用 ref 存回调，避免 useEffect 因回调变化而反复重建 recognition
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  // 标记是否应该自动重启（continuous 模式下浏览器可能中断）
  const shouldRestartRef = useRef(false);

  // 每次 render 同步最新回调到 ref
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // 只在 language 变化时创建 recognition（不依赖回调）
  useEffect(() => {
    const SpeechRecognition = 
      (window as any).SpeechRecognition || 
      (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setIsSupported(false);
      console.warn('[Web Speech STT] Not supported in this browser');
      return;
    }

    setIsSupported(true);
    
    const recognition = new SpeechRecognition();
    recognition.lang = language;
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      console.log('[Web Speech STT] Started listening');
      setIsListening(true);
      setInterimTranscript('');
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (interim) {
        setInterimTranscript(interim);
        onResultRef.current?.(interim, false);
      }

      if (final) {
        console.log('[Web Speech STT] Final result:', final);
        setInterimTranscript('');
        onResultRef.current?.(final, true);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('[Web Speech STT] Error:', event.error);
      
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        const errorMsg = getErrorMessage(event.error);
        onErrorRef.current?.(errorMsg);
      }
      
      // no-speech 错误不应该停止监听，让 onend 处理自动重启
      if (event.error === 'no-speech') {
        return;
      }
      
      setIsListening(false);
      setInterimTranscript('');
    };

    recognition.onend = () => {
      console.log('[Web Speech STT] Ended, shouldRestart:', shouldRestartRef.current);
      setIsListening(false);
      setInterimTranscript('');
      
      // continuous 模式下浏览器可能会意外中断，自动重启
      if (shouldRestartRef.current) {
        console.log('[Web Speech STT] Auto-restarting...');
        setTimeout(() => {
          try {
            recognition.start();
          } catch (e) {
            console.error('[Web Speech STT] Auto-restart failed:', e);
          }
        }, 300);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      shouldRestartRef.current = false;
      try {
        recognition.stop();
      } catch (e) {
        // Ignore
      }
    };
  }, [language]);

  const startListening = useCallback(() => {
    if (!isSupported) {
      onErrorRef.current?.('你的浏览器不支持语音识别，请使用 Chrome 或 Edge');
      return false;
    }

    if (isListening) {
      console.log('[Web Speech STT] Already listening');
      return false;
    }

    try {
      shouldRestartRef.current = true;
      recognitionRef.current?.start();
      return true;
    } catch (error) {
      console.error('[Web Speech STT] Failed to start:', error);
      onErrorRef.current?.('启动语音识别失败');
      return false;
    }
  }, [isSupported, isListening]);

  const stopListening = useCallback(() => {
    shouldRestartRef.current = false;
    if (!isListening) {
      return;
    }

    try {
      recognitionRef.current?.stop();
    } catch (error) {
      console.error('[Web Speech STT] Failed to stop:', error);
    }
  }, [isListening]);

  const abortListening = useCallback(() => {
    shouldRestartRef.current = false;
    if (!isListening) {
      return;
    }

    try {
      recognitionRef.current?.abort();
      setIsListening(false);
      setInterimTranscript('');
    } catch (error) {
      console.error('[Web Speech STT] Failed to abort:', error);
    }
  }, [isListening]);

  return {
    isSupported,
    isListening,
    interimTranscript,
    startListening,
    stopListening,
    abortListening,
  };
}

function getErrorMessage(error: string): string {
  const errorMessages: Record<string, string> = {
    'no-speech': '没有检测到语音，请重试',
    'audio-capture': '无法访问麦克风',
    'not-allowed': '麦克风权限被拒绝',
    'network': '网络错误',
    'service-not-allowed': '语音识别服务不可用',
    'bad-grammar': '语法错误',
    'language-not-supported': '不支持该语言',
  };

  return errorMessages[error] || `语音识别错误: ${error}`;
}

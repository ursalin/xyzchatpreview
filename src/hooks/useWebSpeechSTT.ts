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

  // 检查浏览器支持
  useEffect(() => {
    const SpeechRecognition = 
      (window as any).SpeechRecognition || 
      (window as any).webkitSpeechRecognition;
    
    if (SpeechRecognition) {
      setIsSupported(true);
      
      const recognition = new SpeechRecognition();
      recognition.lang = language;
      recognition.interimResults = true;
      recognition.continuous = false;
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

        // 更新临时识别结果
        if (interim) {
          setInterimTranscript(interim);
          onResult?.(interim, false);
        }

        // 最终结果
        if (final) {
          console.log('[Web Speech STT] Final result:', final);
          setInterimTranscript('');
          onResult?.(final, true);
        }
      };

      recognition.onerror = (event: any) => {
        console.error('[Web Speech STT] Error:', event.error);
        
        // 忽略某些非关键错误
        if (event.error !== 'aborted' && event.error !== 'no-speech') {
          const errorMsg = getErrorMessage(event.error);
          onError?.(errorMsg);
        }
        
        setIsListening(false);
        setInterimTranscript('');
      };

      recognition.onend = () => {
        console.log('[Web Speech STT] Ended');
        setIsListening(false);
        setInterimTranscript('');
      };

      recognitionRef.current = recognition;
    } else {
      setIsSupported(false);
      console.warn('[Web Speech STT] Not supported in this browser');
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // Ignore
        }
      }
    };
  }, [language, onResult, onError]);

  // 开始识别
  const startListening = useCallback(() => {
    if (!isSupported) {
      onError?.('你的浏览器不支持语音识别，请使用 Chrome 或 Edge');
      return false;
    }

    if (isListening) {
      console.log('[Web Speech STT] Already listening');
      return false;
    }

    try {
      recognitionRef.current?.start();
      return true;
    } catch (error) {
      console.error('[Web Speech STT] Failed to start:', error);
      onError?.('启动语音识别失败');
      return false;
    }
  }, [isSupported, isListening, onError]);

  // 停止识别
  const stopListening = useCallback(() => {
    if (!isListening) {
      return;
    }

    try {
      recognitionRef.current?.stop();
    } catch (error) {
      console.error('[Web Speech STT] Failed to stop:', error);
    }
  }, [isListening]);

  // 中止识别（不触发 onend）
  const abortListening = useCallback(() => {
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

// 错误消息映射
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

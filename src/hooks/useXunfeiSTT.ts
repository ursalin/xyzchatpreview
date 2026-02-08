import { useState, useCallback, useRef, useEffect } from 'react';

interface UseXunfeiSTTOptions {
  language?: string;
  onResult: (transcript: string, isFinal: boolean) => void;
  onError: (error: string) => void;
}

// 讯飞语音识别 WebSocket API
// 文档: https://www.xfyun.cn/doc/asr/voicedictation/API.html
export function useXunfeiSTT({
  language = 'zh_cn',
  onResult,
  onError,
}: UseXunfeiSTTOptions) {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isStoppedRef = useRef(false);

  // 讯飞 API 配置（需要在环境变量中配置）
  const XUNFEI_APP_ID = import.meta.env.VITE_XUNFEI_APP_ID || '';
  const XUNFEI_API_KEY = import.meta.env.VITE_XUNFEI_API_KEY || '';
  const XUNFEI_API_SECRET = import.meta.env.VITE_XUNFEI_API_SECRET || '';

  // 检查是否支持
  const isSupported = !!(
    navigator.mediaDevices?.getUserMedia &&
    XUNFEI_APP_ID &&
    XUNFEI_API_KEY &&
    XUNFEI_API_SECRET
  );

  // 生成讯飞 WebSocket 鉴权 URL
  const getWebSocketUrl = useCallback(() => {
    const host = 'iat-api.xfyun.cn';
    const path = '/v2/iat';
    const date = new Date().toUTCString();
    
    // 生成签名
    const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
    
    // 使用 Web Crypto API 生成 HMAC-SHA256
    const encoder = new TextEncoder();
    const keyData = encoder.encode(XUNFEI_API_SECRET);
    const messageData = encoder.encode(signatureOrigin);
    
    return crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    ).then(key => 
      crypto.subtle.sign('HMAC', key, messageData)
    ).then(signature => {
      const signatureBase64 = btoa(
        String.fromCharCode(...new Uint8Array(signature))
      );
      
      const authorizationOrigin = `api_key="${XUNFEI_API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureBase64}"`;
      const authorization = btoa(authorizationOrigin);
      
      return `wss://${host}${path}?authorization=${authorization}&date=${encodeURIComponent(date)}&host=${host}`;
    });
  }, [XUNFEI_API_KEY, XUNFEI_API_SECRET]);

  // 开始监听
  const startListening = useCallback(async () => {
    if (!isSupported) {
      onError('讯飞语音识别不可用：缺少配置或浏览器不支持');
      return;
    }

    if (isListening) {
      console.log('[Xunfei STT] Already listening');
      return;
    }

    try {
      isStoppedRef.current = false;
      console.log('[Xunfei STT] Starting...');

      // 获取麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });
      streamRef.current = stream;

      // 创建 AudioContext
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      // 连接 WebSocket
      const wsUrl = await getWebSocketUrl();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Xunfei STT] WebSocket connected');
        setIsListening(true);

        // 发送配置参数
        const params = {
          common: {
            app_id: XUNFEI_APP_ID,
          },
          business: {
            language: language,
            domain: 'iat',
            accent: 'mandarin',
            vad_eos: 1000, // 静音检测时长
            dwa: 'wpgs', // 动态修正
          },
          data: {
            status: 0, // 0: 第一帧，1: 中间帧，2: 最后一帧
            format: 'audio/L16;rate=16000',
            encoding: 'raw',
          },
        };

        ws.send(JSON.stringify(params));

        // 开始发送音频数据
        processor.onaudioprocess = (e) => {
          if (isStoppedRef.current || ws.readyState !== WebSocket.OPEN) return;

          const inputData = e.inputBuffer.getChannelData(0);
          const pcmData = new Int16Array(inputData.length);
          
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }

          const audioData = {
            data: {
              status: 1,
              format: 'audio/L16;rate=16000',
              encoding: 'raw',
              audio: btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer))),
            },
          };

          ws.send(JSON.stringify(audioData));
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
      };

      ws.onmessage = (event) => {
        try {
          const result = JSON.parse(event.data);
          
          if (result.code !== 0) {
            console.error('[Xunfei STT] Error:', result.message);
            onError(`识别错误: ${result.message}`);
            return;
          }

          if (result.data?.result) {
            const ws = result.data.result.ws;
            let transcript = '';
            
            ws.forEach((word: any) => {
              word.cw.forEach((char: any) => {
                transcript += char.w;
              });
            });

            const isFinal = result.data.status === 2;
            
            if (transcript) {
              console.log('[Xunfei STT] Result:', transcript, 'isFinal:', isFinal);
              setInterimTranscript(isFinal ? '' : transcript);
              onResult(transcript, isFinal);
            }
          }
        } catch (error) {
          console.error('[Xunfei STT] Parse error:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('[Xunfei STT] WebSocket error:', error);
        onError('语音识别连接失败');
        setIsListening(false);
      };

      ws.onclose = () => {
        console.log('[Xunfei STT] WebSocket closed');
        setIsListening(false);
      };

    } catch (error) {
      console.error('[Xunfei STT] Start error:', error);
      onError(error instanceof Error ? error.message : '启动失败');
      setIsListening(false);
    }
  }, [isSupported, isListening, language, onResult, onError, getWebSocketUrl, XUNFEI_APP_ID]);

  // 停止监听
  const stopListening = useCallback(() => {
    console.log('[Xunfei STT] Stopping...');
    isStoppedRef.current = true;

    // 发送结束帧
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const endFrame = {
        data: {
          status: 2,
          format: 'audio/L16;rate=16000',
          encoding: 'raw',
          audio: '',
        },
      };
      wsRef.current.send(JSON.stringify(endFrame));
      wsRef.current.close();
    }

    // 清理音频资源
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setIsListening(false);
    setInterimTranscript('');
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (isListening) {
        stopListening();
      }
    };
  }, [isListening, stopListening]);

  return {
    isListening,
    isSupported,
    interimTranscript,
    startListening,
    stopListening,
  };
}

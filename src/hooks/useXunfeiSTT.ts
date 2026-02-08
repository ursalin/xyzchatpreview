import { useState, useCallback, useRef, useEffect } from 'react';

interface UseXunfeiSTTOptions {
  language?: string;
  onResult: (transcript: string, isFinal: boolean) => void;
  onError: (error: string) => void;
}

// 讯飞语音识别 WebSocket API — 持续监听模式
// 麦克风一直开着，WebSocket 断开后自动重连
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
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // activeRef: true = 通话中（应持续监听），false = 已停止
  const activeRef = useRef(false);
  // 防止同时多个 WebSocket 连接
  const connectingRef = useRef(false);
  // 动态修正(wpgs)需要按 sn 存储每段结果
  const resultMapRef = useRef<Map<number, string>>(new Map());
  // 回调 ref，避免闭包过期
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // 讯飞 API 配置
  const XUNFEI_APP_ID = import.meta.env.VITE_XUNFEI_APP_ID || '';
  const XUNFEI_API_KEY = import.meta.env.VITE_XUNFEI_API_KEY || '';
  const XUNFEI_API_SECRET = import.meta.env.VITE_XUNFEI_API_SECRET || '';

  const isSupported = !!(
    navigator.mediaDevices?.getUserMedia &&
    XUNFEI_APP_ID &&
    XUNFEI_API_KEY &&
    XUNFEI_API_SECRET
  );

  // 生成讯飞 WebSocket 鉴权 URL
  const getWebSocketUrl = useCallback(async () => {
    const host = 'iat-api.xfyun.cn';
    const path = '/v2/iat';
    const date = new Date().toUTCString();
    
    const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
    
    const encoder = new TextEncoder();
    const keyData = encoder.encode(XUNFEI_API_SECRET);
    const messageData = encoder.encode(signatureOrigin);
    
    const key = await crypto.subtle.importKey(
      'raw', keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, messageData);
    const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
    
    const authorizationOrigin = `api_key="${XUNFEI_API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureBase64}"`;
    const authorization = btoa(authorizationOrigin);
    
    return `wss://${host}${path}?authorization=${authorization}&date=${encodeURIComponent(date)}&host=${host}`;
  }, [XUNFEI_API_KEY, XUNFEI_API_SECRET]);

  // 建立一个新的 WebSocket 连接（内部方法）
  const connectWebSocket = useCallback(async () => {
    if (!activeRef.current || connectingRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    connectingRef.current = true;
    resultMapRef.current.clear();

    try {
      const wsUrl = await getWebSocketUrl();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Xunfei STT] WebSocket connected');
        connectingRef.current = false;
        setIsListening(true);

        // 发送配置参数（第一帧）
        const params = {
          common: { app_id: XUNFEI_APP_ID },
          business: {
            language: language,
            domain: 'iat',
            accent: 'mandarin',
            vad_eos: 3000, // 3秒静音后结束识别
            dwa: 'wpgs',
          },
          data: {
            status: 0,
            format: 'audio/L16;rate=16000',
            encoding: 'raw',
          },
        };
        ws.send(JSON.stringify(params));
      };

      ws.onmessage = (event) => {
        try {
          const result = JSON.parse(event.data);
          
          if (result.code !== 0) {
            console.error('[Xunfei STT] Error:', result.code, result.message);
            onErrorRef.current(`识别错误: ${result.message}`);
            return;
          }

          if (result.data?.result) {
            const data = result.data.result;
            const sn = data.sn;
            const pgs = data.pgs;
            const rg = data.rg;
            
            let segText = '';
            if (data.ws) {
              data.ws.forEach((word: any) => {
                word.cw.forEach((char: any) => {
                  segText += char.w;
                });
              });
            }

            if (pgs === 'rpl' && rg) {
              for (let i = rg[0]; i <= rg[1]; i++) {
                resultMapRef.current.delete(i);
              }
            }
            resultMapRef.current.set(sn, segText);

            const sortedKeys = Array.from(resultMapRef.current.keys()).sort((a, b) => a - b);
            let fullTranscript = '';
            for (const key of sortedKeys) {
              fullTranscript += resultMapRef.current.get(key) || '';
            }

            const isFinal = result.data.status === 2;
            
            if (fullTranscript) {
              console.log('[Xunfei STT] Result:', fullTranscript.substring(0, 50), 'isFinal:', isFinal);
              setInterimTranscript(isFinal ? '' : fullTranscript);
              onResultRef.current(fullTranscript, isFinal);
            }

            if (isFinal) {
              resultMapRef.current.clear();
            }
          }
        } catch (error) {
          console.error('[Xunfei STT] Parse error:', error);
        }
      };

      ws.onerror = () => {
        console.error('[Xunfei STT] WebSocket error');
        connectingRef.current = false;
      };

      ws.onclose = () => {
        console.log('[Xunfei STT] WebSocket closed, active:', activeRef.current);
        connectingRef.current = false;
        wsRef.current = null;
        
        // 如果仍然处于活跃状态，自动重连
        if (activeRef.current) {
          console.log('[Xunfei STT] Auto-reconnecting in 500ms...');
          setTimeout(() => {
            if (activeRef.current) {
              connectWebSocket();
            }
          }, 500);
        } else {
          setIsListening(false);
        }
      };

    } catch (error) {
      console.error('[Xunfei STT] Connect error:', error);
      connectingRef.current = false;
      
      // 重试
      if (activeRef.current) {
        setTimeout(() => {
          if (activeRef.current) connectWebSocket();
        }, 1000);
      }
    }
  }, [getWebSocketUrl, XUNFEI_APP_ID, language]);

  // 音频处理：把麦克风数据发到 WebSocket
  const setupAudioProcessor = useCallback(() => {
    const processor = processorRef.current;
    if (!processor) return;

    processor.onaudioprocess = (e) => {
      const ws = wsRef.current;
      if (!activeRef.current || !ws || ws.readyState !== WebSocket.OPEN) return;

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

      try {
        ws.send(JSON.stringify(audioData));
      } catch {
        // WebSocket 可能已关闭，忽略
      }
    };
  }, []);

  // 开始监听（建立麦克风 + 开始 WebSocket 循环）
  const startListening = useCallback(async () => {
    if (!isSupported) {
      onErrorRef.current('讯飞语音识别不可用：缺少配置或浏览器不支持');
      return;
    }

    if (activeRef.current) {
      console.log('[Xunfei STT] Already active');
      return;
    }

    try {
      activeRef.current = true;
      console.log('[Xunfei STT] Starting continuous listening...');

      // 获取麦克风（只在第一次获取，之后保持）
      if (!streamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            sampleRate: 16000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          } 
        });
        streamRef.current = stream;
      }

      // 创建 AudioContext（只在第一次创建）
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        const audioContext = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = audioContext;

        const source = audioContext.createMediaStreamSource(streamRef.current);
        sourceRef.current = source;
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        source.connect(processor);
        processor.connect(audioContext.destination);
      }

      // 设置音频处理
      setupAudioProcessor();

      // 如果 AudioContext 被暂停了，恢复它
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      // 建立 WebSocket 连接
      await connectWebSocket();

    } catch (error) {
      console.error('[Xunfei STT] Start error:', error);
      activeRef.current = false;
      onErrorRef.current(error instanceof Error ? error.message : '启动失败');
      setIsListening(false);
    }
  }, [isSupported, connectWebSocket, setupAudioProcessor]);

  // 停止监听（完全停止，释放资源）
  const stopListening = useCallback(() => {
    console.log('[Xunfei STT] Stopping...');
    activeRef.current = false;

    // 关闭 WebSocket
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({
          data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' },
        }));
        wsRef.current.close();
      } catch { /* ignore */ }
    }
    wsRef.current = null;

    // 清理音频
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
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
    resultMapRef.current.clear();
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      activeRef.current = false;
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
      }
      if (processorRef.current) processorRef.current.disconnect();
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioContextRef.current) audioContextRef.current.close();
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  return {
    isListening,
    isSupported,
    interimTranscript,
    startListening,
    stopListening,
  };
}

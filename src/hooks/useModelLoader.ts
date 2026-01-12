import { useState, useCallback, useEffect, useRef } from 'react';
import { useGLTF } from '@react-three/drei';

interface UseModelLoaderOptions {
  url: string | null;
  timeout?: number;
  onLoad?: () => void;
  onError?: (error: Error) => void;
}

interface UseModelLoaderReturn {
  progress: number;
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
  retry: () => void;
  model: any | null;
}

// Model cache for faster subsequent loads
const modelCache = new Map<string, any>();

export function useModelLoader({
  url,
  timeout = 60000,
  onLoad,
  onError,
}: UseModelLoaderOptions): UseModelLoaderReturn {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<any | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadModel = useCallback(async () => {
    if (!url) {
      setStatus('idle');
      return;
    }

    // Check cache first
    if (modelCache.has(url)) {
      setModel(modelCache.get(url));
      setProgress(100);
      setStatus('success');
      onLoad?.();
      return;
    }

    setStatus('loading');
    setProgress(0);
    setError(null);

    // Create abort controller for timeout
    abortControllerRef.current = new AbortController();
    
    // Set timeout
    timeoutRef.current = setTimeout(() => {
      abortControllerRef.current?.abort();
      setError('加载超时，请检查网络后重试');
      setStatus('error');
      onError?.(new Error('Load timeout'));
    }, timeout);

    try {
      // Simulate progress updates during fetch
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + Math.random() * 10;
        });
      }, 200);

      // Use XMLHttpRequest for progress tracking
      const xhr = new XMLHttpRequest();
      
      const loadPromise = new Promise<ArrayBuffer>((resolve, reject) => {
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        
        xhr.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentComplete = (event.loaded / event.total) * 90;
            setProgress(percentComplete);
          }
        };
        
        xhr.onload = () => {
          clearInterval(progressInterval);
          if (xhr.status === 200) {
            resolve(xhr.response);
          } else {
            reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
          }
        };
        
        xhr.onerror = () => {
          clearInterval(progressInterval);
          reject(new Error('网络请求失败'));
        };
        
        xhr.send();
      });

      // Listen for abort
      abortControllerRef.current.signal.addEventListener('abort', () => {
        xhr.abort();
      });

      await loadPromise;

      // Clear timeout on success
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Mark as success - the actual GLTF parsing will happen in the component
      setProgress(100);
      setStatus('success');
      onLoad?.();

    } catch (err: any) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      if (err.name !== 'AbortError') {
        setError(err.message || '加载失败');
        setStatus('error');
        onError?.(err);
      }
    }
  }, [url, timeout, onLoad, onError, retryCount]);

  const retry = useCallback(() => {
    setRetryCount((c) => c + 1);
  }, []);

  useEffect(() => {
    loadModel();
    
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      abortControllerRef.current?.abort();
    };
  }, [loadModel]);

  return {
    progress,
    status,
    error,
    retry,
    model,
  };
}

// Preload function for warming cache
export function preloadModel(url: string) {
  if (url) {
    useGLTF.preload(url);
  }
}

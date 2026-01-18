import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import {
  Environment,
  Float,
  MeshDistortMaterial,
  OrbitControls,
  Sphere,
  useProgress,
} from '@react-three/drei';
import * as THREE from 'three';
import { Button } from '@/components/ui/button';
import { CharacterModel } from './CharacterModel';
import { ModelLoader } from './ModelLoader';
import { ErrorBoundary } from '@/components/ErrorBoundary';

interface AvatarMeshProps {
  isSpeaking: boolean;
  mood?: 'happy' | 'neutral' | 'thinking';
}

function AvatarMesh({ isSpeaking, mood = 'neutral' }: AvatarMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const leftEyeRef = useRef<THREE.Mesh>(null);
  const rightEyeRef = useRef<THREE.Mesh>(null);
  const mouthRef = useRef<THREE.Mesh>(null);

  const blinkTimer = useRef(0);
  const isBlinking = useRef(false);
  const speakTimer = useRef(0);

  const colors = useMemo(() => {
    switch (mood) {
      case 'happy':
        return { primary: '#ff6b9d', secondary: '#ffd93d', glow: '#ff9ecd' };
      case 'thinking':
        return { primary: '#6b9dff', secondary: '#9dffd9', glow: '#9eadff' };
      default:
        return { primary: '#a78bfa', secondary: '#c4b5fd', glow: '#ddd6fe' };
    }
  }, [mood]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.1;
    groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.3) * 0.1;

    blinkTimer.current += delta;
    if (blinkTimer.current > 3 + Math.random() * 2) {
      isBlinking.current = true;
      blinkTimer.current = 0;
    }

    if (leftEyeRef.current && rightEyeRef.current) {
      const blinkScale = isBlinking.current ? 0.1 : 1;
      leftEyeRef.current.scale.y = THREE.MathUtils.lerp(leftEyeRef.current.scale.y, blinkScale, 0.3);
      rightEyeRef.current.scale.y = THREE.MathUtils.lerp(rightEyeRef.current.scale.y, blinkScale, 0.3);

      if (isBlinking.current && leftEyeRef.current.scale.y < 0.15) {
        isBlinking.current = false;
      }
    }

    if (mouthRef.current) {
      if (isSpeaking) {
        speakTimer.current += delta * 15;
        const mouthOpen = (Math.sin(speakTimer.current) + 1) * 0.15 + 0.1;
        mouthRef.current.scale.y = mouthOpen;
        mouthRef.current.scale.x = 1 + Math.sin(speakTimer.current * 0.5) * 0.1;
      } else {
        speakTimer.current = 0;
        mouthRef.current.scale.y = THREE.MathUtils.lerp(mouthRef.current.scale.y, 0.15, 0.1);
        mouthRef.current.scale.x = THREE.MathUtils.lerp(mouthRef.current.scale.x, 1, 0.1);
      }
    }
  });

  return (
    <group ref={groupRef}>
      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.3}>
        <Sphere args={[1, 64, 64]}>
          <MeshDistortMaterial
            color={colors.primary}
            attach="material"
            distort={0.3}
            speed={2}
            roughness={0.2}
            metalness={0.1}
          />
        </Sphere>
      </Float>

      <Sphere args={[0.85, 32, 32]}>
        <meshStandardMaterial
          color={colors.glow}
          emissive={colors.secondary}
          emissiveIntensity={0.5}
          transparent
          opacity={0.6}
        />
      </Sphere>

      <mesh ref={leftEyeRef} position={[-0.3, 0.2, 0.85]}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>

      <mesh position={[-0.28, 0.24, 0.95]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.5} />
      </mesh>

      <mesh ref={rightEyeRef} position={[0.3, 0.2, 0.85]}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>

      <mesh position={[0.32, 0.24, 0.95]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.5} />
      </mesh>

      <mesh ref={mouthRef} position={[0, -0.25, 0.9]}>
        <capsuleGeometry args={[0.08, 0.2, 8, 16]} />
        <meshStandardMaterial color="#ff6b9d" />
      </mesh>

      <mesh position={[-0.55, -0.05, 0.7]} rotation={[0, 0.3, 0]}>
        <circleGeometry args={[0.12, 16]} />
        <meshStandardMaterial color="#ff9ecd" transparent opacity={0.6} />
      </mesh>

      <mesh position={[0.55, -0.05, 0.7]} rotation={[0, -0.3, 0]}>
        <circleGeometry args={[0.12, 16]} />
        <meshStandardMaterial color="#ff9ecd" transparent opacity={0.6} />
      </mesh>

      {[...Array(6)].map((_, i) => (
        <Float key={i} speed={3 + i * 0.5} rotationIntensity={0.5} floatIntensity={0.8}>
          <mesh
            position={[
              Math.sin((i * Math.PI) / 3) * 1.5,
              Math.cos((i * Math.PI) / 3) * 0.5,
              Math.cos((i * Math.PI) / 3) * 0.3,
            ]}
          >
            <sphereGeometry args={[0.05 + i * 0.01, 8, 8]} />
            <meshStandardMaterial
              color={colors.secondary}
              emissive={colors.secondary}
              emissiveIntensity={0.8}
              transparent
              opacity={0.8}
            />
          </mesh>
        </Float>
      ))}
    </group>
  );
}

function ProgressBridge({
  onProgress,
  onActive,
  onError,
}: {
  onProgress: (p: number) => void;
  onActive: (a: boolean) => void;
  onError: (msg: string | null) => void;
}) {
  const { active, progress, errors } = useProgress();

  useEffect(() => {
    onProgress(progress);
    onActive(active);
  }, [progress, active, onProgress, onActive]);

  useEffect(() => {
    if (errors && errors.length > 0) {
      const first = errors[0] as any;
      onError(first?.message ? String(first.message) : '模型加载失败');
    }
  }, [errors, onError]);

  return null;
}

interface Avatar3DProps {
  isSpeaking: boolean;
  mood?: 'happy' | 'neutral' | 'thinking';
  className?: string;
  modelUrl?: string | null;
}

export function Avatar3D({ isSpeaking, mood = 'neutral', className = '', modelUrl }: Avatar3DProps) {
  // 为了避免大模型导致浏览器/显卡崩溃：默认不自动加载外部GLB，必须手动确认。
  const [enableExternalModel, setEnableExternalModel] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const deviceMemory = typeof navigator !== 'undefined' ? (navigator as any).deviceMemory : undefined;
  const isLowMemoryDevice = typeof deviceMemory === 'number' && deviceMemory > 0 && deviceMemory < 4;

  const canOfferExternalModel = Boolean(modelUrl) && !isLowMemoryDevice;
  const shouldRenderExternalModel = Boolean(modelUrl) && enableExternalModel && !isLowMemoryDevice;

  useEffect(() => {
    // modelUrl变化时：重置外部加载状态，避免自动再次触发大文件解析
    setEnableExternalModel(false);
    setModelLoaded(false);
    setLoadAttempt(0);
    setProgress(0);
    setActive(false);
    setLoadError(null);
  }, [modelUrl]);

  const handleModelLoaded = useCallback(() => {
    setModelLoaded(true);
    setLoadError(null);
  }, []);

  const handleRetry = useCallback(() => {
    setLoadError(null);
    setModelLoaded(false);
    setProgress(0);
    setEnableExternalModel(true);
    setLoadAttempt((a) => a + 1);
  }, []);

  const showLoaderOverlay = shouldRenderExternalModel && (active || (!modelLoaded && progress > 0) || loadError);

  return (
    <div className={`w-full h-full ${className} relative`}>
      {modelUrl && !enableExternalModel && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
          <div className="max-w-[320px] w-full rounded-2xl border border-border/50 bg-background/80 backdrop-blur-sm shadow-lg p-4 text-center">
            <p className="text-sm font-medium text-foreground">已检测到外部3D模型</p>
            <p className="mt-1 text-xs text-muted-foreground">
              文件约 27MB，为防止大文件导致闪退，默认使用内置头像。确认电脑性能/网络允许后再手动加载。
            </p>
            {isLowMemoryDevice && (
              <p className="mt-2 text-xs text-destructive">
                当前设备内存较小（deviceMemory&lt;4GB），已自动禁用外部模型加载。
              </p>
            )}
            <div className="mt-4 flex gap-2 justify-center">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEnableExternalModel(false)}
              >
                继续用默认头像
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={!canOfferExternalModel}
                onClick={() => setEnableExternalModel(true)}
              >
                手动加载3D
              </Button>
            </div>
          </div>
        </div>
      )}

      {showLoaderOverlay && (
        <div className="absolute inset-0 z-30">
          <ModelLoader
            progress={loadError ? progress : Math.max(1, progress)}
            status={loadError ? 'error' : 'loading'}
            error={loadError || undefined}
            onRetry={handleRetry}
          />
        </div>
      )}

      <ErrorBoundary>
        <Canvas
          camera={{ position: [0, 0.5, 3.5], fov: 50 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          style={{ background: 'transparent' }}
        >
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} intensity={1} />
          <pointLight position={[-10, -10, -10]} intensity={0.5} color="#a78bfa" />
          <spotLight
            position={[0, 5, 5]}
            angle={0.3}
            penumbra={1}
            intensity={1}
            castShadow
          />

          {shouldRenderExternalModel ? (
            <>
              <ProgressBridge onProgress={setProgress} onActive={setActive} onError={setLoadError} />
              <Suspense fallback={null}>
                <CharacterModel
                  key={`${modelUrl}-${loadAttempt}`}
                  url={modelUrl!}
                  isSpeaking={isSpeaking}
                  mood={mood}
                  onLoaded={handleModelLoaded}
                />
              </Suspense>
            </>
          ) : (
            <AvatarMesh isSpeaking={isSpeaking} mood={mood} />
          )}

          <OrbitControls
            enableZoom={false}
            enablePan={false}
            minPolarAngle={Math.PI / 3}
            maxPolarAngle={Math.PI / 1.5}
            minAzimuthAngle={-Math.PI / 4}
            maxAzimuthAngle={Math.PI / 4}
          />

          <Environment preset="sunset" />
        </Canvas>
      </ErrorBoundary>
    </div>
  );
}

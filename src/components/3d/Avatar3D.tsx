import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, Float, Sphere, MeshDistortMaterial } from '@react-three/drei';
import * as THREE from 'three';

interface AvatarMeshProps {
  isSpeaking: boolean;
  mood?: 'happy' | 'neutral' | 'thinking';
}

function AvatarMesh({ isSpeaking, mood = 'neutral' }: AvatarMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const leftEyeRef = useRef<THREE.Mesh>(null);
  const rightEyeRef = useRef<THREE.Mesh>(null);
  const mouthRef = useRef<THREE.Mesh>(null);
  
  // Blinking animation
  const blinkTimer = useRef(0);
  const isBlinking = useRef(false);
  
  // Speaking animation
  const speakTimer = useRef(0);

  // Colors based on mood
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
    
    // Gentle floating motion
    groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.1;
    groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.3) * 0.1;
    
    // Blinking
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
    
    // Speaking animation
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
      {/* Main head/body sphere with distortion */}
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
      
      {/* Inner glow sphere */}
      <Sphere args={[0.85, 32, 32]}>
        <meshStandardMaterial
          color={colors.glow}
          emissive={colors.secondary}
          emissiveIntensity={0.5}
          transparent
          opacity={0.6}
        />
      </Sphere>
      
      {/* Left eye */}
      <mesh ref={leftEyeRef} position={[-0.3, 0.2, 0.85]}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>
      
      {/* Left eye highlight */}
      <mesh position={[-0.28, 0.24, 0.95]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.5} />
      </mesh>
      
      {/* Right eye */}
      <mesh ref={rightEyeRef} position={[0.3, 0.2, 0.85]}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>
      
      {/* Right eye highlight */}
      <mesh position={[0.32, 0.24, 0.95]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.5} />
      </mesh>
      
      {/* Mouth */}
      <mesh ref={mouthRef} position={[0, -0.25, 0.9]}>
        <capsuleGeometry args={[0.08, 0.2, 8, 16]} />
        <meshStandardMaterial color="#ff6b9d" />
      </mesh>
      
      {/* Blush left */}
      <mesh position={[-0.55, -0.05, 0.7]} rotation={[0, 0.3, 0]}>
        <circleGeometry args={[0.12, 16]} />
        <meshStandardMaterial color="#ff9ecd" transparent opacity={0.6} />
      </mesh>
      
      {/* Blush right */}
      <mesh position={[0.55, -0.05, 0.7]} rotation={[0, -0.3, 0]}>
        <circleGeometry args={[0.12, 16]} />
        <meshStandardMaterial color="#ff9ecd" transparent opacity={0.6} />
      </mesh>
      
      {/* Decorative floating particles */}
      {[...Array(6)].map((_, i) => (
        <Float key={i} speed={3 + i * 0.5} rotationIntensity={0.5} floatIntensity={0.8}>
          <mesh 
            position={[
              Math.sin(i * Math.PI / 3) * 1.5,
              Math.cos(i * Math.PI / 3) * 0.5,
              Math.cos(i * Math.PI / 3) * 0.3
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

interface Avatar3DProps {
  isSpeaking: boolean;
  mood?: 'happy' | 'neutral' | 'thinking';
  className?: string;
}

export function Avatar3D({ isSpeaking, mood = 'neutral', className = '' }: Avatar3DProps) {
  return (
    <div className={`w-full h-full ${className}`}>
      <Canvas
        camera={{ position: [0, 0, 4], fov: 45 }}
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
        
        <AvatarMesh isSpeaking={isSpeaking} mood={mood} />
        
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
    </div>
  );
}

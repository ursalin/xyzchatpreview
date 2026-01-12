import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';

interface CharacterModelProps {
  url: string;
  isSpeaking: boolean;
  mood?: 'happy' | 'neutral' | 'thinking';
  onLoaded?: () => void;
}

export function CharacterModel({ url, isSpeaking, mood = 'neutral', onLoaded }: CharacterModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(url);
  const { actions, mixer } = useAnimations(animations, groupRef);
  
  // Speaking animation timer
  const speakTimer = useRef(0);
  
  // Clone the scene to avoid sharing issues
  const clonedScene = useMemo(() => scene.clone(), [scene]);

  // Notify when model is loaded
  useEffect(() => {
    onLoaded?.();
  }, [onLoaded]);

  // Handle animations
  useEffect(() => {
    if (!actions) return;

    // Try to find and play idle animation
    const idleAnimation = actions['idle'] || actions['Idle'] || Object.values(actions)[0];
    if (idleAnimation) {
      idleAnimation.reset().fadeIn(0.5).play();
    }

    return () => {
      Object.values(actions).forEach((action) => {
        action?.fadeOut(0.5);
      });
    };
  }, [actions]);

  // Handle speaking animation
  useEffect(() => {
    if (!actions) return;

    const speakAnimation = actions['speak'] || actions['Speak'] || actions['talk'] || actions['Talk'];
    
    if (speakAnimation) {
      if (isSpeaking) {
        speakAnimation.reset().fadeIn(0.3).play();
      } else {
        speakAnimation.fadeOut(0.3);
      }
    }
  }, [isSpeaking, actions]);

  // Breathing and subtle movements
  useFrame((state, delta) => {
    if (!groupRef.current) return;

    // Gentle breathing motion
    const breathe = Math.sin(state.clock.elapsedTime * 0.8) * 0.02;
    groupRef.current.position.y = breathe;

    // Subtle head movement when speaking
    if (isSpeaking) {
      speakTimer.current += delta;
      groupRef.current.rotation.y = Math.sin(speakTimer.current * 2) * 0.05;
      groupRef.current.rotation.x = Math.sin(speakTimer.current * 3) * 0.02;
    } else {
      speakTimer.current = 0;
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, 0, 0.1);
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, 0, 0.1);
    }

    // Update animation mixer
    if (mixer) {
      mixer.update(delta);
    }
  });

  return (
    <group ref={groupRef} dispose={null}>
      <primitive 
        object={clonedScene} 
        scale={1}
        position={[0, -1, 0]}
      />
    </group>
  );
}

// Preload function
CharacterModel.preload = (url: string) => {
  useGLTF.preload(url);
};

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

  // Auto-calculate bounding box, center and scale the model
  const { scale, position } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(clonedScene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    
    // Target size for the model (height ~2 units)
    const targetHeight = 2;
    const maxDim = Math.max(size.x, size.y, size.z);
    const autoScale = maxDim > 0 ? targetHeight / maxDim : 1;
    
    // Center the model and place it on ground
    const autoPosition = new THREE.Vector3(
      -center.x * autoScale,
      -box.min.y * autoScale, // Place on ground (y=0)
      -center.z * autoScale
    );
    
    console.log('[CharacterModel] 模型信息:', {
      原始尺寸: { x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2) },
      自动缩放: autoScale.toFixed(4),
      位置偏移: { x: autoPosition.x.toFixed(2), y: autoPosition.y.toFixed(2), z: autoPosition.z.toFixed(2) }
    });
    
    return { scale: autoScale, position: autoPosition };
  }, [clonedScene]);

  // Debug materials and textures
  useEffect(() => {
    console.log('[CharacterModel] 开始分析材质和贴图...');
    let materialCount = 0;
    let textureCount = 0;
    let missingTextureCount = 0;
    
    clonedScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        
        materials.forEach((mat) => {
          if (mat) {
            materialCount++;
            const material = mat as THREE.MeshStandardMaterial;
            
            // Check various texture maps
            const textureTypes = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const;
            
            textureTypes.forEach((texType) => {
              const texture = material[texType];
              if (texture) {
                textureCount++;
                console.log(`[CharacterModel] ✓ ${mesh.name || '未命名网格'} - ${texType}: 已加载`);
              }
            });
            
            // Check for missing textures on standard materials
            if (material.isMeshStandardMaterial && !material.map) {
              missingTextureCount++;
              console.log(`[CharacterModel] ⚠ ${mesh.name || '未命名网格'} - 无基础贴图，使用颜色:`, material.color?.getHexString());
            }
          }
        });
      }
    });
    
    console.log('[CharacterModel] 材质分析完成:', {
      材质数量: materialCount,
      贴图数量: textureCount,
      缺失贴图: missingTextureCount
    });
  }, [clonedScene]);

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
    groupRef.current.position.y = position.y + breathe;

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
        scale={scale}
        position={[position.x, position.y, position.z]}
      />
    </group>
  );
}

// Preload function
CharacterModel.preload = (url: string) => {
  useGLTF.preload(url);
};

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
  
  // Animation timer
  const speakTimer = useRef(0);
  
  // Clone the scene to avoid sharing issues
  const clonedScene = useMemo(() => scene.clone(), [scene]);

  // 计算模型居中和缩放 - 不修改任何骨骼！
  const { scale, position } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(clonedScene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    
    // 目标高度约2单位
    const targetHeight = 2;
    const autoScale = size.y > 0 ? targetHeight / size.y : 1;
    
    // 居中模型
    const autoPosition = new THREE.Vector3(
      -center.x * autoScale,
      -center.y * autoScale, // 完全居中
      -center.z * autoScale
    );
    
    console.log('[CharacterModel] 模型信息:', {
      原始尺寸: { x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2) },
      自动缩放: autoScale.toFixed(4),
      位置偏移: { x: autoPosition.x.toFixed(2), y: autoPosition.y.toFixed(2), z: autoPosition.z.toFixed(2) }
    });
    
    return { scale: autoScale, position: autoPosition };
  }, [clonedScene]);

  // Debug materials
  useEffect(() => {
    console.log('[CharacterModel] 开始分析材质和贴图...');
    let materialCount = 0;
    let textureCount = 0;
    
    clonedScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        
        materials.forEach((mat) => {
          if (mat) {
            materialCount++;
            const material = mat as THREE.MeshStandardMaterial;
            
            const textureTypes = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const;
            textureTypes.forEach((texType) => {
              const texture = material[texType];
              if (texture) {
                textureCount++;
                console.log(`[CharacterModel] ✓ ${mesh.name || '未命名'} - ${texType}: 已加载`);
              }
            });
            
            if (material.isMeshStandardMaterial && !material.map) {
              console.log(`[CharacterModel] ⚠ ${mesh.name || '未命名'} - 无基础贴图，颜色:`, material.color?.getHexString());
            }
          }
        });
      }
    });
    
    console.log('[CharacterModel] 材质分析完成:', { 材质数量: materialCount, 贴图数量: textureCount });
  }, [clonedScene]);

  // Notify when loaded
  useEffect(() => {
    onLoaded?.();
  }, [onLoaded]);

  // Play animations if available
  useEffect(() => {
    if (!actions) return;
    console.log('[CharacterModel] 可用动画:', Object.keys(actions));
    
    const idleAnimation = actions['idle'] || actions['Idle'] || actions['Breathing'] || Object.values(actions)[0];
    if (idleAnimation) {
      idleAnimation.reset().fadeIn(0.5).play();
    }

    return () => {
      Object.values(actions).forEach((action) => action?.fadeOut(0.5));
    };
  }, [actions]);

  // 简单的呼吸和说话动画 - 只移动整体group，不动骨骼
  useFrame((state, delta) => {
    if (!groupRef.current) return;
    
    // 轻微呼吸浮动
    const breathe = Math.sin(state.clock.elapsedTime * 1.2) * 0.01;
    groupRef.current.position.y = position.y + breathe;

    // 说话时轻微晃动
    if (isSpeaking) {
      speakTimer.current += delta;
      groupRef.current.rotation.y = Math.sin(speakTimer.current * 2) * 0.03;
    } else {
      speakTimer.current = 0;
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, 0, 0.1);
    }

    if (mixer) mixer.update(delta);
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

CharacterModel.preload = (url: string) => {
  useGLTF.preload(url);
};

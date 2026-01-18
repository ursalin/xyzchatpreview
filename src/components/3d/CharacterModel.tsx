import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';

interface CharacterModelProps {
  url: string;
  isSpeaking: boolean;
  mood?: 'happy' | 'neutral' | 'thinking';
  onLoaded?: () => void;
}

// 查找骨骼的辅助函数（支持模糊匹配）
function findBoneByKeywords(skeleton: THREE.Skeleton | undefined, keywords: string[]): THREE.Bone | null {
  if (!skeleton) return null;
  for (const keyword of keywords) {
    const bone = skeleton.bones.find(b => 
      b.name.toLowerCase().includes(keyword.toLowerCase())
    );
    if (bone) return bone;
  }
  return null;
}

export function CharacterModel({ url, isSpeaking, mood = 'neutral', onLoaded }: CharacterModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(url);
  const { actions, mixer } = useAnimations(animations, groupRef);
  
  // Animation timer
  const speakTimer = useRef(0);
  const armsPoseApplied = useRef(false);
  
  // 骨骼引用
  const bonesRef = useRef<{
    leftArm: THREE.Bone | null;
    rightArm: THREE.Bone | null;
    leftForeArm: THREE.Bone | null;
    rightForeArm: THREE.Bone | null;
  }>({ leftArm: null, rightArm: null, leftForeArm: null, rightForeArm: null });
  
  // ✅ 正确克隆带骨骼/蒙皮的模型
  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene]);

  // 计算模型居中和缩放
  const { scale, position } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(clonedScene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    
    // 半身构图：目标高度约3单位（放大）
    const targetHeight = 3;
    const autoScale = size.y > 0 ? targetHeight / size.y : 1;
    
    // 位置：略微下移让画面聚焦在上半身
    const autoPosition = new THREE.Vector3(
      -center.x * autoScale,
      (-center.y * autoScale) - 0.8, // 下移，让腰部以上为主
      -center.z * autoScale
    );
    
    console.log('[CharacterModel] 模型信息:', {
      原始尺寸: { x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2) },
      自动缩放: autoScale.toFixed(4),
      位置偏移: { x: autoPosition.x.toFixed(2), y: autoPosition.y.toFixed(2), z: autoPosition.z.toFixed(2) }
    });
    
    return { scale: autoScale, position: autoPosition };
  }, [clonedScene]);

  // 查找骨骼并放下手臂
  useEffect(() => {
    let skeleton: THREE.Skeleton | null = null;
    
    clonedScene.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
        const skinnedMesh = child as THREE.SkinnedMesh;
        if (skinnedMesh.skeleton && !skeleton) {
          skeleton = skinnedMesh.skeleton;
          
          // 打印所有骨骼名称用于调试
          console.log('[CharacterModel] 骨骼列表:', skeleton.bones.map(b => b.name).slice(0, 50), '...');
          
          // 查找手臂骨骼（适配多种命名规范）
          bonesRef.current = {
            leftArm: findBoneByKeywords(skeleton, ['L_Arm', 'Arm_L', 'LeftArm', 'Left_Arm', 'arm.l', 'L_UpperArm', 'UpperArm_L']),
            rightArm: findBoneByKeywords(skeleton, ['R_Arm', 'Arm_R', 'RightArm', 'Right_Arm', 'arm.r', 'R_UpperArm', 'UpperArm_R']),
            leftForeArm: findBoneByKeywords(skeleton, ['L_ForeArm', 'ForeArm_L', 'LeftForeArm', 'forearm.l', 'L_LowerArm']),
            rightForeArm: findBoneByKeywords(skeleton, ['R_ForeArm', 'ForeArm_R', 'RightForeArm', 'forearm.r', 'R_LowerArm']),
          };
          
          console.log('[CharacterModel] 找到手臂骨骼:', {
            leftArm: bonesRef.current.leftArm?.name || '未找到',
            rightArm: bonesRef.current.rightArm?.name || '未找到',
            leftForeArm: bonesRef.current.leftForeArm?.name || '未找到',
            rightForeArm: bonesRef.current.rightForeArm?.name || '未找到',
          });
        }
      }
    });
  }, [clonedScene]);

  // Debug materials
  useEffect(() => {
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
            ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach((texType) => {
              if ((material as any)[texType]) textureCount++;
            });
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

  // 动画循环
  useFrame((state, delta) => {
    if (!groupRef.current) return;
    
    const bones = bonesRef.current;
    
    // 放下手臂（只执行一次）
    if (!armsPoseApplied.current) {
      if (bones.leftArm) {
        // 左臂向下旋转（绕Z轴正方向 ~75度）
        bones.leftArm.rotation.z = Math.PI * 0.42;
        bones.leftArm.rotation.x = 0.05;
      }
      if (bones.leftForeArm) {
        bones.leftForeArm.rotation.z = 0.15;
      }
      if (bones.rightArm) {
        // 右臂向下旋转（绕Z轴负方向）
        bones.rightArm.rotation.z = -Math.PI * 0.42;
        bones.rightArm.rotation.x = 0.05;
      }
      if (bones.rightForeArm) {
        bones.rightForeArm.rotation.z = -0.15;
      }
      
      if (bones.leftArm || bones.rightArm) {
        armsPoseApplied.current = true;
        console.log('[CharacterModel] ✓ 手臂已放下');
      }
    }
    
    // 轻微呼吸浮动
    const breathe = Math.sin(state.clock.elapsedTime * 1.2) * 0.008;
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

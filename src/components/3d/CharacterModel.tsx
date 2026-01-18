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

// 骨骼名称映射（支持不同命名规范）
const BONE_NAMES = {
  leftUpperArm: ['LeftUpperArm', 'Left_UpperArm', 'L_UpperArm', 'mixamorig:LeftArm', 'Arm.L', 'arm.L', 'LeftArm'],
  rightUpperArm: ['RightUpperArm', 'Right_UpperArm', 'R_UpperArm', 'mixamorig:RightArm', 'Arm.R', 'arm.R', 'RightArm'],
  leftForeArm: ['LeftLowerArm', 'Left_LowerArm', 'L_LowerArm', 'mixamorig:LeftForeArm', 'ForeArm.L', 'forearm.L', 'LeftForeArm'],
  rightForeArm: ['RightLowerArm', 'Right_LowerArm', 'R_LowerArm', 'mixamorig:RightForeArm', 'ForeArm.R', 'forearm.R', 'RightForeArm'],
  spine: ['Spine', 'spine', 'mixamorig:Spine', 'Spine1'],
  chest: ['Chest', 'chest', 'mixamorig:Spine1', 'Spine2', 'UpperChest'],
  head: ['Head', 'head', 'mixamorig:Head'],
};

function findBone(skeleton: THREE.Skeleton | undefined, names: string[]): THREE.Bone | null {
  if (!skeleton) return null;
  for (const name of names) {
    const bone = skeleton.bones.find(b => b.name.toLowerCase().includes(name.toLowerCase()));
    if (bone) return bone;
  }
  return null;
}

export function CharacterModel({ url, isSpeaking, mood = 'neutral', onLoaded }: CharacterModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(url);
  const { actions, mixer } = useAnimations(animations, groupRef);
  
  // Animation refs
  const speakTimer = useRef(0);
  const breatheTimer = useRef(0);
  const skeletonRef = useRef<THREE.Skeleton | null>(null);
  const bonesRef = useRef<{
    leftUpperArm: THREE.Bone | null;
    rightUpperArm: THREE.Bone | null;
    leftForeArm: THREE.Bone | null;
    rightForeArm: THREE.Bone | null;
    spine: THREE.Bone | null;
    chest: THREE.Bone | null;
    head: THREE.Bone | null;
  }>({
    leftUpperArm: null,
    rightUpperArm: null,
    leftForeArm: null,
    rightForeArm: null,
    spine: null,
    chest: null,
    head: null,
  });
  
  // 初始骨骼旋转值（用于放下手臂）
  const initialPoseApplied = useRef(false);
  
  // Clone the scene to avoid sharing issues
  const clonedScene = useMemo(() => scene.clone(), [scene]);

  // 参考恋与深空的布局：计算模型边界，让角色占据屏幕中央 70-80% 高度
  const { scale, position } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(clonedScene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    
    // 目标高度约2.5单位（让角色占更大比例）
    const targetHeight = 2.5;
    const autoScale = size.y > 0 ? targetHeight / size.y : 1;
    
    // 居中模型，并让角色站在视觉中心偏下的位置
    const autoPosition = new THREE.Vector3(
      -center.x * autoScale,
      (-center.y * autoScale) - 0.3, // 略微下移，确保头部可见
      -center.z * autoScale
    );
    
    console.log('[CharacterModel] 模型信息:', {
      原始尺寸: { x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2) },
      自动缩放: autoScale.toFixed(4),
      位置偏移: { x: autoPosition.x.toFixed(2), y: autoPosition.y.toFixed(2), z: autoPosition.z.toFixed(2) }
    });
    
    return { scale: autoScale, position: autoPosition };
  }, [clonedScene]);

  // 查找骨骼并设置初始姿势（手放下）
  useEffect(() => {
    let skeleton: THREE.Skeleton | null = null;
    
    clonedScene.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
        const skinnedMesh = child as THREE.SkinnedMesh;
        if (skinnedMesh.skeleton) {
          skeleton = skinnedMesh.skeleton;
          skeletonRef.current = skeleton;
          
          // 打印所有骨骼名称用于调试
          console.log('[CharacterModel] 骨骼列表:', skeleton.bones.map(b => b.name));
        }
      }
    });
    
    if (skeleton) {
      // 查找各个骨骼
      bonesRef.current = {
        leftUpperArm: findBone(skeleton, BONE_NAMES.leftUpperArm),
        rightUpperArm: findBone(skeleton, BONE_NAMES.rightUpperArm),
        leftForeArm: findBone(skeleton, BONE_NAMES.leftForeArm),
        rightForeArm: findBone(skeleton, BONE_NAMES.rightForeArm),
        spine: findBone(skeleton, BONE_NAMES.spine),
        chest: findBone(skeleton, BONE_NAMES.chest),
        head: findBone(skeleton, BONE_NAMES.head),
      };
      
      console.log('[CharacterModel] 找到骨骼:', {
        leftUpperArm: bonesRef.current.leftUpperArm?.name,
        rightUpperArm: bonesRef.current.rightUpperArm?.name,
        spine: bonesRef.current.spine?.name,
        head: bonesRef.current.head?.name,
      });
    }
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
            
            const textureTypes = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const;
            
            textureTypes.forEach((texType) => {
              const texture = material[texType];
              if (texture) {
                textureCount++;
                console.log(`[CharacterModel] ✓ ${mesh.name || '未命名网格'} - ${texType}: 已加载`);
              }
            });
            
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

  // Handle animations - 如果模型自带动画则播放
  useEffect(() => {
    if (!actions) return;

    console.log('[CharacterModel] 可用动画:', Object.keys(actions));
    
    // Try to find and play idle animation
    const idleAnimation = actions['idle'] || actions['Idle'] || actions['Breathing'] || actions['breathing'];
    if (idleAnimation) {
      console.log('[CharacterModel] 播放idle动画');
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

    const speakAnimation = actions['speak'] || actions['Speak'] || actions['talk'] || actions['Talk'] || actions['Talking'];
    
    if (speakAnimation) {
      if (isSpeaking) {
        speakAnimation.reset().fadeIn(0.3).play();
      } else {
        speakAnimation.fadeOut(0.3);
      }
    }
  }, [isSpeaking, actions]);

  // 主动画循环：呼吸、说话、手臂放下
  useFrame((state, delta) => {
    if (!groupRef.current) return;
    
    breatheTimer.current += delta;
    const bones = bonesRef.current;

    // 应用初始姿势：把手臂从T-pose放下来
    if (!initialPoseApplied.current && (bones.leftUpperArm || bones.rightUpperArm)) {
      // 左手臂向下旋转（约70度）
      if (bones.leftUpperArm) {
        bones.leftUpperArm.rotation.z = Math.PI * 0.4; // 向身体方向旋转
        bones.leftUpperArm.rotation.x = 0.1; // 略微向前
      }
      if (bones.leftForeArm) {
        bones.leftForeArm.rotation.z = 0.2; // 手肘略微弯曲
      }
      
      // 右手臂向下旋转
      if (bones.rightUpperArm) {
        bones.rightUpperArm.rotation.z = -Math.PI * 0.4;
        bones.rightUpperArm.rotation.x = 0.1;
      }
      if (bones.rightForeArm) {
        bones.rightForeArm.rotation.z = -0.2;
      }
      
      initialPoseApplied.current = true;
      console.log('[CharacterModel] 已应用待机姿势（手臂放下）');
    }

    // 呼吸动画 - 胸部和脊柱的轻微起伏
    const breatheAmount = Math.sin(breatheTimer.current * 1.2) * 0.015;
    const breatheScale = 1 + Math.sin(breatheTimer.current * 1.2) * 0.008;
    
    if (bones.chest) {
      bones.chest.rotation.x = breatheAmount;
    }
    if (bones.spine) {
      bones.spine.scale.setScalar(breatheScale);
    }
    
    // 整体轻微上下浮动（呼吸感）
    const breatheY = Math.sin(breatheTimer.current * 1.2) * 0.01;
    groupRef.current.position.y = position.y + breatheY;

    // 说话时的动画
    if (isSpeaking) {
      speakTimer.current += delta;
      
      // 头部轻微摆动
      if (bones.head) {
        bones.head.rotation.y = Math.sin(speakTimer.current * 2.5) * 0.06;
        bones.head.rotation.x = Math.sin(speakTimer.current * 3) * 0.03;
        bones.head.rotation.z = Math.sin(speakTimer.current * 1.8) * 0.02;
      }
      
      // 身体轻微晃动
      groupRef.current.rotation.y = Math.sin(speakTimer.current * 1.5) * 0.03;
    } else {
      speakTimer.current = 0;
      
      // 缓慢回归中立姿态
      if (bones.head) {
        bones.head.rotation.y = THREE.MathUtils.lerp(bones.head.rotation.y, 0, 0.05);
        bones.head.rotation.x = THREE.MathUtils.lerp(bones.head.rotation.x, 0, 0.05);
        bones.head.rotation.z = THREE.MathUtils.lerp(bones.head.rotation.z, 0, 0.05);
      }
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, 0, 0.05);
    }

    // 更新动画混合器
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

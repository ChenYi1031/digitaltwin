// ============================================================
// scene.v3.js —— 渲染器、场景、天空渐变背景、地面、灯光
// v3：仅配置版本跟进（import config.v3），逻辑与 v2 一致。
// 健壮性检查（§9）：
//   - 主平行光唯一投射阴影；shadow camera 收紧到基地主区域；
//     bias = -0.0005；mapSize 2048；near/far 覆盖光位到地面全程，防阴影闪烁。
//   - outputColorSpace = SRGBColorSpace，无弃用 API，控制台零 warning。
// ============================================================

import * as THREE from 'three';
import { COLORS, LAYOUT } from './config.v3.js';

/** 天空渐变背景（Canvas 生成，不依赖外部贴图） */
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 512;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, '#b9cfe4');   // 天顶
  grad.addColorStop(0.55, '#e3ebf2');
  grad.addColorStop(1.0, '#f4f6f8');   // 地平线（与雾色一致）
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function initScene(container) {
  // ---- 渲染器 ----
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // ---- 场景 / 相机 ----
  const scene = new THREE.Scene();
  scene.background = makeSkyTexture();
  scene.fog = new THREE.Fog(0xf0f3f6, 320, 820);

  const camera = new THREE.PerspectiveCamera(
    50, window.innerWidth / window.innerHeight, 0.5, 1500
  );
  camera.position.set(130, 95, 150);

  // ---- 灯光：柔和环境光 + 唯一带阴影的平行光 ----
  const hemi = new THREE.HemisphereLight(0xe8eef5, 0xc9c2b8, 1.0);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(110, 160, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);            // §8：不超过 2048
  const sc = sun.shadow.camera;
  sc.left = -170; sc.right = 170;                // 阴影相机收紧到基地主区域
  sc.top = 170; sc.bottom = -170;
  sc.near = 40; sc.far = 420;                    // 覆盖光位到地面全程，防阴影闪烁
  sun.shadow.bias = -0.0005;                     // §8/§9 指定值
  scene.add(sun);
  scene.add(sun.target);

  // ---- 地面 ----
  const groundMat = new THREE.MeshStandardMaterial({
    color: COLORS.ground, roughness: 0.95, metalness: 0.0,
  });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(LAYOUT.groundSize, LAYOUT.groundSize),
    groundMat
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  return { renderer, scene, camera, sun };
}

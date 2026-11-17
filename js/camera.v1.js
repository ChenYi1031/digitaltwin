// ============================================================
// camera.v1.js —— OrbitControls + 相机缓动聚焦 + 巡游留桩
// 健壮性检查（§9）：
//   - 聚焦使用 easeInOutCubic 缓动插值（相机位置与 controls.target 同步），
//     禁止直接 set 瞬移；
//   - 用户手动拖拽（controls 'start' 事件）立即取消聚焦插值，避免抢占。
// 说明：相机聚焦属交互层动画，使用真实帧间隔驱动 —— 暂停仿真时点击聚焦仍可响应；
//       场景内动画才受 simClock 门控。
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function initCamera(camera, dom) {
  const controls = new OrbitControls(camera, dom);
  controls.enableDamping = true;          // 阻尼
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495; // 限制在地面以上
  controls.minDistance = 20;
  controls.maxDistance = 420;
  controls.target.set(0, 0, 20);
  controls.update();
  return controls;
}

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** 相机缓动聚焦导演 */
export class CameraDirector {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.active = false;
    this.t = 0;
    this.duration = 1.4;
    this.fromPos = new THREE.Vector3();
    this.toPos = new THREE.Vector3();
    this.fromTarget = new THREE.Vector3();
    this.toTarget = new THREE.Vector3();
    // 用户接管：手动拖拽时取消进行中的聚焦
    controls.addEventListener('start', () => this.cancel());
  }

  /** 平滑飞往目标点（camPos 相机落点 / target 观察点） */
  flyTo(camPos, target, duration = 1.4) {
    this.fromPos.copy(this.camera.position);
    this.toPos.copy(camPos);
    this.fromTarget.copy(this.controls.target);
    this.toTarget.copy(target);
    this.duration = duration;
    this.t = 0;
    this.active = true;
  }

  cancel() {
    this.active = false;
  }

  /** 每帧调用：realDelta 为真实帧间隔（秒） */
  update(realDelta) {
    if (!this.active) return;
    this.t += realDelta / this.duration;
    const k = easeInOutCubic(Math.min(this.t, 1));
    this.camera.position.lerpVectors(this.fromPos, this.toPos, k);
    this.controls.target.lerpVectors(this.fromTarget, this.toTarget, k);
    this.controls.update();
    if (this.t >= 1) this.active = false;
  }
}

// ------------------------------------------------------------
// 自动巡游【P0 留桩，未启用】
// 计划实现（P3）：车间内部 / 机械臂特写 / 检测工位 / 港口细节镜头序列，
//   序列插值同样走 CameraDirector；鼠标接管（'start' 事件）自动切回手动模式。
// ------------------------------------------------------------
export function startTour() {
  // TODO(P3): 巡游镜头序列（未启用）
}

export function stopTour() {
  // TODO(P3)
}

// ============================================================
// camera.v3.js —— OrbitControls + 相机缓动聚焦 + 自动巡游
// v3：巡游镜头序列扩充（+ 船舶岸桥 / 装配线协同），其余与 v2 一致。
// 健壮性检查（§9）：
//   - 聚焦使用 easeInOutCubic 缓动插值（相机位置与 controls.target 同步），
//     禁止直接 set 瞬移；
//   - 用户手动拖拽（controls 'start'）立即取消聚焦与巡游（鼠标接管）。
// 相机运动属交互层，使用真实帧间隔驱动 —— 暂停仿真时仍可响应。
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LAYOUT, APRON, INSPECT_CFG } from './config.v3.js';

export function initCamera(camera, dom) {
  const controls = new OrbitControls(camera, dom);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 20;
  controls.maxDistance = 420;
  controls.target.set(0, 0, 20);
  controls.update();
  return controls;
}

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

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
    controls.addEventListener('start', () => this.cancel());
  }

  flyTo(camPos, target, duration = 1.4) {
    this.fromPos.copy(this.camera.position);
    this.toPos.copy(camPos);
    this.fromTarget.copy(this.controls.target);
    this.toTarget.copy(target);
    this.duration = duration;
    this.t = 0;
    this.active = true;
  }

  cancel() { this.active = false; }

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

// —— 巡游镜头序列（v3：9 站）——
const { factory, warehouse, port } = LAYOUT;
const SHOTS = [
  { name: '基地全景',     pos: [150, 118, 168], tgt: [0, 0, 24] },
  { name: '主装配车间',   pos: [factory.x + 50, 36, factory.z + 70], tgt: [factory.x, 8, factory.z] },
  { name: '机械臂工作站', pos: [APRON.x + 24, 15, APRON.z + 26], tgt: [APRON.x, 3.5, APRON.z] },
  { name: '装配线协同',   pos: [-36, 20, 66], tgt: [-72, 3, 28] },
  { name: '检测工位',     pos: [INSPECT_CFG.x + 20, 12, INSPECT_CFG.z + 19], tgt: [INSPECT_CFG.x, 2.5, INSPECT_CFG.z] },
  { name: '成品仓储区',   pos: [warehouse.x + 42, 32, warehouse.z + 44], tgt: [warehouse.x, 6, warehouse.z] },
  { name: '船舶岸桥',     pos: [130, 30, 160], tgt: [65, 6, 102] },
  { name: '重件码头',     pos: [port.x + 40, 30, port.z + 52], tgt: [port.x, 5, port.z] },
  { name: '路网俯瞰',     pos: [10, 95, 115], tgt: [30, 0, 34] },
];
const FLY_TIME = 4, HOLD_TIME = 3;

export class TourController {
  constructor(camera, controls, director) {
    this.camera = camera;
    this.controls = controls;
    this.director = director;
    this.active = false;
    this.idx = 0;
    this.state = 'fly';
    this.hold = 0;
    controls.addEventListener('start', () => this.stop());
  }

  start() {
    this.active = true;
    this.idx = 0;
    this.state = 'fly';
    this.hold = 0;
    this._fly();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.director.cancel();
  }

  toggle() {
    this.active ? this.stop() : this.start();
    return this.active;
  }

  isActive() { return this.active; }

  _fly() {
    const s = SHOTS[this.idx];
    this.director.flyTo(new THREE.Vector3(...s.pos), new THREE.Vector3(...s.tgt), FLY_TIME);
  }

  update(realDelta) {
    if (!this.active) return;
    if (this.state === 'fly') {
      if (!this.director.active) {
        this.state = 'hold';
        this.hold = 0;
      }
    } else {
      this.hold += realDelta;
      if (this.hold >= HOLD_TIME) {
        this.idx = (this.idx + 1) % SHOTS.length;
        this.state = 'fly';
        this._fly();
      }
    }
  }
}

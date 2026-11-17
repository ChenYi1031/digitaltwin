// ============================================================
// main.v2.js —— 入口：装配各模块、渲染循环、resize
// 时间规则（§7）：场景内一切工序动画以 simClock.simTime 为唯一时间源
//   （机械臂/检测相位推算、AGV 弧长积分）；相机聚焦与自动巡游属交互层，
//   使用真实帧间隔（暂停仿真时仍可响应）。
// v2：接入 P1 机械臂 ×2、P2 检测工位 + AGV ×5、P3 自动巡游与遥测面板。
// ============================================================

import * as THREE from 'three';
import { TIME } from './config.v2.js';
import { initScene } from './scene.v2.js';
import { buildFactory, buildWarehouse, buildPort } from './factory.v2.js';
import { buildRoads } from './road.v2.js';
import { SimClock } from './simClock.v2.js';
import { initCamera, CameraDirector, TourController } from './camera.v2.js';
import { initInteraction, setHighlight } from './interaction.v2.js';
import { initUI } from './ui.v2.js';
import { createRobotStation } from './robot.v2.js';
import { createInspectionStation } from './inspection.v2.js';
import { createVehicleSystem } from './vehicle.v2.js';

// ---- 场景与相机 ----
const app = document.getElementById('app');
const { renderer, scene, camera } = initScene(app);
const controls = initCamera(camera, renderer.domElement);
const director = new CameraDirector(camera, controls);

// ---- 设施（厂房 / 仓储 / 港口 / 道路 / 机械臂 A·B / 检测工位）----
const facilities = [
  buildFactory(),
  buildWarehouse(),
  buildPort(),
  buildRoads(),
  createRobotStation(0),
  createRobotStation(1),
  createInspectionStation(),
];
facilities.forEach((f) => {
  scene.add(f.group);
  // 收集设施专属材质（高亮用；noHighlight 的状态灯材质跳过，避免覆盖其动态 emissive）
  const matSet = new Set();
  f.group.traverse((o) => {
    if (o.isMesh && o.material && o.material.emissive && !o.material.userData.noHighlight) {
      matSet.add(o.material);
    }
  });
  f.mats = [...matSet];
});

// ---- AGV 车辆系统（InstancedMesh，随 simTime 推进）----
const vehicles = createVehicleSystem(scene);

// ---- 全局仿真时钟（唯一时间源）----
const simClock = new SimClock();
simClock.speed = TIME.defaultSpeed;

// ---- UI ----
const tour = new TourController(camera, controls, director);
const ui = initUI({
  onPauseToggle: () => {
    const paused = simClock.toggle();
    ui.setPaused(paused);
  },
  onTourToggle: () => {
    tour.toggle();
    ui.setTourActive(tour.isActive());
  },
});
ui.setPaused(false);
ui.setSelected(null);
ui.setTourActive(false);

// ---- 拾取：点击选中 → 高亮 → 平滑聚焦（并结束巡游）----
let selected = null;
function applySelect(f) {
  if (selected) setHighlight(selected, false);
  selected = f;
  if (f) {
    setHighlight(f, true);
    ui.setSelected(f);
    tour.stop();                                    // 点击设施 = 用户接管巡游
    ui.setTourActive(tour.isActive());
    director.flyTo(f.focus.camPos, f.focus.target); // 缓动插值，禁止瞬移
  } else {
    ui.setSelected(null);
  }
}
initInteraction({
  camera,
  dom: renderer.domElement,
  facilities,
  onSelect: applySelect,
});

// ---- 渲染循环 ----
const realClock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(realClock.getDelta(), 0.1);   // 防切页回来跳变

  simClock.update(dt);                              // 唯一仿真时间源
  const simTime = simClock.simTime;

  // 工序模块推进（全部以 simTime 为相位来源，暂停时自动停走）
  facilities[4].update(simTime);                    // 机械臂 A
  facilities[5].update(simTime);                    // 机械臂 B
  facilities[6].update(simTime);                    // 检测工位
  vehicles.update(simTime);

  // 交互层（真实时间驱动）
  director.update(dt);
  tour.update(dt);
  controls.update();

  // 面板（内部带变更检测，仅变化时写 DOM）
  ui.setClock(simTime);
  ui.setModules({
    robot: '运行中 · 2 台',
    inspect: `运行中 · ${facilities[6].rateLabel()}`,
    vehicle: `运行中 · ${vehicles.count()} 台`,
  });
  ui.setTelemetry({
    ra: facilities[4].phaseLabel(),
    rb: facilities[5].phaseLabel(),
    ins: facilities[6].resultLabel(),
    agv: vehicles.statsLabel(),
  });
  ui.setAlarm(vehicles.alarms());

  renderer.render(scene, camera);
}
animate();

// ---- 自适应窗口 ----
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================
// main.v3.js —— 入口：装配各模块、渲染循环、resize
// 时间规则（§7）：工序动画全部以 simClock.simTime 为唯一时间源
//   （机械臂事件门控 FSM、检测周期、车队/物料弧长积分、船舶班期相位）；
//   相机聚焦与巡游属交互层，用真实帧间隔（暂停仿真仍可响应）。
// v3：接入 P4 —— 船舶靠离调度与 STS 岸桥装卸（marine）、
//   物料 AGV 工件级任务队列（material，与机械臂队列门控、车队双向避让）。
// ============================================================

import * as THREE from 'three';
import { TIME } from './config.v3.js';
import { initScene } from './scene.v3.js';
import { buildFactory, buildWarehouse, buildPort } from './factory.v3.js';
import { buildRoads } from './road.v3.js';
import { SimClock } from './simClock.v2.js';
import { initCamera, CameraDirector, TourController } from './camera.v3.js';
import { initInteraction, setHighlight } from './interaction.v3.js';
import { initUI } from './ui.v3.js';
import { createRobotStation } from './robot.v3.js';
import { createInspectionStation } from './inspection.v3.js';
import { createVehicleSystem } from './vehicle.v3.js';
import { createMarine } from './marine.v3.js';
import { createMaterialSystem } from './material.v3.js';

// ---- 场景与相机 ----
const app = document.getElementById('app');
const { renderer, scene, camera } = initScene(app);
const controls = initCamera(camera, renderer.domElement);
const director = new CameraDirector(camera, controls);

// ---- 设施 ----
const factory = buildFactory();
const warehouse = buildWarehouse();
const port = buildPort();
const road = buildRoads();
const robotA = createRobotStation(0);
const robotB = createRobotStation(1);
const inspection = createInspectionStation();
const marine = createMarine(scene, port.yardAPI);

const marineFacility = {
  id: 'marine',
  name: '班轮与岸桥',
  get status() { return marine.statusLabel(); },
  desc: '班轮 A/B 错峰靠离，STS 岸桥自动装卸堆场箱（P4 已启用）。点击本设施可在面板查看两轮状态。',
  group: marine.group,
  focus: {
    target: new THREE.Vector3(65, 8, 100),
    camPos: new THREE.Vector3(130, 30, 160),
  },
};

const facilities = [factory, warehouse, port, road, robotA, robotB, inspection, marineFacility];
facilities.forEach((f) => {
  scene.add(f.group);
  const matSet = new Set();
  f.group.traverse((o) => {
    if (o.isMesh && o.material && o.material.emissive && !o.material.userData.noHighlight) {
      matSet.add(o.material);
    }
  });
  f.mats = [...matSet];
});

// ---- 系统 ----
const vehicles = createVehicleSystem(scene);
const materials = createMaterialSystem(scene, [robotA, robotB], () => vehicles.getVehicles());

// ---- 全局仿真时钟（唯一时间源）----
const simClock = new SimClock();
simClock.speed = TIME.defaultSpeed;

// ---- UI / 巡游 ----
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
    tour.stop();
    ui.setTourActive(tour.isActive());
    director.flyTo(f.focus.camPos, f.focus.target);
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
  const dt = Math.min(realClock.getDelta(), 0.1);

  simClock.update(dt);
  const simTime = simClock.simTime;

  // 工序推进（顺序保证依赖：机械臂先于物料，物料位姿先于车队避障）
  robotA.update(simTime);
  robotB.update(simTime);
  inspection.update(simTime);
  marine.update(simTime);
  materials.update(simTime);
  vehicles.update(simTime, materials.getPoses());

  // 交互层（真实时间驱动）
  director.update(dt);
  tour.update(dt);
  controls.update();

  // 面板（内部带变更检测）
  ui.setClock(simTime);
  ui.setModules({
    robot: '运行中 · 2 台 · 队列门控',
    inspect: `运行中 · ${inspection.rateLabel()}`,
    vehicle: `运行中 · ${vehicles.count()} 台`,
    marine: '运行中 · 班期 6 分钟/轮',
    material: '运行中 · 2 线循环',
  });
  ui.setTelemetry({
    ra: robotA.phaseLabel(),
    rb: robotB.phaseLabel(),
    ins: inspection.resultLabel(),
    agv: vehicles.statsLabel(),
    matA: materials.lineLabels()[0],
    matB: materials.lineLabels()[1],
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

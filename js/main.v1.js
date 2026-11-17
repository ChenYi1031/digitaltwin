// ============================================================
// main.v1.js —— 入口：装配各模块、渲染循环、resize
// 时间规则（§7）：场景内一切动画以 simClock.simTime 为唯一时间源；
//   相机缓动聚焦属交互层，使用真实帧间隔（暂停时仍可响应点击聚焦）。
// ============================================================

import * as THREE from 'three';
import { TIME } from './config.v1.js';
import { initScene } from './scene.v1.js';
import { buildFactory, buildWarehouse, buildPort } from './factory.v1.js';
import { buildRoads } from './road.v1.js';
import { SimClock } from './simClock.v1.js';
import { initCamera, CameraDirector } from './camera.v1.js';
import { initInteraction, setHighlight } from './interaction.v1.js';
import { initUI } from './ui.v1.js';
// —— P0 留桩模块（未启用，接口预埋；P1/P2 接入实现）——
import { createRobot, updateRobot } from './robot.v1.js';
import { createInspection, updateInspection } from './inspection.v1.js';
import { createVehicleSystem, updateVehicles } from './vehicle.v1.js';

// ---- 场景与相机 ----
const app = document.getElementById('app');
const { renderer, scene, camera } = initScene(app);
const controls = initCamera(camera, renderer.domElement);
const director = new CameraDirector(camera, controls);

// ---- 设施（厂房 / 仓储 / 港口 / 道路）----
const facilities = [buildFactory(), buildWarehouse(), buildPort(), buildRoads()];
facilities.forEach((f) => {
  scene.add(f.group);
  // 收集设施专属材质（高亮用；材质相互独立，见 factory.v1.js makeMats）
  const matSet = new Set();
  f.group.traverse((o) => {
    if (o.isMesh && o.material && o.material.emissive) matSet.add(o.material);
  });
  f.mats = [...matSet];
});

// ---- 全局仿真时钟（唯一时间源）----
const simClock = new SimClock();
simClock.speed = TIME.defaultSpeed;

// ---- 留桩实例（P0 不驱动）----
const robot = createRobot();
const inspection = createInspection();
const vehicleSystem = createVehicleSystem();

// ---- UI ----
const ui = initUI({
  onPauseToggle: () => {
    const paused = simClock.toggle();
    ui.setPaused(paused);
  },
});
ui.setPaused(false);
ui.setSelected(null);

// ---- 拾取：点击选中 → 高亮 → 平滑聚焦 ----
let selected = null;
function applySelect(f) {
  if (selected) setHighlight(selected, false);
  selected = f;
  if (f) {
    setHighlight(f, true);
    ui.setSelected(f);
    director.flyTo(f.focus.camPos, f.focus.target);   // 缓动插值，禁止瞬移
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
  const dt = Math.min(realClock.getDelta(), 0.1);     // 防切页回来跳变

  simClock.update(dt);                                 // 唯一仿真时间源
  const simTime = simClock.simTime;

  // 留桩模块推进（P0 内部为空实现，未启用直接返回）
  updateRobot(robot, simTime);
  updateInspection(inspection, simTime);
  updateVehicles(vehicleSystem, simTime);

  director.update(dt);                                 // 交互层：真实时间驱动
  controls.update();

  ui.setClock(simTime);
  renderer.render(scene, camera);
}
animate();

// ---- 自适应窗口 ----
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

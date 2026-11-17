// ============================================================
// robot.v2.js —— 机械臂工作站（P1 实现，替代 v1 桩）
// 五阶段状态机：WAIT 等待工件 → GRASP 抓取 → TRANSFER 搬运
//   → PLACE 落位 → RETRACT 回位 → WAIT（周期 22s 循环）
// 实现要点（§7 仿真与动画规则）：
//   - 相位完全由 simClock.simTime 推算：tc = (simTime + offset) % 周期，
//     无局部计时器，暂停自然停走、恢复连续无跳变；
//   - 显式枚举 + 周期表定义相位，转移条件即时间窗口边界（无 if 堆叠隐式状态）；
//   - 夹爪与工件用 Object3D.attach() 父子挂接：TRANSFER/PLACE 期间挂到腕部，
//     相位边界 reconcile（不依赖帧序，暂停/恢复/掉帧均一致）；
//   - 关节角度由圆柱坐标目标点 + 平面二连杆 IK 解算，全周期轨迹 C0 连续；
//   - 工件循环边界"目标位缩小消失 / 源位放大出现"，模拟下线与上料。
// ============================================================

import * as THREE from 'three';
import { COLORS, APRON, ROBOT_CFG } from './config.v2.js';

export const ROBOT_PHASE = {
  WAIT: 'WAIT',
  GRASP: 'GRASP',
  TRANSFER: 'TRANSFER',
  PLACE: 'PLACE',
  RETRACT: 'RETRACT',
};

export const PHASE_LABEL = {
  WAIT: '等待工件',
  GRASP: '抓取',
  TRANSFER: '搬运',
  PLACE: '落位',
  RETRACT: '回位',
};

const ORDER = [ROBOT_PHASE.WAIT, ROBOT_PHASE.GRASP, ROBOT_PHASE.TRANSFER, ROBOT_PHASE.PLACE, ROBOT_PHASE.RETRACT];
const CYCLE_TABLE = ROBOT_CFG.cycle;
const TOTAL = ORDER.reduce((s, k) => s + CYCLE_TABLE[k], 0);

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

/** 由累计仿真相位时间求解当前阶段与阶段内进度 */
function phaseAt(tc) {
  let acc = 0;
  for (const ph of ORDER) {
    const d = CYCLE_TABLE[ph];
    if (tc < acc + d) return { phase: ph, p: (tc - acc) / d };
    acc += d;
  }
  return { phase: ORDER[0], p: 0 };
}

/**
 * 平面二连杆 IK（肩/肘两关节，肘向下的工作姿态）：
 * 输入目标相对肩部的水平距 r 与高度差 dy，输出肩转角 gamma（自竖直向前）、
 * 肘转角 delta。已验证：gamma/delta 代入正运动学精确还原 (r, dy)。
 */
function solveIK(r, dy, L1, L2) {
  const D = Math.min(Math.max(Math.hypot(r, dy), 0.85), L1 + L2 - 0.02);
  const alpha = Math.atan2(dy, r);
  const cosB = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D);
  const beta = Math.acos(Math.min(1, Math.max(-1, cosB)));
  const thetaS = alpha + beta;                       // 大臂绝对仰角
  const cosE = (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2);
  const interior = Math.acos(Math.min(1, Math.max(-1, cosE)));
  return { gamma: Math.PI / 2 - thetaS, delta: Math.PI - interior };
}

// 站点构件几何（两站共享实例，§8 复用）
const GEO = {
  pedestal: new THREE.BoxGeometry(1.8, 0.5, 1.8),
  column:   new THREE.BoxGeometry(1.3, 2.3, 1.3),
  band:     new THREE.BoxGeometry(1.36, 0.28, 1.36),
  turret:   new THREE.BoxGeometry(1.0, 0.5, 1.0),
  counter:  new THREE.BoxGeometry(0.5, 0.7, 0.35),
  upper:    new THREE.BoxGeometry(0.55, ROBOT_CFG.L1, 0.55),
  fore:     new THREE.BoxGeometry(0.4, ROBOT_CFG.L2, 0.4),
  hub:      new THREE.BoxGeometry(0.34, 0.3, 0.34),
  housing:  new THREE.BoxGeometry(0.5, 0.36, 0.5),
  finger:   new THREE.BoxGeometry(0.12, 0.75, 0.5),
  pallet:   new THREE.BoxGeometry(2.2, 0.18, 2.2),
  piece:    new THREE.BoxGeometry(1.3, 1.0, 1.7),
  plate:    new THREE.BoxGeometry(0.9, 0.06, 1.3),
  cabinet:  new THREE.BoxGeometry(0.9, 1.5, 0.7),
  pole:     new THREE.BoxGeometry(0.06, 0.9, 0.06),
  lamp:     new THREE.BoxGeometry(0.22, 0.22, 0.22),
};

const mesh = (parent, geo, mat, x, y, z) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
};

/**
 * 创建机械臂工作站。index → ROBOT_CFG.stations 配置。
 * 返回 { id, name, status, desc, group, focus, update(simTime), phaseLabel() }
 */
export function createRobotStation(index) {
  const cfg = ROBOT_CFG.stations[index];
  const sx = cfg.x, off = cfg.offset;
  const { rSrc, hoverH, gripH, carryH, L1, L2, shoulderY } = ROBOT_CFG;
  const pieceCY = 0.68;              // 工件中心高（托盘顶 0.18 + 半高 0.5）
  const aSrc = -Math.PI / 2, aTgt = Math.PI / 2;

  // —— 站点专属材质（高亮隔离；堆叠灯材质标记 noHighlight）——
  const mats = {
    trim:   new THREE.MeshStandardMaterial({ color: COLORS.lightGray, roughness: 0.8 }),
    dark:   new THREE.MeshStandardMaterial({ color: COLORS.darkGray,  roughness: 0.55, metalness: 0.25 }),
    orange: new THREE.MeshStandardMaterial({ color: COLORS.orange,    roughness: 0.45, metalness: 0.15 }),
    piece:  new THREE.MeshStandardMaterial({ color: COLORS.lightGray, roughness: 0.5 }),
    lamp:   new THREE.MeshStandardMaterial({ color: COLORS.orange,    roughness: 0.4, emissive: COLORS.orange, emissiveIntensity: 0.8 }),
  };
  mats.lamp.userData.noHighlight = true;   // 状态灯自身控制 emissive，不参与拾取高亮

  const station = new THREE.Group();
  station.position.set(sx, APRON.h, APRON.z);

  // —— 静态结构 ——
  mesh(station, GEO.pedestal, mats.trim, 0, 0.25, 0);
  mesh(station, GEO.column, mats.dark, 0, 1.65, 0);
  mesh(station, GEO.band, mats.orange, 0, 2.55, 0);

  // —— 机械臂运动链： turret(Y 回转) → shoulder(X) → elbow(X) → wrist(X) → 夹爪 ——
  const turret = new THREE.Group();
  turret.position.y = shoulderY;
  station.add(turret);
  mesh(turret, GEO.turret, mats.trim, 0, 0.1, 0);
  mesh(turret, GEO.counter, mats.dark, 0, 0.15, -0.55);

  const shoulder = new THREE.Group();
  turret.add(shoulder);
  mesh(shoulder, GEO.upper, mats.orange, 0, L1 / 2, 0);

  const elbow = new THREE.Group();
  elbow.position.y = L1;
  shoulder.add(elbow);
  mesh(elbow, GEO.fore, mats.trim, 0, L2 / 2, 0);

  const wrist = new THREE.Group();
  wrist.position.y = L2;
  elbow.add(wrist);
  mesh(wrist, GEO.hub, mats.dark, 0, 0.05, 0);
  mesh(wrist, GEO.housing, mats.dark, 0, -0.30, 0);
  const fingerL = mesh(wrist, GEO.finger, mats.trim, -0.935, -1.025, 0);
  const fingerR = mesh(wrist, GEO.finger, mats.trim, 0.935, -1.025, 0);

  // —— 源/目标托盘 + 工件（含橙色顶牌随动）——
  mesh(station, GEO.pallet, mats.dark, -rSrc, 0.09, 0);
  mesh(station, GEO.pallet, mats.trim, rSrc, 0.09, 0);
  const piece = mesh(station, GEO.piece, mats.piece, -rSrc, pieceCY, 0);
  mesh(piece, GEO.plate, mats.orange, 0, 0.53, 0);

  // —— 控制柜 + 堆叠状态灯（静态）——
  mesh(station, GEO.cabinet, mats.trim, 2.2, 0.75, -2.2);
  mesh(station, GEO.pole, mats.dark, 2.2, 1.95, -2.2);
  mesh(station, GEO.lamp, mats.dark, 2.2, 2.51, -2.2);
  const lampW = mats.trim; mesh(station, GEO.lamp, lampW, 2.2, 2.73, -2.2);
  mesh(station, GEO.lamp, mats.lamp, 2.2, 2.95, -2.2);

  let curPhase = ROBOT_PHASE.WAIT;
  let curCycle = 0;

  /** 每帧驱动（唯一入参：全局仿真时间） */
  function update(simTime) {
    const tc = (((simTime + off) % TOTAL) + TOTAL) % TOTAL;
    const { phase, p } = phaseAt(tc);
    curPhase = phase;
    curCycle = Math.floor((simTime + off) / TOTAL);

    // —— 相位边界 reconcile：挂接状态跟随相位（与帧序无关，暂停/恢复安全）——
    const shouldAttach = phase === ROBOT_PHASE.TRANSFER || phase === ROBOT_PHASE.PLACE;
    if (shouldAttach && piece.parent !== wrist) {
      wrist.attach(piece);                 // Object3D.attach：保持世界变换
    } else if (!shouldAttach && piece.parent !== station) {
      station.attach(piece);
    }

    // —— 圆柱坐标目标轨迹（方位角 / 半径 / 高度逐相位插值，C0 连续）——
    let az, h;
    if (phase === ROBOT_PHASE.WAIT) {
      az = aSrc;
      const env = Math.max(0, Math.min(1, p / 0.25, (1 - p) / 0.25));   // 起止归零，保证相位边界连续
      h = hoverH + Math.sin(simTime * 1.6) * 0.07 * env;
    } else if (phase === ROBOT_PHASE.GRASP) {
      az = aSrc;
      h = lerp(hoverH, gripH, easeInOut(p));
    } else if (phase === ROBOT_PHASE.TRANSFER) {
      az = lerp(aSrc, aTgt, easeInOut(p));
      h = lerp(gripH, carryH, easeInOut(p));
    } else if (phase === ROBOT_PHASE.PLACE) {
      az = aTgt;
      h = lerp(carryH, gripH, easeInOut(p));
    } else {   // RETRACT
      az = lerp(aTgt, aSrc, easeInOut(p));
      h = lerp(gripH, hoverH, easeInOut(p));
    }

    // —— 二连杆 IK 解算关节角（IK 目标 = 腕心，即夹爪安装点上方 0.55）——
    const ty = h + 0.55;
    const { gamma, delta } = solveIK(rSrc, ty - shoulderY, L1, L2);
    turret.rotation.y = az;
    shoulder.rotation.x = gamma;
    elbow.rotation.x = delta;
    wrist.rotation.x = -(gamma + delta);   // 腕部补偿，夹爪保持竖直朝下

    // —— 手指开合（闭：GRASP 末端；开：RETRACT 前段）——
    let open;
    if (phase === ROBOT_PHASE.WAIT) open = 1;
    else if (phase === ROBOT_PHASE.GRASP) open = p < 0.7 ? 1 : 1 - easeInOut((p - 0.7) / 0.3);
    else if (phase === ROBOT_PHASE.RETRACT) open = easeInOut(Math.min(p / 0.3, 1));
    else open = 0;
    const fx = 0.935 + 0.425 * open;
    fingerL.position.x = -fx;
    fingerR.position.x = fx;

    // —— 工件摆位与缩放（未挂接时；缩放淡入/淡出掩盖循环边界的上料/下线）——
    if (!shouldAttach) {
      const px = phase === ROBOT_PHASE.WAIT || phase === ROBOT_PHASE.GRASP ? -rSrc : rSrc;
      piece.position.set(px, pieceCY, 0);
      piece.rotation.set(0, 0, 0);
      let s = 1;
      if (phase === ROBOT_PHASE.WAIT && p < 0.18) s = easeInOut(p / 0.18);
      if (phase === ROBOT_PHASE.RETRACT && p > 0.82) s = 1 - easeInOut((p - 0.82) / 0.18);
      piece.scale.setScalar(Math.max(0.0001, s));
    } else {
      piece.scale.setScalar(1);
    }
  }

  function phaseLabel() {
    return `${PHASE_LABEL[curPhase]} · 第 ${curCycle + 1} 循环`;
  }

  return {
    id: `robot-${index === 0 ? 'a' : 'b'}`,
    name: `机械臂工作站 ${index === 0 ? 'A' : 'B'}`,
    status: '运行中 · 五阶段状态机循环作业',
    desc: '等待 → 抓取 → 搬运 → 落位 → 回位；夹爪与工件 Object3D.attach() 父子挂接，相位由全局仿真时钟推算。',
    group: station,
    focus: {
      target: new THREE.Vector3(sx, 3.5, APRON.z),
      camPos: new THREE.Vector3(sx + 24, 13, APRON.z + 23),
    },
    update,
    phaseLabel,
  };
}

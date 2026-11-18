// ============================================================
// robot.v3.js —— 机械臂工作站（v3：事件门控状态机 + 物料协同）
// 五阶段：WAIT 等待 → GRASP 抓取 → TRANSFER 搬运 → PLACE 落位 → RETRACT 回位
// v3 核心变化（工件级任务队列）：
//   - WAIT 退出条件由纯时间门控改为【事件门控】：料位 stock>0 且成品位
//     target<targetMax 且最短等待满足 —— 料空/成品满时机械臂怠速等待，
//     由物料 AGV（material.v3.js）经 stockIn()/collectFinished() 推进队列；
//   - 料位堆叠 4 层 / 成品位堆叠 3 层，抓取/落位高度随层号自适应；
//   - 相位边界时间仍由 simClock.simTime 推算（tEnter 记录于仿真时域，
//     暂停自然停走、恢复连续），显式枚举 + 单一 tick 转移函数；
//   - 夹爪与工件 Object3D.attach() 父子挂接（抓取点即挂接点，
//     抓取层偏移 1.5 恒定 → 落位中心精确，无逐帧位置同步）。
// 可达性核算：gripH(3 层)=4.69 → ty 5.24 → D 4.86；carryH 4.82 → D 4.92
//   ≤ L1+L2-0.02 = 4.98 ✓（细节见 config.v3.js ROBOT_CFG 注释）。
// ============================================================

import * as THREE from 'three';
import { COLORS, APRON, ROBOT_CFG } from './config.v3.js';

export const ROBOT_PHASE = {
  WAIT: 'WAIT',
  GRASP: 'GRASP',
  TRANSFER: 'TRANSFER',
  PLACE: 'PLACE',
  RETRACT: 'RETRACT',
};

export const PHASE_LABEL = {
  WAIT: '待料',
  GRASP: '抓取',
  TRANSFER: '搬运',
  PLACE: '落位',
  RETRACT: '回位',
};

const CFG = ROBOT_CFG;
const M = CFG.mfg;
const DUR = CFG.cycle;
const PITCH = M.layerPitch;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (t) => Math.min(1, Math.max(0, t));

/** 平面二连杆 IK（肩/肘，肘向下工作姿态）；已验证正运动学精确还原目标 */
function solveIK(r, dy, L1, L2) {
  const D = Math.min(Math.max(Math.hypot(r, dy), 0.85), L1 + L2 - 0.02);
  const alpha = Math.atan2(dy, r);
  const cosB = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D);
  const beta = Math.acos(Math.min(1, Math.max(-1, cosB)));
  const thetaS = alpha + beta;
  const cosE = (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2);
  const interior = Math.acos(Math.min(1, Math.max(-1, cosE)));
  return { gamma: Math.PI / 2 - thetaS, delta: Math.PI - interior };
}

const GEO = {
  pedestal: new THREE.BoxGeometry(1.8, 0.5, 1.8),
  column:   new THREE.BoxGeometry(1.3, 2.3, 1.3),
  band:     new THREE.BoxGeometry(1.36, 0.28, 1.36),
  turret:   new THREE.BoxGeometry(1.0, 0.5, 1.0),
  counter:  new THREE.BoxGeometry(0.5, 0.7, 0.35),
  upper:    new THREE.BoxGeometry(0.55, CFG.L1, 0.55),
  fore:     new THREE.BoxGeometry(0.4, CFG.L2, 0.4),
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
 * 创建机械臂工作站。index → ROBOT_CFG.stations。
 * 返回 { id, name, ..., update(simTime), stockIn(n), collectFinished(), phaseLabel() }
 */
export function createRobotStation(index) {
  const cfg = CFG.stations[index];
  const sx = cfg.x, off = cfg.offset;
  const { rSrc, hoverH, carryH, L1, L2, shoulderY } = CFG;
  const aSrc = -Math.PI / 2, aTgt = Math.PI / 2;
  const gripHOf = (layer) => M.pieceCY0 + 0.5 + 0.45 + layer * PITCH;   // 层顶 + 0.45

  const mats = {
    trim:   new THREE.MeshStandardMaterial({ color: COLORS.lightGray, roughness: 0.8 }),
    dark:   new THREE.MeshStandardMaterial({ color: COLORS.darkGray,  roughness: 0.55, metalness: 0.25 }),
    orange: new THREE.MeshStandardMaterial({ color: COLORS.orange,    roughness: 0.45, metalness: 0.15 }),
    piece:  new THREE.MeshStandardMaterial({ color: COLORS.lightGray, roughness: 0.5 }),
    lamp:   new THREE.MeshStandardMaterial({ color: COLORS.orange,    roughness: 0.4, emissive: COLORS.orange, emissiveIntensity: 0.8 }),
  };
  mats.lamp.userData.noHighlight = true;

  const station = new THREE.Group();
  station.position.set(sx, APRON.h, APRON.z);

  // —— 静态结构 ——
  mesh(station, GEO.pedestal, mats.trim, 0, 0.25, 0);
  mesh(station, GEO.column, mats.dark, 0, 1.65, 0);
  mesh(station, GEO.band, mats.orange, 0, 2.55, 0);

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

  // —— 料位（-x 侧，4 层）/ 成品位（+x 侧，3 层）托盘 ——
  mesh(station, GEO.pallet, mats.dark, -rSrc, 0.09, 0);
  mesh(station, GEO.pallet, mats.trim, rSrc, 0.09, 0);

  const mkPiece = (mat) => {
    const p = mesh(station, GEO.piece, mat, 0, 0, 0);
    mesh(p, GEO.plate, mats.orange, 0, 0.53, 0);
    p.scale.setScalar(0.0001);
    return p;
  };
  const stockMeshes = [];
  for (let i = 0; i < M.stockMax; i++) stockMeshes.push(mkPiece(mats.piece));
  const targetMeshes = [];
  for (let i = 0; i < M.targetMax; i++) targetMeshes.push(mkPiece(mats.piece));
  const carried = mkPiece(mats.piece);   // 搬运中的工件（挂接于腕部）

  // —— 控制柜 + 堆叠状态灯 ——
  mesh(station, GEO.cabinet, mats.trim, 2.2, 0.75, -2.2);
  mesh(station, GEO.pole, mats.dark, 2.2, 1.95, -2.2);
  mesh(station, GEO.lamp, mats.dark, 2.2, 2.51, -2.2);
  mesh(station, GEO.lamp, mats.trim, 2.2, 2.73, -2.2);
  mesh(station, GEO.lamp, mats.lamp, 2.2, 2.95, -2.2);

  // —— 队列状态（事件门控的"工件级任务队列"）——
  let stock = M.prestock;
  let target = 0;
  let simNow = 0;
  const stockAppear = new Array(M.stockMax).fill(-10);          // 层出现时刻（预置料即满显）
  const targetAppear = new Array(M.targetMax).fill(Infinity);
  const targetClear = new Array(M.targetMax).fill(-10);         // 层被取走时刻
  let phase = ROBOT_PHASE.WAIT;
  let tEnter = off;                     // 进入当前相位时的仿真时刻（B 站错峰）
  let grabLayer = 0;                    // 本次抓取层
  let placeLayer = 0;                   // 本次落位层
  let grabDone = false, placeDone = false;

  function enter(ph, t) {
    phase = ph;
    tEnter = t;
    grabDone = false;
    placeDone = false;
    if (ph === ROBOT_PHASE.GRASP) grabLayer = stock - 1;
    if (ph === ROBOT_PHASE.PLACE) placeLayer = target;
  }

  /** 物料 AGV 卸料入口：加料至料位（返回实际接收数） */
  function stockIn(n) {
    const added = Math.min(n, M.stockMax - stock);
    for (let i = 0; i < added; i++) stockAppear[stock + i] = simNow + i * 0.15;
    stock += added;
    return added;
  }

  /** 物料 AGV 收取成品入口：取走全部成品（返回数量） */
  function collectFinished() {
    const n = target;
    for (let i = 0; i < n; i++) targetClear[i] = simNow + i * 0.1;
    target = 0;
    return n;
  }

  /** 每帧驱动（唯一入参：全局仿真时间） */
  function update(simTime) {
    simNow = simTime;

    // —— 显式状态机（事件门控转移，全部条件逐条列出）——
    const el = simTime - tEnter;
    if (phase === ROBOT_PHASE.WAIT) {
      // 顶层淡入完成门控：stockIn 刚发生时顶层 mesh 仍在淡入，须等 0.4s 再抓
      const topReady = stock <= 0 || simTime >= stockAppear[stock - 1] + 0.4;
      if (stock > 0 && target < M.targetMax && el >= M.minWait && topReady) enter(ROBOT_PHASE.GRASP, simTime);
    } else if (phase === ROBOT_PHASE.GRASP) {
      if (el >= DUR.GRASP) enter(ROBOT_PHASE.TRANSFER, simTime);
    } else if (phase === ROBOT_PHASE.TRANSFER) {
      if (el >= DUR.TRANSFER) enter(ROBOT_PHASE.PLACE, simTime);
    } else if (phase === ROBOT_PHASE.PLACE) {
      if (el >= DUR.PLACE) { target += 1; targetAppear[placeLayer] = simTime; enter(ROBOT_PHASE.RETRACT, simTime); }
    } else if (phase === ROBOT_PHASE.RETRACT) {
      if (el >= DUR.RETRACT) enter(ROBOT_PHASE.WAIT, simTime);
    }
    const e2 = simTime - tEnter;
    const p = Math.min(1, Math.max(0, e2 / DUR[phase]));

    // —— 挂接 reconcile：TRANSFER/PLACE 期间工件挂于腕部（与帧序无关）——
    const shouldAttach = phase === ROBOT_PHASE.TRANSFER || phase === ROBOT_PHASE.PLACE;
    if (shouldAttach && carried.parent !== wrist) {
      carried.position.set(-rSrc, M.pieceCY0 + grabLayer * PITCH, 0);   // 抓取层中心（attach 保持世界位姿）
      carried.scale.setScalar(1);
      wrist.attach(carried);
    } else if (!shouldAttach && carried.parent !== station) {
      station.attach(carried);
      carried.visible = phase !== ROBOT_PHASE.GRASP || p < 0.85;
    }
    if (phase === ROBOT_PHASE.TRANSFER) carried.visible = true;

    // —— 圆柱坐标目标轨迹（相位边界 C0 连续）——
    let az, h;
    if (phase === ROBOT_PHASE.WAIT) {
      az = aSrc;
      const env = smooth01(p / 0.25) * smooth01((1 - p) / 0.25);
      h = hoverH + Math.sin(simTime * 1.6) * 0.07 * env;
    } else if (phase === ROBOT_PHASE.GRASP) {
      az = aSrc;
      h = lerp(hoverH, gripHOf(grabLayer), easeInOut(p));
    } else if (phase === ROBOT_PHASE.TRANSFER) {
      az = lerp(aSrc, aTgt, easeInOut(p));
      h = lerp(gripHOf(grabLayer), carryH, easeInOut(p));
    } else if (phase === ROBOT_PHASE.PLACE) {
      az = aTgt;
      h = lerp(carryH, gripHOf(placeLayer), easeInOut(p));
    } else {   // RETRACT
      az = lerp(aTgt, aSrc, easeInOut(p));
      h = lerp(gripHOf(placeLayer), hoverH, easeInOut(p));
    }

    const ty = h + 0.55;
    const { gamma, delta } = solveIK(rSrc, ty - shoulderY, L1, L2);
    turret.rotation.y = az;
    shoulder.rotation.x = gamma;
    elbow.rotation.x = delta;
    wrist.rotation.x = -(gamma + delta);

    // —— 手指开合 ——
    let open;
    if (phase === ROBOT_PHASE.WAIT) open = 1;
    else if (phase === ROBOT_PHASE.GRASP) open = p < 0.7 ? 1 : 1 - easeInOut((p - 0.7) / 0.3);
    else if (phase === ROBOT_PHASE.RETRACT) open = easeInOut(Math.min(p / 0.3, 1));
    else open = 0;
    const fx = 0.935 + 0.425 * open;
    fingerL.position.x = -fx;
    fingerR.position.x = fx;

    // —— 料位工件可见性（抓取交叉淡出/上料淡入）——
    for (let i = 0; i < M.stockMax; i++) {
      let s = 0;
      if (i < stock) s = smooth01((simTime - stockAppear[i]) / 0.4);
      if (phase === ROBOT_PHASE.GRASP && i === grabLayer) {
        s = Math.min(s, 1 - smooth01((p - 0.7) / 0.15));
      }
      stockMeshes[i].scale.setScalar(Math.max(0.0001, s));
    }

    // —— 成品位工件可见性（落位淡入/收取淡出）——
    for (let i = 0; i < M.targetMax; i++) {
      let s = 0;
      if (i < target) s = smooth01((simTime - targetAppear[i]) / 0.4);
      const sinceClear = simTime - targetClear[i];
      if (sinceClear >= 0 && sinceClear < 0.4) {
        s = Math.min(s, 1 - sinceClear / 0.3);   // 仅收取后短暂窗口内淡出
      }
      targetMeshes[i].scale.setScalar(Math.max(0.0001, s));
    }

    // —— 搬运工件可见性（抓取末端淡入 / 落位末端淡出）——
    if (phase === ROBOT_PHASE.GRASP) {
      carried.position.set(-rSrc, M.pieceCY0 + grabLayer * PITCH, 0);   // 淡入于抓取点
      carried.visible = p >= 0.85;
      carried.scale.setScalar(Math.max(0.0001, smooth01((p - 0.85) / 0.1)));
    } else if (phase === ROBOT_PHASE.PLACE) {
      carried.visible = p < 0.9;
      carried.scale.setScalar(Math.max(0.0001, 1 - smooth01((p - 0.85) / 0.1)));
    }
  }

  function phaseLabel() {
    return `${PHASE_LABEL[phase]} · 料 ${stock}/${M.stockMax} · 成品 ${target}/${M.targetMax}`;
  }

  return {
    id: `robot-${index === 0 ? 'a' : 'b'}`,
    name: `机械臂工作站 ${index === 0 ? 'A' : 'B'}`,
    status: '运行中 · 事件门控五阶段作业',
    desc: '等待→抓取→搬运→落位→回位；料位/成品位由物料 AGV 队列推拉（P4 已启用），相位由全局仿真时钟推算。',
    group: station,
    focus: {
      target: new THREE.Vector3(sx, 3.5, APRON.z),
      camPos: new THREE.Vector3(sx + 24, 13, APRON.z + 23),
    },
    update,
    stockIn,
    collectFinished,
    phaseLabel,
  };
}

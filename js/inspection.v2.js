// ============================================================
// inspection.v2.js —— 模组检测工位（P2 实现，替代 v1 桩）
// 四阶段状态机：CLAMP 夹紧 → PROBE 探针接触 → SCANNING 检测中
//   → RESULT 结果反馈（前后各带 IDLE 上料缓冲，周期 20s）
// 实现要点（§7）：
//   - 相位由 simClock.simTime 推算（tc = simTime % 周期），无局部计时器；
//   - 显式枚举 + 周期表，转移条件即时间窗口边界（无 if 堆叠隐式状态）；
//   - 检测结果序列确定性：第 k 循环 k%10===7 时 NG，面板可推算良率；
//   - 指示灯 emissive 状态机（已标记 noHighlight，不参与拾取高亮）。
// ============================================================

import * as THREE from 'three';
import { COLORS, INSPECT_CFG } from './config.v2.js';

export const INSPECT_PHASE = {
  IDLE: 'IDLE',
  CLAMP: 'CLAMP',
  PROBE: 'PROBE',
  SCANNING: 'SCANNING',
  RESULT: 'RESULT',
};

export const PHASE_LABEL = {
  IDLE: '上料',
  CLAMP: '夹紧',
  PROBE: '探针接触',
  SCANNING: '检测中',
  RESULT: '结果反馈',
};

const ORDER = [INSPECT_PHASE.IDLE, INSPECT_PHASE.CLAMP, INSPECT_PHASE.PROBE, INSPECT_PHASE.SCANNING, INSPECT_PHASE.RESULT];
const CYCLE_TABLE = INSPECT_CFG.cycle;
const TOTAL = ORDER.reduce((s, k) => s + CYCLE_TABLE[k], 0);

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

function phaseAt(tc) {
  let acc = 0;
  for (const ph of ORDER) {
    const d = CYCLE_TABLE[ph];
    if (tc < acc + d) return { phase: ph, p: (tc - acc) / d };
    acc += d;
  }
  return { phase: ORDER[0], p: 0 };
}

// —— 构件几何（模块内共享）——
const GEO = {
  pad:   new THREE.BoxGeometry(8, 0.5, 8),
  bench: new THREE.BoxGeometry(3, 1.1, 1.6),
  post:  new THREE.BoxGeometry(0.22, 3.6, 0.22),
  beam:  new THREE.BoxGeometry(3.9, 0.25, 0.3),
  rod:   new THREE.BoxGeometry(0.14, 1.1, 0.14),
  tip:   new THREE.BoxGeometry(0.18, 0.16, 0.18),
  jaw:   new THREE.BoxGeometry(0.14, 0.7, 1.3),
  piece: new THREE.BoxGeometry(1.3, 1.0, 1.3),
  plate: new THREE.BoxGeometry(0.9, 0.06, 0.9),
  lamp:  new THREE.BoxGeometry(0.3, 0.36, 0.3),
};

const mesh = (parent, geo, mat, x, y, z) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
};

const JAW_OPEN = 1.3, JAW_CLOSED = 0.74;   // 夹爪中心 x（工件半宽 0.65 + 间隙）
const PROBE_DROP = 0.24;                    // 探针行程（尖端 2.84 → 2.60 恰触工件顶面）
const PIECE_Y = 2.1;                        // 工件中心高（台面 1.6 + 半高 0.5）
const LAMP_OK = 0xdfe5ea, LAMP_OFF = 0x2a2e33;

export function createInspectionStation() {
  const { x, z } = INSPECT_CFG;

  // —— 工位专属材质（高亮隔离；指示灯 noHighlight）——
  const mats = {
    trim:  new THREE.MeshStandardMaterial({ color: COLORS.lightGray, roughness: 0.8 }),
    dark:  new THREE.MeshStandardMaterial({ color: COLORS.darkGray,  roughness: 0.55, metalness: 0.25 }),
    orange:new THREE.MeshStandardMaterial({ color: COLORS.orange,    roughness: 0.45, metalness: 0.15 }),
    piece: new THREE.MeshStandardMaterial({ color: COLORS.lightGray, roughness: 0.5 }),
    lamp:  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: LAMP_OFF, emissiveIntensity: 0.1 }),
  };
  mats.lamp.userData.noHighlight = true;

  const g = new THREE.Group();
  g.position.set(x, 0, z);

  // 检测平台 + 检测台 + 工件（含橙色顶牌随动）
  mesh(g, GEO.pad, mats.trim, 0, 0.25, 0);
  mesh(g, GEO.bench, mats.dark, 0, 1.05, 0);
  const piece = mesh(g, GEO.piece, mats.piece, 0, PIECE_Y, 0);
  mesh(piece, GEO.plate, mats.orange, 0, 0.53, 0);
  piece.scale.setScalar(0.0001);   // 开场等待上料淡入

  // 龙门架：双立柱 + 横梁（探针悬于工件正上方）
  mesh(g, GEO.post, mats.trim, -1.75, 2.3, 0);
  mesh(g, GEO.post, mats.trim, 1.75, 2.3, 0);
  mesh(g, GEO.beam, mats.dark, 0, 4.225, 0);

  // 探针组件（可动：竖直进给 + 检测中横向扫描）
  const probe = new THREE.Group();
  probe.position.set(0, 4.1, 0);
  g.add(probe);
  mesh(probe, GEO.rod, mats.orange, 0, -0.55, 0);
  mesh(probe, GEO.tip, mats.dark, 0, -1.18, 0);

  // 夹爪 ×2（工作台面滑移）
  const jawL = mesh(g, GEO.jaw, mats.orange, -JAW_OPEN, 1.95, 0);
  const jawR = mesh(g, GEO.jaw, mats.orange, JAW_OPEN, 1.95, 0);

  // 结果指示灯（东立柱顶）
  const lamp = mesh(g, GEO.lamp, mats.lamp, 1.75, 4.28, 0);
  lamp.castShadow = false;

  let curCycle = 0, curNG = false;

  function update(simTime) {
    const tc = ((simTime % TOTAL) + TOTAL) % TOTAL;
    const { phase, p } = phaseAt(tc);
    curCycle = Math.floor(simTime / TOTAL);
    curNG = curCycle % INSPECT_CFG.ngEvery.mod === INSPECT_CFG.ngEvery.at;

    // —— 夹爪开合（显式分相位求值，时间驱动无隐式状态）——
    let close = 0;
    if (phase === INSPECT_PHASE.CLAMP) close = easeInOut(p);
    else if (phase === INSPECT_PHASE.PROBE || phase === INSPECT_PHASE.SCANNING) close = 1;
    else if (phase === INSPECT_PHASE.RESULT) close = p < 0.34 ? 1 - easeInOut(p / 0.34) : 0;
    const jx = lerp(JAW_OPEN, JAW_CLOSED, close);
    jawL.position.x = -jx;
    jawR.position.x = jx;

    // —— 探针进给 + 检测中横向扫描（窗口端点归零保证相位边界连续）——
    let drop = 0, scanX = 0;
    if (phase === INSPECT_PHASE.PROBE) drop = easeInOut(p) * PROBE_DROP;
    else if (phase === INSPECT_PHASE.SCANNING) {
      drop = PROBE_DROP;
      const env = Math.max(0, Math.min(1, p / 0.12, (1 - p) / 0.12));
      scanX = Math.sin(simTime * 2.2) * 0.22 * env;
    } else if (phase === INSPECT_PHASE.RESULT && p < 0.3) {
      drop = PROBE_DROP * (1 - easeInOut(p / 0.3));
    }
    probe.position.y = 4.1 - drop;
    probe.position.x = scanX;

    // —— 指示灯 emissive 状态机 ——
    if (phase === INSPECT_PHASE.SCANNING) {
      mats.lamp.emissive.setHex(LAMP_OK);
      mats.lamp.emissiveIntensity = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(simTime * Math.PI * 2 * 3));
    } else if (phase === INSPECT_PHASE.RESULT) {
      if (curNG) {
        mats.lamp.emissive.setHex(COLORS.orange);
        mats.lamp.emissiveIntensity = Math.sin(simTime * Math.PI * 2 * 4) > 0 ? 1.4 : 0.3;
      } else {
        mats.lamp.emissive.setHex(LAMP_OK);
        mats.lamp.emissiveIntensity = 1.2;
      }
    } else if (phase === INSPECT_PHASE.IDLE) {
      mats.lamp.emissive.setHex(LAMP_OFF);
      mats.lamp.emissiveIntensity = 0.1;
    } else {   // CLAMP / PROBE
      mats.lamp.emissive.setHex(LAMP_OK);
      mats.lamp.emissiveIntensity = 0.5;
    }

    // —— 工件上料/下线（缩放淡入淡出，掩盖循环边界换件）——
    let s = 1;
    if (phase === INSPECT_PHASE.IDLE && p < 0.3) s = easeInOut(p / 0.3);
    if (phase === INSPECT_PHASE.RESULT && p > 0.9) s = 1 - easeInOut((p - 0.9) / 0.1);
    piece.scale.setScalar(Math.max(0.0001, s));
  }

  /** 当前循环结果（面板遥测） */
  function resultLabel() {
    return `第 ${curCycle + 1} 循环 · ${curNG ? 'NG 复检' : 'OK'}`;
  }

  /** 累计良率（面板模块标签）：k < n 且 k%10===7 的循环为 NG */
  function rateLabel() {
    const n = curCycle + 1;
    let cnt = 0;
    for (let k = INSPECT_CFG.ngEvery.at; k < n; k += INSPECT_CFG.ngEvery.mod) cnt++;
    const pct = n > 0 ? Math.round(((n - cnt) / n) * 100) : 100;
    return `良率 ${pct}%`;
  }

  return {
    id: 'inspection',
    name: '模组检测工位',
    status: '运行中 · 四阶段循环检测',
    desc: '夹紧 → 探针接触 → 检测中 → 结果反馈；每 10 循环 1 次 NG 复检演示，指示灯状态联动。',
    group: g,
    focus: {
      target: new THREE.Vector3(x, 2.5, z),
      camPos: new THREE.Vector3(x + 20, 12, z + 19),
    },
    update,
    resultLabel,
    rateLabel,
  };
}

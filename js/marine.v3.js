// ============================================================
// marine.v3.js —— 船舶靠离调度 + STS 岸桥装卸（P4 实现）
// ------------------------------------------------------------
// 班期（T=360s，相位表见 config.v3.js MARINE_CFG）：
//   A 轮：进港 [0,40]（减速靠泊）→ 靠泊装卸 [40,150]（9 箱×10s+4s 延迟）
//         → 回转+离港 [150,180]（加速驶离）→ 航次外 [180,360)
//   B 轮：整体 +180 错峰。两轮走廊在时域上无重叠（已核算）。
// STS 岸桥：大车沿 x 行走（泊位间转移走船离港窗口，轨 z 88/96），
//   小车沿臂行走（z 62..112 悬臂覆盖堆场取箱列与船位），
//   吊具竖直升降；抓取=堆场箱隐藏（yardAPI）+吊具箱显形，
//   落箱=吊具箱隐藏+甲板箱显形（同帧同位交换，无跳变）。
// 实现要点（§7）：
//   - 全部位姿/事件由 simClock.simTime 纯函数推导（tl 局部相位 + 关键帧表），
//     无逐帧计时器、无一次性副作用 —— 暂停自然停走，恢复连续无跳变；
//   - 堆场箱可见性、甲板箱可见性、吊具持箱均为 tl 的纯函数。
// ============================================================

import * as THREE from 'three';
import { COLORS, MARINE_CFG as M } from './config.v3.js';

const PAL = [COLORS.orange, COLORS.lightGray, COLORS.darkGray];
const easeOutQ = (u) => 1 - (1 - u) * (1 - u);
const easeInQ = (u) => u * u;
const smooth01 = (t) => Math.min(1, Math.max(0, t));
const lerp = (a, b, f) => a + (b - a) * f;
const mod = (v, m) => ((v % m) + m) % m;

// —— 装卸周期关键帧（u: 周期内进度 0..1）——
// [u, cx, trolleyZ, hangY]；u<0.25 段从"上周期结束位姿"插值；
// 落箱高度 dropY 动态取自船体当前 y（含吃水与起伏），保证落位精确。
function cycleKeyframes(k, ship, shipY) {
  const row = k % 2 === 0 ? -M.rowPitch : M.rowPitch;
  const dropZ = M.berthZ + row;
  const grabY = M.yardY + M.hangOffY;                 // 4.52
  const dropY = shipY + M.deckY + M.hangOffY;         // 动态：随船体起伏/吃水
  const prevZ = k === 0 ? M.idleZ : M.berthZ + ((k - 1) % 2 === 0 ? -M.rowPitch : M.rowPitch);
  const prevX = ship.berthX;
  const slot = ship.order[k];
  return {
    kf: [
      [0.00, prevX,    prevZ,    M.hangIdleY],
      [0.25, slot.x,   slot.z,   M.hangIdleY],
      [0.45, slot.x,   slot.z,   grabY],
      [0.55, slot.x,   slot.z,   grabY],
      [0.75, slot.x,   slot.z,   M.carryY],
      [0.80, ship.berthX, dropZ,  M.carryY],
      [0.92, ship.berthX, dropZ,  dropY],
      [1.00, ship.berthX, dropZ,  M.hangIdleY],
    ],
    slot,
    dropZ,
  };
}

function interpKF(kf, u) {
  let a = kf[0], b = kf[kf.length - 1];
  for (let i = 0; i < kf.length - 1; i++) {
    if (u >= kf[i][0] && u <= kf[i + 1][0]) {
      a = kf[i];
      b = kf[i + 1];
      break;
    }
  }
  const span = b[0] - a[0] || 1;
  const f = smooth01((u - a[0]) / span);
  return {
    cx: lerp(a[1], b[1], f),
    z: lerp(a[2], b[2], f),
    hang: lerp(a[3], b[3], f),
  };
}

// —— 船体构件几何（两船共享）——
const GEO = {
  hull:   new THREE.BoxGeometry(50, 2.4, 9.6),
  bow:    new THREE.BoxGeometry(8, 2.4, 5.5),
  stern:  new THREE.BoxGeometry(4, 2.4, 7),
  house:  new THREE.BoxGeometry(9, 6.5, 8),
  bridge: new THREE.BoxGeometry(10, 2.2, 8.6),
  glass:  new THREE.BoxGeometry(10.2, 0.5, 8.8),
  funnel: new THREE.BoxGeometry(2, 1.8, 2.6),
  hatch:  new THREE.BoxGeometry(7, 0.4, 5.2),
  slot:   new THREE.BoxGeometry(6.1, 2.6, 2.44),
};
const SLOT_XS = [-14, -6.8, 0.4, 7.6, 14.8];   // 5 列 × 2 行（用前 9）

const mesh = (parent, geo, mat, x, y, z) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
};

function buildShip(cfg, idx) {
  const mats = {
    hull:  new THREE.MeshStandardMaterial({ color: COLORS.darkGray,  roughness: 0.6, metalness: 0.15, transparent: true }),
    trim:  new THREE.MeshStandardMaterial({ color: COLORS.lightGray, roughness: 0.75, transparent: true }),
    orange:new THREE.MeshStandardMaterial({ color: COLORS.orange,    roughness: 0.5, transparent: true }),
    glass: new THREE.MeshStandardMaterial({ color: COLORS.glass,     roughness: 0.25, metalness: 0.3, transparent: true }),
    c0:    new THREE.MeshStandardMaterial({ color: PAL[0], roughness: 0.65, transparent: true }),
    c1:    new THREE.MeshStandardMaterial({ color: PAL[1], roughness: 0.65, transparent: true }),
    c2:    new THREE.MeshStandardMaterial({ color: PAL[2], roughness: 0.65, transparent: true }),
  };
  const slotMats = [mats.c0, mats.c1, mats.c2];

  const g = new THREE.Group();
  mesh(g, GEO.hull, mats.hull, -2, 1.2, 0);      // -27..23
  mesh(g, GEO.bow, mats.hull, 27, 1.2, 0);       // 23..31（收窄船艏）
  mesh(g, GEO.stern, mats.hull, -29, 1.2, 0);    // -31..-27
  mesh(g, GEO.house, mats.trim, -22, 5.65, 0);
  mesh(g, GEO.bridge, mats.trim, -22, 10.0, 0);
  mesh(g, GEO.glass, mats.glass, -22, 10.5, 0);
  mesh(g, GEO.funnel, mats.orange, -22, 12.1, 0);

  // 舱盖 + 甲板箱位（9 只，落箱后随船出港）
  const colXs = SLOT_XS;
  const hatchXs = [-10.4, -3.2, 4.0, 11.2];
  hatchXs.forEach((hx) => mesh(g, GEO.hatch, mats.trim, hx, 2.6, 0));
  const slotBoxes = [];
  for (let k = 0; k < 9; k++) {
    const col = Math.floor(k / 2);
    const row = k % 2 === 0 ? -1 : 1;
    const b = mesh(g, GEO.slot, slotMats[k % 3], colXs[col], 3.7, row * M.rowPitch);
    b.visible = false;
    slotBoxes.push(b);
  }

  return { cfg, idx, group: g, mats: Object.values(mats), slotBoxes };
}

export function createMarine(scene, yardAPI) {
  const group = new THREE.Group();
  scene.add(group);

  const ships = M.ships.map((cfg, i) => {
    const s = buildShip(cfg, i);
    s.slotMatsPalette = PAL;
    // 取箱顺序：按与泊位的 x 距离升序（就近先取，减少大车行程）
    s.order = [...yardAPI.slots].sort(
      (a, b) => Math.abs(a.x - cfg.berthX) - Math.abs(b.x - cfg.berthX) || a.z - b.z
    );
    group.add(s.group);
    return s;
  });

  // —— STS 岸桥 ——
  const rails = new THREE.Group();
  M.crane.railZs.forEach((rz) => {
    const r = mesh(rails, new THREE.BoxGeometry(90, 0.14, 0.5),
      new THREE.MeshStandardMaterial({ color: COLORS.darkGray, roughness: 0.5, metalness: 0.3 }),
      65, 1.67, rz);
    r.castShadow = false;
  });
  group.add(rails);

  const crane = new THREE.Group();          // position.x = 大车行程
  group.add(crane);
  const craneMatOrange = new THREE.MeshStandardMaterial({ color: COLORS.orange, roughness: 0.5, metalness: 0.2 });
  const craneMatDark = new THREE.MeshStandardMaterial({ color: COLORS.darkGray, roughness: 0.55, metalness: 0.25 });

  M.crane.legXs.forEach((lx) => {
    M.crane.railZs.forEach((rz) => {
      mesh(crane, new THREE.BoxGeometry(1.6, 16.6, 1.6), craneMatOrange, lx, 9.9, rz);
    });
  });
  mesh(crane, new THREE.BoxGeometry(3.4, 1.8, 50), craneMatDark, 0, M.crane.beamY, 87);   // 主梁 z 62..112
  mesh(crane, new THREE.BoxGeometry(22, 1.2, 1.4), craneMatOrange, 0, 8.0, 92);           // 下横梁
  mesh(crane, new THREE.BoxGeometry(6, 3, 5), craneMatDark, -6, 19.6, 92);                // 机器房
  mesh(crane, new THREE.BoxGeometry(0.8, 2.7, 0.8), craneMatDark, 7, 14.95, 99);          // 司机室吊杆
  mesh(crane, new THREE.BoxGeometry(2.2, 2.2, 2.6), craneMatOrange, 7, 12.5, 99);         // 司机室

  const trolley = new THREE.Group();
  trolley.position.set(0, M.crane.trolleyY, M.idleZ);
  crane.add(trolley);
  mesh(trolley, new THREE.BoxGeometry(4.5, 2.0, 3.2), craneMatDark, 0, 0, 0);
  const rope = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1, 0.14), craneMatDark);
  rope.castShadow = false;
  trolley.add(rope);

  const spreader = new THREE.Group();       // local y = hangY - trolleyY
  trolley.add(spreader);
  mesh(spreader, new THREE.BoxGeometry(6.3, 0.5, 2.7), craneMatOrange, 0, 0, 0);
  [[-2.9, -1.1], [2.9, -1.1], [-2.9, 1.1], [2.9, 1.1]].forEach(([sx, sz]) =>
    mesh(spreader, new THREE.BoxGeometry(0.4, 0.6, 0.4), craneMatDark, sx, 0, sz)
  );
  const heldMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 });
  const heldBox = new THREE.Mesh(GEO.slot, heldMat);
  heldBox.position.set(0, -M.hangOffY, 0);
  heldBox.visible = false;
  heldBox.castShadow = true;
  spreader.add(heldBox);

  crane.position.x = M.crane.initX;

  // —— 状态工具（全部纯函数）——
  const shipTL = (ship, t) => mod(t - ship.cfg.t0, M.T);

  // 每船：堆场列表序号 j → 该船抓到此箱的时刻（order 与列表序不同序，需映射）
  ships.forEach((ship) => {
    ship.grabTByList = yardAPI.slots.map((sl) => {
      const oi = ship.order.findIndex((o) => o.k === sl.k);
      return oi >= 0 ? grabT(oi) : undefined;
    });
  });

  function dropT(k) { return M.approachDur + M.loadDelay + k * M.loadDur + 0.95 * M.loadDur; }
  function grabT(k) { return M.approachDur + M.loadDelay + k * M.loadDur + 0.5 * M.loadDur; }

  function loadedCount(tl) {
    if (tl < dropT(0)) return 0;
    return Math.min(M.loadN, Math.floor((tl - dropT(0)) / M.loadDur) + 1);
  }

  /** 堆场箱 j 是否处于"已被吊起"状态（任一船已过该箱的抓取时刻且未驶离） */
  function yardHidden(j, t) {
    for (const ship of ships) {
      const tl = shipTL(ship, t);
      const gt = ship.grabTByList[j];
      if (gt !== undefined && tl >= gt && tl < M.approachDur + M.berthDur) return true;
    }
    return false;
  }

  /** 船相位：{ x, yaw, alpha, phase } */
  function shipPose(ship, t) {
    const tl = shipTL(ship, t);
    const bx = ship.cfg.berthX;
    let x, yaw = Math.PI / 2, alpha = 1, phase;
    if (tl < M.approachDur) {
      const u = tl / M.approachDur;
      x = lerp(M.sailMinX, bx, easeOutQ(u));
      alpha = smooth01(tl / M.fade);
      phase = '进港';
    } else if (tl < M.approachDur + M.berthDur) {
      x = bx;
      const n = loadedCount(tl);
      phase = n > 0 && n < M.loadN ? `装卸 ${n}/${M.loadN}` : (tl < M.approachDur + M.loadDelay ? '靠泊' : '待发');
    } else if (tl < M.approachDur + M.berthDur + M.departDur) {
      const tl2 = tl - M.approachDur - M.berthDur;    // 0..30
      if (tl2 < M.turnDur) {
        x = bx;
        yaw = lerp(Math.PI / 2, -Math.PI / 2, smooth01(tl2 / M.turnDur));
      } else {
        x = lerp(bx, M.sailMinX, easeInQ((tl2 - M.turnDur) / (M.departDur - M.turnDur)));
        yaw = -Math.PI / 2;
      }
      alpha = tl > M.approachDur + M.berthDur + M.departDur - M.fadeOut
        ? 1 - smooth01((tl - (M.approachDur + M.berthDur + M.departDur - M.fadeOut)) / M.fadeOut)
        : 1;
      phase = '离港';
    } else {
      x = M.sailMinX;
      alpha = 0;
      phase = '航次外';
    }
    return { x, yaw, alpha, phase, tl };
  }

  // 堆场缩放缓存（避免每帧重写矩阵）
  const yardLast = new Map();

  let lastLabel = '待班';

  function update(t) {
    // —— 船舶 ——
    const poses = ships.map((ship) => {
      const p = shipPose(ship, t);
      const g = ship.group;
      g.position.x = p.x;
      g.position.z = M.berthZ;
      const sink = loadedCount(p.tl) * M.sinkPer;
      const amp = p.phase === '靠泊' || p.phase.startsWith('装卸') || p.phase === '待发' ? M.bobBerth : M.bobSail;
      g.position.y = -0.6 - sink + Math.sin(t * Math.PI * 2 * M.bobFreq + ship.idx * 1.7) * amp;
      g.rotation.y = p.yaw;
      g.visible = p.alpha > 0.02;
      ship.mats.forEach((m) => { m.opacity = p.alpha; });
      // 甲板箱显形（纯时间规则）
      ship.slotBoxes.forEach((b, k) => { b.visible = p.tl >= dropT(k); });
      return p;
    });

    // —— 堆场箱隐藏/恢复（纯时间规则；带缓存避免重复写矩阵）——
    for (let j = 0; j < yardAPI.slots.length; j++) {
      const hidden = yardHidden(j, t);
      const s = hidden ? 0.0001 : 1;
      if (yardLast.get(j) !== s) {
        yardAPI.setScale(yardAPI.slots[j].k, s);
        yardLast.set(j, s);
      }
    }

    // —— 岸桥位姿 ——
    // 1) 找当前装卸周期（两船窗口不重叠）
    let active = null;
    for (const ship of ships) {
      const tl = shipTL(ship, t);
      if (tl >= M.approachDur + M.loadDelay && tl < M.approachDur + M.loadDelay + M.loadN * M.loadDur) {
        active = { ship, tl, k: Math.floor((tl - M.approachDur - M.loadDelay) / M.loadDur), u: ((tl - M.approachDur - M.loadDelay) / M.loadDur) % 1 };
        break;
      }
    }
    // 2) 装卸刚结束 → 3s 内从周期末位姿缓动回怠速位姿
    let pose;
    let blendAfter = null;
    for (const ship of ships) {
      const endT = M.approachDur + M.loadDelay + M.loadN * M.loadDur;
      const tl = shipTL(ship, t);
      if (tl >= endT && tl < endT + 3) blendAfter = { ship, tl, f: smooth01((tl - endT) / 3) };
    }
    if (active) {
      const ck = cycleKeyframes(active.k, active.ship, active.ship.group.position.y);
      pose = interpKF(ck.kf, active.u);
      // 吊具持箱与颜色（纯函数：u ∈ [0.5, 0.95)）
      const holding = active.u >= 0.5 && active.u < 0.95;
      heldBox.visible = holding;
      if (holding) heldMat.color.set(PAL[ck.slot.colorIdx]);
    } else if (blendAfter) {
      const ck = cycleKeyframes(M.loadN - 1, blendAfter.ship, blendAfter.ship.group.position.y);
      const end = interpKF(ck.kf, 1.0);
      pose = {
        cx: end.cx,                                            // 停在泊位（怠速 cx 与之重合）
        z: lerp(end.z, M.idleZ, blendAfter.f),
        hang: lerp(end.hang, M.hangIdleY, blendAfter.f),
      };
      heldBox.visible = false;
    } else {
      pose = { cx: idleCX(t), z: M.idleZ, hang: M.hangIdleY };
      heldBox.visible = false;
    }

    crane.position.x = pose.cx;
    trolley.position.z = pose.z;
    spreader.position.y = pose.hang - M.crane.trolleyY;
    const ropeLen = Math.max(0.3, (M.crane.trolleyY - 1.0) - (pose.hang + 0.25));
    rope.scale.y = ropeLen;
    rope.position.y = -1.0 - ropeLen / 2;

    // —— 面板文案 ——
    const label = ships.map((ship, i) => `${ship.cfg.name}轮 ${poses[i].phase}`).join(' · ');
    lastLabel = label;
  }

  /** 大车怠速行程（船离港窗口内两泊位间转移；其余时段停驻） */
  function idleCX(t) {
    const tm = mod(t, M.T);
    const { travelA, travelB, initX } = M.crane;
    if (tm >= travelA.win[0] && tm < travelA.win[1]) {
      return lerp(initX, travelA.to, smooth01((tm - travelA.win[0]) / (travelA.win[1] - travelA.win[0])));
    }
    if (tm >= travelA.win[1] && tm < travelB.win[0]) {
      return travelA.to;                                  // 停驻 B 泊位
    }
    if (tm >= travelB.win[0] && tm < travelB.win[1]) {
      return lerp(travelA.to, travelB.to, smooth01((tm - travelB.win[0]) / (travelB.win[1] - travelB.win[0])));
    }
    return initX;                                         // [342,360)∪[0,150) 停驻 A 泊位
  }

  function statusLabel() {
    return lastLabel;
  }

  return { group, update, statusLabel };
}

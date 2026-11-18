// ============================================================
// material.v3.js —— 物料 AGV 调度（P4 实现：工件级任务队列）
// ------------------------------------------------------------
// 2 台物料 AGV（A/B 线）循环执行：
//   仓储装料(batch 4) → 送工位（stockIn 卸料 + collectFinished 收成品）
//   → 有成品则交检测工位（HANDOFF，作为检测线上料叙事）→ 空车返回仓储。
// 机械臂队列门控：料空 → 机械臂待料；成品满 → 机械臂阻塞（由本系统收取解除）。
// 避障（双向）：
//   - 对车队：跟车（gap 11 / lat 2.0）+ n4 路口持锁让行（fleet holder）；
//   - 车队对本系统：material 坐标经 main 注入 fleet update(extras)；
//   - 本系统内：交付位 dI 占用 → 提前 holdDist 停车等待；
//   - 仓储停靠位位于车队路径终点之外，不阻塞车队折返（见 config 注释）。
// 时间规则（§7）：弧长以 simTime 增量积分（暂停自然停走）；显式状态机，
//   过渡位姿用 BLEND 通用状态（起点/终点捕获，smoothstep 插值，yaw 最短弧）。
// ============================================================

import * as THREE from 'three';
import { COLORS, ROAD_GRAPH, MATERIAL_CFG as MC } from './config.v3.js';

const MSTATE = {
  LOAD: 'LOAD',
  RUN_OUT: 'RUN_OUT',
  BLEND: 'BLEND',
  UNLOAD: 'UNLOAD',
  RUN_INS: 'RUN_INS',
  HANDOFF: 'HANDOFF',
  RUN_HOME: 'RUN_HOME',
};

const STATE_LABEL = {
  LOAD: '仓储装料',
  RUN_OUT: '送料途中',
  BLEND: '对位中',
  UNLOAD: '工位装卸',
  RUN_INS: '运往检测',
  HANDOFF: '交付检测',
  RUN_HOME: '返回仓储',
};

// —— 路径（折线弧长参数化 + 右侧行车道偏移）——
class Path {
  constructor(keys) {
    this.pts = keys.map((k) => ROAD_GRAPH.nodes[k]);
    this.segs = [];
    this.L = 0;
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i], b = this.pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      this.segs.push({ x: a.x, z: a.z, dx: dx / len, dz: dz / len, len, c0: this.L });
      this.L += len;
    }
  }
  segAt(s) {
    for (const sg of this.segs) if (s < sg.c0 + sg.len) return sg;
    return this.segs[this.segs.length - 1];
  }
  posAt(s) {
    const sg = this.segAt(s);
    const d = s - sg.c0;
    return [sg.x + sg.dx * d, sg.z + sg.dz * d];
  }
  dirAt(s) {
    let ax = 0, az = 0;
    const win = 4;
    for (const sg of this.segs) {
      const lo = Math.max(sg.c0, s - win);
      const hi = Math.min(sg.c0 + sg.len, s + win);
      const o = hi - lo;
      if (o > 0) { ax += sg.dx * o; az += sg.dz * o; }
    }
    const m = Math.hypot(ax, az);
    if (m < 1e-6) { const sg = this.segAt(s); return [sg.dx, sg.dz]; }
    return [ax / m, az / m];
  }
  /** 车道位姿：中心线 + 右侧偏移（与车队同约定） */
  lanePose(s, off) {
    const [px, pz] = this.posAt(s);
    const [dx, dz] = this.dirAt(s);
    return { x: px + -dz * off, z: pz + dx * off, yaw: Math.atan2(dx, dz) };
  }
}

const yawLerp = (a, b, f) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
};

// —— 车体几何（两车共享）——
const GEO = {
  chassis: new THREE.BoxGeometry(2.3, 0.3, 3.4),
  deck:    new THREE.BoxGeometry(2.1, 0.55, 3.2),
  cab:     new THREE.BoxGeometry(1.5, 0.5, 1.2),
  beacon:  new THREE.BoxGeometry(0.28, 0.22, 0.28),
  crate:   new THREE.BoxGeometry(1.05, 0.85, 1.35),
};
const GEO_T = {
  chassis: GEO.chassis.clone().translate(0, 0.45, 0),
  deck:    GEO.deck.clone().translate(0, 0.875, 0),
  cab:     GEO.cab.clone().translate(0, 1.4, -0.9),
  beacon:  GEO.beacon.clone().translate(0, 1.85, -0.9),
};

const mesh = (parent, geo, mat, x, y, z) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
};

function buildVehicle(scene) {
  const mats = {
    chassis: new THREE.MeshStandardMaterial({ color: COLORS.darkGray,  roughness: 0.6, metalness: 0.2 }),
    deck:    new THREE.MeshStandardMaterial({ color: COLORS.lightGray, roughness: 0.55 }),
    cab:     new THREE.MeshStandardMaterial({ color: 0xffffff,         roughness: 0.4 }),
    beacon:  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0.5 }),
    raw:     new THREE.MeshStandardMaterial({ color: COLORS.lightGray, roughness: 0.6 }),
    fin:     new THREE.MeshStandardMaterial({ color: COLORS.orange,    roughness: 0.55 }),
  };
  const g = new THREE.Group();
  mesh(g, GEO_T.chassis, mats.chassis, 0, 0, 0);
  mesh(g, GEO_T.deck, mats.deck, 0, 0, 0);
  mesh(g, GEO_T.cab, mats.cab, 0, 0, 0);
  mesh(g, GEO_T.beacon, mats.beacon, 0, 0, 0);
  // 货位：料位（车尾 z-0.75，双层）×4 / 成品位（车头 z+0.75，双层）×4
  const rawSlots = [], finSlots = [];
  for (let i = 0; i < 4; i++) {
    rawSlots.push(mesh(g, GEO.crate, mats.raw, (i % 2 === 0 ? -0.55 : 0.55), 1.55 + Math.floor(i / 2) * 0.9, -0.75));
    finSlots.push(mesh(g, GEO.crate, mats.fin, (i % 2 === 0 ? -0.55 : 0.55), 1.55 + Math.floor(i / 2) * 0.9, 0.75));
  }
  rawSlots.concat(finSlots).forEach((m) => { m.visible = false; m.scale.setScalar(0.0001); });
  scene.add(g);
  return { group: g, rawSlots, finSlots, mats };
}

const smooth01 = (t) => Math.min(1, Math.max(0, t));

export function createMaterialSystem(scene, robots, fleetGet) {
  const paths = {
    out:  {}, toIns: {}, home: {},
  };
  for (const line of MC.lines) {
    paths.out[line.id] = new Path(MC.legs.out[line.id]);
    paths.toIns[line.id] = new Path(MC.legs.toIns[line.id]);
    paths.home[line.id] = new Path(MC.legs.home[line.id]);
  }
  const n4Node = ROAD_GRAPH.nodes.n4;
  const dockNode = (key) => ROAD_GRAPH.nodes[key];
  const loadPose = { x: MC.whPose.x, z: MC.whPose.z, yaw: Math.PI };   // 面向南（仓库侧）

  const vehicles = MC.lines.map((line) => {
    const veh = buildVehicle(scene);
    return {
      line,
      ...veh,
      state: MSTATE.LOAD,
      tEnter: line.startAt,
      s: 0,
      lastSim: null,
      blocked: false,
      didAct: false,
      rawCount: 0,
      finCount: 0,
      pose: { ...loadPose },
      blend: null,           // { from, to, next }
      nextPose: null,        // BLEND 结束后的目的地语义
      path: null,
    };
  });

  function enter(v, state, t) {
    v.state = state;
    v.tEnter = t;
    v.didAct = false;
    v.blocked = false;
  }

  /** BLEND：from → to，结束后进入 next 状态 */
  function startBlend(v, from, to, next, t) {
    v.blend = { from: { ...from }, to: { ...to } };
    v.blendNext = next;
    enter(v, MSTATE.BLEND, t);
  }

  function update(simTime) {
    const fleet = fleetGet ? fleetGet() : [];
    for (const v of vehicles) {
      const dt = v.lastSim === null ? 0 : Math.min(5, Math.max(0, simTime - v.lastSim));
      v.lastSim = simTime;
      v.blocked = false;
      const el = simTime - v.tEnter;

      if (v.state === MSTATE.LOAD) {
        if (el >= MC.dwell.load && el >= 0) {
          v.rawCount = Math.min(MC.batch, v.rawCount + MC.batch);   // 保留上轮未接收余料
          startBlend(v, loadPose, paths.out[v.line.id].lanePose(0, MC.laneOffset), MSTATE.RUN_OUT, simTime);
        }
      } else if (v.state === MSTATE.RUN_OUT || v.state === MSTATE.RUN_INS || v.state === MSTATE.RUN_HOME) {
        // —— 避障判定（基于当前位姿）——
        const dir = { x: Math.sin(v.pose.yaw), z: Math.cos(v.pose.yaw) };
        // 车队项为 {x,z}；其他物料车位姿在 .pose 下 —— 统一映射为 {x,z}
        const blockers = [
          ...fleet,
          ...vehicles.filter((u) => u !== v).map((u) => ({ x: u.pose.x, z: u.pose.z })),
        ];
        for (const o of blockers) {
          const rx = o.x - v.pose.x;
          const rz = o.z - v.pose.z;
          const along = rx * dir.x + rz * dir.z;
          if (along > 0.5 && along < MC.followGap) {
            const lat = Math.abs(rx * dir.z - rz * dir.x);
            if (lat < MC.followLat) v.blocked = true;
          }
        }
        // n4 路口让行（仅 out/home 腿穿越 n4；toIns 直达腿 dA→dI 不经 n4，
        // 且 dI 距 n4 仅 10m —— 对 RUN_INS 生效会误挡去程车）
        if (v.state !== MSTATE.RUN_INS) {
          const dhx = n4Node.x - v.pose.x;
          const dhz = n4Node.z - v.pose.z;
          const dN4 = Math.hypot(dhx, dhz);
          const aheadN4 = dhx * dir.x + dhz * dir.z > 0;
          const fleetHolder = fleet.some((f) => Math.hypot(f.x - n4Node.x, f.z - n4Node.z) < MC.n4.r);
          if (fleetHolder && aheadN4 && dN4 > MC.n4.r && dN4 < MC.n4.stop) v.blocked = true;
        }
        // 交付位占用 → 提前停车等待（含对位过渡中的车辆；仅去程且终点为 dI）
        if (v.state === MSTATE.RUN_INS) {
          const other = vehicles.find((u) => u !== v &&
            (u.state === MSTATE.HANDOFF ||
             (u.state === MSTATE.BLEND && u.blendNext === MSTATE.HANDOFF)));
          const remain = v.path.L - v.s;
          if (other && remain < MC.holdDist) v.blocked = true;
        }
        // —— 积分与位姿 ——
        if (!v.blocked) v.s = Math.min(v.path.L, v.s + MC.speed * dt);
        const endPose = v.path.lanePose(v.path.L, MC.laneOffset);
        if (v.s >= v.path.L - 1e-6) {
          if (v.state === MSTATE.RUN_OUT) {
            const dock = dockNode(v.line.dock);
            startBlend(v, endPose, { x: dock.x, z: MC.dockZ, yaw: 0 }, MSTATE.UNLOAD, simTime);
          } else if (v.state === MSTATE.RUN_INS) {
            startBlend(v, endPose, { x: dockNode('dI').x, z: MC.dockZ, yaw: 0 }, MSTATE.HANDOFF, simTime);
          } else {
            startBlend(v, endPose, loadPose, MSTATE.LOAD, simTime);
          }
        } else {
          v.pose = v.path.lanePose(v.s, MC.laneOffset);
        }
      } else if (v.state === MSTATE.UNLOAD) {
        if (!v.didAct && el >= 0.5) {
          v.didAct = true;
          const added = robots[v.line.station].stockIn(v.rawCount);
          v.rawCount -= added;
          v.finCount = robots[v.line.station].collectFinished();
        }
        if (el >= MC.dwell.unload) {
          const next = v.finCount > 0 ? MSTATE.RUN_INS : MSTATE.RUN_HOME;
          const leg = next === MSTATE.RUN_INS ? paths.toIns[v.line.id] : paths.home[v.line.id];
          v.path = leg;
          v.s = 0;
          startBlend(v, v.pose, leg.lanePose(0, MC.laneOffset), next, simTime);
        }
      } else if (v.state === MSTATE.HANDOFF) {
        if (!v.didAct && el >= 0.5) {
          v.didAct = true;
          v.finCount = 0;   // 交付检测（叙事：作为检测线上料）
        }
        if (el >= MC.dwell.handoff) {
          v.path = paths.home[v.line.id];
          v.s = 0;
          startBlend(v, v.pose, v.path.lanePose(0, MC.laneOffset), MSTATE.RUN_HOME, simTime);
        }
      } else if (v.state === MSTATE.BLEND) {
        const f = smooth01(el / MC.blendT);
        const { from, to } = v.blend;
        v.pose = {
          x: lerp2(from.x, to.x, f),
          z: lerp2(from.z, to.z, f),
          yaw: yawLerp(from.yaw, to.yaw, f),
        };
        if (el >= MC.blendT) {
          const next = v.blendNext;
          v.blend = null;
          if (next === MSTATE.RUN_OUT) {
            v.path = paths.out[v.line.id];
            v.s = 0;
            enter(v, MSTATE.RUN_OUT, simTime);
          } else {
            enter(v, next, simTime);
          }
        }
      }

      // —— 应用位姿 / 货物可见性 / 警示灯 ——
      v.group.position.set(v.pose.x, 0, v.pose.z);
      v.group.rotation.y = v.pose.yaw;
      const showRaw = v.state !== MSTATE.HANDOFF && v.rawCount > 0;
      v.rawSlots.forEach((m, i) => { m.visible = showRaw && i < v.rawCount; });
      v.finSlots.forEach((m, i) => { m.visible = v.finCount > i; });
      const blink = simTime * Math.PI * 2 * (v.blocked ? 1.2 : 2.4);
      v.mats.beacon.emissive.setHex(v.blocked ? 0x8a5a1a : COLORS.orange);
      v.mats.beacon.emissiveIntensity = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(blink));
    }
  }

  const lerp2 = (a, b, f) => a + (b - a) * f;

  return {
    /** 面板遥测（每线一条） */
    lineLabels() {
      return vehicles.map((v) => {
        const st = STATE_LABEL[v.state] + (v.blocked ? '·让行' : '');
        return `${st} · 料${v.rawCount} 成${v.finCount}`;
      });
    },
    /** 向车队注入本系统坐标（跨系统避障） */
    getPoses() {
      return vehicles.map((v) => ({ x: v.pose.x, z: v.pose.z }));
    },
    update,
  };
}

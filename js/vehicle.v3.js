// ============================================================
// vehicle.v3.js —— AGV 车队（v3：增加跨系统避障接口）
// 功能：沿 ROAD_GRAPH 路网行驶（弧长参数化）+ 右侧行车道偏移 +
//       跟车间距控制 + 路口通行控制（占用锁）+ 故障停车与警报联动。
// v3 变化：
//   - update(simTime, extras)：extras 为物料 AGV 世界坐标（material.v3.js），
//     作为跟车障碍（横向容差收紧 2.0，停靠位 z=29 与车道 31.4 相距 2.4 不误判）
//     与路口占用候选 —— 车队与物料车互让，避免跨系统穿模；
//   - getVehicles()：向物料系统暴露车队坐标（反向避障）。
// 其余与 v2 一致：弧长以 simTime 增量积分（暂停自然停走）、显式状态机、
// 车辆 4 部件 InstancedMesh、警示灯实例级颜色。
// ============================================================

import * as THREE from 'three';
import { COLORS, ROAD_GRAPH, VEHICLE_CFG as CFG } from './config.v3.js';

export const VEHICLE_STATE = {
  PARKED: 'PARKED',
  RUNNING: 'RUNNING',
  YIELD: 'YIELD',
  FAULT: 'FAULT',
};

const GEO = {
  under:  new THREE.BoxGeometry(2.3, 0.3, 3.4).translate(0, 0.30, 0),
  body:   new THREE.BoxGeometry(2.1, 0.5, 3.1).translate(0, 0.70, 0),
  cab:    new THREE.BoxGeometry(1.5, 0.4, 2.0).translate(0, 1.15, -0.35),
  beacon: new THREE.BoxGeometry(0.28, 0.22, 0.28).translate(0, 1.46, -0.35),
};
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const POS = new THREE.Vector3();
const COLOR_BRIGHT = new THREE.Color(1.0, 0.54, 0.14);
const COLOR_DIM = new THREE.Color(0.45, 0.26, 0.08);
const COLOR_DARK = new THREE.Color(0.16, 0.12, 0.07);

function buildRoute(nodeKeys) {
  const pts = nodeKeys.map((k) => ROAD_GRAPH.nodes[k]);
  const segs = [];
  let L = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dz = pts[i + 1].z - pts[i].z;
    const len = Math.hypot(dx, dz);
    segs.push({ x: pts[i].x, z: pts[i].z, dx: dx / len, dz: dz / len, len, c0: L });
    L += len;
  }
  return { segs, L };
}

function segAt(route, s) {
  for (const sg of route.segs) {
    if (s < sg.c0 + sg.len) return sg;
  }
  return route.segs[route.segs.length - 1];
}

function posAt(route, s) {
  const sg = segAt(route, s);
  const d = s - sg.c0;
  return [sg.x + sg.dx * d, sg.z + sg.dz * d];
}

function dirAt(route, s) {
  let ax = 0, az = 0;
  for (const sg of route.segs) {
    for (const k of [-1, 0, 1]) {
      const lo = s - CFG.sampleArc + k * route.L;
      const hi = s + CFG.sampleArc + k * route.L;
      const o = Math.min(sg.c0 + sg.len, hi) - Math.max(sg.c0, lo);
      if (o > 0) {
        ax += sg.dx * o;
        az += sg.dz * o;
      }
    }
  }
  const m = Math.hypot(ax, az);
  if (m < 1e-6) {
    const sg = segAt(route, s);
    return [sg.dx, sg.dz];
  }
  return [ax / m, az / m];
}

export function createVehicleSystem(scene) {
  const n = CFG.fleet.length;
  const routes = {};
  for (const key of Object.keys(CFG.routes)) routes[key] = buildRoute(CFG.routes[key]);

  const mats = {
    under:  new THREE.MeshStandardMaterial({ color: COLORS.darkGray,  roughness: 0.6, metalness: 0.2 }),
    body:   new THREE.MeshStandardMaterial({ color: COLORS.lightGray, roughness: 0.55 }),
    cab:    new THREE.MeshStandardMaterial({ color: 0xffffff,         roughness: 0.4 }),
    beacon: new THREE.MeshStandardMaterial({ color: 0xffffff,         roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0.55 }),
  };
  const ims = {};
  for (const part of Object.keys(GEO)) {
    const im = new THREE.InstancedMesh(GEO[part], mats[part], n);
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    scene.add(im);
    ims[part] = im;
  }

  const vehicles = CFG.fleet.map((f, i) => ({
    id: i,
    name: `AGV-${i + 1}`,
    route: routes[f.route],
    s: f.s0 * routes[f.route].L,
    state: VEHICLE_STATE.PARKED,
    lastSim: null,
    nextFaultAt: 20 + i * 14 + Math.random() * 18,
    faultEnd: 0,
    pos: new THREE.Vector3(),
    dir: new THREE.Vector3(1, 0, 0),
  }));

  const junctionPos = CFG.junctions.map((k) => ROAD_GRAPH.nodes[k]);

  /**
   * 每帧推进。extras: [{ x, z }] —— 物料 AGV 坐标（跨系统避障）。
   */
  function update(simTime, extras = []) {
    // ① 故障状态机（显式转移条件）
    for (const v of vehicles) {
      if (v.state === VEHICLE_STATE.FAULT && simTime >= v.faultEnd) {
        v.state = VEHICLE_STATE.RUNNING;
        v.nextFaultAt = simTime + CFG.fault.respawnMin + Math.random() * CFG.fault.respawnVar;
      } else if (v.state !== VEHICLE_STATE.FAULT && simTime >= v.nextFaultAt) {
        v.state = VEHICLE_STATE.FAULT;
        v.faultEnd = simTime + CFG.fault.dur;
      }
    }

    // ② 位姿（供路口/跟车判定）
    for (const v of vehicles) {
      const s = ((v.s % v.route.L) + v.route.L) % v.route.L;
      const [px, pz] = posAt(v.route, s);
      const [dx, dz] = dirAt(v.route, s);
      v.pos.set(px, 0, pz);
      v.dir.set(dx, 0, dz);
    }

    // ③ 路口占用锁：候选 = 车队车辆 + 物料 AGV（extras）
    const holders = new Map();   // junction index → holder（车队车 or 'X'物料车）
    junctionPos.forEach((j, ji) => {
      let best = null, bestD = CFG.junctionR, bestIsExtra = false;
      for (const v of vehicles) {
        const d = Math.hypot(v.pos.x - j.x, v.pos.z - j.z);
        if (d < bestD) {
          bestD = d;
          best = v;
          bestIsExtra = false;
        }
      }
      for (const e of extras) {
        const d = Math.hypot(e.x - j.x, e.z - j.z);
        if (d < bestD) {
          bestD = d;
          best = e;
          bestIsExtra = true;
        }
      }
      if (best) holders.set(ji, { v: best, isExtra: bestIsExtra });
    });

    // ④ 逐车决策与弧长积分（dt 来自 simTime 增量 —— 暂停时 dt=0）
    for (const v of vehicles) {
      let block = false;
      let yieldJ = false;
      if (v.state !== VEHICLE_STATE.FAULT) {
        // 路口让行：路口被他人持有、路口在我前方、且我尚未进入占用圈
        junctionPos.forEach((j, ji) => {
          const h = holders.get(ji);
          if (!h || h.v === v) return;
          const d = Math.hypot(v.pos.x - j.x, v.pos.z - j.z);
          const ahead = (j.x - v.pos.x) * v.dir.x + (j.z - v.pos.z) * v.dir.z > 0;
          if (ahead && d < CFG.junctionStop && d > CFG.junctionR) yieldJ = true;
        });
        // 跟车间距：车队车辆（同车道）
        for (const u of vehicles) {
          if (u === v) continue;
          const rx = u.pos.x - v.pos.x;
          const rz = u.pos.z - v.pos.z;
          const along = rx * v.dir.x + rz * v.dir.z;
          if (along > 0.5 && along < CFG.followGap) {
            const lat = Math.abs(rx * v.dir.z - rz * v.dir.x);
            if (lat < CFG.followLat) block = true;
          }
        }
        // 跨系统跟车：物料 AGV（横向容差收紧 2.0；停靠位 2.4m 外不误判）
        for (const e of extras) {
          const rx = e.x - v.pos.x;
          const rz = e.z - v.pos.z;
          const along = rx * v.dir.x + rz * v.dir.z;
          if (along > 0.5 && along < CFG.followGap) {
            const lat = Math.abs(rx * v.dir.z - rz * v.dir.x);
            if (lat < 2.0) block = true;
          }
        }
      }
      v.state = v.state === VEHICLE_STATE.FAULT
        ? VEHICLE_STATE.FAULT
        : (block || yieldJ ? VEHICLE_STATE.YIELD : VEHICLE_STATE.RUNNING);

      const dt = v.lastSim === null ? 0 : Math.min(5, Math.max(0, simTime - v.lastSim));
      v.lastSim = simTime;
      if (v.state === VEHICLE_STATE.RUNNING) v.s += CFG.speed * dt;

      // ⑤ 写实例矩阵：右侧行车道偏移
      const s = ((v.s % v.route.L) + v.route.L) % v.route.L;
      const [px, pz] = posAt(v.route, s);
      const [dx, dz] = dirAt(v.route, s);
      const ox = px + -dz * CFG.laneOffset;
      const oz = pz + dx * CFG.laneOffset;
      Q.setFromAxisAngle(Y_AXIS, Math.atan2(dx, dz));
      POS.set(ox, 0, oz);
      M4.compose(POS, Q, ONE);
      for (const part of Object.keys(ims)) ims[part].setMatrixAt(v.id, M4);

      // ⑥ 警示灯
      let c;
      if (v.state === VEHICLE_STATE.FAULT) {
        c = Math.sin(simTime * Math.PI * 2 * 6 + v.id) > 0 ? COLOR_BRIGHT : COLOR_DARK;
      } else if (v.state === VEHICLE_STATE.YIELD) {
        c = COLOR_DIM;
      } else {
        c = Math.sin(simTime * Math.PI * 2 * 1.2 + v.id) > 0 ? COLOR_BRIGHT : COLOR_DARK;
      }
      ims.beacon.setColorAt(v.id, c);
    }
    for (const part of Object.keys(ims)) ims[part].instanceMatrix.needsUpdate = true;
    if (ims.beacon.instanceColor) ims.beacon.instanceColor.needsUpdate = true;
  }

  return {
    count: () => vehicles.length,
    /** 向物料系统暴露车队坐标（反向避障） */
    getVehicles() {
      return vehicles.map((v) => ({ x: v.pos.x, z: v.pos.z }));
    },
    statsLabel() {
      let run = 0, give = 0, fault = 0;
      for (const v of vehicles) {
        if (v.state === VEHICLE_STATE.RUNNING) run++;
        else if (v.state === VEHICLE_STATE.YIELD) give++;
        else if (v.state === VEHICLE_STATE.FAULT) fault++;
      }
      return `运行 ${run} · 让行 ${give} · 故障 ${fault}`;
    },
    alarms() {
      return vehicles
        .filter((v) => v.state === VEHICLE_STATE.FAULT)
        .map((v) => `${v.name} 故障停车 · 警报联动中`);
    },
    update,
  };
}

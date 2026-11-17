// ============================================================
// vehicle.v2.js —— AGV 车辆调度（P2 实现，替代 v1 桩）
// 功能：沿 ROAD_GRAPH 路网行驶（弧长参数化）+ 右侧行车道偏移 +
//       跟车间距控制 + 路口通行控制（占用锁）+ 故障停车与警报联动。
// 实现要点（§7 / §8）：
//   - 弧长推进以 simClock.simTime 增量积分（dt = simTime - lastSim），
//     暂停时 dt=0 自然停走、恢复连续；simTime 是唯一时间源；
//   - 显式状态机：PARKED → RUNNING ⇄ YIELD / FAULT，转移条件逐条列出；
//   - 车辆 4 个部件全部 InstancedMesh，逐帧仅更新实例矩阵（§8）；
//   - 航向取 ±sampleArc 弧长窗内线段方向加权和，转弯圆滑、车道偏移无跳变。
// ============================================================

import * as THREE from 'three';
import { COLORS, ROAD_GRAPH, VEHICLE_CFG as CFG } from './config.v2.js';

export const VEHICLE_STATE = {
  PARKED: 'PARKED',
  RUNNING: 'RUNNING',
  YIELD: 'YIELD',
  FAULT: 'FAULT',
};

// —— 车辆部件几何（高度已在几何内烘焙，4 部件共用同一实例矩阵）——
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

/** 节点序列 → 弧长参数化折线（闭合环线） */
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

/** 弧长 → 中心线坐标 */
function posAt(route, s) {
  const sg = segAt(route, s);
  const d = s - sg.c0;
  return [sg.x + sg.dx * d, sg.z + sg.dz * d];
}

/** 弧长 → 平滑航向（±sampleArc 窗内各线段方向按重叠长度加权，端点跨闭合缝） */
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

  // —— 车辆部件 InstancedMesh（§8：重复对象实例化）——
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
    im.frustumCulled = false;   // 实例随车辆全图移动，禁用视锥剔除
    scene.add(im);
    ims[part] = im;
  }

  // —— 车队状态 ——
  const vehicles = CFG.fleet.map((f, i) => ({
    id: i,
    name: `AGV-${i + 1}`,
    route: routes[f.route],
    s: f.s0 * routes[f.route].L,
    state: VEHICLE_STATE.PARKED,
    lastSim: null,
    nextFaultAt: 20 + i * 14 + Math.random() * 18,   // 首次故障错峰出现
    faultEnd: 0,
    pos: new THREE.Vector3(),
    dir: new THREE.Vector3(1, 0, 0),
  }));

  const junctionPos = CFG.junctions.map((k) => ROAD_GRAPH.nodes[k]);

  function update(simTime) {
    // ① 故障状态机（显式转移条件：时间到达触发 / 到达修复时刻）
    for (const v of vehicles) {
      if (v.state === VEHICLE_STATE.FAULT && simTime >= v.faultEnd) {
        v.state = VEHICLE_STATE.RUNNING;
        v.nextFaultAt = simTime + CFG.fault.respawnMin + Math.random() * CFG.fault.respawnVar;
      } else if (v.state !== VEHICLE_STATE.FAULT && simTime >= v.nextFaultAt) {
        v.state = VEHICLE_STATE.FAULT;
        v.faultEnd = simTime + CFG.fault.dur;
      }
    }

    // ② 按当前弧长求位姿（供路口/跟车判定）
    for (const v of vehicles) {
      const s = ((v.s % v.route.L) + v.route.L) % v.route.L;
      const [px, pz] = posAt(v.route, s);
      const [dx, dz] = dirAt(v.route, s);
      v.pos.set(px, 0, pz);
      v.dir.set(dx, 0, dz);
    }

    // ③ 路口占用锁：距路口中心最近且在占用半径内的车辆持有该路口
    const holders = new Map();   // junction index → vehicle
    junctionPos.forEach((j, ji) => {
      let best = null, bestD = CFG.junctionR;
      for (const v of vehicles) {
        const d = Math.hypot(v.pos.x - j.x, v.pos.z - j.z);
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      }
      if (best) holders.set(ji, best);
    });

    // ④ 逐车决策与弧长积分（dt 来自 simTime 增量 —— 暂停时 dt=0）
    for (const v of vehicles) {
      let block = false;      // 跟车间距触发
      let yieldJ = false;     // 路口让行触发
      if (v.state !== VEHICLE_STATE.FAULT) {
        // 路口让行：路口被他人持有、路口在我前方、且我尚未进入占用圈
        junctionPos.forEach((j, ji) => {
          const h = holders.get(ji);
          if (!h || h === v) return;
          const d = Math.hypot(v.pos.x - j.x, v.pos.z - j.z);
          const ahead = (j.x - v.pos.x) * v.dir.x + (j.z - v.pos.z) * v.dir.z > 0;
          if (ahead && d < CFG.junctionStop && d > CFG.junctionR) yieldJ = true;
        });
        // 跟车间距：前方近距且横向对齐（同车道）的车辆 → 保持间距
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
      }
      v.state = v.state === VEHICLE_STATE.FAULT
        ? VEHICLE_STATE.FAULT
        : (block || yieldJ ? VEHICLE_STATE.YIELD : VEHICLE_STATE.RUNNING);

      const dt = v.lastSim === null ? 0 : Math.min(5, Math.max(0, simTime - v.lastSim));
      v.lastSim = simTime;
      if (v.state === VEHICLE_STATE.RUNNING) v.s += CFG.speed * dt;

      // ⑤ 写实例矩阵：右侧行车道偏移（right = forward × up）
      const s = ((v.s % v.route.L) + v.route.L) % v.route.L;
      const [px, pz] = posAt(v.route, s);
      const [dx, dz] = dirAt(v.route, s);
      const ox = px + -dz * CFG.laneOffset;
      const oz = pz + dx * CFG.laneOffset;
      Q.setFromAxisAngle(Y_AXIS, Math.atan2(dx, dz));
      POS.set(ox, 0, oz);
      M4.compose(POS, Q, ONE);
      for (const part of Object.keys(ims)) ims[part].setMatrixAt(v.id, M4);

      // ⑥ 警示灯：运行慢闪 / 让行常暗 / 故障急闪（实例级颜色）
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
    /** 面板遥测：运行 / 让行 / 故障 计数 */
    statsLabel() {
      let run = 0, give = 0, fault = 0;
      for (const v of vehicles) {
        if (v.state === VEHICLE_STATE.RUNNING) run++;
        else if (v.state === VEHICLE_STATE.YIELD) give++;
        else if (v.state === VEHICLE_STATE.FAULT) fault++;
      }
      return `运行 ${run} · 让行 ${give} · 故障 ${fault}`;
    },
    /** 警报列表（故障停车 → 警报联动） */
    alarms() {
      return vehicles
        .filter((v) => v.state === VEHICLE_STATE.FAULT)
        .map((v) => `${v.name} 故障停车 · 警报联动中`);
    },
    update,
  };
}

// ============================================================
// road.v2.js —— 路网节点图 → 路面 + 标线
// v2：ROAD_GRAPH 主干道拆为 4 段（config.v2），逐段绘制结果与整段视觉一致；
//     段间接缝面法线相反（+x 面 vs -x 面），背面剔除下不产生 Z-fighting。
// 健壮性检查（§9）：
//   - 主干道顶面 0.14、支路顶面 0.15、标线底面 0.16：相邻高程错开 ≥0.01；
//   - 支路两端各外延半宽，填平丁字路口夹角。
// vehicle.v2.js 复用 ROAD_GRAPH 做沿路网行驶与路口通行控制。
// ============================================================

import * as THREE from 'three';
import { COLORS, ROAD_GRAPH } from './config.v2.js';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

export function buildRoads() {
  const g = new THREE.Group();
  const roadMat = new THREE.MeshStandardMaterial({ color: COLORS.road, roughness: 0.95 });
  const markMat = new THREE.MeshStandardMaterial({ color: COLORS.marking, roughness: 0.9 });

  const roadBox = (w, l, h, y, cx, cz, horizontal) => {
    const m = new THREE.Mesh(UNIT_BOX, roadMat);
    m.scale.set(horizontal ? l : w, h, horizontal ? w : l);
    m.position.set(cx, y, cz);
    m.receiveShadow = true;
    m.castShadow = false;           // §8：路面不参与投影，节省阴影开销
    g.add(m);
    return m;
  };

  // 路面：逐边生成（全部轴对齐）
  for (const [aKey, bKey, isMain] of ROAD_GRAPH.edges) {
    const a = ROAD_GRAPH.nodes[aKey];
    const b = ROAD_GRAPH.nodes[bKey];
    const w = isMain ? ROAD_GRAPH.mainW : ROAD_GRAPH.branchW;
    const horizontal = a.z === b.z;
    const len = horizontal ? Math.abs(b.x - a.x) : Math.abs(b.z - a.z);
    // 主干道原长；支路两端各外延半宽填平路口
    const lenE = len + (isMain ? 0 : w);
    const cx = (a.x + b.x) / 2;
    const cz = (a.z + b.z) / 2;
    // 高程错层：主干道顶 0.14，支路顶 0.15
    roadBox(w, lenE, 0.14, isMain ? 0.07 : 0.08, cx, cz, horizontal);
  }

  // 主干道中央虚线（InstancedMesh；frustumCulled 关闭——实例散布远超几何包围球）
  {
    const [a, b] = [ROAD_GRAPH.nodes.n0, ROAD_GRAPH.nodes.n1];
    const zMid = a.z;
    const step = 5.2, dashLen = 2.6;
    const count = Math.floor((b.x - a.x) / step);
    const dashes = new THREE.InstancedMesh(UNIT_BOX, markMat, count);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      m4.makeScale(dashLen, 0.02, 0.35);
      m4.setPosition(a.x + step * i + dashLen, 0.17, zMid);   // 底面 0.16，高于路面顶
      dashes.setMatrixAt(i, m4);
    }
    dashes.instanceMatrix.needsUpdate = true;
    dashes.receiveShadow = true;
    dashes.frustumCulled = false;   // 实例包围远超几何球，禁用视锥剔除防整段消失
    g.add(dashes);
  }

  // 支路中央实线（每支路一根细条）
  for (const [aKey, bKey, isMain] of ROAD_GRAPH.edges) {
    if (isMain) continue;
    const a = ROAD_GRAPH.nodes[aKey];
    const b = ROAD_GRAPH.nodes[bKey];
    const len = Math.abs(b.z - a.z) - 4;         // 两端各留 2m 避让路口
    const m = new THREE.Mesh(UNIT_BOX, markMat);
    m.scale.set(0.25, 0.02, len);
    m.position.set(a.x, 0.17, (a.z + b.z) / 2);
    m.receiveShadow = true;
    g.add(m);
  }

  return {
    id: 'road',
    name: '基地道路网',
    status: '畅通 · AGV 调度运行中',
    desc: '1 条主干道 + 3 条支路。AGV 车辆沿路网行驶（P2 已启用）：右侧行车、跟车间距、路口让行。',
    group: g,
    focus: {
      target: new THREE.Vector3(0, 2, 34),
      camPos: new THREE.Vector3(42, 62, 96),
    },
  };
}

// ============================================================
// factory.v2.js —— 厂房 / 仓储 / 港口建筑体块（程序化生成，无外部模型）
// v2 变更：
//   - 主厂房 z=-8（config），厂前新增装配试验区平台 APRON（P1 机械臂站位）；
//   - 所有 InstancedMesh 关闭 frustumCulled：实例散布远超几何包围球，
//     默认剔除会导致整组实例在镜头边缘集体消失（v1 隐患修复）。
// 性能约束（§8）：
//   - 长方体共用同一单位盒 Geometry；重复构件一律 InstancedMesh；
//   - 每个设施持有独立 Material 实例，保证拾取高亮互不影响。
// 健壮性检查（§9）：
//   - 附加构件相对墙面外凸 0.15~0.2 或抬升 ≥0.05，禁止完全共面叠加；
//   - 水面高于地面 0.04；平台标线底部 0.005 抬升防共面。
// ============================================================

import * as THREE from 'three';
import { COLORS, LAYOUT, APRON } from './config.v2.js';

// 统一单位盒：所有长方体构件复用同一 Geometry 实例
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/** 创建一套设施专属材质（不同设施不共享，保证高亮隔离） */
function makeMats() {
  return {
    wall:   new THREE.MeshStandardMaterial({ color: COLORS.white,     roughness: 0.85, metalness: 0.02 }),
    trim:   new THREE.MeshStandardMaterial({ color: COLORS.lightGray, roughness: 0.80 }),
    roof:   new THREE.MeshStandardMaterial({ color: COLORS.darkGray,  roughness: 0.90 }),
    dark:   new THREE.MeshStandardMaterial({ color: COLORS.darkGray,  roughness: 0.55, metalness: 0.25 }),
    glass:  new THREE.MeshStandardMaterial({ color: COLORS.glass,     roughness: 0.20, metalness: 0.40 }),
    orange: new THREE.MeshStandardMaterial({ color: COLORS.orange,    roughness: 0.45, metalness: 0.15 }),
    cargo:  new THREE.MeshStandardMaterial({ color: 0xffffff,         roughness: 0.65 }), // 配合实例级颜色
    water:  new THREE.MeshStandardMaterial({ color: COLORS.water,     roughness: 0.30, metalness: 0.10 }),
  };
}

/** 单位盒缩放快捷构造 */
function box(w, h, d, mat, x, y, z, opts = {}) {
  const m = new THREE.Mesh(UNIT_BOX, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = opts.cast !== false;
  m.receiveShadow = true;
  return m;
}

/** 填充 InstancedMesh 的一个实例矩阵 */
function setInst(mesh, i, x, y, z, sx, sy, sz) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion(),
    new THREE.Vector3(sx, sy, sz)
  );
  mesh.setMatrixAt(i, m);
}

// ------------------------------------------------------------
// 1. 主装配车间 + 装配试验区平台
// ------------------------------------------------------------
export function buildFactory() {
  const mats = makeMats();
  const g = new THREE.Group();
  const { x, z, w, d, h } = LAYOUT.factory;

  // 主厂房大体块
  g.add(box(w, h, d, mats.wall, x, h / 2, z));

  // 屋顶（外挑 + 相对墙体顶面抬升 0.05，避免共面 → 防 Z-fighting）
  g.add(box(w + 1.6, 0.8, d + 1.6, mats.roof, x, h + 0.45, z));
  // 屋顶采光带
  g.add(box(w * 0.62, 0.9, d * 0.42, mats.glass, x, h + 1.3, z));
  // 屋顶设备机组 ×3
  [-24, 0, 24].forEach((dx) =>
    g.add(box(4, 2.2, 3, mats.dark, x + dx, h + 2.3, z - 6))
  );

  // 前立面（南侧）大门 ×3，外凸 0.2 避免与墙面共面；门头工业橙饰条
  [-24, 0, 24].forEach((dx) => {
    g.add(box(10, 9, 0.4, mats.dark, x + dx, 4.5, z + d / 2 + 0.2));
    g.add(box(10.6, 0.5, 0.5, mats.orange, x + dx, 9.4, z + d / 2 + 0.25));
  });

  // 高窗带（前后左右，外凸 0.16）
  g.add(box(w * 0.86, 1.6, 0.32, mats.glass, x, 12.6, z + d / 2 + 0.16));
  g.add(box(w * 0.86, 1.6, 0.32, mats.glass, x, 12.6, z - d / 2 - 0.16));
  g.add(box(0.32, 1.6, d * 0.7, mats.glass, x - w / 2 - 0.16, 12.6, z));
  g.add(box(0.32, 1.6, d * 0.7, mats.glass, x + w / 2 + 0.16, 12.6, z));

  // 入口雨棚 + 两根立柱
  g.add(box(16, 0.5, 5, mats.trim, x, 10.2, z + d / 2 + 2.4));
  g.add(box(0.7, 9.95, 0.7, mats.dark, x - 6, 4.975, z + d / 2 + 4.4));
  g.add(box(0.7, 9.95, 0.7, mats.dark, x + 6, 4.975, z + d / 2 + 4.4));

  // 四角壁柱
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
    g.add(box(1.4, h, 1.4, mats.trim, x + (sx * w) / 2, h / 2, z + (sz * d) / 2))
  );

  // 东端附属用房（两层小楼体块）
  g.add(box(18, 7, 22, mats.trim, x + w / 2 + 9, 3.5, z - 8));
  g.add(box(18.8, 0.6, 22.8, mats.roof, x + w / 2 + 9, 7.35, z - 8));

  // 锅炉房烟囱
  g.add(box(2.6, 12, 2.6, mats.dark, x - w / 2 - 2.5, 6, z - 14));

  // —— 装配试验区平台（P1 机械臂工作站所在，厂前）——
  g.add(box(APRON.w, APRON.h, APRON.d, mats.trim, APRON.x, APRON.h / 2, APRON.z));
  // 平台四周安全标线（工业橙；底部 0.005 抬升，避免与平台顶面共面）
  g.add(box(APRON.w - 1.4, 0.17, 0.28, mats.orange, APRON.x, 0.59, APRON.z - APRON.d / 2 + 0.35, { cast: false }));
  g.add(box(APRON.w - 1.4, 0.17, 0.28, mats.orange, APRON.x, 0.59, APRON.z + APRON.d / 2 - 0.35, { cast: false }));
  g.add(box(0.28, 0.17, APRON.d - 1.4, mats.orange, APRON.x - APRON.w / 2 + 0.35, 0.59, APRON.z, { cast: false }));
  g.add(box(0.28, 0.17, APRON.d - 1.4, mats.orange, APRON.x + APRON.w / 2 - 0.35, 0.59, APRON.z, { cast: false }));

  return {
    id: 'factory',
    name: '主装配车间',
    status: '运行中 · 3 条装配线满产',
    desc: '电池模组装配主厂房，厂前为装配试验区（机械臂工作站 A/B）。机械臂工作站已启用（P1）。',
    group: g,
    focus: {
      target: new THREE.Vector3(x, 8, z),
      camPos: new THREE.Vector3(x + 50, 36, z + 70),
    },
  };
}

// ------------------------------------------------------------
// 2. 仓储区（开放式堆棚，货架 InstancedMesh 复用）
// ------------------------------------------------------------
export function buildWarehouse() {
  const mats = makeMats();
  const g = new THREE.Group();
  const { x, z, w, d } = LAYOUT.warehouse;

  // 地坪（顶面 0.4，高于地面）
  g.add(box(w, 0.4, d, mats.trim, x, 0.2, z));

  // 棚柱 InstancedMesh（8 根）
  const colX = [-w / 2 + 1.5, -w / 6, w / 6, w / 2 - 1.5];
  const colZ = [-d / 2 + 1.5, d / 2 - 1.5];
  const cols = new THREE.InstancedMesh(UNIT_BOX, mats.dark, colX.length * colZ.length);
  let ci = 0;
  for (const cx of colX) for (const cz of colZ) setInst(cols, ci++, x + cx, 4.6, z + cz, 0.9, 8.4, 0.9);
  cols.instanceMatrix.needsUpdate = true;
  cols.castShadow = true;
  cols.receiveShadow = true;
  cols.frustumCulled = false;   // 实例散布远超几何包围球，禁用剔除防整组消失
  g.add(cols);

  // 棚顶（底部 8.8 = 柱顶 8.8，居中 9.05，留 0.05 间隙）
  g.add(box(w + 2, 0.5, d + 2, mats.roof, x, 9.05, z));

  // 货架 InstancedMesh：3 排 × 6 列
  const rackGeo = new THREE.BoxGeometry(7, 4.2, 2);
  const rows = [-13, 0, 13];
  const perRow = 6;
  const racks = new THREE.InstancedMesh(rackGeo, mats.trim, rows.length * perRow);
  let ri = 0;
  for (const rz of rows)
    for (let i = 0; i < perRow; i++)
      setInst(racks, ri++, x - 25 + i * 10, 2.5, z + rz, 1, 1, 1);
  racks.instanceMatrix.needsUpdate = true;
  racks.castShadow = true;
  racks.receiveShadow = true;
  racks.frustumCulled = false;
  g.add(racks);

  // 货物箱 InstancedMesh（实例级颜色：橙 / 浅灰 / 深灰交错，确定性排布）
  const cargoGeo = new THREE.BoxGeometry(2.4, 1.8, 1.8);
  const cargoList = [];
  for (const rz of rows)
    for (let i = 0; i < perRow; i++)
      for (const lvl of [1.4, 3.3])
        if ((i + lvl * 10 + rz) % 3 !== 0)
          cargoList.push([x - 25 + i * 10, lvl, z + rz]);
  const cargo = new THREE.InstancedMesh(cargoGeo, mats.cargo, cargoList.length);
  const palette = [new THREE.Color(COLORS.orange), new THREE.Color(COLORS.lightGray), new THREE.Color(COLORS.darkGray)];
  cargoList.forEach(([cx, cy, cz], k) => {
    setInst(cargo, k, cx, cy, cz, 1, 1, 1);
    cargo.setColorAt(k, palette[k % 3]);
  });
  cargo.instanceMatrix.needsUpdate = true;
  if (cargo.instanceColor) cargo.instanceColor.needsUpdate = true;
  cargo.castShadow = true;
  cargo.receiveShadow = true;
  cargo.frustumCulled = false;
  g.add(cargo);

  return {
    id: 'warehouse',
    name: '成品仓储区',
    status: '库存正常 · 3 排 18 组货架',
    desc: '开放式堆棚，电池模组成品暂存与发运缓冲。AGV 可沿支路 n2-n5 到达装卸位（P2 已启用）。',
    group: g,
    focus: {
      target: new THREE.Vector3(x, 6, z),
      camPos: new THREE.Vector3(x + 42, 32, z + 44),
    },
  };
}

// ------------------------------------------------------------
// 3. 港口区（码头平台 + 集装箱 InstancedMesh + 门机）
// ------------------------------------------------------------
export function buildPort() {
  const mats = makeMats();
  const g = new THREE.Group();
  const { x, z, w, d } = LAYOUT.port;

  // 码头平台
  g.add(box(w, 1.6, d, mats.trim, x, 0.8, z));

  // 港池水面（高于地面 0.04 防 Z-fighting；不投影）
  const water = new THREE.Mesh(new THREE.PlaneGeometry(LAYOUT.water.w, LAYOUT.water.d), mats.water);
  water.rotation.x = -Math.PI / 2;
  water.position.set(LAYOUT.water.x, 0.04, LAYOUT.water.z);
  water.receiveShadow = false;
  g.add(water);

  // 护舷 InstancedMesh：沿临水缘（码头南缘）每 8.5m 一只
  const fenders = new THREE.InstancedMesh(UNIT_BOX, mats.dark, 9);
  for (let i = 0; i < 9; i++)
    setInst(fenders, i, x - w / 2 + 6 + i * 8.5, 1.9, z + d / 2 - 0.6, 0.9, 0.8, 1.2);
  fenders.instanceMatrix.needsUpdate = true;
  fenders.castShadow = true;
  fenders.frustumCulled = false;
  g.add(fenders);

  // 集装箱 InstancedMesh（实例级颜色）：5 × 4 底层 + 稀疏二层
  const contGeo = new THREE.BoxGeometry(6.1, 2.6, 2.44);
  const slotsX = [-28, -14, 0, 14, 28].map((dx) => x + dx);
  const slotsZ = [-12, -4, 4, 12].map((dz) => z + dz);
  const positions = [];
  for (const sx of slotsX)
    for (const sz of slotsZ) {
      positions.push([sx, 2.9, sz]);
      if ((sx + sz) % 7 === 0 || (sx + sz) % 11 === 0)
        positions.push([sx, 5.5, sz]);
    }
  const conts = new THREE.InstancedMesh(contGeo, mats.cargo, positions.length);
  const cPalette = [new THREE.Color(COLORS.orange), new THREE.Color(COLORS.lightGray), new THREE.Color(COLORS.darkGray)];
  positions.forEach(([cx, cy, cz], k) => {
    setInst(conts, k, cx, cy, cz, 1, 1, 1);
    conts.setColorAt(k, cPalette[k % 3]);
  });
  conts.instanceMatrix.needsUpdate = true;
  if (conts.instanceColor) conts.instanceColor.needsUpdate = true;
  conts.castShadow = true;
  conts.receiveShadow = true;
  conts.frustumCulled = false;
  g.add(conts);

  // 门式起重机（静态体块）：轨道 + 4 腿 + 主梁 + 外伸臂 + 小车
  g.add(box(w - 6, 0.3, 1.2, mats.dark, x, 1.75, z - 10));
  g.add(box(w - 6, 0.3, 1.2, mats.dark, x, 1.75, z + 10));
  [[-19, -10], [19, -10], [-19, 10], [19, 10]].forEach(([lx, lz]) =>
    g.add(box(1.4, 12, 1.4, mats.orange, x + lx, 7.9, z + lz))
  );
  g.add(box(46, 1.8, 3.2, mats.orange, x, 14.8, z));
  g.add(box(18, 1.6, 3.2, mats.orange, x + 31, 14.8, z));
  g.add(box(3, 2.4, 2.4, mats.dark, x + 20, 13.4, z));

  return {
    id: 'port',
    name: '重件码头',
    status: '泊位空闲 · 到发正常',
    desc: '电池模组及原材料水运中转码头。船舶靠离调度未启用（P3 接入）。',
    group: g,
    focus: {
      target: new THREE.Vector3(x, 5, z),
      camPos: new THREE.Vector3(x + 40, 30, z + 52),
    },
  };
}

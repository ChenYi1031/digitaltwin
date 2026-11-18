// ============================================================
// factory.v3.js —— 厂房 / 仓储 / 港口建筑体块（程序化生成，无外部模型）
// v3 变更：
//   - 装配试验区平台南移（APRON.z=22.6，config）；
//   - 港口移除旧装饰门机 → 由 marine.v3.js 构建真实 STS 岸桥（可动）；
//   - 集装箱堆场暴露 yardAPI： marine 模块对取箱位做隐藏/恢复（装卸联动）；
//   - InstancedMesh 均关闭 frustumCulled（实例散布超几何包围球）。
// 性能约束（§8）：单位盒复用、重复构件 InstancedMesh、设施独立材质（高亮隔离）。
// 健壮性检查（§9）：附加构件外凸/抬升、水面高于地面 0.04、标线底部 0.005 抬升。
// ============================================================

import * as THREE from 'three';
import { COLORS, LAYOUT, APRON } from './config.v3.js';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

function makeMats() {
  return {
    wall:   new THREE.MeshStandardMaterial({ color: COLORS.white,     roughness: 0.85, metalness: 0.02 }),
    trim:   new THREE.MeshStandardMaterial({ color: COLORS.lightGray, roughness: 0.80 }),
    roof:   new THREE.MeshStandardMaterial({ color: COLORS.darkGray,  roughness: 0.90 }),
    dark:   new THREE.MeshStandardMaterial({ color: COLORS.darkGray,  roughness: 0.55, metalness: 0.25 }),
    glass:  new THREE.MeshStandardMaterial({ color: COLORS.glass,     roughness: 0.20, metalness: 0.40 }),
    orange: new THREE.MeshStandardMaterial({ color: COLORS.orange,    roughness: 0.45, metalness: 0.15 }),
    cargo:  new THREE.MeshStandardMaterial({ color: 0xffffff,         roughness: 0.65 }),
    water:  new THREE.MeshStandardMaterial({ color: COLORS.water,     roughness: 0.30, metalness: 0.10 }),
  };
}

function box(w, h, d, mat, x, y, z, opts = {}) {
  const m = new THREE.Mesh(UNIT_BOX, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = opts.cast !== false;
  m.receiveShadow = true;
  return m;
}

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

  g.add(box(w, h, d, mats.wall, x, h / 2, z));
  g.add(box(w + 1.6, 0.8, d + 1.6, mats.roof, x, h + 0.45, z));
  g.add(box(w * 0.62, 0.9, d * 0.42, mats.glass, x, h + 1.3, z));
  [-24, 0, 24].forEach((dx) =>
    g.add(box(4, 2.2, 3, mats.dark, x + dx, h + 2.3, z - 6))
  );

  [-24, 0, 24].forEach((dx) => {
    g.add(box(10, 9, 0.4, mats.dark, x + dx, 4.5, z + d / 2 + 0.2));
    g.add(box(10.6, 0.5, 0.5, mats.orange, x + dx, 9.4, z + d / 2 + 0.25));
  });

  g.add(box(w * 0.86, 1.6, 0.32, mats.glass, x, 12.6, z + d / 2 + 0.16));
  g.add(box(w * 0.86, 1.6, 0.32, mats.glass, x, 12.6, z - d / 2 - 0.16));
  g.add(box(0.32, 1.6, d * 0.7, mats.glass, x - w / 2 - 0.16, 12.6, z));
  g.add(box(0.32, 1.6, d * 0.7, mats.glass, x + w / 2 + 0.16, 12.6, z));

  g.add(box(16, 0.5, 5, mats.trim, x, 10.2, z + d / 2 + 2.4));
  g.add(box(0.7, 9.95, 0.7, mats.dark, x - 6, 4.975, z + d / 2 + 4.4));
  g.add(box(0.7, 9.95, 0.7, mats.dark, x + 6, 4.975, z + d / 2 + 4.4));

  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
    g.add(box(1.4, h, 1.4, mats.trim, x + (sx * w) / 2, h / 2, z + (sz * d) / 2))
  );

  g.add(box(18, 7, 22, mats.trim, x + w / 2 + 9, 3.5, z - 8));
  g.add(box(18.8, 0.6, 22.8, mats.roof, x + w / 2 + 9, 7.35, z - 8));
  g.add(box(2.6, 12, 2.6, mats.dark, x - w / 2 - 2.5, 6, z - 14));

  // —— 装配试验区平台（机械臂工作站 A/B 站位）——
  g.add(box(APRON.w, APRON.h, APRON.d, mats.trim, APRON.x, APRON.h / 2, APRON.z));
  g.add(box(APRON.w - 1.4, 0.17, 0.28, mats.orange, APRON.x, 0.59, APRON.z - APRON.d / 2 + 0.35, { cast: false }));
  g.add(box(APRON.w - 1.4, 0.17, 0.28, mats.orange, APRON.x, 0.59, APRON.z + APRON.d / 2 - 0.35, { cast: false }));
  g.add(box(0.28, 0.17, APRON.d - 1.4, mats.orange, APRON.x - APRON.w / 2 + 0.35, 0.59, APRON.z, { cast: false }));
  g.add(box(0.28, 0.17, APRON.d - 1.4, mats.orange, APRON.x + APRON.w / 2 - 0.35, 0.59, APRON.z, { cast: false }));

  return {
    id: 'factory',
    name: '主装配车间',
    status: '运行中 · 3 条装配线满产',
    desc: '电池模组装配主厂房，厂前为装配试验区（机械臂工作站 A/B + 物料 AGV 停靠位）。',
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

  g.add(box(w, 0.4, d, mats.trim, x, 0.2, z));

  const colX = [-w / 2 + 1.5, -w / 6, w / 6, w / 2 - 1.5];
  const colZ = [-d / 2 + 1.5, d / 2 - 1.5];
  const cols = new THREE.InstancedMesh(UNIT_BOX, mats.dark, colX.length * colZ.length);
  let ci = 0;
  for (const cx of colX) for (const cz of colZ) setInst(cols, ci++, x + cx, 4.6, z + cz, 0.9, 8.4, 0.9);
  cols.instanceMatrix.needsUpdate = true;
  cols.castShadow = true;
  cols.receiveShadow = true;
  cols.frustumCulled = false;
  g.add(cols);

  g.add(box(w + 2, 0.5, d + 2, mats.roof, x, 9.05, z));

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
    status: '库存正常 · 物料 AGV 装卸中',
    desc: '开放式堆棚。物料 AGV 在此装载原材料、交付成品（P4 已启用）；车队 AGV 沿支路 n2-n5 巡回。',
    group: g,
    focus: {
      target: new THREE.Vector3(x, 6, z),
      camPos: new THREE.Vector3(x + 42, 32, z + 44),
    },
  };
}

// ------------------------------------------------------------
// 3. 港口区（码头平台 + 集装箱堆场 yardAPI + 水面；STS 岸桥见 marine.v3.js）
// ------------------------------------------------------------
export function buildPort() {
  const mats = makeMats();
  const g = new THREE.Group();
  const { x, z, w, d } = LAYOUT.port;

  g.add(box(w, 1.6, d, mats.trim, x, 0.8, z));

  const water = new THREE.Mesh(new THREE.PlaneGeometry(LAYOUT.water.w, LAYOUT.water.d), mats.water);
  water.rotation.x = -Math.PI / 2;
  water.position.set(LAYOUT.water.x, 0.04, LAYOUT.water.z);
  water.receiveShadow = false;
  g.add(water);

  const fenders = new THREE.InstancedMesh(UNIT_BOX, mats.dark, 9);
  for (let i = 0; i < 9; i++)
    setInst(fenders, i, x - w / 2 + 6 + i * 8.5, 1.9, z + d / 2 - 0.6, 0.9, 0.8, 1.2);
  fenders.instanceMatrix.needsUpdate = true;
  fenders.castShadow = true;
  fenders.frustumCulled = false;
  g.add(fenders);

  // —— 集装箱堆场（InstancedMesh + yardAPI：marine 取箱联动）——
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

  // 取箱位：底层箱、临水中列（x∈{51,65,79}），排除上方有二层箱的箱位
  //（与二层堆放规则同源：(x+z)%7===0 || (x+z)%11===0 → 恰 9 只可用）
  const pickup = [];
  positions.forEach(([cx, cy, cz], k) => {
    const stackedAbove = (cx + cz) % 7 === 0 || (cx + cz) % 11 === 0;
    if (cy === 2.9 && (cx === 51 || cx === 65 || cx === 79) && !stackedAbove) {
      pickup.push({ k, x: cx, y: cy, z: cz, colorIdx: k % 3 });
    }
  });

  // yardAPI：按实例索引隐藏/恢复箱体（ marine 装卸联动）
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  const yardAPI = {
    slots: pickup,
    setScale(k, s) {
      conts.getMatrixAt(k, _m);
      _m.decompose(_p, _q, _s);
      _s.setScalar(Math.max(s, 0.0001));
      _m.compose(_p, _q, _s);
      conts.setMatrixAt(k, _m);
      conts.instanceMatrix.needsUpdate = true;
    },
  };

  return {
    id: 'port',
    name: '重件码头',
    status: '班轮靠泊装卸中',
    desc: '电池模组水运中转码头。班轮 A/B 错峰靠离（P4 已启用），STS 岸桥自动装卸堆场箱。',
    group: g,
    yardAPI,
    focus: {
      target: new THREE.Vector3(x, 5, z),
      camPos: new THREE.Vector3(x + 40, 30, z + 52),
    },
  };
}

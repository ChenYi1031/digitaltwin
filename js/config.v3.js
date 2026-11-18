// ============================================================
// config.v3.js —— 全局常量：尺度、颜色、路网、时间与工序参数
// v3 变更：
//   - 港池水面加宽（x 60±130 → -70..190）：船舶进港起点 x=-20 / 离港终点
//     x=150 处船体（半长 26）完全落在水面上，不出现"船在岸上"；
//   - 装配试验区平台南移（z=22.6）贴近主干道，物料 AGV 停靠位 dA/dB/dI
//     位于主干道北缘（z=29），仅加节点不新增路面；
//   - 机械臂 carryH 提升至 4.82（越过成品堆 3 层顶 3.22，二连杆可达
//     D=4.92 ≤ L1+L2-0.02=4.98，已验证）；
//   - 新增 MARINE_CFG（船舶班期/装卸/STS 参数）与 MATERIAL_CFG（物料协同）。
// ============================================================

export const COLORS = {
  white: 0xf5f6f7,
  lightGray: 0xd9dce1,
  darkGray: 0x4a4f57,
  orange: 0xf08a24,
  ground: 0xe6e8ec,
  road: 0x9aa0a8,
  marking: 0xf5f6f7,
  water: 0x9fbdd4,
  glass: 0x8fa3b8,
};

export const LAYOUT = {
  groundSize: 460,
  factory:   { x: -70, z: -8,  w: 84, d: 40, h: 16 },
  warehouse: { x: 55,  z: -62, w: 60, d: 44 },
  port:      { x: 65,  z: 78,  w: 80, d: 40 },
  water:     { x: 60,  z: 165, w: 260, d: 130 },   // v3：加宽容纳船舶全程
};

// 装配试验区平台（机械臂 A/B 站位；南缘 27.6 与主干道北缘 28 留 0.4 间距）
export const APRON = { x: -70, z: 22.6, w: 64, d: 10, h: 0.5 };

// 检测工位：与试验区同排
export const INSPECT_CFG = {
  x: -26, z: 22.6,
  cycle: { IDLE: 3, CLAMP: 3, PROBE: 3, SCANNING: 5, RESULT: 6 },
  ngEvery: { mod: 10, at: 7 },
};

// 机械臂（事件门控五阶段状态机 + 圆柱坐标轨迹 + 平面二连杆 IK）
export const ROBOT_CFG = {
  stations: [ { x: -88, offset: 0 }, { x: -52, offset: 11 } ],
  cycle: { WAIT: 3, GRASP: 4, TRANSFER: 5.5, PLACE: 4, RETRACT: 5.5 },
  rSrc: 4.2,
  hoverH: 3.0,
  gripH0: 1.63,       // 第 0 层抓取高度 = 层中心 + 0.95；第 i 层 = gripH0 + i*1.02
  carryH: 4.82,       // v3：越过成品堆顶（3 层顶 3.22）的搬运高度
  L1: 2.9, L2: 2.1,
  shoulderY: 2.8,
  // 物料协同（v3）：料位/成品位容量与事件门控参数
  mfg: { stockMax: 4, targetMax: 3, prestock: 2, minWait: 1.8, layerPitch: 1.02, pieceCY0: 0.68 },
};

// AGV 车队（沿路网行驶）：与 v2 相同
export const VEHICLE_CFG = {
  speed: 5,
  laneOffset: 2.6,
  sampleArc: 9,
  junctions: ['n2', 'n3', 'n4'],
  junctionR: 9,
  junctionStop: 13,
  followGap: 9,
  followLat: 2.6,
  fault: { dur: 7, respawnMin: 50, respawnVar: 40 },
  routes: {
    wh:   ['n4', 'n2', 'n5', 'n2', 'n4'],
    port: ['n2', 'n3', 'n6', 'n3', 'n2'],
    full: ['n0', 'n4', 'n7', 'n4', 'n2', 'n5', 'n2', 'n3', 'n6', 'n3', 'n1', 'n0'],
  },
  fleet: [
    { route: 'wh',   s0: 0 },
    { route: 'wh',   s0: 0.5 },
    { route: 'port', s0: 0 },
    { route: 'port', s0: 0.55 },
    { route: 'full', s0: 0.3 },
  ],
};

// 船舶靠离调度（P4）：两轮班期错峰（A 泊位 x=45 / B 泊位 x=85，同泊位带 z=103.5）。
// 时序已核算：A 进港[0,40] 靠泊[40,150] 装卸[44,134]（9 箱×10s+4s 延迟）离港[150,180]；
// B 平移 +180：[180,220]/[220,330]/[224,314]/[330,360] —— 全程走廊无重叠。
export const MARINE_CFG = {
  T: 360,
  sailMinX: -20,      // 进港起点 / 离港终点（水域西缘内）
  berthZ: 103.5,
  ships: [
    { name: 'A', berthX: 45, t0: 0 },
    { name: 'B', berthX: 85, t0: 180 },
  ],
  approachDur: 40, berthDur: 110, departDur: 30,   // 0..40 / 40..150 / 150..180
  turnDur: 6,                                      // 离港前原地回转（ departed 前段）
  loadDelay: 4,
  loadDur: 10,
  loadN: 9,                                        // 堆场可取底层箱恰 9 只（见 factory.v3 pickup 规则）
  fade: 5, fadeOut: 3,
  bobSail: 0.12, bobBerth: 0.04, bobFreq: 0.45,
  sinkPer: 0.015,
  rowPitch: 2.2,      // 甲板双列装箱横向间距（±2.2）
  deckY: 3.7,         // 甲板箱中心高（舱盖 2.4 + 半箱 1.3）
  // STS 起重机：轨沿岸线（z 88/96），大车沿 x 行走（泊位间大移 + 装卸对位），
  // 小车沿臂（z 62..112，越轨悬臂伸到船位）行走，吊具竖直升降。
  crane: {
    railZs: [88, 96],
    legXs: [-10, 10],
    beamY: 17.2, trolleyY: 15.4,
    idleZ: 103.5,
    travelA: { win: [150, 162], to: 85 },   // A 离港期移向 B 泊位
    travelB: { win: [330, 342], to: 45 },   // B 离港期移回 A 泊位
    initX: 45,
  },
  hangIdleY: 8.0,
  hangOffY: 1.62,     // 吊具中心 → 箱中心
  yardY: 2.9,         // 堆场底层箱中心高 → 抓取吊具高 = yardY + hangOffY = 4.52
  carryY: 11.0,
};

// 物料协同（P4）：2 台物料 AGV（A/B 线）执行工件级任务队列
// 循环：仓储装料 → 送工位（卸料 + 收成品）→ 交检测 → 回仓
export const MATERIAL_CFG = {
  speed: 5,
  laneOffset: 2.6,
  batch: 4,
  dwell: { load: 3, unload: 4, handoff: 3 },
  followGap: 11, followLat: 2.0,
  dockZ: 28.5,          // 工位停靠位（与车队西行车道 31.4 间距 2.9m，扣除车宽留 0.6m 视觉间隙）
  holdDist: 8,          // 交付位占用时提前停车的距离
  blendT: 1.5,
  n4: { r: 9, stop: 16 },   // n4 路口让行参数（对车队持锁让行）
  // 仓储停靠位 (52.4,-44)：位于车队北行车道终点 (52.4,-40) 以北 4m（路径终点
  // 之外），不会阻塞车队 n5 折返（along<0 不触发跟车，已核算）。
  whPose: { x: 52.4, z: -44 },
  lines: [
    { id: 'A', station: 0, dock: 'dA', startAt: 0 },
    { id: 'B', station: 1, dock: 'dB', startAt: 50 },
  ],
  legs: {
    out:  { A: ['n5', 'n2', 'n4', 'dA'], B: ['n5', 'n2', 'n4', 'dB'] },
    toIns:{ A: ['dA', 'dI'], B: ['dB', 'dI'] },   // 同在主干道，直达不绕 n4
    home: { A: ['dI', 'n4', 'n2', 'n5'], B: ['dI', 'n4', 'n2', 'n5'] },
  },
};

// 路网节点图：主干道 4 段 + 三条支路（同 v2）。
// v3 新增停靠节点 dA/dB/dI（位于主干道 z=34 上，仅寻路用）。
export const ROAD_GRAPH = {
  mainW: 12,
  branchW: 8,
  nodes: {
    n0: { x: -130, z: 34 },
    n1: { x: 130,  z: 34 },
    n2: { x: 55,   z: 34 },
    n3: { x: 65,   z: 34 },
    n4: { x: -16,  z: 34 },
    n5: { x: 55,   z: -40 },
    n6: { x: 65,   z: 58 },
    n7: { x: -16,  z: 22 },
    dA: { x: -88,  z: 34 },
    dB: { x: -52,  z: 34 },
    dI: { x: -26,  z: 34 },
  },
  edges: [
    ['n0', 'n4', true],
    ['n4', 'n2', true],
    ['n2', 'n3', true],
    ['n3', 'n1', true],
    ['n4', 'n7', false],
    ['n2', 'n5', false],
    ['n3', 'n6', false],
  ],
};

export const TIME = { defaultSpeed: 1 };

// ============================================================
// config.v2.js —— 全局常量：尺度、颜色、路网、时间与工序参数
// v2 变更：
//   - 主厂房北移（z=-8），厂前腾出装配试验区平台 APRON（P1 机械臂站位）；
//   - ROAD_GRAPH 主干道按岔口拆分为 4 段（车辆寻路需要真图拓扑，
//     n2/n3/n4 成为图节点；绘制结果与 v1 视觉一致，接缝面法线相反不产生 Z-fighting）；
//   - 新增 ROBOT_CFG / INSPECT_CFG / VEHICLE_CFG 工序参数（P1/P2）。
// ============================================================

export const COLORS = {
  white: 0xf5f6f7,        // 主色：白
  lightGray: 0xd9dce1,    // 主色：浅灰
  darkGray: 0x4a4f57,     // 主色：深灰
  orange: 0xf08a24,       // 强调色：工业橙
  ground: 0xe6e8ec,       // 基地地面
  road: 0x9aa0a8,         // 路面
  marking: 0xf5f6f7,      // 道路标线
  water: 0x9fbdd4,        // 港池水面
  glass: 0x8fa3b8,        // 窗带玻璃
};

export const LAYOUT = {
  groundSize: 460,
  factory:   { x: -70, z: -8,  w: 84, d: 40, h: 16 },  // 主装配车间（v2: z -8，厂前留装配试验区）
  warehouse: { x: 55,  z: -62, w: 60, d: 44 },
  port:      { x: 65,  z: 78,  w: 80, d: 40 },
  water:     { x: 65,  z: 165, w: 170, d: 130 },
};

// 装配试验区平台（P1：机械臂工作站 A/B 站位）
export const APRON = { x: -70, z: 21, w: 64, d: 10, h: 0.5 };

// 检测工位（P2）：独立小平台，位于试验区与车间支路之间
export const INSPECT_CFG = {
  x: -26, z: 21,
  cycle: { IDLE: 3, CLAMP: 3, PROBE: 3, SCANNING: 5, RESULT: 6 },  // 合计 20s
  ngEvery: { mod: 10, at: 7 },   // 第 k 循环 k%10===7 时 NG（确定性结果序列）
};

// 机械臂（P1）：五阶段周期 22s；圆柱坐标轨迹 + 平面二连杆 IK
export const ROBOT_CFG = {
  stations: [ { x: -88, offset: 0 }, { x: -52, offset: 11 } ],
  cycle: { WAIT: 3, GRASP: 4, TRANSFER: 5.5, PLACE: 4, RETRACT: 5.5 },  // 合计 22s
  rSrc: 4.2,          // 源/目标托盘半径（站局坐标，源 -x / 目标 +x）
  hoverH: 3.0,        // 等待位夹爪安装高度（站局）
  gripH: 1.63,        // 抓取/落位高度（工件顶 + 0.45）
  carryH: 2.93,       // 搬运高位
  L1: 2.9, L2: 2.1,   // 大臂/小臂长
  shoulderY: 2.8,     // 肩部铰点高（站局）
};

// AGV 车辆（P2）：沿 ROAD_GRAPH 行驶，跟车 + 路口锁 + 故障联动
export const VEHICLE_CFG = {
  speed: 5,           // m/s
  laneOffset: 2.6,    // 右侧行车道偏移（靠右行驶，对向车自然错车道）
  sampleArc: 9,       // 航向平滑窗口（±弧长，转弯圆滑过渡）
  junctions: ['n2', 'n3', 'n4'],   // 路口节点（度 ≥ 3）
  junctionR: 9,       // 路口占用判定半径
  junctionStop: 13,   // 路口让行停止线（距路口中心）
  followGap: 9,       // 跟车安全间距
  followLat: 2.6,     // 跟车横向对齐容差（车道外车辆不触发跟车）
  fault: { dur: 7, respawnMin: 50, respawnVar: 40 },  // 故障时长/下次故障间隔
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

// 路网节点图：主干道拆分为 4 段（n0-n4-n2-n3-n1）+ 三条支路。
// vehicle.v2.js 依赖此图做寻路与路口通行控制。
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

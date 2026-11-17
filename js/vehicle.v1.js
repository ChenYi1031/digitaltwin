// ============================================================
// vehicle.v1.js —— AGV / 物流车辆【P0 留桩，未启用】
// ------------------------------------------------------------
// 计划实现（P2/P3）：
//   1. 沿 js/config.v1.js 的 ROAD_GRAPH 路网行驶（节点寻路 + 弧长参数化）。
//   2. 跟车间距控制：同边车辆按弧长排序保持安全间距。
//   3. 路口通行控制：节点占用锁，冲突让行。
//   4. 故障停车与警报联动：FAULT 状态触发高亮/警报。
//   运动全部由 simClock.simTime 推算：弧长 = 速度 × (simTime - t0)，暂停自然停走、
//   恢复后连续无跳变。
// P0 仅导出枚举与桩函数，UI 面板标注"未启用"。
// ============================================================

export const VEHICLE_STATE = {
  PARKED: 'PARKED',
  RUNNING: 'RUNNING',
  YIELD: 'YIELD',
  FAULT: 'FAULT',
};

export function createVehicleSystem() {
  return {
    enabled: false,                  // P0：未启用
    vehicles: [],
    roadGraphRef: 'ROAD_GRAPH (js/config.v1.js)',
  };
}

/** P2/P3 实现：推进车辆行驶逻辑（当前为空桩） */
export function updateVehicles(system, simTime) {
  if (!system.enabled) return;       // 桩：未启用直接返回
  // TODO(P2): 沿路网行驶 / 跟车 / 路口通行 / 故障联动
}

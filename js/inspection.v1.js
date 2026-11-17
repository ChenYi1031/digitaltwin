// ============================================================
// inspection.v1.js —— 模组检测工位【P0 留桩，未启用】
// ------------------------------------------------------------
// 计划实现（P2）：
//   四阶段状态机（显式枚举 + 转移条件表）：
//     CLAMP（夹紧）→ PROBE（探针接触）→ SCANNING（检测中）
//       → RESULT（结果反馈：OK / NG 指示）→ IDLE
//   探针位移与指示灯相位全部由 simClock.simTime 推算。
// P0 仅导出枚举与桩函数，UI 面板标注"未启用"。
// ============================================================

export const INSPECT_PHASE = {
  IDLE: 'IDLE',
  CLAMP: 'CLAMP',
  PROBE: 'PROBE',
  SCANNING: 'SCANNING',
  RESULT: 'RESULT',
};

export function createInspection() {
  return {
    enabled: false,                  // P0：未启用
    phase: INSPECT_PHASE.IDLE,
    // P2 预留：clampJaw / probe / indicatorLight / workpiece
  };
}

/** P2 实现：驱动检测四阶段（当前为空桩） */
export function updateInspection(state, simTime) {
  if (!state.enabled) return;        // 桩：未启用直接返回
  // TODO(P2): 按 INSPECT_PHASE 状态机推进
}

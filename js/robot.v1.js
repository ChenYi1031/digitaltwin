// ============================================================
// robot.v1.js —— 机械臂工作站【P0 留桩，未启用】
// ------------------------------------------------------------
// 计划实现（P1）：
//   1. 五阶段状态机（显式枚举 ROBOT_PHASE + 转移条件表，禁止 if 堆叠隐式状态）：
//      IDLE → WAIT（等待工件到位）→ GRASP（抓取）→ TRANSFER（搬运）
//           → PLACE（落位）→ RETRACT（回位）→ IDLE
//   2. 夹爪与工件父子挂接：Object3D.attach()，不做逐帧手动位置同步。
//   3. 全部关节相位由 simClock.simTime 推算（simTime 进模取周期），暂停自然停走。
// P0 仅导出枚举与桩函数，UI 面板标注"未启用"。
// ============================================================

export const ROBOT_PHASE = {
  IDLE: 'IDLE',
  WAIT: 'WAIT',
  GRASP: 'GRASP',
  TRANSFER: 'TRANSFER',
  PLACE: 'PLACE',
  RETRACT: 'RETRACT',
};

export function createRobot() {
  return {
    enabled: false,                  // P0：未启用
    phase: ROBOT_PHASE.IDLE,
    // P1 预留：baseGroup / armJoints / gripper / attachedPart
  };
}

/** P1 实现：驱动状态机与关节动画（当前为空桩） */
export function updateRobot(robot, simTime) {
  if (!robot.enabled) return;        // 桩：未启用直接返回
  // TODO(P1): 按 ROBOT_PHASE 状态机推进
}

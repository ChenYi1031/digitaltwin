// ============================================================
// simClock.v1.js —— 全局唯一仿真时间源（仿真与动画规则 §7）
//   simTime += delta * speed；暂停时 speed 生效为 0，恢复后从暂停处继续，
//   时间连续无跳变。所有周期性/状态机动画一律用 simTime 推算相位，
//   禁止每帧自增局部计时器。
// ============================================================

export class SimClock {
  constructor() {
    this.simTime = 0;    // 累计仿真时间（秒）
    this.speed = 1;      // 倍速（暂停时不修改 speed，用 paused 门控）
    this.paused = false;
  }

  /** 每帧调用：realDelta 为真实帧间隔（秒），返回累计仿真时间 */
  update(realDelta) {
    if (!this.paused && realDelta > 0) {
      this.simTime += realDelta * this.speed;
    }
    return this.simTime;
  }

  pause()  { this.paused = true; }
  resume() { this.paused = false; }
  toggle() { this.paused = !this.paused; return this.paused; }
}

// ============================================================
// ui.v1.js —— 悬浮面板（纯 DOM + CSS，不用 lil-gui）
//   显示基地名称、选中设施信息、工序模块状态（留桩标"未启用"）、
//   暂停/恢复按钮与仿真时钟。
// ============================================================

export function initUI({ onPauseToggle }) {
  const el = {
    name: document.getElementById('sel-name'),
    status: document.getElementById('sel-status'),
    desc: document.getElementById('sel-desc'),
    btn: document.getElementById('btn-pause'),
    clock: document.getElementById('clock'),
  };

  el.btn.addEventListener('click', onPauseToggle);

  let lastClockText = '';

  return {
    /** 更新选中设施信息；传 null 恢复默认提示 */
    setSelected(f) {
      if (f) {
        el.name.textContent = f.name;
        el.status.textContent = f.status;
        el.desc.textContent = f.desc;
        el.name.classList.add('active');
      } else {
        el.name.textContent = '— 未选中 —';
        el.status.textContent = '点击厂房 / 仓储 / 港口 / 道路查看信息并聚焦';
        el.desc.textContent = '';
        el.name.classList.remove('active');
      }
    },

    /** 暂停状态同步按钮文案 */
    setPaused(paused) {
      el.btn.textContent = paused ? '恢复' : '暂停';
      el.btn.classList.toggle('paused', paused);
    },

    /** 仿真时钟显示（mm:ss，仅在文本变化时写 DOM） */
    setClock(simTime) {
      const total = Math.floor(simTime);
      const text =
        String(Math.floor(total / 60)).padStart(2, '0') +
        ':' +
        String(total % 60).padStart(2, '0');
      if (text !== lastClockText) {
        el.clock.textContent = text;
        lastClockText = text;
      }
    },
  };
}

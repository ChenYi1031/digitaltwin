// ============================================================
// ui.v2.js —— 悬浮面板（纯 DOM + CSS，不用 lil-gui）
//   基地名称、选中设施信息、工序模块状态标签、产线遥测、
//   故障警报条、暂停/巡游按钮、仿真时钟。
//   全部文本带变更检测：仅在实际变化时写 DOM。
// ============================================================

export function initUI({ onPauseToggle, onTourToggle }) {
  const $ = (id) => document.getElementById(id);
  const el = {
    name: $('sel-name'),
    status: $('sel-status'),
    desc: $('sel-desc'),
    pause: $('btn-pause'),
    tour: $('btn-tour'),
    clock: $('clock'),
    alarm: $('alarm'),
    mod: {
      robot: $('mod-robot'),
      inspect: $('mod-inspect'),
      vehicle: $('mod-vehicle'),
      tour: $('mod-tour'),
    },
    tel: {
      ra: $('tel-robot-a'),
      rb: $('tel-robot-b'),
      ins: $('tel-inspect'),
      agv: $('tel-agv'),
    },
  };

  const cache = {};
  const setText = (node, key, text) => {
    if (cache[key] !== text) {
      cache[key] = text;
      node.textContent = text;
    }
  };

  el.pause.addEventListener('click', onPauseToggle);
  el.tour.addEventListener('click', onTourToggle);

  return {
    /** 更新选中设施信息；传 null 恢复默认提示 */
    setSelected(f) {
      if (f) {
        setText(el.name, 'name', f.name);
        setText(el.status, 'status', f.status);
        setText(el.desc, 'desc', f.desc);
        el.name.classList.add('active');
      } else {
        setText(el.name, 'name', '— 未选中 —');
        setText(el.status, 'status', '点击厂房 / 机械臂 / 检测 / 港口 / 道路查看信息并聚焦');
        setText(el.desc, 'desc', '');
        el.name.classList.remove('active');
      }
    },

    /** 暂停状态同步按钮文案 */
    setPaused(paused) {
      const t = paused ? '恢复' : '暂停';
      if (cache.paused !== t) {
        cache.paused = t;
        el.pause.textContent = t;
        el.pause.classList.toggle('paused', paused);
      }
    },

    /** 巡游状态同步按钮 */
    setTourActive(active) {
      const t = active ? '停止巡游' : '巡游';
      if (cache.tour !== t) {
        cache.tour = t;
        el.tour.textContent = t;
        el.tour.classList.toggle('active', active);
      }
      setText(el.mod.tour, 'modTour', active ? '巡游中 · 拖拽接管' : '点击「巡游」开启');
    },

    /** 故障警报条（null/空数组 = 隐藏） */
    setAlarm(list) {
      const t = list && list.length ? list.join('；') : '';
      if (cache.alarm !== t) {
        cache.alarm = t;
        el.alarm.hidden = !t;
        el.alarm.textContent = t;
      }
    },

    /** 仿真时钟显示（mm:ss，仅在文本变化时写 DOM） */
    setClock(simTime) {
      const total = Math.floor(simTime);
      const text =
        String(Math.floor(total / 60)).padStart(2, '0') +
        ':' +
        String(total % 60).padStart(2, '0');
      setText(el.clock, 'clock', text);
    },

    /** 工序模块状态标签 */
    setModules(m) {
      setText(el.mod.robot, 'modRobot', m.robot);
      setText(el.mod.inspect, 'modInspect', m.inspect);
      setText(el.mod.vehicle, 'modVehicle', m.vehicle);
    },

    /** 产线遥测 */
    setTelemetry(t) {
      setText(el.tel.ra, 'telRa', t.ra);
      setText(el.tel.rb, 'telRb', t.rb);
      setText(el.tel.ins, 'telIns', t.ins);
      setText(el.tel.agv, 'telAgv', t.agv);
    },
  };
}

// ============================================================
// ui.v3.js —— 悬浮面板（纯 DOM + CSS）
//   v3：模块列表新增 船舶调度 / 物料协同；遥测新增 物料 A/B 线。
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
      marine: $('mod-marine'),
      material: $('mod-material'),
      tour: $('mod-tour'),
    },
    tel: {
      ra: $('tel-robot-a'),
      rb: $('tel-robot-b'),
      ins: $('tel-inspect'),
      agv: $('tel-agv'),
      matA: $('tel-mat-a'),
      matB: $('tel-mat-b'),
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
    setSelected(f) {
      if (f) {
        setText(el.name, 'name', f.name);
        setText(el.status, 'status', f.status);
        setText(el.desc, 'desc', f.desc);
        el.name.classList.add('active');
      } else {
        setText(el.name, 'name', '— 未选中 —');
        setText(el.status, 'status', '点击任意设施查看信息并聚焦');
        setText(el.desc, 'desc', '');
        el.name.classList.remove('active');
      }
    },

    setPaused(paused) {
      const t = paused ? '恢复' : '暂停';
      if (cache.paused !== t) {
        cache.paused = t;
        el.pause.textContent = t;
        el.pause.classList.toggle('paused', paused);
      }
    },

    setTourActive(active) {
      const t = active ? '停止巡游' : '巡游';
      if (cache.tour !== t) {
        cache.tour = t;
        el.tour.textContent = t;
        el.tour.classList.toggle('active', active);
      }
      setText(el.mod.tour, 'modTour', active ? '巡游中 · 拖拽接管' : '点击「巡游」开启');
    },

    setAlarm(list) {
      const t = list && list.length ? list.join('；') : '';
      if (cache.alarm !== t) {
        cache.alarm = t;
        el.alarm.hidden = !t;
        el.alarm.textContent = t;
      }
    },

    setClock(simTime) {
      const total = Math.floor(simTime);
      const text =
        String(Math.floor(total / 60)).padStart(2, '0') +
        ':' +
        String(total % 60).padStart(2, '0');
      setText(el.clock, 'clock', text);
    },

    setModules(m) {
      setText(el.mod.robot, 'modRobot', m.robot);
      setText(el.mod.inspect, 'modInspect', m.inspect);
      setText(el.mod.vehicle, 'modVehicle', m.vehicle);
      setText(el.mod.marine, 'modMarine', m.marine);
      setText(el.mod.material, 'modMaterial', m.material);
    },

    setTelemetry(t) {
      setText(el.tel.ra, 'telRa', t.ra);
      setText(el.tel.rb, 'telRb', t.rb);
      setText(el.tel.ins, 'telIns', t.ins);
      setText(el.tel.agv, 'telAgv', t.agv);
      setText(el.tel.matA, 'telMatA', t.matA);
      setText(el.tel.matB, 'telMatB', t.matB);
    },
  };
}

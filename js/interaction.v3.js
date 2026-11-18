// ============================================================
// interaction.v3.js —— Raycaster 拾取与高亮
// v3：仅配置版本跟进（import config.v3），逻辑与 v2 一致。
// 健壮性检查（§9）：
//   - 只对"可交互对象集合"（pickMeshes）做射线检测，不遍历全场景；
//   - 拖拽轨道（位移 > 6px）不判定为点击，避免旋转后误触发聚焦；
//   - 高亮通过设施专属材质的 emissive 实现（材质隔离，互不影响）；
//   - userData.noHighlight 的材质（状态指示灯等）不参与高亮。
// ============================================================

import * as THREE from 'three';
import { COLORS } from './config.v3.js';

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/**
 * 初始化拾取。facilities: [{ id, group, focus, ... }]
 * onSelect(hoveredFacilityOrNull) 在点击时回调（拖拽除外）
 * onHover(facilityOrNull) 在移动时回调（用于指针样式）
 */
export function initInteraction({ camera, dom, facilities, onSelect, onHover }) {
  // 构建可交互 mesh 集合（每帧不变，点击时零遍历场景）
  const pickMeshes = [];
  facilities.forEach((f) => {
    f.group.traverse((o) => {
      if (o.isMesh) {
        o.userData.facilityId = f.id;
        pickMeshes.push(o);
      }
    });
  });

  function pick(e) {
    pointer.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickMeshes, false);
    if (!hits.length) return null;
    const fid = hits[0].object.userData.facilityId;
    return facilities.find((f) => f.id === fid) || null;
  }

  let downX = 0, downY = 0;
  dom.addEventListener('pointerdown', (e) => {
    downX = e.clientX;
    downY = e.clientY;
  });
  dom.addEventListener('pointerup', (e) => {
    // 轨道拖拽不算点击
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
    if (e.button !== 0) return;
    onSelect(pick(e));
  });
  dom.addEventListener('pointermove', (e) => {
    const f = pick(e);
    dom.style.cursor = f ? 'pointer' : '';
    if (onHover) onHover(f);
  });
}

/** 设施高亮开关：emissive 指向工业橙（设施材质独立，互不影响） */
export function setHighlight(facility, on) {
  facility.mats.forEach((m) => {
    if (!m.emissive) return;
    m.emissive.setHex(on ? COLORS.orange : 0x000000);
    m.emissiveIntensity = 0.35;
  });
}

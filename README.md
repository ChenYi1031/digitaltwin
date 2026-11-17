# 电池模组装配基地 · 数字孪生总览（P0）

Three.js r168 程序化建模的工业数字孪生总览页面：厂房、道路、仓储、港口，
白灰 + 工业橙配色，轻量悬浮数据面板。纯静态站点，**零构建、零 npm 依赖**，
Three.js 本地自包含于 `vendor/`，不依赖任何公网 CDN。

## 本地预览

必须通过 HTTP 服务预览（ES Module 不能用 `file://` 双击打开）：

```bash
python -m http.server 8080
```

浏览器打开 <http://localhost:8080>。

## 操作

- 左键拖拽旋转 · 滚轮缩放 · 右键平移
- 点击厂房 / 仓储 / 港口 / 道路：高亮 + 镜头平滑聚焦 + 面板显示信息
- 面板按钮：暂停 / 恢复（所有仿真动画基于全局仿真时钟，暂停停走、恢复连续）

## 部署（EdgeOne Pages）

1. 推送本仓库到 GitHub：<https://github.com/ChenYi1031/digitaltwin.git>
2. EdgeOne Pages →「导入 Git 仓库」→ 选择仓库
3. 构建命令、安装命令、输出目录**全部留空**（根目录 `edgeone.json` 已声明零构建）
4. 无需任何环境变量

## 目录结构

```
index.html            页面入口（importmap 指向本地 vendor）
edgeone.json          零构建静态站点声明
css/main.v1.css       悬浮面板样式
js/main.v1.js         入口：装配模块、渲染循环
js/config.v1.js       全局常量：尺度、颜色、路网、时间参数
js/scene.v1.js        场景、相机、灯光、天空渐变
js/factory.v1.js      厂房 / 仓储 / 港口体块
js/road.v1.js         路网节点图 → 路面与标线
js/camera.v1.js       OrbitControls + 缓动聚焦 + 巡游留桩
js/interaction.v1.js  Raycaster 拾取与高亮
js/ui.v1.js           悬浮面板逻辑
js/simClock.v1.js     全局唯一仿真时钟
js/robot.v1.js        【留桩】机械臂五阶段状态机
js/inspection.v1.js   【留桩】检测工位四阶段
js/vehicle.v1.js      【留桩】AGV 沿路网行驶
vendor/               Three.js r168 本地自包含
```

## 后续阶段（未启用，接口已预埋）

- P1 机械臂工作站：五阶段状态机，`Object3D.attach()` 夹爪挂接
- P2 检测工位：夹紧 → 探针接触 → 检测中 → 结果反馈
- P2/P3 AGV 车辆：沿 `ROAD_GRAPH` 路网行驶、跟车间距、路口通行、故障警报
- P3 自动巡游：细节镜头序列 + 鼠标接管切换

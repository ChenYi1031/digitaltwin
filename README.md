# 电池模组装配基地 · 数字孪生

Three.js r168 程序化建模的工业数字孪生：基地总览（厂房、道路、仓储、港口）+
产线工序仿真（机械臂、检测工位、AGV 车辆）+ 自动巡游。
白灰 + 工业橙配色，轻量悬浮数据面板。纯静态站点，**零构建、零 npm 依赖**，
Three.js 本地自包含于 `vendor/`，不依赖任何公网 CDN。

## 本地预览

必须通过 HTTP 服务预览（ES Module 不能用 `file://` 双击打开）：

```bash
python -m http.server 8080
```

浏览器打开 <http://localhost:8080>。

## 功能

- **基地总览**：程序化厂房 / 仓储堆棚 / 港口码头与门机，路网节点图生成主干道与支路
- **机械臂工作站 ×2（P1）**：等待 → 抓取 → 搬运 → 落位 → 回位 五阶段状态机；
  圆柱坐标轨迹 + 二连杆 IK；夹爪与工件 `Object3D.attach()` 父子挂接
- **检测工位（P2）**：夹紧 → 探针接触 → 检测中 → 结果反馈 四阶段；指示灯状态联动，
  确定性 NG 序列（每 10 循环 1 次），面板推算良率
- **AGV 车辆 ×5（P2）**：沿路网弧长参数化行驶，右侧行车道、跟车间距、
  路口占用锁让行、周期性故障停车与警报联动（面板警报条 + 急闪警示灯）
- **自动巡游（P3）**：7 站镜头序列（全景/车间/机械臂/检测/仓储/港口/路网），
  鼠标拖拽即接管
- **交互**：点击任一设施高亮 + 镜头平滑聚焦 + 面板信息；暂停/恢复
  （所有工序动画基于全局仿真时钟，暂停停走、恢复连续无跳变）

## 部署（EdgeOne Pages）

1. 推送本仓库到 GitHub：<https://github.com/ChenYi1031/digitaltwin.git>
2. EdgeOne Pages →「导入 Git 仓库」→ 选择仓库
3. 构建命令、安装命令、输出目录**全部留空**（根目录 `edgeone.json` 已声明零构建）
4. 无需任何环境变量

## 目录结构

```
index.html            页面入口（importmap 指向本地 vendor）
edgeone.json          零构建静态站点声明
css/main.v2.css       悬浮面板样式
js/main.v2.js         入口：装配模块、渲染循环
js/config.v2.js       全局常量：尺度、颜色、路网、工序参数
js/scene.v2.js        场景、相机、灯光、天空渐变
js/factory.v2.js      厂房 / 装配试验区 / 仓储 / 港口体块
js/road.v2.js         路网节点图 → 路面与标线
js/robot.v2.js        机械臂五阶段状态机（P1）
js/inspection.v2.js   检测工位四阶段（P2）
js/vehicle.v2.js      AGV 沿路网行驶（P2）
js/camera.v2.js       OrbitControls + 缓动聚焦 + 自动巡游（P3）
js/interaction.v2.js  Raycaster 拾取与高亮
js/ui.v2.js           悬浮面板逻辑
js/simClock.v2.js     全局唯一仿真时钟
vendor/               Three.js r168 本地自包含
```

## 缓存策略

静态资源（JS/CSS）文件名带版本后缀（当前 `.v2`）。**内容变更时必须升版本号并
同步更新所有 import 路径与 index.html 引用**，避免 EdgeOne 边缘缓存返回旧版本。

## 后续可扩展

- 船舶靠离调度与港口装卸动画
- 仓储 AGV 与机械臂的物料协同（工件级任务队列）
- 数据接入：用真实 MES 数据驱动面板与状态

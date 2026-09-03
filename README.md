<h1 align="center">Cesium Annotation Editor</h1>

<p align="center">
  轻量、开箱即用的 TypeScript Cesium 标绘与几何编辑插件，提供响应式 Entity 渲染与 Leaflet-Geoman 风格 API。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cesium-annotation-editor"><img src="https://img.shields.io/npm/v/cesium-annotation-editor.svg?color=3388ff" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/cesium-annotation-editor"><img src="https://img.shields.io/npm/dm/cesium-annotation-editor.svg" alt="npm downloads"></a>
  <a href="https://github.com/nanvon/cesium-annotation-editor"><img src="https://img.shields.io/badge/types-TypeScript-blue" alt="TypeScript"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-orange" alt="license"></a>
</p>

<p align="center">
  <a href="./README_EN.md">English</a> · <b>简体中文</b>
</p>

---

## 🎯 概览

Cesium 官方未内置高层的交互式标绘与几何编辑组件，业务自研往往需要处理底层 `ScreenSpaceEventHandler` 状态机、动态顶点 Handle 维护、多边形实时闭合以及复杂的空间吸附计算。

**Cesium Annotation Editor** 基于 Cesium Entity API 渲染并维护独立的响应式标注状态。它为点、折线、多边形、圆形提供完整的标绘交互、顶点微调、整件拖拽移动、实时吸附及标准序列化能力；同时提供对标 Leaflet-Geoman 的生态 API，帮助二维 WebGIS 开发者零迁移成本过渡至三维空间标绘场景。

---

## ✨ 核心特性

- **多几何要素覆盖** — 支持点（Point）、折线（Polyline）、多边形（Polygon）和真圆（Circle，保留圆心与精确半径，非多边形离散模拟）的交互式绘制与动态渲染。
- **顶点与整件编辑** — 细粒度控制点拖拽编辑（点位置、折线/面各顶点、圆心与半径控制点），支持标注整件拖拽平移（Cartographic 经纬度差值推算）。
- **空间几何吸附 (Snapping)** — 绘制与编辑阶段实时吸附至已有标注顶点与线段骨架；圆形支持圆心与圆周采样点吸附；按住 `Alt` 键毫秒级临时脱附。
- **双套 API 体系** — 兼顾现代化面向对象原生 API (`CesiumAnnotationEditor`) 与高度兼容 Leaflet-Geoman 的生态 API (`editor.pm` / `viewer.pm`)，支持无缝移植。
- **标准双向数据流转** — 原生经纬度扁平 JSON (`toJSON` / `fromJSON`) 与开放标准 GeoJSON `FeatureCollection` (`toGeoJSON` / `fromGeoJSON`) 双向无损转换，圆要素通过扩展属性保真。
- **大数据量渲染优化** — 视口可见性 Handle 增量裁剪、吸附候选视口索引缓存，深度适配 Cesium 的 `requestRenderMode: true` 按需渲染机制。

> [!NOTE]
> 本插件聚焦轻量通用的空间要素标绘与编辑。当前不包含文字注记、倾斜矩形、几何裁剪/布尔运算、测量算子以及撤销/重做栈。

---

## 📦 快速安装

```bash
npm install cesium cesium-annotation-editor
```

### 环境要求

* **CesiumJS**：`^1.130.0` (Peer Dependency，需宿主配置好 Cesium 静态资源加载，如使用 `vite-plugin-cesium`)；
* **构建支持**：提供 ESM 与 CJS 双格式出口，内置 TypeScript 完整类型支持；
* **浏览器兼容**：Chrome / Edge / Safari / Firefox 近两个主版本。

---

## 🚀 快速上手

```ts
import { Viewer } from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { CesiumAnnotationEditor } from 'cesium-annotation-editor';
import 'cesium-annotation-editor/styles.css';

// 1. 初始化 Cesium 场景（强烈建议开启 requestRenderMode 以获得最佳能耗表现）
const viewer = new Viewer('cesiumContainer', {
  animation: false,
  timeline: false,
  requestRenderMode: true,
  maximumRenderTimeChange: Infinity
});

// 2. 挂载编辑器实例
const editor = new CesiumAnnotationEditor(viewer, {
  toolbar: true,
  snapping: {
    enabled: true,
    snapDistance: 20
  }
});

// 3. 监听标注创建与全量变更
editor.on('create', ({ annotation }) => {
  console.log('创建标注:', annotation.id, annotation.type);
});

editor.on('change', () => {
  console.log('当前标注数据:', editor.toJSON());
});
```

---

## 💡 交互操作指南

| 几何类型 / 模式 | 交互动作 | 完成或确认方式 | 撤销与取消 |
| :--- | :--- | :--- | :--- |
| **点 (Point)** | 单击地图任意位置创建 | 单击即完成 | `Esc` 退出模式 |
| **折线 (Polyline)** | 连续单击添加折线顶点（至少 2 点） | 双击 / 单击末点 / `Enter` / 点击 `Finish` | `Backspace` 撤销上一点；`Esc` 取消 |
| **多边形 (Polygon)** | 连续单击添加轮廓顶点（至少 3 点） | 双击 / 单击首点闭合 / `Enter` / 点击 `Finish` | `Backspace` 撤销上一点；`Esc` 取消 |
| **圆形 (Circle)** | 首次点击确定圆心，移动光标预览半径 | 再次点击确定半径并完成 | `Esc` 取消绘制 |
| **编辑模式 (Edit)** | 点击选中要素，拖动高亮控制点调节形状 | 切换至其他工具或退出模式 | 自动同步至实体模型 |
| **拖动模式 (Drag)** | 按下鼠标拖拽任意标注整体平移 | 松开鼠标完成放置 | 保持相对几何拓扑 |

> [!TIP]
> 绘制或编辑过程中，按住键盘 **`Alt`** 键可临时关闭几何吸附，方便在密集线段旁微调或标绘自由点。

---

## 🔌 核心 API 与架构

### 1. 原生编程式 API

```ts
import { Cartesian3 } from 'cesium';

// 切换工作模式
editor.setMode('draw:polygon');
editor.enableDraw('polygon');
editor.finishDrawing();
editor.cancelDrawing();

// 编程式添加标注
const annotation = editor.addAnnotation({
  type: 'point',
  position: Cartesian3.fromDegrees(117.2272, 31.8206)
});

// 更新与移除
editor.updateAnnotation(annotation.id, {
  properties: { name: '检修井点 #1' }
});
editor.removeAnnotation(annotation.id);

// 模式管理
editor.enableEditMode();
editor.select(annotation.id);
editor.enableDragMode();

// 销毁实例（默认保留正式实体，仅清理工作层与事件）
editor.destroy();
```

### 2. Geoman-style 兼容 API

插件自动挂载 Geoman API 到 `editor.pm`（当 `viewer.pm` 未被占用时也会同步挂载）：

```ts
// 全局绘制与模式切换
editor.pm.enableDraw('Polygon');
editor.pm.enableGlobalEditMode();
editor.pm.disableGlobalEditMode();

// 图层级独立控制
const layers = editor.pm.getGeomanLayers();
const [targetLayer] = layers;

targetLayer.pm.enable(); // 开启单要素编辑
targetLayer.pm.enableLayerDrag(); // 开启单要素拖动
targetLayer.pm.on('pm:update', ({ annotation }) => {
  console.log('要素已更新:', annotation.id);
});
```

### 3. 核心生命周期与交互事件

```ts
editor.on('create', ({ annotation, source }) => {});     // 用户交互标绘完成
editor.on('update', ({ annotation, reason }) => {});     // 标注属性或几何更新
editor.on('change', ({ annotation, source }) => {});     // 标注集合任何变化
editor.on('select', ({ annotation, previous }) => {});   // 选中的标注发生变化
editor.on('vertexdragend', ({ annotation }) => {});      // 控制点拖拽结束
editor.on('dragend', ({ annotation }) => {});            // 要素整件拖拽结束
editor.on('pm:snap', ({ snapPosition, snapTargetType }) => {}); // 触发吸附
```

---

## 💾 数据序列化

### 原生 JSON 双向流转

导出/导入经纬度扁平数组格式（`[longitude, latitude, height]`），便于持久化至关系型数据库：

```ts
// 导出全量标注
const json = editor.toJSON();

// 清空当前图层并批量恢复
editor.fromJSON(json, { clear: true });
```

### 标准 GeoJSON 双向流转

导出标准 `FeatureCollection`，天然适配 QGIS、PostGIS、Mapbox 等外部 GIS 体系：

```ts
const geojson = editor.toGeoJSON();
editor.fromGeoJSON(geojson, { clear: true });
```

* **要素映射规则**：
  * `point` ➔ `Feature<Point>`
  * `polyline` ➔ `Feature<LineString>`
  * `polygon` ➔ `Feature<Polygon>`（导出自动外环闭合，导入时自动解闭合）
  * `circle` ➔ `Feature<Point>`（圆半径与插件元数据封装在 `properties.cesiumAnnotationEditor` 中）

---

## 🔧 配置项

```ts
const editor = new CesiumAnnotationEditor(viewer, {
  toolbar: true,                      // 是否展示默认工具栏，也可传入 ToolbarOptions 自定义位置与按钮
  shapes: ['point', 'polyline', 'circle', 'polygon'], // 启用的几何类型
  clampToGround: true,                // 是否贴地渲染（Entity clampToGround）
  snapping: {
    enabled: true,                    // 开启吸附
    snapDistance: 20,                 // 吸附触发像素距离阈值
    snapVertex: true,                 // 吸附顶点
    snapSegment: true,                // 吸附线段骨架
    disableWithAlt: true              // 允许 Alt 临时禁用
  },
  destroyBehavior: 'keep-annotations' // 销毁策略：'keep-annotations' 保留实体 / 'remove-all' 完全清空
});
```

---

## ⚡ 性能优化与实践

面向中等规模标注场景（数百 ~ 2000 个标注），插件内置以下关键优化：

1. **按需渲染适配 (Request Render)**：编辑器的绘制预览、控制点更新、拖动均主动派发 `viewer.scene.requestRender()`。强烈建议为宿主 `Viewer` 开启 `requestRenderMode: true`，在无交互静止时将 GPU/CPU 开销降至最低。
2. **视口 Handle 增量裁剪**：在全局编辑模式下，编辑器仅为当前相机视锥体内可见的标注创建顶点交互 Handle，相机停止移动时触发增量重建，避免视口外不可见标注过度创建 Cesium 实体。
3. **吸附候选版本缓存**：吸附候选坐标池基于标注版本号及视口进行惰性缓存，鼠标移动过程免除重复全量投影运算。

---

## 📖 相关文档

* [完整 API 契约与方法参数](./docs/cesium-annotation-editor/05-plugin-api-contract.md)
* [交互状态机与操作规格](./docs/cesium-annotation-editor/02-interaction-spec.md)
* [Cesium 技术架构设计](./docs/cesium-annotation-editor/04-cesium-technical-design.md)
* [大数据量性能优化设计](./docs/cesium-annotation-editor/07-large-scale-performance-design.md)
* [系统验收测试用例](./docs/cesium-annotation-editor/06-acceptance-tests.md)

---

## 📄 开源许可

[MIT](./LICENSE) © nanvon

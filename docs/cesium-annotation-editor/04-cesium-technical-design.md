# 04 Cesium Technical Design

## 架构概览

推荐模块：

```text
CesiumAnnotationEditor
  Toolbar
  ModeManager
  DrawController
    PointDrawTool
    PolylineDrawTool
    CircleDrawTool
    PolygonDrawTool
  EditController
    SelectionManager
    HandleManager
  DragController
  AnnotationStore
  EntityFactory
  PickService
  SnapService
  CameraInputGuard
  EventEmitter
  Serializer
```

核心原则：

- `AnnotationStore` 是业务真相源。
- Cesium `Entity` 是渲染对象，不是唯一数据模型。
- helper entities 独立管理，不参与导出。
- snap indicator 独立管理，不参与导出和 picking。
- 所有 `ScreenSpaceEventHandler` action 必须由 mode controller 注册和注销。
- `destroy()` 必须可重复调用且无副作用。

## Cesium API 映射

### Point

Annotation:

```ts
{
  type: 'point',
  position: Cartesian3
}
```

Cesium:

- `Entity.position`
- `Entity.point`

可选样式：

- `pixelSize`
- `color`
- `outlineColor`
- `outlineWidth`
- `heightReference`

### Polyline

Annotation:

```ts
{
  type: 'polyline',
  positions: Cartesian3[]
}
```

Cesium:

- `Entity.polyline.positions`
- `PolylineGraphics.clampToGround`

要求：

- 至少 2 个 positions。
- 拖动整体时更新所有 positions。
- 编辑顶点时更新单个 position。

### Polygon

Annotation:

```ts
{
  type: 'polygon',
  positions: Cartesian3[]
}
```

Cesium:

- `Entity.polygon.hierarchy`
- `PolygonHierarchy`

要求：

- 至少 3 个 positions。
- 内部数据不保存重复闭合点。
- 不支持 holes。

### Circle

Annotation:

```ts
{
  type: 'circle',
  center: Cartesian3,
  radius: number
}
```

Cesium:

- `Entity.position = center`
- `Entity.ellipse.semiMajorAxis = radius`
- `Entity.ellipse.semiMinorAxis = radius`

要求：

- radius 单位为米。
- center 拖动不改变 radius。
- radius handle 拖动只改变 radius。

## 动态预览策略

绘制中有两种实现方式：

1. 使用 `CallbackProperty` 从 working state 返回 positions/hierarchy/radius。
2. 在鼠标移动时直接重新设置 entity property。

建议：

- 第一版优先使用直接 property 更新，调试简单。
- 线只在点击确认顶点后更新 property，鼠标移动只做顶点 hover picking。
- 多边形绘制阶段沿用 Geoman 风格的临时 open polyline；鼠标移动更新 hint line，完成时才 promote 为正式 polygon。
- 点绘制的 cursor marker 跟随鼠标移动，但不写入业务数据。
- 如果渲染抖动或 property 更新代码重复，再引入 `CallbackProperty`。
- 完成绘制时优先原地 promote working entity 为正式 annotation entity，减少删除重建带来的闪烁；未被 promote 的 helper/working entity 必须清理。

## PickService

屏幕坐标转世界坐标是 Cesium 版成败关键。

推荐方法：

```ts
pickWorldPosition(screenPosition: Cartesian2): Cartesian3 | undefined
```

优先级：

1. 如果需要拾取 3D Tiles 或已渲染深度对象，且 `scene.pickPositionSupported` 为 true，尝试 `scene.pickPosition(screenPosition)`。
2. 如果失败，使用 `viewer.camera.getPickRay(screenPosition)`。
3. 使用 `viewer.scene.globe.pick(ray, viewer.scene)` 获取 globe/terrain 交点。
4. 如果仍失败，返回 undefined。

注意：

- `scene.pickPosition` 来自深度缓冲，透明对象和未开启深度拾取时会有差异。
- `globe.pick` 依赖当前渲染的 globe surface。
- 点击天空或地球外区域应返回 undefined。
- 不要在 pick 失败时用相机前方任意点伪造位置。

## SnapService

Snapping 基于屏幕像素距离，而不是世界距离：

1. 将已有 annotation 的顶点和线段端点通过 `SceneTransforms.worldToWindowCoordinates` 投影到屏幕。
2. 在 `snapDistance` 范围内找最近候选，顶点优先于线段。
3. 线段命中时先在屏幕线段上求最近点比例，再插值回 `Cartesian3`。
4. draw/edit controller 使用吸附后的 `Cartesian3` 更新 working geometry 或 edit preview。

候选来源：

- point position。
- polyline / polygon vertices。
- polyline / polygon segments，polygon 包含闭合边。
- circle center。圆周吸附暂不实现，避免把椭圆边界采样误认为真实业务顶点。
- draw mode 当前 working vertices，用于吸附到已确认顶点并支持接近首尾点完成。

排除规则：

- `properties.snapIgnore === true` 的 annotation 不参与吸附。
- edit mode 拖动某个 annotation 的 handle 时，不吸附到同一个 annotation。
- 按住 Alt 时临时关闭吸附。

## Annotation picking

需要区分三类对象：

- annotation entity
- edit handle entity
- 其他 Cesium entity / 3D Tiles feature

建议给所有插件 entity 写入内部属性：

```ts
entity.properties = {
  editorKind: 'annotation' | 'handle' | 'working',
  annotationId,
  handleType,
  vertexIndex
}
```

pick annotation：

- 使用 `scene.pick(screenPosition)`。
- 检查 `picked.id` 是否为 Cesium Entity。
- 检查 entity properties 或 WeakMap 记录。
- helper entity 优先级高于 annotation entity。

## CameraInputGuard

拖动 annotation 或 handle 时必须禁用相机输入。

推荐实现：

```ts
class CameraInputGuard {
  lock(): void
  unlock(): void
}
```

lock 时保存：

- `enableInputs`
- `enableRotate`
- `enableTranslate`
- `enableZoom`
- `enableTilt`
- `enableLook`

第一版可以直接设置：

```ts
controller.enableInputs = false;
```

但恢复时必须恢复旧值，而不是简单设回 true。Cesium 官方说明 `enableInputs` 适合临时禁用输入，但长期限制应使用更细粒度 flags。

## 位移算法

第一版推荐经纬差平移：

1. 将 from/to `Cartesian3` 转为 `Cartographic`。
2. 计算 `deltaLongitude`、`deltaLatitude`、`deltaHeight`。
3. 对所有 vertices 或 center 应用 delta。
4. 转回 `Cartesian3`。

优点：

- 简单。
- 对小范围标注足够稳定。
- 易调试。

风险：

- 高纬度大范围拖动可能形变。
- 跨日期变更线需要归一化 longitude。
- 对贴地标注，height 处理需要谨慎。

第二阶段可改为局部 ENU 平移：

- 在 drag start 的中心点建立 East-North-Up frame。
- 把点转换到局部坐标，应用平移，再转回世界坐标。
- 更适合 3D 场景和大范围标注。

## 贴地和高度

配置建议：

```ts
clampToGround: boolean
heightMode: 'terrain' | 'ellipsoid' | 'absolute'
```

第一版建议：

- 默认 `clampToGround = true`。
- polyline 使用 Cesium polyline 的 `clampToGround`。
- polygon 和 ellipse 使用对应的 height/heightReference 能力；如果运行环境不稳定，至少保证在 ellipsoid 上正确显示。
- point 使用 `heightReference`。

风险：

- 不同 Cesium 版本、terrain provider、3D Tiles、透明对象会影响 pickPosition。
- 贴地 polygon / ellipse 的材质支持可能受环境限制。
- 3D Tiles 表面标注不是第一版强保证。

## Controller 职责

### ModeManager

- 保存 active mode。
- 负责切换 mode。
- 切换前调用当前 controller 的 `deactivate()`。
- 切换后调用新 controller 的 `activate()`。
- 触发 `modechange`。

### DrawController

- 根据 shape 分发到具体 draw tool。
- 管理 working entities。
- 提供 `finish()`、`cancel()`、`removeLastVertex()`。
- 保证最小顶点数。

### EditController

- 管理当前 selected annotation。
- 创建和清理 handles。
- 处理 handle drag。
- 更新 annotation store 和 entity。

### DragController

- 处理 annotation pick。
- 管理 drag target。
- 计算位移。
- 更新 annotation store 和 entity。

### AnnotationStore

- `Map<string, Annotation>`
- 创建、更新、删除 annotation。
- 根据 entity 查 annotation。
- 发出内部变更通知。

### EntityFactory

- annotation -> Cesium entity。
- annotation update -> entity update。
- handle descriptor -> helper entity。
- working state -> working entity。

## 性能约束

第一版目标：

- 100 个 annotation 内交互流畅。
- 单个 polygon 500 个顶点内可编辑。
- edit mode 只显示选中对象 handles，避免一次创建海量 helper entities。

如果后续需要更多对象：

- handle 按需创建。
- 大对象限制 handle 数量或按视口过滤。
- 考虑 Primitive API 或 EntityCluster。

## 销毁清理

`destroy()` 必须：

- 退出 active mode。
- 销毁 `ScreenSpaceEventHandler`。
- 移除 toolbar DOM。
- 移除所有 working/helper entities。
- 可选保留或删除正式 annotation entities，由配置决定。
- 移除所有事件监听。
- 恢复相机输入。
- 清空内部引用。

## 技术风险

### 1. 深度拾取不稳定

`scene.pickPosition` 依赖深度缓冲。透明对象、未渲染对象、浏览器/WebGL 能力差异都可能导致结果异常。必须有 globe.pick fallback。

### 2. 相机交互冲突

Cesium 默认左键拖拽控制相机。所有拖动标注和 handles 的动作都必须锁相机输入，并保证异常路径恢复。

### 3. 3D 场景遮挡

handle 可能被 terrain、3D Tiles 或其他 entity 遮挡。需要通过样式、depthTest 配置或拾取优先级保证可用。

### 4. Circle 在地球曲面上的语义

Cesium ellipse 是地表椭圆/圆的渲染对象。半径计算必须明确是地表距离，不能用屏幕像素距离。

### 5. 坐标序列化

Cesium 内部是 `Cartesian3`。业务通常需要经纬度。必须提供稳定序列化，不能让业务依赖 Entity 内部 property。

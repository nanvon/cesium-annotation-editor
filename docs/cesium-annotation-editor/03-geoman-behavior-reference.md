# 03 Leaflet-Geoman Behavior Reference

本文档只记录与当前 Cesium 标注插件目标相关的 Leaflet-Geoman 行为。它不是移植清单，也不要求 Cesium 版完全一致。

本地 Leaflet-Geoman 源码根目录为 `/Users/nanvon/Code/leaflet-geoman`。本文中的源码路径均相对于该目录；后续查询 Geoman 实现行为时优先读取本地仓库，避免直接查线上源码。

本地 Leaflet-Geoman 官方文档站源码根目录为 `/Users/nanvon/Code/leaflet-geoman-docs`。查询公开 API、配置项、事件命名、示例代码和文档表述时，优先读取这个本地文档仓库。常用路径：

- `docs/toolbar.md`
- `docs/modes/1.draw-mode.mdx`
- `docs/modes/2.edit-mode.mdx`
- `docs/modes/3.drag-mode.mdx`
- `docs/options/0.index.md`
- `docs/16.keyboard.md`
- `src/components/examples/Draw.tsx`
- `src/components/examples/Edit.tsx`
- `src/components/examples/Drag.tsx`

## Toolbar

源码参考：

- `src/js/Toolbar/L.PM.Toolbar.js`
- `src/js/Toolbar/L.Controls.js`

关键行为：

- toolbar 默认注册所有按钮，包括 marker、polyline、rectangle、polygon、circle、circleMarker、text、edit、drag、cut、removal、rotate。
- `addControls(options)` 通过按钮级布尔值控制显示隐藏。
- 每个按钮可以 `doToggle`，按钮 active 状态由 `toggleStatus` 表示。
- `disableOtherButtons` 为 true 的按钮会在点击时触发其他 active 按钮退出，保证绘制、编辑、拖动等模式互斥。
- draw block 和 edit block 可分组显示，也可通过 `oneBlock` 合并。
- 内置 action 包括 `cancel`、`finishMode`、`removeLastVertex`、`finish`。

对 Cesium 版的提炼：

- 必须保留 mode 互斥。
- 必须保留 active 按钮状态。
- 必须保留 finish/cancel 概念。
- 不需要保留 Geoman 的多 block 复杂度，第一版单 toolbar 即可。

## Draw registry

源码参考：

- `src/js/Draw/L.PM.Draw.js`

关键行为：

- Geoman 的 draw manager 维护 shapes 列表。
- `enable(shape)` 会先 `disable()` 所有 shape，再启用目标 shape。
- 同一时刻只有一个 draw mode active。
- `getActiveShape()` 从所有 shape 中找到 `_enabled` 的那个。
- 创建完成后会给 layer 设置 `_drawnByGeoman = true`。

对 Cesium 版的提炼：

- mode manager 应集中管理 active draw mode。
- 创建的 annotation 需要有内部标记，例如 `source: "cesium-annotation-editor"` 或 `annotationId`。
- 不要依赖 Cesium Entity 本身作为唯一状态源。

## Marker drawing

源码参考：

- `src/js/Draw/L.PM.Draw.Marker.js`

关键行为：

- 进入 marker draw 后，地图容器添加绘制 cursor class。
- 桌面端创建跟随鼠标的 hint marker。
- 点击地图后创建正式 marker。
- `markerEditable` 为 true 时，新创建 marker 立即启用 edit 能力。
- `continueDrawing` 对 marker 默认 true，因此可连续打点。
- 创建后触发 `pm:create`。

对 Cesium 版的提炼：

- 点工具应支持单击创建。
- 点工具默认可以连续创建。
- 点创建后应触发 create 事件。
- 点绘制时显示跟随鼠标的 cursor marker；只有点击确认后才创建正式点标注。

## Line drawing

源码参考：

- `src/js/Draw/L.PM.Draw.Line.js`
- `cypress/e2e/line.cy.js`

关键行为：

- 进入 line draw 后创建临时 FeatureGroup、临时 polyline、hintline、cursor marker。
- 每次点击添加一个顶点，并创建一个临时 vertex marker。
- 鼠标移动时 hint marker 跟随鼠标，hintline 从最后一个顶点连到鼠标位置。
- 点击任意临时 marker 可完成线。
- 如果新点等于首点或上一个点，也会尝试完成。
- `finish` action 会调用 `_finishShape()`。
- 顶点数小于等于 1 时不能完成。
- `removeLastVertex` 会删除最后一个顶点；剩余顶点小于等于 1 时取消绘制。
- 完成后创建正式 `L.polyline` 并触发 `pm:create`。
- 默认完成后退出 draw mode；`continueDrawing` 可继续绘制下一条。

对 Cesium 版的提炼：

- 线必须有 working geometry，但不显示鼠标当前位置相关的 preview segment。
- 线至少 2 个顶点才能完成。
- 完成和取消必须清理临时对象。
- 点击最后一个已确认顶点可完成线；点击其他已有顶点只消费事件，不追加重复顶点。
- remove last vertex 是可选增强。

## Polygon drawing

源码参考：

- `src/js/Draw/L.PM.Draw.Polygon.js`
- `cypress/e2e/polygon.cy.js`

关键行为：

- Polygon 继承 Line 的大部分绘制逻辑。
- 首个 vertex marker 可点击完成 polygon。
- 其他 vertex marker 会阻止事件冒泡，避免重复创建点。
- 顶点数小于等于 2 时不能完成。
- 完成后创建正式 `L.polygon` 并触发 `pm:create`。
- Geoman 支持自相交检测选项，但默认允许自相交。

对 Cesium 版的提炼：

- 多边形至少 3 个顶点才能完成。
- 点击首个已确认顶点可完成多边形；点击其他已有顶点只消费事件，不追加重复顶点。
- 默认不做自相交校验。
- 数据模型只保存外环顶点，不保存重复闭合点。

## Circle drawing

源码参考：

- `src/js/Draw/L.PM.Draw.CircleMarker.js`
- `src/js/Draw/L.PM.Draw.Circle.js`
- `cypress/e2e/circle.cy.js`

关键行为：

- Circle 继承 CircleMarker 的绘制逻辑，但基础类是 `L.Circle`。
- 默认 `resizeableCircle = true`。
- resizeable 时，绘制流程是：
  - 第一次点击放置中心点。
  - 显示中心 marker、hint marker、hintline。
  - 鼠标移动时同步半径。
  - 第二次点击完成圆。
- 支持 `minRadiusCircle` 和 `maxRadiusCircle` 限制。
- 完成后创建正式 circle 并触发 `pm:create`。
- 非 resizeable 时，点击一次即可创建默认半径圆，这更像 CircleMarker 行为。

对 Cesium 版的提炼：

- 当前产品应采用 Geoman 默认语义：两次点击画圆，第一点中心，第二点半径。
- 圆编辑应支持中心控制点和半径控制点。
- 半径限制应作为配置项保留。
- 不建议做“点击一次默认半径圆”的默认模式。

## Global edit mode

源码参考：

- `src/js/Mixins/Modes/Mode.Edit.js`
- `src/js/Edit/L.PM.Edit.Line.js`
- `src/js/Edit/L.PM.Edit.Marker.js`
- `src/js/Edit/L.PM.Edit.CircleMarker.js`
- `src/js/Edit/L.PM.Edit.Circle.js`

关键行为：

- `enableGlobalEditMode()` 查找地图上所有 Geoman layer，并对相关 layer 执行 `layer.pm.enable(options)`。
- 新增 layer 时，如果 edit mode 仍开启，会自动启用编辑。
- 线和多边形编辑时：
  - 每个 vertex 有一个 marker。
  - 相邻 vertex 之间有 middle marker。
  - 点击或拖动 middle marker 会新增一个顶点。
  - 拖动 vertex marker 会更新对应坐标。
  - 默认右键 vertex marker 删除顶点。
- 点编辑时：
  - marker 本身可以拖动。
  - marker 可右键删除，除非阻止删除。
- 圆编辑时：
  - resizeable circle 会生成 center marker 和 outer marker。
  - center marker 移动圆心。
  - outer marker 修改半径。
  - 不可 resizeable circle 在 edit mode 下表现为整体可拖动。

对 Cesium 版的提炼：

- 必须支持拖动已有顶点。
- 圆必须支持中心和半径控制点。
- 新增/删除顶点可以作为第二阶段能力。
- Cesium edit mode 显示全图所有 annotation 的 handles；点击某个 annotation 或 handle 时仍同步当前选中状态。

## Global drag mode

源码参考：

- `src/js/Mixins/Modes/Mode.Drag.js`
- `src/js/Mixins/Dragging.js`
- `cypress/e2e/globalmodes.cy.js`

关键行为：

- `enableGlobalDragMode()` 查找所有相关 layer，并调用 `layer.pm.enableLayerDrag()`。
- 启用 layer drag 前会先 disable edit，避免编辑和拖动冲突。
- 拖动过程中禁用地图拖动，结束后恢复。
- 非 marker 几何通过鼠标移动 delta 同步平移所有坐标。
- marker/circle 通过更新中心点移动。
- 拖动开始、拖动中、结束分别触发事件。

对 Cesium 版的提炼：

- drag mode 必须与 edit mode 互斥。
- 拖动 annotation 时必须禁用 Cesium camera input。
- polyline/polygon 通过整体平移所有顶点实现。
- circle 只移动 center，不改 radius。

## Events

源码参考：

- `src/js/Mixins/Events.js`

Geoman 相关事件：

- draw: `pm:drawstart`、`pm:drawend`、`pm:create`
- edit: `pm:enable`、`pm:disable`、`pm:update`、`pm:edit`
- vertex: `pm:markerdragstart`、`pm:markerdrag`、`pm:markerdragend`、`pm:vertexadded`、`pm:vertexremoved`、`pm:vertexclick`
- drag: `pm:dragstart`、`pm:drag`、`pm:dragend`、`pm:dragenable`、`pm:dragdisable`
- mode: `pm:globaldrawmodetoggled`、`pm:globaleditmodetoggled`、`pm:globaldragmodetoggled`
- toolbar: `pm:buttonclick`、`pm:actionclick`
- change: `pm:change`

对 Cesium 版的提炼：

- 原生事件名继续保留，同时提供 `pm:` 命名作为 Geoman 风格兼容别名。
- 必须保留 create/update/modechange/select/drag/vertex drag 的语义。
- 事件 payload 必须返回 annotation model，而不是只返回 Cesium Entity。

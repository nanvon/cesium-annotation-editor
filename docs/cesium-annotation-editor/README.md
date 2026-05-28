# Cesium Annotation Editor Docs

这里是 Cesium Annotation Editor 的详细文档。根目录 [README.md](../../README.md) 面向安装和快速使用；本目录保留更完整的 API、交互规格、技术设计和验收资料。

## 文档顺序

1. [01-product-scope.md](./01-product-scope.md): 产品边界、目标用户、功能范围和非目标。
2. [02-interaction-spec.md](./02-interaction-spec.md): toolbar、绘制、编辑、拖拽和 snapping 的交互规则。
3. [03-geoman-behavior-reference.md](./03-geoman-behavior-reference.md): 从 Leaflet-Geoman 行为中提炼出的兼容参考。
4. [04-cesium-technical-design.md](./04-cesium-technical-design.md): Cesium Entity 映射、拾取、拖拽、吸附和生命周期设计。
5. [05-plugin-api-contract.md](./05-plugin-api-contract.md): 当前插件对外暴露的 TypeScript API、事件和数据模型参考。
6. [06-acceptance-tests.md](./06-acceptance-tests.md): 人工验收或自动化测试可用的验收用例。

## 当前能力

- 内置 toolbar。
- 绘制点、线、圆、多边形。
- 编辑点位置、线/面顶点、圆心和半径。
- 拖动 annotation 整体位置。
- 绘制和编辑时支持基础 snapping。
- 原生 API 和 Leaflet-Geoman 风格 `editor.pm` / `viewer.pm` API。
- 核心事件和 `pm:*` 事件别名。
- `toJSON()` / `fromJSON()` 序列化。

## 当前非目标

- 裁剪、旋转、缩放、删除模式。
- 文字、矩形、复杂测绘工具。
- 批量编辑、撤销重做。
- 完整复刻 Leaflet-Geoman 的所有 API。
- 2D / Columbus View 的完整验收。

## 实现原则

- 第一版使用 Cesium Entity API，不直接暴露 Primitive API。
- 插件内部维护 annotation model，Cesium Entity 只是渲染投影。
- 绘制中使用 working geometry；线和多边形只响应已点击确认的顶点，圆保留半径预览。
- snapping 只做顶点和线段级基础吸附，不把圆周采样成业务顶点。
- edit mode 和 drag mode 互斥。

## 参考来源

Leaflet-Geoman 本地代码参考：

本地源码根目录为 `/Users/nanvon/Code/leaflet-geoman`。对比 Geoman 行为时优先读取这个本地仓库，只有本地源码缺失或需要确认版本差异时再查线上资料。以下路径均相对于该目录：

- `src/js/Toolbar/L.PM.Toolbar.js`
- `src/js/Toolbar/L.Controls.js`
- `src/js/Draw/L.PM.Draw.Marker.js`
- `src/js/Draw/L.PM.Draw.Line.js`
- `src/js/Draw/L.PM.Draw.Polygon.js`
- `src/js/Draw/L.PM.Draw.CircleMarker.js`
- `src/js/Draw/L.PM.Draw.Circle.js`
- `src/js/Edit/L.PM.Edit.Marker.js`
- `src/js/Edit/L.PM.Edit.Line.js`
- `src/js/Edit/L.PM.Edit.CircleMarker.js`
- `src/js/Edit/L.PM.Edit.Circle.js`
- `src/js/Mixins/Modes/Mode.Edit.js`
- `src/js/Mixins/Modes/Mode.Drag.js`
- `src/js/Mixins/Dragging.js`
- `src/js/Mixins/Events.js`

Leaflet-Geoman 官方文档站本地参考：

本地文档站源码根目录为 `/Users/nanvon/Code/leaflet-geoman-docs`。查询 Geoman 公开 API、配置项、事件命名、示例代码和文档表述时，优先读取这个本地文档仓库；需要确认线上部署内容时再查 `https://geoman.io/docs`。常用路径均相对于该目录：

- `docs/toolbar.md`
- `docs/modes/1.draw-mode.mdx`
- `docs/modes/2.edit-mode.mdx`
- `docs/modes/3.drag-mode.mdx`
- `docs/options/0.index.md`
- `docs/16.keyboard.md`
- `src/components/examples/Draw.tsx`
- `src/components/examples/Edit.tsx`
- `src/components/examples/Drag.tsx`

Cesium 官方文档参考：

- Entity API: https://cesium.com/learn/cesiumjs/ref-doc/Entity.html
- Creating Entities: https://cesium.com/learn/cesiumjs-learn/cesiumjs-creating-entities/
- ScreenSpaceEventHandler: https://cesium.com/learn/cesiumjs/ref-doc/ScreenSpaceEventHandler.html
- Scene picking: https://cesium.com/learn/cesiumjs/ref-doc/Scene.html
- Globe picking: https://cesium.com/learn/cesiumjs/ref-doc/Globe.html
- ScreenSpaceCameraController: https://cesium.com/learn/cesiumjs/ref-doc/ScreenSpaceCameraController.html
- CallbackProperty: https://cesium.com/learn/cesiumjs/ref-doc/CallbackProperty.html
- PolylineGraphics: https://cesium.com/learn/cesiumjs/ref-doc/PolylineGraphics.html
- PolygonGraphics: https://cesium.com/learn/cesiumjs/ref-doc/PolygonGraphics.html
- EllipseGraphics: https://cesium.com/learn/cesiumjs/ref-doc/EllipseGraphics.html

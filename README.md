# Cesium Annotation Editor

Cesium Annotation Editor 是一个轻量的 TypeScript Cesium 标注插件，提供点、线、圆、多边形的绘制、编辑、整体拖拽、吸附和序列化能力。插件使用 Cesium Entity API 渲染，同时维护自己的 annotation model，业务代码不需要直接处理 Cesium 低层鼠标事件。

## 功能

- 内置标注工具栏，支持绘制点、线、圆、多边形。
- 支持顶点或控制点编辑：点位置、线/面顶点、圆心和半径。
- 支持标注整体拖拽。
- 支持绘制和编辑过程中的顶点/线段吸附，按住 `Alt` 可临时关闭吸附。
- 支持原生 API、Leaflet-Geoman 风格的 `editor.pm` / `viewer.pm` API 和 `pm:*` 事件别名。
- 支持添加、更新、删除、查询、清空和 JSON 序列化。

当前不包含裁剪、旋转、缩放、删除模式、文字、矩形、复杂测绘工具、批量编辑和撤销重做。

## 安装

```bash
npm install cesium cesium-annotation-editor
```

`cesium` 是 peer dependency。业务项目需要先按自己的构建方式配置好 Cesium 资源加载；Vite 项目通常可以使用 `vite-plugin-cesium`。

## 快速开始

```ts
import { Viewer } from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { CesiumAnnotationEditor } from 'cesium-annotation-editor';
import 'cesium-annotation-editor/styles.css';

const viewer = new Viewer('cesiumContainer', {
  animation: false,
  timeline: false
});

const editor = new CesiumAnnotationEditor(viewer, {
  toolbar: true,
  snapping: {
    enabled: true,
    snapDistance: 20
  }
});

editor.on('create', ({ annotation }) => {
  console.log('created', annotation.type, annotation.id);
});

editor.on('change', () => {
  console.log(editor.toJSON());
});
```

## 交互

- 点击 toolbar 上的点、线、圆、多边形按钮进入对应绘制模式。
- 点：点击地图创建标注。
- 线：依次点击添加顶点，点击最后一个顶点、双击、按 `Enter` 或点击 `Finish` 完成。
- 多边形：依次点击添加顶点，点击首个顶点、双击、按 `Enter` 或点击 `Finish` 完成。
- 圆：第一次点击放置圆心，第二次点击确定半径。
- 绘制线/面时按 `Backspace` 或点击 `Remove Last Vertex` 撤销最后一个顶点。
- 按 `Escape` 或点击 `Cancel` 取消当前绘制。
- 编辑模式下拖动 handle 修改几何。
- 拖拽模式下拖动 annotation 整体移动。

## 原生 API

```ts
editor.setMode('draw:polygon');
editor.enableDraw('polygon');
editor.finishDrawing();
editor.cancelDrawing();
editor.removeLastVertex();

editor.enableEditMode();
editor.select(annotationId);
editor.disableEditMode();

editor.enableDragMode();
editor.disableDragMode();

const annotation = editor.addAnnotation({
  type: 'point',
  position: Cartesian3.fromDegrees(117.2272, 31.8206)
});

editor.updateAnnotation(annotation.id, {
  properties: { name: 'inspection point' }
});

editor.removeAnnotation(annotation.id);
editor.getAnnotation(annotation.id);
editor.getAnnotations();
editor.clearAnnotations();

const data = editor.toJSON();
editor.fromJSON(data, { clear: true });

const unsubscribe = editor.on('update', ({ annotation, reason }) => {
  console.log(annotation.id, reason);
});
unsubscribe();

editor.destroy();
```

完整类型、方法、参数和 payload 见 [API Reference](./docs/cesium-annotation-editor/05-plugin-api-contract.md)。

## Options

```ts
const editor = new CesiumAnnotationEditor(viewer, {
  toolbar: {
    position: 'top-left',
    buttons: ['drawPoint', 'drawPolyline', 'drawPolygon', 'drawCircle', 'editMode', 'dragMode'],
    labels: {
      drawPolygon: 'Draw Area'
    }
  },
  shapes: ['point', 'polyline', 'circle', 'polygon'],
  clampToGround: true,
  continueDrawing: {
    point: true,
    polygon: false
  },
  circle: {
    minRadius: 1,
    maxRadius: 500000
  },
  snapping: {
    enabled: true,
    snapDistance: 20,
    snapVertex: true,
    snapSegment: true,
    showIndicator: true,
    disableWithAlt: true
  },
  styles: {
    pointColor: '#2f80ed',
    lineColor: '#2f80ed',
    fillColor: 'rgba(47, 128, 237, 0.26)'
  },
  destroyBehavior: 'keep-annotations'
});
```

主要默认值：

| Option | Default |
| --- | --- |
| `toolbar` | `true` |
| `shapes` | `['point', 'polyline', 'circle', 'polygon']` |
| `clampToGround` | `true` |
| `heightMode` | `'terrain'` |
| `continueDrawing` | `{ point: true }` |
| `circle.minRadius` | `1` |
| `edit.singleSelection` | `true` |
| `drag.strategy` | `'cartographic-delta'` |
| `snapping.snapDistance` | `20` |
| `destroyBehavior` | `'keep-annotations'` |

`heightMode`、`edit.allowVertexInsert`、`edit.allowVertexDelete`、`drag.strategy: 'enu'` 和 `circle.resizeable` 已保留在类型中，但当前实现仍以贴地 Entity、移动已有顶点、圆心/半径控制点和 cartographic delta 拖拽为主。

## Annotation Model

```ts
type AnnotationType = 'point' | 'polyline' | 'circle' | 'polygon';

type Annotation =
  | { id: string; type: 'point'; position: Cartesian3; entity: Cesium.Entity; source: 'draw' | 'api' }
  | { id: string; type: 'polyline'; positions: Cartesian3[]; entity: Cesium.Entity; source: 'draw' | 'api' }
  | { id: string; type: 'polygon'; positions: Cartesian3[]; entity: Cesium.Entity; source: 'draw' | 'api' }
  | { id: string; type: 'circle'; center: Cartesian3; radius: number; entity: Cesium.Entity; source: 'draw' | 'api' };
```

每个 annotation 还包含 `style`、`properties`、`createdAt`、`updatedAt`。`entity` 是 Cesium 渲染对象，业务持久化建议使用 `toJSON()` 的结果。

## 序列化

`toJSON()` 输出经纬度数组，便于业务保存和回放：

```ts
const json = editor.toJSON();

editor.fromJSON(
  [
    {
      id: 'a1',
      type: 'polygon',
      positions: [
        [117.22, 31.82, 0],
        [117.23, 31.82, 0],
        [117.23, 31.83, 0]
      ],
      properties: { name: 'Area A' }
    }
  ],
  { clear: true }
);
```

圆会保留为 `{ center, radius }`，不会自动近似成 GeoJSON polygon。

## 事件

```ts
editor.on('modechange', ({ previousMode, mode }) => {});
editor.on('create', ({ annotation, source }) => {});
editor.on('add', ({ annotation, source }) => {});
editor.on('select', ({ annotation, previous }) => {});
editor.on('update', ({ annotation, reason }) => {});
editor.on('change', ({ annotation, source }) => {});
editor.on('vertexdragstart', ({ annotation, vertexIndex, handleType, position }) => {});
editor.on('vertexdrag', ({ annotation, vertexIndex, handleType, position }) => {});
editor.on('vertexdragend', ({ annotation, vertexIndex, handleType, position }) => {});
editor.on('dragstart', ({ annotation, startPosition, currentPosition }) => {});
editor.on('drag', ({ annotation, startPosition, currentPosition }) => {});
editor.on('dragend', ({ annotation, startPosition, currentPosition }) => {});
editor.on('cancel', ({ mode, reason }) => {});
editor.on('error', ({ code, message, cause }) => {});
```

核心事件：

| Event | Timing |
| --- | --- |
| `buttonclick` | toolbar 主按钮或 action 按钮点击 |
| `modechange` | 模式切换完成 |
| `drawstart` / `drawend` | 绘制模式启动/结束 |
| `create` | 用户交互绘制出 annotation |
| `add` | API 加载 annotation |
| `select` | 选中 annotation 变化 |
| `update` | API、编辑或拖拽修改 annotation |
| `change` | annotation 集合或几何发生变化 |
| `vertexdragstart` / `vertexdrag` / `vertexdragend` | 编辑 handle 拖动 |
| `dragstart` / `drag` / `dragend` | annotation 整体拖拽 |
| `cancel` | 绘制被取消或模式清理 |
| `error` | 不可恢复或明确上报的运行时错误 |

## Geoman-style API

插件同时提供 Leaflet-Geoman 风格 API：

```ts
import type { GeomanViewer } from 'cesium-annotation-editor';

const geomanViewer = viewer as GeomanViewer;

editor.pm.enableDraw('Polygon');
geomanViewer.pm.enableDraw('Marker');

editor.pm.Draw.Polygon.setOptions({ continueDrawing: true });
editor.pm.Draw.Polygon.setStyle({ fillColor: 'rgba(47, 128, 237, 0.35)' });

editor.pm.enableGlobalEditMode();
editor.pm.disableGlobalEditMode();
editor.pm.enableGlobalDragMode();
editor.pm.disableGlobalDragMode();

const layers = editor.pm.getGeomanLayers();
const [layer] = layers;

layer.pm.enable();
layer.pm.on('pm:update', ({ annotation }) => {
  console.log(annotation.id);
});
layer.pm.enableLayerDrag();
layer.pm.remove();
```

`editor.pm` 总是可用。构造插件时，如果传入的 Cesium `viewer` 没有被其他集成占用 `pm` 属性，插件也会挂载同一个 API 到 `viewer.pm`，并在 `destroy()` 时恢复原始属性。

支持的 shape 映射：

| Geoman shape | Native type |
| --- | --- |
| `Marker` / `marker` | `point` |
| `Line` / `line` | `polyline` |
| `Circle` / `circle` | `circle` |
| `Polygon` / `polygon` | `polygon` |

Geoman 风格事件包括 `pm:create`、`pm:update`、`pm:edit`、`pm:dragstart`、`pm:drag`、`pm:dragend`、`pm:snapdrag`、`pm:snap`、`pm:unsnap`、`pm:vertexadded`、`pm:centerplaced`、`pm:globaldrawmodetoggled`、`pm:globaleditmodetoggled`、`pm:globaldragmodetoggled` 等。完整列表见 [API Reference](./docs/cesium-annotation-editor/05-plugin-api-contract.md#events)。

## Snapping

Snapping 默认开启，绘制和编辑时会吸附到已有 annotation 的顶点或线段，也会吸附到当前绘制中的可用顶点/线段。

```ts
editor.on('pm:snap', ({ snapPosition, layerInteractedWith, snapTargetType }) => {
  console.log(snapTargetType, snapPosition, layerInteractedWith);
});

editor.on('pm:unsnap', ({ snapPosition }) => {
  console.log('leave snap target', snapPosition);
});
```

通过 `properties.snapIgnore = true` 添加的 annotation 不参与吸附候选。

## Toolbar

```ts
new CesiumAnnotationEditor(viewer, {
  toolbar: {
    container: document.querySelector('#toolbar') as HTMLElement,
    position: 'top-right',
    buttons: ['drawPoint', 'drawPolyline', 'drawPolygon', 'editMode', 'dragMode'],
    labels: {
      drawPoint: 'Draw Marker',
      cancel: 'Cancel'
    }
  }
});
```

可用按钮：`drawPoint`、`drawPolyline`、`drawCircle`、`drawPolygon`、`editMode`、`dragMode`、`finish`、`cancel`、`removeLastVertex`。

## 生命周期

```ts
editor.destroy();
editor.isDestroyed();
```

`destroy()` 可重复调用。默认 `destroyBehavior: 'keep-annotations'` 会保留正式 annotation entity，只清理工作图层、helper、toolbar、事件监听、snapping indicator 和 `viewer.pm` 挂载。设置为 `'remove-all'` 时会同时删除所有 annotation。

## Demo

```bash
npm install
npm run demo
```

然后打开 Vite 输出的 URL，入口位于 `examples/basic`。

## 文档

- [API Reference](./docs/cesium-annotation-editor/05-plugin-api-contract.md)
- [交互规格](./docs/cesium-annotation-editor/02-interaction-spec.md)
- [Cesium 技术设计](./docs/cesium-annotation-editor/04-cesium-technical-design.md)
- [验收用例](./docs/cesium-annotation-editor/06-acceptance-tests.md)

## 兼容性

- CesiumJS: `^1.130.0`
- Module: ESM first，同时提供 CJS 入口
- Language: TypeScript
- Browser: Chrome / Edge / Safari 近两个主版本

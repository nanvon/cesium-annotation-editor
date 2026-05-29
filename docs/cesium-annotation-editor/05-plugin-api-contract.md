# 05 Plugin API Reference

本文档描述 Cesium Annotation Editor 当前对外暴露的 TypeScript API、事件、数据模型和 Geoman 风格兼容入口。权威类型定义位于 `src/types.ts`，运行时入口位于 `src/CesiumAnnotationEditor.ts`。

## Imports

```ts
import { Cartesian3, Viewer } from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import {
  CesiumAnnotationEditor,
  type Annotation,
  type CesiumAnnotationEditorOptions,
  type GeomanViewer
} from 'cesium-annotation-editor';
import 'cesium-annotation-editor/styles.css';
```

## Initialization

```ts
const viewer = new Viewer('cesiumContainer');
const editor = new CesiumAnnotationEditor(viewer, options);
```

`viewer` 必须是已初始化的 `Cesium.Viewer`，并且需要可用的 `viewer.scene` 和 `viewer.entities`。构造失败会同步抛出 `Error`。

构造后：

- `editor.pm` 总是可用。
- 如果 `viewer.pm` 没有被其他集成占用，插件会把同一个 API 挂到 `viewer.pm`。
- `destroy()` 时会恢复原始 `viewer.pm` 属性。

## Options

```ts
interface CesiumAnnotationEditorOptions {
  toolbar?: boolean | ToolbarOptions;
  shapes?: AnnotationType[];
  clampToGround?: boolean;
  heightMode?: 'terrain' | 'ellipsoid' | 'absolute';
  continueDrawing?: Partial<Record<AnnotationType, boolean>>;
  circle?: {
    resizeable?: boolean;
    minRadius?: number;
    maxRadius?: number;
  };
  edit?: {
    singleSelection?: boolean;
    allowVertexInsert?: boolean;
    allowVertexDelete?: boolean;
  };
  drag?: {
    strategy?: 'cartographic-delta' | 'enu';
  };
  snapping?: SnappingOptions;
  styles?: AnnotationStyleOptions;
  destroyBehavior?: 'remove-all' | 'keep-annotations';
}
```

默认值：

```ts
{
  toolbar: true,
  shapes: ['point', 'polyline', 'circle', 'polygon'],
  clampToGround: true,
  heightMode: 'terrain',
  continueDrawing: { point: true },
  circle: {
    resizeable: true,
    minRadius: 1,
    maxRadius: undefined
  },
  edit: {
    singleSelection: true,
    allowVertexInsert: false,
    allowVertexDelete: false
  },
  drag: { strategy: 'cartographic-delta' },
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
    pointOutlineColor: '#ffffff',
    pointPixelSize: 10,
    lineColor: '#2f80ed',
    lineWidth: 3,
    fillColor: 'rgba(47, 128, 237, 0.26)',
    outlineColor: '#2f80ed',
    outlineWidth: 2,
    handleColor: '#ffffff',
    handleOutlineColor: '#2f80ed',
    snapColor: 'rgba(47, 128, 237, 0.18)',
    snapOutlineColor: '#2f80ed',
    snapPixelSize: 16,
    workingColor: '#2f80ed'
  },
  destroyBehavior: 'keep-annotations'
}
```

### Option notes

| Option | Description |
| --- | --- |
| `toolbar` | `true` 使用内置 toolbar；`false` 禁用；对象值可配置容器、位置、按钮和 label。 |
| `shapes` | 限制可绘制形状。`enableDraw()` 尝试启用未允许的 shape 会抛错。 |
| `clampToGround` | 控制 polyline、outline 和点/handle 的贴地渲染。 |
| `heightMode` | 类型中保留的高度策略字段；当前实现主要由 Cesium pick 结果和 `clampToGround` 控制高度。 |
| `continueDrawing` | 指定某个 shape 完成后是否继续保留绘制模式。默认只有 `point` 连续绘制。 |
| `circle.minRadius` / `circle.maxRadius` | 绘制和编辑半径时会夹取到该范围。 |
| `circle.resizeable` | 类型中保留；当前交互始终使用圆心和半径控制点。 |
| `edit.singleSelection` | 类型中保留并可通过 Geoman options 设置；当前 edit mode 会渲染全量 handles，同时维护当前选中 annotation。 |
| `edit.allowVertexInsert` / `edit.allowVertexDelete` | 类型中保留；当前实现只支持移动已有顶点。 |
| `drag.strategy` | 类型接受 `cartographic-delta` 和 `enu`；当前拖拽实现使用 cartographic delta。 |
| `snapping` | 控制绘制和编辑过程中的顶点/线段吸附。 |
| `styles` | 控制 annotation、helper、working geometry 和 snapping indicator 的颜色与尺寸。 |
| `destroyBehavior` | `keep-annotations` 保留正式 annotation entity；`remove-all` 同时删除所有 annotation。 |

## Core Types

```ts
type AnnotationType = 'point' | 'polyline' | 'circle' | 'polygon';

type EditorMode =
  | 'idle'
  | 'draw:point'
  | 'draw:polyline'
  | 'draw:circle'
  | 'draw:polygon'
  | 'edit'
  | 'drag';

type LngLatHeight = [longitude: number, latitude: number, height?: number];
```

## Annotation Model

```ts
interface BaseAnnotation {
  id: string;
  type: AnnotationType;
  entity: GeomanEntity;
  source: 'draw' | 'api';
  style?: AnnotationStyle;
  properties?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

interface PointAnnotation extends BaseAnnotation {
  type: 'point';
  position: Cesium.Cartesian3;
}

interface PolylineAnnotation extends BaseAnnotation {
  type: 'polyline';
  positions: Cesium.Cartesian3[];
}

interface PolygonAnnotation extends BaseAnnotation {
  type: 'polygon';
  positions: Cesium.Cartesian3[];
}

interface CircleAnnotation extends BaseAnnotation {
  type: 'circle';
  center: Cesium.Cartesian3;
  radius: number;
}

type Annotation =
  | PointAnnotation
  | PolylineAnnotation
  | PolygonAnnotation
  | CircleAnnotation;
```

`entity` 是插件创建或提升后的 Cesium Entity。返回给业务的 `entity` 带有 `pm` 命名空间，因此类型是 `GeomanEntity`。

## Style Types

```ts
interface AnnotationStyle {
  pointColor?: string;
  pointOutlineColor?: string;
  pointPixelSize?: number;
  lineColor?: string;
  lineWidth?: number;
  fillColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  handleColor?: string;
  handleOutlineColor?: string;
  snapColor?: string;
  snapOutlineColor?: string;
  snapPixelSize?: number;
  workingColor?: string;
}

interface AnnotationStyleOptions extends AnnotationStyle {}
```

颜色字符串会交给 Cesium `Color.fromCssColorString()` 解析，因此支持常见 CSS color、hex 和 `rgba(...)`。

## Annotation Input and Patch

```ts
type AnnotationInput =
  | {
      id?: string;
      type: 'point';
      position: Cesium.Cartesian3;
      style?: AnnotationStyle;
      properties?: Record<string, unknown>;
    }
  | {
      id?: string;
      type: 'polyline';
      positions: Cesium.Cartesian3[];
      style?: AnnotationStyle;
      properties?: Record<string, unknown>;
    }
  | {
      id?: string;
      type: 'polygon';
      positions: Cesium.Cartesian3[];
      style?: AnnotationStyle;
      properties?: Record<string, unknown>;
    }
  | {
      id?: string;
      type: 'circle';
      center: Cesium.Cartesian3;
      radius: number;
      style?: AnnotationStyle;
      properties?: Record<string, unknown>;
    };

type AnnotationPatch =
  | Partial<Pick<PointAnnotation, 'position' | 'style' | 'properties'>>
  | Partial<Pick<PolylineAnnotation, 'positions' | 'style' | 'properties'>>
  | Partial<Pick<PolygonAnnotation, 'positions' | 'style' | 'properties'>>
  | Partial<Pick<CircleAnnotation, 'center' | 'radius' | 'style' | 'properties'>>;
```

输入校验：

- `point.position` 必填。
- `polyline.positions.length >= 2`。
- `polygon.positions.length >= 3`。
- `circle.center` 必填，`circle.radius > 0`。
- 重复 id 会同步抛错。

## JSON Model

```ts
type AnnotationJSON =
  | {
      id: string;
      type: 'point';
      position: LngLatHeight;
      properties?: Record<string, unknown>;
    }
  | {
      id: string;
      type: 'polyline';
      positions: LngLatHeight[];
      properties?: Record<string, unknown>;
    }
  | {
      id: string;
      type: 'polygon';
      positions: LngLatHeight[];
      properties?: Record<string, unknown>;
    }
  | {
      id: string;
      type: 'circle';
      center: LngLatHeight;
      radius: number;
      properties?: Record<string, unknown>;
    };
```

JSON 使用经纬度和可选高度。圆保持为 center + radius，不会导出成近似 polygon。

## Native API

### Mode

```ts
setMode(mode: EditorMode): void;
getMode(): EditorMode;
clearMode(): void;
```

- `setMode()` 会先清理旧模式，再进入新模式，并触发 `modechange`。
- 重复设置当前模式是 no-op。
- 未知 mode 会同步抛错。
- `clearMode()` 等价于 `setMode('idle')`。

### Drawing

```ts
enableDraw(type: AnnotationType): void;
finishDrawing(): boolean;
cancelDrawing(): void;
removeLastVertex(): boolean;
```

- `enableDraw(type)` 进入对应 draw mode。若 `type` 不在 `options.shapes` 中，会同步抛错。
- `finishDrawing()` 成功创建 annotation 时返回 `true`；当前不是可完成的 drawing state 或顶点数不足时返回 `false`。
- `cancelDrawing()` 只在当前为 draw mode 时生效。
- `removeLastVertex()` 只对 polyline/polygon working state 生效。

### Selection and edit

```ts
select(id: string | null): void;
getSelected(): Annotation | null;
enableEditMode(): void;
disableEditMode(): void;
```

- `select(id)` 会同步校验 id 是否存在。
- `select(null)` 清空选择。
- edit mode 下会显示 annotation handles。

### Drag

```ts
enableDragMode(): void;
disableDragMode(): void;
```

drag mode 下左键按住 annotation 后可整体拖动。拖动过程中插件会临时锁定 Cesium camera inputs，并在结束或清理时恢复。

### CRUD

```ts
addAnnotation(input: AnnotationInput): Annotation;
updateAnnotation(id: string, patch: AnnotationPatch): Annotation;
removeAnnotation(id: string): boolean;
getAnnotation(id: string): Annotation | undefined;
getAnnotations(): Annotation[];
clearAnnotations(): void;
```

- `addAnnotation()` 用于业务/API 加载 annotation，触发 `add` 和 `change`，不会触发 `create`。
- `updateAnnotation()` 触发 `update` 和 `change`。
- `removeAnnotation()` 找到并删除时返回 `true`，并触发 `change`；未找到返回 `false`。
- `clearAnnotations()` 删除所有 annotation，并触发 `change`。
- `getAnnotations()` 返回当前 store 中的 annotation 数组。

### Serialization

```ts
toJSON(): AnnotationJSON[];
fromJSON(items: AnnotationJSON[], options?: { clear?: boolean }): Annotation[];
```

- `toJSON()` 把 Cesium `Cartesian3` 转成 `[longitude, latitude, height?]`。
- `toJSON()` 返回的 `properties` 是深拷贝；修改导出的嵌套对象不会反向修改 editor 内部 annotation。
- `fromJSON(items, { clear: true })` 会先执行 `clearAnnotations()`，再逐个 `addAnnotation()`。
- `fromJSON()` 创建的 annotation 的 `source` 是 `'api'`。
- `fromJSON()` / `fromJSONInput()` 会深拷贝输入 JSON 的 `properties`；导入后的 annotation 不共享调用方传入的可变嵌套对象。

### Events

```ts
on<T extends EditorEventName>(name: T, handler: EditorEventHandler<T>): () => void;
off<T extends EditorEventName>(name: T, handler: EditorEventHandler<T>): void;
once<T extends EditorEventName>(name: T, handler: EditorEventHandler<T>): () => void;
```

`on()` 和 `once()` 返回 unsubscribe 函数。

### Lifecycle

```ts
destroy(): void;
isDestroyed(): boolean;
```

`destroy()` 可重复调用。销毁后继续调用需要可用状态的 API 会同步抛错。

## Geoman-style API

```ts
type GeomanShapeName = 'Marker' | 'Line' | 'Circle' | 'Polygon';

type GeomanShapeInput =
  | GeomanShapeName
  | AnnotationType
  | 'marker'
  | 'line'
  | 'polyline'
  | 'circle'
  | 'polygon';
```

shape 映射：

| Geoman shape | Native type |
| --- | --- |
| `Marker` / `marker` | `point` |
| `Line` / `line` | `polyline` |
| `Circle` / `circle` | `circle` |
| `Polygon` / `polygon` | `polygon` |

### `editor.pm`

```ts
interface GeomanApi {
  Draw: GeomanDrawApi;
  enableDraw(shape: GeomanShapeInput, options?: GeomanDrawOptions): void;
  disableDraw(): void;
  globalDrawModeEnabled(): boolean;
  enableGlobalEditMode(options?: GeomanEditOptions): void;
  disableGlobalEditMode(): void;
  toggleGlobalEditMode(options?: GeomanEditOptions): void;
  globalEditModeEnabled(): boolean;
  cancelGlobalEditMode(): void;
  enableGlobalDragMode(options?: GeomanDragOptions): void;
  disableGlobalDragMode(): void;
  toggleGlobalDragMode(options?: GeomanDragOptions): void;
  globalDragModeEnabled(): boolean;
  cancelGlobalDragMode(): void;
  getGeomanLayers(asFeatureGroup?: boolean): GeomanEntity[];
  getGeomanDrawLayers(asFeatureGroup?: boolean): GeomanEntity[];
  setPathOptions(options: AnnotationStyleOptions): void;
  addControls(options?: ToolbarOptions): void;
  removeControls(): void;
  toggleControls(options?: ToolbarOptions): void;
  controlsVisible(): boolean;
  setGlobalOptions(options: GeomanGlobalOptions): void;
  getGlobalOptions(): GeomanGlobalOptions;
  applyGlobalOptions(): void;
}
```

说明：

- `disableDraw()` 会取消当前 draw mode。
- `getGeomanLayers()` 返回所有插件 annotation 对应的 `GeomanEntity[]`。
- `getGeomanDrawLayers()` 只返回 `annotation.source === 'draw'` 的实体。
- `asFeatureGroup` 参数为了贴近 Geoman 签名保留；Cesium 版始终返回数组。
- `setPathOptions()` 修改后续默认样式，不会回写已有 annotation。
- `setGlobalOptions()` 保存并立即应用支持的全局选项，同时触发 `pm:globaloptionschanged`。
- `applyGlobalOptions()` 重新应用已保存的全局选项。

### Draw API

```ts
interface GeomanDrawApi {
  Marker: GeomanDrawShapeApi;
  Line: GeomanDrawShapeApi;
  Circle: GeomanDrawShapeApi;
  Polygon: GeomanDrawShapeApi;
  getShapes(): GeomanShapeName[];
  getActiveShape(): GeomanShapeName | null;
}

interface GeomanDrawShapeApi {
  setOptions(options: GeomanDrawOptions): void;
  setStyle(options: AnnotationStyleOptions): void;
}

interface GeomanDrawOptions {
  continueDrawing?: boolean;
  minRadiusCircle?: number;
  maxRadiusCircle?: number;
  resizeableCircle?: boolean;
  snappable?: boolean;
  snapDistance?: number;
  snapVertex?: boolean;
  snapSegment?: boolean;
  snapMiddle?: boolean;
}
```

`snapMiddle` 在当前 Cesium 版中映射为启用线段吸附。

### Edit and drag options

```ts
interface GeomanEditOptions {
  singleSelection?: boolean;
  allowVertexInsert?: boolean;
  allowVertexDelete?: boolean;
  snappable?: boolean;
  snapDistance?: number;
  snapVertex?: boolean;
  snapSegment?: boolean;
  snapMiddle?: boolean;
}

interface GeomanDragOptions {
  strategy?: 'cartographic-delta' | 'enu';
}

type GeomanGlobalOptions = GeomanDrawOptions & GeomanEditOptions & GeomanDragOptions;
```

### Layer API

每个 annotation 对应的 Cesium Entity 会被装饰为 `GeomanEntity`：

```ts
type GeomanEntity = Cesium.Entity & { pm: GeomanLayerApi };
type GeomanViewer = Cesium.Viewer & { pm: GeomanApi };

interface GeomanLayerApi {
  enable(options?: GeomanEditOptions): void;
  disable(): void;
  toggleEdit(options?: GeomanEditOptions): void;
  enabled(): boolean;
  hasSelfIntersection(): boolean;
  remove(): boolean;
  getShape(): GeomanShapeName;
  setOptions(options: GeomanEditOptions & GeomanDragOptions): void;
  getOptions(): GeomanEditOptions & GeomanDragOptions;
  enableLayerDrag(options?: GeomanDragOptions): void;
  disableLayerDrag(): void;
  layerDragEnabled(): boolean;
  dragging(): boolean;
  cancel(): void;
  getAnnotation(): Annotation;
  on<T extends GeomanLayerEventName>(name: T, handler: EditorEventHandler<T>): () => void;
  off<T extends GeomanLayerEventName>(name: T, handler: EditorEventHandler<T>): void;
  once<T extends GeomanLayerEventName>(name: T, handler: EditorEventHandler<T>): () => void;
}
```

说明：

- `layer.pm.enable()` 会选中该 annotation 并进入全局 edit mode。
- `layer.pm.enableLayerDrag()` 会选中该 annotation 并进入全局 drag mode。
- `layer.pm.enabled()` 返回该 layer 自己的 edit 启用状态；通过 `layer.pm.enable()` 切换到另一 layer 时，旧 layer 会失效，不再简单等于全局 edit mode。
- `layer.pm.layerDragEnabled()` 返回该 layer 自己的 drag 启用状态；通过 `layer.pm.enableLayerDrag()` 切换到另一 layer 时，旧 layer 会失效，不再简单等于全局 drag mode。
- `editor.pm.enableGlobalEditMode()` / `editor.pm.enableGlobalDragMode()` 会把当前所有 annotation 标记为对应 layer 状态已启用。
- 当前 Cesium 交互实现仍复用全局 edit/drag controller；layer API 的状态语义已经按 layer 维护，但底层控制器不是 Leaflet-Geoman 那种每个 layer 独立 handler。
- `hasSelfIntersection()` 对 polygon 和 polyline 做经纬度平面段相交检测，至少能识别常见 bow-tie polygon；不处理孔洞、多环和高纬/跨反经线的完整测地线鲁棒性。
- `dragging()` 返回该 layer 是否正处于整体 drag 操作中。
- `layer.pm.on()` / `once()` 会自动过滤，只接收该 annotation/layer 相关事件。

## Snapping visibility and performance

- Snap 候选会跳过 `properties.snapIgnore === true`、`entity.show === false`、`entity.isShowing === false` 的 annotation。
- `resolve()` 会过滤相机背面、地球 horizon 背面、无法投影到窗口坐标、或投影点落在当前 viewport + `snapDistance` 外的候选。
- Annotation 候选按 annotation `updatedAt`、显隐、snap 选项和顶点数量做缓存；同一相机/viewport/signature 下重复 `resolve()` 会复用投影结果，不再每次无条件重投影全部 annotation 顶点/线段。
- 地球背面判断使用基于 WGS84 最大半径的 horizon 近似，适合过滤明确在背面的地表候选。
- 已知限制：Cesium terrain、3D Tiles、depth buffer 遮挡和透明/半透明对象遮挡无法在无渲染读回的稳定单元测试中可靠判定；当前只承诺过滤“明确不可见”的候选，不承诺判断所有 terrain/depth 遮挡。

layer 级可订阅事件：

```ts
type GeomanLayerEventName =
  | 'pm:enable'
  | 'pm:disable'
  | 'pm:edit'
  | 'pm:update'
  | 'pm:change'
  | 'pm:markerdragstart'
  | 'pm:markerdrag'
  | 'pm:markerdragend'
  | 'pm:centerplaced'
  | 'pm:snapdrag'
  | 'pm:snap'
  | 'pm:unsnap'
  | 'pm:dragstart'
  | 'pm:drag'
  | 'pm:dragend'
  | 'pm:dragenable'
  | 'pm:dragdisable'
  | 'pm:cancel'
  | 'pm:error';
```

## Events

### Core event names

```ts
type CoreEditorEventName =
  | 'buttonclick'
  | 'modechange'
  | 'drawstart'
  | 'drawend'
  | 'create'
  | 'add'
  | 'select'
  | 'update'
  | 'change'
  | 'vertexdragstart'
  | 'vertexdrag'
  | 'vertexdragend'
  | 'dragstart'
  | 'drag'
  | 'dragend'
  | 'cancel'
  | 'error';
```

| Event | Payload | Trigger |
| --- | --- | --- |
| `buttonclick` | `ButtonClickEvent` | toolbar 按钮或 action 点击。 |
| `modechange` | `ModeChangeEvent` | mode 成功切换后。 |
| `drawstart` | `DrawEvent` | draw mode 激活。 |
| `drawend` | `DrawEvent` | draw mode 结束或清理。 |
| `create` | `CreateEvent` | 用户交互绘制完成 annotation。 |
| `add` | `AddEvent` | `addAnnotation()` 或 `fromJSON()` 添加 annotation。 |
| `select` | `SelectEvent` | 当前选中 annotation 变化。 |
| `update` | `UpdateEvent` | API 更新、顶点编辑、圆心/半径编辑、整体拖拽结束。 |
| `change` | `ChangeEvent` | annotation 创建、添加、更新、删除或清空。 |
| `vertexdragstart` | `VertexDragEvent` | edit mode 中开始拖动 handle。 |
| `vertexdrag` | `VertexDragEvent` | edit mode 中拖动 handle。 |
| `vertexdragend` | `VertexDragEvent` | edit mode 中结束拖动 handle。 |
| `dragstart` | `DragEvent` | drag mode 中开始整体拖动 annotation。 |
| `drag` | `DragEvent` | drag mode 中整体拖动 annotation。 |
| `dragend` | `DragEvent` | drag mode 中结束整体拖动 annotation。 |
| `cancel` | `CancelEvent` | 绘制被取消或 mode/destroy 清理了有几何的绘制状态。 |
| `error` | `EditorErrorEvent` | 运行时明确上报错误。 |

### Core payloads

```ts
interface ButtonClickEvent {
  button: ToolbarButtonName;
  mode: EditorMode;
}

interface ModeChangeEvent {
  previousMode: EditorMode;
  mode: EditorMode;
}

interface DrawEvent {
  mode: EditorMode;
  type?: AnnotationType;
}

interface CreateEvent {
  annotation: Annotation;
  source: 'draw';
}

interface AddEvent {
  annotation: Annotation;
  source: 'api';
}

interface SelectEvent {
  annotation: Annotation | null;
  previous: Annotation | null;
}

interface UpdateEvent {
  annotation: Annotation;
  reason: 'vertex' | 'drag' | 'radius' | 'center' | 'api';
}

interface ChangeEvent {
  annotation?: Annotation;
  source: 'draw' | 'api' | 'edit' | 'drag' | 'clear' | 'remove';
}

interface VertexDragEvent {
  annotation: Annotation;
  vertexIndex?: number;
  handleType: 'vertex' | 'center' | 'radius' | 'point';
  position: Cesium.Cartesian3;
}

interface DragEvent {
  annotation: Annotation;
  startPosition?: Cesium.Cartesian3;
  currentPosition?: Cesium.Cartesian3;
}

interface CancelEvent {
  mode: EditorMode;
  reason: 'toolbar' | 'escape' | 'api' | 'modechange' | 'destroy';
}

interface EditorErrorEvent {
  code: string;
  message: string;
  cause?: unknown;
}
```

### Geoman event names

```ts
type GeomanEventName =
  | 'pm:buttonclick'
  | 'pm:actionclick'
  | 'pm:globaldrawmodetoggled'
  | 'pm:globaleditmodetoggled'
  | 'pm:globaldragmodetoggled'
  | 'pm:globaloptionschanged'
  | 'pm:drawstart'
  | 'pm:drawend'
  | 'pm:create'
  | 'pm:enable'
  | 'pm:disable'
  | 'pm:edit'
  | 'pm:update'
  | 'pm:change'
  | 'pm:markerdragstart'
  | 'pm:markerdrag'
  | 'pm:markerdragend'
  | 'pm:vertexadded'
  | 'pm:centerplaced'
  | 'pm:snapdrag'
  | 'pm:snap'
  | 'pm:unsnap'
  | 'pm:dragstart'
  | 'pm:drag'
  | 'pm:dragend'
  | 'pm:dragenable'
  | 'pm:dragdisable'
  | 'pm:cancel'
  | 'pm:globalcancel'
  | 'pm:error';
```

### Geoman event aliases and triggers

| Event | Payload | Trigger |
| --- | --- | --- |
| `pm:buttonclick` | `GeomanButtonClickEvent` | `buttonclick` alias。 |
| `pm:actionclick` | `GeomanButtonClickEvent` | `finish`、`cancel`、`removeLastVertex` action 点击。 |
| `pm:globaldrawmodetoggled` | `GeomanModeToggleEvent` | 进入或离开 draw mode。 |
| `pm:globaleditmodetoggled` | `GeomanModeToggleEvent` | 进入或离开 edit mode。 |
| `pm:globaldragmodetoggled` | `GeomanModeToggleEvent` | 进入或离开 drag mode。 |
| `pm:globaloptionschanged` | `GeomanGlobalOptionsChangedEvent` | `setGlobalOptions()` 或 `applyGlobalOptions()`。 |
| `pm:drawstart` | `GeomanDrawEvent` | `drawstart` alias。 |
| `pm:drawend` | `GeomanDrawEvent` | `drawend` alias。 |
| `pm:create` | `GeomanCreateEvent` | `create` alias。 |
| `pm:enable` | `GeomanLayerEvent` | annotation/layer 进入 edit mode。 |
| `pm:disable` | `GeomanLayerEvent` | annotation/layer 离开 edit mode。 |
| `pm:edit` | `GeomanUpdateEvent` | 顶点、圆心或半径编辑完成。 |
| `pm:update` | `GeomanUpdateEvent` | `update` alias。 |
| `pm:change` | `GeomanChangeEvent` | `change` alias。 |
| `pm:markerdragstart` | `GeomanMarkerDragEvent` | `vertexdragstart` alias。 |
| `pm:markerdrag` | `GeomanMarkerDragEvent` | `vertexdrag` alias。 |
| `pm:markerdragend` | `GeomanMarkerDragEvent` | `vertexdragend` alias。 |
| `pm:vertexadded` | `GeomanVertexAddedEvent` | 绘制 polyline/polygon 时新增 working vertex。 |
| `pm:centerplaced` | `GeomanCenterPlacedEvent` | 绘制圆时放置圆心，或圆心 handle 拖动结束。 |
| `pm:snapdrag` | `GeomanSnapEvent` | 鼠标/handle 处于吸附状态时持续触发。 |
| `pm:snap` | `GeomanSnapEvent` | 进入新的吸附目标。 |
| `pm:unsnap` | `GeomanSnapEvent` | 离开当前吸附目标。 |
| `pm:dragstart` | `GeomanDragEvent` | `dragstart` alias。 |
| `pm:drag` | `GeomanDragEvent` | `drag` alias。 |
| `pm:dragend` | `GeomanDragEvent` | `dragend` alias。 |
| `pm:dragenable` | `GeomanLayerEvent` | annotation/layer 进入 drag mode。 |
| `pm:dragdisable` | `GeomanLayerEvent` | annotation/layer 离开 drag mode。 |
| `pm:cancel` | `GeomanCancelEvent` | `cancel` alias 或 layer cancel。 |
| `pm:globalcancel` | `GeomanCancelEvent` | `cancel` alias，或 `cancelGlobalEditMode()` / `cancelGlobalDragMode()`。 |
| `pm:error` | `GeomanErrorEvent` | `error` alias。 |

### Geoman payloads

```ts
interface GeomanModeToggleEvent {
  enabled: boolean;
  shape?: GeomanShapeName;
  mode: EditorMode;
  previousMode?: EditorMode;
}

interface GeomanButtonClickEvent {
  btnName: ToolbarButtonName;
  button: ToolbarButtonName;
  mode: EditorMode;
}

interface GeomanGlobalOptionsChangedEvent {
  options: GeomanGlobalOptions;
}

interface GeomanDrawEvent extends DrawEvent {
  shape?: GeomanShapeName;
}

interface GeomanLayerEvent {
  annotation: Annotation;
  layer: GeomanEntity;
  shape: GeomanShapeName;
}

interface GeomanCreateEvent extends GeomanLayerEvent {
  source: 'draw';
}

interface GeomanUpdateEvent extends GeomanLayerEvent {
  reason: UpdateEvent['reason'];
}

interface GeomanChangeEvent {
  annotation?: Annotation;
  layer?: GeomanEntity;
  shape?: GeomanShapeName;
  source: ChangeEvent['source'];
}

interface GeomanMarkerDragEvent extends GeomanLayerEvent {
  vertexIndex?: number;
  indexPath?: number[];
  handleType: VertexDragEvent['handleType'];
  position: Cesium.Cartesian3;
}

interface GeomanVertexAddedEvent {
  shape: GeomanShapeName;
  workingLayer?: Cesium.Entity;
  marker?: Cesium.Entity;
  position: Cesium.Cartesian3;
  vertexIndex: number;
}

interface GeomanCenterPlacedEvent {
  shape: GeomanShapeName;
  position: Cesium.Cartesian3;
  workingLayer?: Cesium.Entity;
  marker?: Cesium.Entity;
  annotation?: Annotation;
  layer?: GeomanEntity;
  vertexIndex?: number;
  indexPath?: number[];
  handleType?: VertexDragEvent['handleType'];
}

interface GeomanSnapEvent {
  shape?: GeomanShapeName;
  annotation?: Annotation;
  layer?: GeomanEntity;
  workingLayer?: Cesium.Entity;
  marker?: Cesium.Entity;
  snapTargetType: 'vertex' | 'segment';
  snapPosition: Cesium.Cartesian3;
  snapLatLng: Cesium.Cartesian3;
  distance: number;
  layerInteractedWith?: GeomanEntity;
  annotationInteractedWith?: Annotation;
  segment?: [Cesium.Cartesian3, Cesium.Cartesian3];
  vertexIndex?: number;
}

interface GeomanDragEvent extends GeomanLayerEvent {
  startPosition?: Cesium.Cartesian3;
  currentPosition?: Cesium.Cartesian3;
}

interface GeomanCancelEvent {
  mode: EditorMode;
  reason: CancelEvent['reason'];
  shape?: GeomanShapeName;
  annotation?: Annotation;
  layer?: GeomanEntity;
}

interface GeomanErrorEvent {
  source: string;
  message: string;
  payload?: unknown;
  code?: string;
  cause?: unknown;
}
```

## Toolbar Contract

```ts
interface ToolbarOptions {
  container?: HTMLElement;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  buttons?: ToolbarButtonName[];
  labels?: Partial<Record<ToolbarButtonName, string>>;
}

type ToolbarButtonName =
  | 'drawPoint'
  | 'drawPolyline'
  | 'drawCircle'
  | 'drawPolygon'
  | 'editMode'
  | 'dragMode'
  | 'finish'
  | 'cancel'
  | 'removeLastVertex';
```

默认主按钮：

- `drawPoint`
- `drawPolyline`
- `drawPolygon`
- `drawCircle`
- `editMode`
- `dragMode`

上下文 action：

- `drawPoint`: `cancel`
- `drawPolyline`: `finish`、`removeLastVertex`、`cancel`
- `drawPolygon`: `finish`、`removeLastVertex`、`cancel`
- `drawCircle`: `cancel`

## Snapping

```ts
interface SnappingOptions {
  enabled?: boolean;
  snapDistance?: number;
  snapVertex?: boolean;
  snapSegment?: boolean;
  showIndicator?: boolean;
  disableWithAlt?: boolean;
}
```

行为：

- 默认启用。
- 候选目标包括已有 annotation 的顶点和线段，也包括当前绘制中的 working positions。
- `snapVertex` 优先级高于 `snapSegment`。
- `snapDistance` 是屏幕像素距离。
- `properties.snapIgnore === true` 的 annotation 会被排除。
- `disableWithAlt` 为 `true` 时，按住 `Alt` 会临时关闭 snapping。
- `showIndicator` 控制是否显示吸附指示点。

## Error Handling

同步 API 错误会抛出 `Error`：

- viewer 非法。
- mode 非法。
- shape 未启用。
- annotation id 不存在。
- annotation 输入不满足最小几何要求。
- 重复 annotation id。
- 已销毁后继续调用需要可用状态的 API。

交互过程里拾取不到世界坐标通常是 no-op，不会抛错。

## Compatibility

- CesiumJS: `^1.130.0`
- Module: ESM first，同时提供 CJS 入口
- Language: TypeScript
- Browser: Chrome / Edge / Safari 近两个主版本

## Current Limitations

- 只保证 Cesium 3D scene 下的主流程。
- 不支持 Cut、Rotate、Scale、Removal、Text、Rectangle 等 Geoman 模式。
- 不支持通过中点新增顶点或右键删除顶点。
- `circle.resizeable`、`edit.allowVertexInsert`、`edit.allowVertexDelete`、`drag.strategy: 'enu'` 和 `heightMode` 当前为保留或部分接入字段，文档和类型保留它们以避免后续扩展破坏 API。

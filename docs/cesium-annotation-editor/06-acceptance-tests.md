# 06 Acceptance Tests

这些验收用例面向未来从零实现的 Cesium 插件。它们既可以人工测试，也可以转换成 Playwright/Cypress 场景测试。

当前仓库已有 Vitest 单元测试入口：

```bash
npm test
```

已自动化覆盖的发布可信度用例包括：

- Serializer `properties` 深拷贝隔离。
- Geoman `layer.pm.enabled()` / `layerDragEnabled()` per-layer 状态、切换 active layer 后旧 layer 失效、`dragging()` 当前拖拽状态、polygon 自相交检测。
- Snap 对隐藏 annotation、相机背面、地球背面、viewport 外候选的过滤。
- Snap 重复 `resolve()` 复用候选投影缓存，不再无条件全量重投影所有 annotation 顶点。
- 无 `window` / `document` 时，`toolbar: false` 的 Node/SSR 构造和销毁路径不抛错。

## Toolbar and mode

### T001 toolbar renders

Given Cesium Viewer 初始化完成  
When 创建 `CesiumAnnotationEditor` 且 `toolbar: true`  
Then 页面显示 point、polyline、circle、polygon、edit、drag 六个按钮

### T002 only one mode active

Given toolbar 已显示  
When 点击 point 按钮，再点击 polygon 按钮  
Then point 按钮变为 inactive  
And polygon 按钮变为 active  
And 当前 mode 为 `draw:polygon`

### T003 clicking active button exits mode

Given 当前 mode 为 `draw:point`  
When 再次点击 point 按钮  
Then 当前 mode 为 `idle`  
And point 按钮 inactive

### T004 switching mode cancels working draw

Given 当前 mode 为 `draw:polyline` 且已有 1 个临时顶点  
When 点击 drag 按钮  
Then 临时顶点和 working polyline 被清理  
And 不触发 `create`  
And 当前 mode 为 `drag`

## Draw point

### T101 create point on globe click

Given 当前 mode 为 `draw:point`  
When 用户点击有效地球表面  
Then 创建一个 point annotation  
And annotation 有唯一 id  
And annotation 有 Cesium Entity  
And 触发 `create` 事件

### T101a point cursor marker follows mouse

Given 当前 mode 为 `draw:point`  
When 用户移动鼠标到有效地表点  
Then 鼠标下显示一个临时 point cursor marker  
And 点击后创建的 point annotation 位于 cursor marker 所在位置

### T102 point no-op on invalid pick

Given 当前 mode 为 `draw:point`  
When 用户点击天空或无法拾取位置  
Then 不创建 annotation  
And 不抛异常

### T103 point continues by default

Given 当前 mode 为 `draw:point`  
When 用户连续点击三个有效地表点  
Then 创建三个 point annotation  
And 当前 mode 仍为 `draw:point`

## Draw polyline

### T201 polyline ignores mouse move preview

Given 当前 mode 为 `draw:polyline`  
When 用户点击第一个有效点并移动鼠标  
Then 不显示从第一个点到鼠标位置的 preview segment  
And polyline 顶点数量不变

### T202 polyline cannot finish with one point

Given 当前 mode 为 `draw:polyline` 且只有 1 个顶点  
When 用户点击 finish  
Then 不创建 annotation  
And 保持 drawing state

### T203 polyline finish with two points

Given 当前 mode 为 `draw:polyline`  
When 用户点击两个有效点并点击 finish  
Then 创建一个 polyline annotation  
And positions 数量为 2  
And 清理 working entities  
And 触发 `create`

### T203a polyline finish by clicking last vertex

Given 当前 mode 为 `draw:polyline` 且已有 2 个顶点  
When 用户点击最后一个顶点 helper  
Then 创建一个 polyline annotation  
And 不追加重复顶点

### T203b polyline vertex helper hover

Given 当前 mode 为 `draw:polyline` 且已有顶点 helper  
When 鼠标移入 helper  
Then helper 变大  
And cursor 显示为 pointer

### T204 polyline cancel

Given 当前 mode 为 `draw:polyline` 且已有多个临时顶点  
When 用户点击 cancel 或按 Escape  
Then 清理 working entities  
And 不创建 annotation  
And 触发 `cancel`

### T205 remove last vertex optional

Given 当前 mode 为 `draw:polyline` 且已有 3 个临时顶点  
When 用户调用 `removeLastVertex()`  
Then 临时顶点减少为 2  
And working polyline 更新为剩余已确认顶点

## Draw polygon

### T301 polygon cannot finish with two points

Given 当前 mode 为 `draw:polygon` 且只有 2 个顶点  
When 用户点击 finish  
Then 不创建 annotation  
And 保持 drawing state

### T302 polygon finish with three points

Given 当前 mode 为 `draw:polygon`  
When 用户点击三个有效点并点击 finish  
Then 创建一个 polygon annotation  
And positions 数量为 3  
And polygon 渲染为闭合面  
And 内部数据不保存重复首点
And finish 前绘制阶段仅显示 open polyline，不显示填充闭合面

### T302a polygon finish by clicking first vertex

Given 当前 mode 为 `draw:polygon` 且已有 3 个顶点  
When 用户点击首个顶点 helper  
Then 创建一个 polygon annotation  
And polygon 闭合渲染  
And 内部数据不保存重复首点

### T302b polygon vertex helper hover

Given 当前 mode 为 `draw:polygon` 且已有顶点 helper  
When 鼠标移入 helper  
Then helper 变大  
And cursor 显示为 pointer

### T303 polygon shows Geoman-style hintline

Given 当前 mode 为 `draw:polygon` 且已有 2 个顶点  
When 用户移动鼠标  
Then 显示从最后一个确认顶点到鼠标位置的 hint line  
And 不显示回到首点的 closing preview  
And 不创建填充 polygon

## Draw circle

### T401 circle place center

Given 当前 mode 为 `draw:circle`  
When 用户第一次点击有效地表点  
Then 设置 working circle center  
And 显示 center helper  
And 当前仍在 `draw:circle`

### T402 circle radius preview

Given 当前 mode 为 `draw:circle` 且已有 center  
When 用户移动鼠标  
Then working circle 半径随鼠标位置变化  
And 显示 radius helper 或 hint line

### T403 circle finish

Given 当前 mode 为 `draw:circle` 且已有 center  
When 用户第二次点击有效地表点  
Then 创建一个 circle annotation  
And annotation 保存 center 和 radius  
And Cesium entity 使用 ellipse 渲染  
And 触发 `create`

### T404 circle respects radius limits

Given 配置 `minRadius = 100` 和 `maxRadius = 1000`  
When 用户绘制半径小于 100 的圆  
Then 实际 radius 为 100  
When 用户绘制半径大于 1000 的圆  
Then 实际 radius 为 1000

## Edit mode

### T501 global edit handles

Given 地图上已有 point、polyline、circle、polygon annotations  
When 进入 edit mode  
Then 显示所有 annotations 的 edit handles

### T501a select annotation in edit mode

Given edit mode 下地图上已有一个 polygon annotation  
When 点击该 polygon  
Then polygon 被选中  
And 不隐藏其他 annotations 的 edit handles  
And 触发 `select`

### T501b edit handle hover feedback

Given edit mode 下已显示 handles  
When 鼠标移入任一 handle  
Then handle 变大  
And cursor 显示为 `move`

### T501c edit handle dragging cursor

Given edit mode 下已显示 handles  
When 用户按住任一 handle 并拖动  
Then cursor 显示为 `move`

### T502 clear selection

Given edit mode 下已有选中 annotation  
When 用户点击空白地球区域  
Then selected annotation 为 null  
And 仍显示所有 annotations 的 edit handles

### T503 edit point

Given edit mode 下选中 point annotation  
When 用户拖动 point handle  
Then annotation.position 更新  
And point entity 位置更新  
And 触发 vertex drag 和 update 事件

### T504 edit polyline vertex

Given edit mode 下选中 polyline annotation  
When 用户拖动第 1 个 vertex handle  
Then positions[1] 更新  
And polyline entity 实时更新  
And 其他顶点不变

### T505 edit polygon vertex

Given edit mode 下选中 polygon annotation  
When 用户拖动一个 vertex handle  
Then polygon 对应顶点更新  
And polygon entity 实时更新  
And 顶点数量不变

### T506 edit circle center

Given edit mode 下选中 circle annotation  
When 用户拖动 center handle  
Then circle.center 更新  
And circle.radius 不变  
And ellipse entity 位置更新

### T507 edit circle radius

Given edit mode 下选中 circle annotation  
When 用户拖动 radius handle  
Then circle.radius 更新  
And circle.center 不变  
And ellipse 的 semiMajorAxis 和 semiMinorAxis 更新

### T508 edit drag locks camera

Given edit mode 下选中 annotation  
When 用户开始拖动 handle  
Then Cesium camera inputs 被临时禁用  
When 用户释放鼠标  
Then camera inputs 恢复为拖动前状态

## Drag mode

### T601 drag point

Given drag mode 下地图上已有 point annotation  
When 用户移入该 point  
Then cursor 显示为 `move`  
When 用户按住该 point 并移动  
Then point position 跟随移动  
And cursor 显示为 `move`  
And 触发 `dragstart`、`drag`、`dragend`、`update`

### T602 drag polyline

Given drag mode 下地图上已有 polyline annotation  
When 用户拖动该 polyline  
Then 所有 positions 同步平移  
And 顶点相对形状保持不变

### T603 drag polygon

Given drag mode 下地图上已有 polygon annotation  
When 用户拖动该 polygon  
Then 所有 positions 同步平移  
And polygon 形状保持不变

### T604 drag circle

Given drag mode 下地图上已有 circle annotation  
When 用户拖动该 circle  
Then center 更新  
And radius 不变

### T605 drag mode hides edit handles

Given edit mode 下已有选中 annotation 且 handles 显示  
When 用户切换到 drag mode  
Then edit handles 被清理  
And 当前 mode 为 `drag`

## Snapping

### T650 draw vertex snaps to existing vertex

Given 地图上已有 point annotation  
And 当前 mode 为 `draw:polyline`  
When 用户在 `snapDistance` 内点击该 point 附近  
Then 新增 vertex 使用该 point 的 position  
And 显示 snap indicator  
And 触发 `pm:snapdrag` 和 `pm:snap`

### T651 draw vertex snaps to existing segment

Given 地图上已有 polyline annotation  
And 当前 mode 为 `draw:polygon`  
When 用户在 `snapDistance` 内移动到该 polyline segment 附近  
Then polygon hint line 终点吸附到 segment 上最近点

### T652 edit handle snaps to another layer

Given edit mode 下有两个 annotation  
When 用户拖动第一个 annotation 的 vertex handle 到第二个 annotation 顶点附近  
Then 被拖动 vertex 吸附到第二个 annotation 顶点  
And 触发 `pm:snapdrag`、`pm:snap`、`pm:markerdrag`

### T653 Alt disables snapping

Given 当前启用 snapping  
When 用户按住 Alt 并拖动或绘制到已有顶点附近  
Then 不吸附  
And 不显示 snap indicator

### T654 snap ignore

Given 地图上已有 annotation 且 `properties.snapIgnore === true`  
When 用户绘制或编辑到该 annotation 附近  
Then 该 annotation 不作为吸附候选

### T655 snap ignores clearly invisible candidates

Given 地图上已有隐藏 annotation、相机背面 annotation、地球背面 annotation 和 viewport 外 annotation
When 用户在这些候选屏幕位置附近绘制或编辑
Then Snap 不吸附到这些候选
And 不对明确隐藏、相机背面或地球背面候选执行窗口坐标投影

### T656 snap caches projected annotation candidates

Given 地图上已有多个 annotation 顶点
And 相机、viewport、annotation `updatedAt` 和 snap 配置都没有变化
When 连续两次调用 Snap resolve
Then 第二次不应无条件重新投影全部 annotation 顶点/线段
And 仍能返回正确最近候选

## API and lifecycle

### T701 addAnnotation

Given editor 已初始化  
When 调用 `addAnnotation()` 添加 polygon  
Then annotation store 包含该 polygon  
And Cesium viewer 显示 polygon entity  
And 触发 `add`

### T702 removeAnnotation

Given editor 中已有 annotation  
When 调用 `removeAnnotation(id)`  
Then annotation 从 store 删除  
And 对应 entity 从 viewer 删除

### T703 serialization roundtrip

Given editor 中已有 point、polyline、circle、polygon  
When 调用 `toJSON()` 再 `clearAnnotations()` 再 `fromJSON()`  
Then 恢复后的 annotation 数量和类型一致  
And 圆仍保存 center/radius，而不是 polygon approximation

### T703a serialization property isolation

Given annotation 或 JSON input 中包含嵌套 `properties`
When 调用 `toJSON()` 或 `fromJSON()` / `fromJSONInput()`
Then 返回值中的 `properties` 与输入或内部 annotation 不共享可变引用
And 修改任一侧嵌套对象不会影响另一侧

### T704 destroy cleanup

Given editor 正在 draw/edit/drag 任一 mode  
When 调用 `destroy()`  
Then toolbar DOM 被移除  
And ScreenSpaceEventHandler 被销毁  
And helper/working entities 被移除  
And Cesium camera input 状态恢复  
And 再次调用 `destroy()` 不报错

### T704a SSR import and construction guard

Given 当前运行环境没有 `window` 和 `document`
When 导入插件模块并以 `toolbar: false` 创建 editor
Then import、constructor 和 `destroy()` 都不抛错

### T705 Geoman per-layer state

Given 地图上已有两个 annotation layer
When 调用第一个 `layer.pm.enable()` 再调用第二个 `layer.pm.enable()`
Then 第二个 `enabled()` 为 `true`
And 第一个 `enabled()` 为 `false`
When 调用 `editor.pm.enableGlobalEditMode()`
Then 两个 layer 的 `enabled()` 都为 `true`

### T706 Geoman layer geometry helpers

Given 地图上已有一个普通 polygon 和一个 bow-tie polygon
Then 普通 polygon 的 `layer.pm.hasSelfIntersection()` 为 `false`
And bow-tie polygon 的 `layer.pm.hasSelfIntersection()` 为 `true`
When 某个 layer 正在整体拖拽
Then 只有该 layer 的 `layer.pm.dragging()` 为 `true`

## Known Cesium visibility limits

Snap 可稳定过滤明确不可见的候选：显式隐藏、相机背面、地球 horizon 背面、无法投影或 viewport 外。Terrain、3D Tiles、depth buffer、透明对象和自定义 shader 造成的遮挡依赖具体渲染帧与深度读回，当前单元测试不承诺覆盖；这类场景需要后续浏览器/场景级测试补充。

## Negative cases

### T801 pick failure during draw

Given 当前 draw mode active  
When `PickService.pickWorldPosition()` 返回 undefined  
Then 当前操作 no-op  
And working state 不损坏

### T802 target removed during edit

Given edit mode 下选中 annotation  
When 外部删除该 annotation entity  
Then 下一次交互前 editor 清理 selection 和 handles  
And 不抛异常

### T803 mouseup lost during drag

Given 用户正在拖动 annotation  
When 浏览器丢失 mouseup 事件并随后切换 mode  
Then editor 恢复 camera input  
And 清理 drag target

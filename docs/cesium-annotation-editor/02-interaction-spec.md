# 02 Interaction Spec

## 总体状态机

插件只有一个 active mode：

- `idle`
- `draw:point`
- `draw:polyline`
- `draw:circle`
- `draw:polygon`
- `edit`
- `drag`

状态切换规则：

- 点击 inactive 工具按钮，进入对应 mode。
- 点击当前 active 工具按钮，退出该 mode 并回到 `idle`。
- 从一个 mode 切到另一个 mode 时，必须先清理前一个 mode 的临时对象和事件监听。
- 绘制未完成时切换 mode，视为取消绘制，不触发 `create`。
- edit mode 和 drag mode 互斥。
- draw mode 与 edit/drag mode 互斥。

## Toolbar 行为

toolbar 默认显示 6 个按钮：

1. Point
2. Polyline
3. Circle
4. Polygon
5. Edit
6. Drag

按钮状态：

- inactive: 可点击，点击后进入 mode。
- active: 当前 mode，点击后取消 mode。
- disabled: 当前不可用，例如 viewer 未初始化或插件已销毁。

按钮点击必须触发：

- `buttonclick`
- 如果 mode 变化，再触发 `modechange`

toolbar 不直接实现绘制逻辑，只调用 mode manager。

## 绘制点

进入 `draw:point`：

- 鼠标变为绘制状态。
- 鼠标下显示跟随移动的 point cursor marker。
- 点击地球或有效拾取对象后创建一个 point annotation。
- 创建后触发 `create`。
- 默认保持 `draw:point` active，方便连续打点；可通过 `continueDrawing.point = false` 配置为创建后退出。

点击无效区域：

- 如果屏幕点无法转换成 `Cartesian3`，不创建对象，不报错。

取消：

- 点击 active point 按钮、切换 mode、按 Escape 或调用 `cancel()`，退出绘制。
- 点绘制的 cursor marker 不写入业务数据，取消只清理 cursor 状态和事件监听。

## 绘制线

进入 `draw:polyline`：

- 创建空的 working annotation。
- 左键点击有效地表点，追加一个顶点。
- 鼠标移动时不追加临时顶点，也不显示从最后顶点到鼠标位置的 preview segment。
- 只有左键点击确认新顶点后，working polyline 才更新。
- 已有顶点以 helper point 显示。

完成条件：

- 顶点数 `>= 2` 时可完成。
- 点击最后一个已确认顶点、toolbar finish action、双击、按 Enter 或调用 `finish()` 可完成。
- 顶点数 `< 2` 时 finish no-op。

取消：

- 清理 working polyline、helper points。
- 不触发 `create`。

完成：

- 创建正式 polyline annotation。
- 清理临时对象。
- 触发 `create`。
- 默认退出 `draw:polyline`，可配置 `continueDrawing.polyline = true` 继续下一条线。

- 点击其他已有顶点只消费点击，不追加重复顶点。
- remove last vertex action 可移除最后一个已确认顶点。
- 鼠标移入已有顶点 helper 时，顶点变大并显示 pointer cursor。

## 绘制多边形

进入 `draw:polygon`：

- 创建空的 working annotation。
- 左键点击有效地表点，追加一个顶点。
- 绘制阶段使用 Geoman 风格的临时 open polyline，不渲染填充面，也不自动连回首点。
- 鼠标移动时不追加临时顶点；已有至少 1 个确认顶点时，显示从最后一个确认顶点到鼠标位置的 hint line。
- 只有左键点击确认新顶点后，临时 open polyline 才更新；完成时才创建正式 polygon。

完成条件：

- 顶点数 `>= 3` 时可完成。
- 点击首点 handle、toolbar finish action、双击、按 Enter 或调用 `finish()` 可完成并渲染闭合 polygon。
- 顶点数 `< 3` 时 finish no-op。
- 鼠标移入已有顶点 helper 时，顶点变大并显示 pointer cursor。

取消和完成逻辑与线一致。

第一版不做：

- 自相交禁止。
- 孔洞。
- 多环。
- 自动闭合点写入数据。数据模型只保存外环顶点，渲染层负责闭合。

## 绘制圆

进入 `draw:circle`：

- 第一次点击有效地表点，确定圆心。
- 创建 working circle 和中心 helper。
- 鼠标移动时根据圆心到鼠标拾取点的距离更新半径。
- 显示半径 helper point 和中心到半径点的 preview line。
- 第二次点击完成圆。

完成条件：

- 已有 center 且 radius 大于 `minRadius`。
- 如果 radius 小于 `minRadius`，按 `minRadius` 完成或 no-op，由配置决定。默认按 `minRadius` 夹取。
- 如果 radius 大于 `maxRadius`，按 `maxRadius` 夹取。

取消：

- 如果还没放置中心，只清理 cursor 状态。
- 如果已放置中心，清理 working circle、center helper、radius helper 和 hint line。

完成：

- 创建 circle annotation，保存 `{ center, radius }`。
- 渲染为 Cesium `ellipse`，`semiMajorAxis` 和 `semiMinorAxis` 都等于 radius。
- 触发 `create`。

## Edit Mode

进入 `edit`：

- 退出当前 draw/drag mode。
- 显示所有 annotation 的 edit handles。
- 点击 annotation 后选中它，但不隐藏其他 annotation 的 handles。
- 点击空白区域可取消选中，仍保留全局 edit handles。
- 拖动 handle 时只更新该 handle 与对应 annotation，不在每次移动时重建全部 handles。
- 鼠标移入 edit handle 时，handle 变大并显示 `move` cursor。
- 拖动 edit handle 时显示 `move` cursor。

### 点编辑

- 点 annotation 被选中后显示一个 handle。
- 拖动 handle 时更新 point position。
- 触发 `markerdragstart`、`markerdrag`、`markerdragend`、`update`。

### 线编辑

- 每个顶点显示一个 handle。
- 拖动 handle 时更新对应 vertex。
- polyline 实时重绘。
- 不显示中点 handle，第一版不支持新增顶点。
- 不支持右键删除顶点。

### 多边形编辑

- 每个外环顶点显示一个 handle。
- 拖动 handle 时更新对应 vertex。
- polygon 实时重绘。
- 不支持新增顶点、删除顶点、孔洞。

### 圆编辑

圆被选中后显示两个 handles：

- center handle: 拖动后移动圆心，半径保持不变。
- radius handle: 拖动后更新半径，圆心不变。

半径 handle 的位置应根据圆心和当前半径计算。实现可以把它放在圆心正东方向，拖动时根据拖动点与圆心的地表距离计算新半径。

### 编辑时相机行为

开始拖动 handle 时：

- 保存 `ScreenSpaceCameraController` 的输入状态。
- 临时禁用相机输入。

拖动结束后：

- 恢复相机输入。
- 触发 update。

## Drag Mode

进入 `drag`：

- 退出当前 draw/edit mode。
- 不显示 edit handles。
- 用户按下 annotation 并移动时，整体拖动该 annotation。
- 鼠标移入可拖动 annotation 时显示 `move` cursor，拖动中显示 `move` cursor。

拖动流程：

1. `LEFT_DOWN`: 使用 `scene.pick` 判断是否命中插件 annotation entity。
2. 命中后保存 drag target 和起始屏幕点对应的 world position。
3. 禁用相机输入。
4. `MOUSE_MOVE`: 计算当前位置与上一次位置之间的地表位移，更新 annotation geometry。
5. `LEFT_UP`: 恢复相机输入，触发 `dragend` 和 `update`。

整体移动规则：

- point: 更新 position。
- polyline: 所有 vertices 加同一位移。
- polygon: 所有 vertices 加同一位移。
- circle: 更新 center，radius 不变。

第一版位移算法：

- 小范围标注使用经纬度差值平移。
- 每次 move 用上一次拾取点到当前拾取点的 cartographic delta。
- 需要封装为 `translateAnnotation(annotation, from, to)`，后续可替换为 ENU 平移。

## 键盘和辅助操作

建议第一版支持：

- `Escape`: 取消当前 draw/edit/drag 子状态，回到 `idle` 或保持当前 toolbar mode 但清理临时操作。默认回到 `idle`。
- `Enter`: 在线/多边形绘制中尝试完成。
- `Backspace`: 在线/多边形绘制中删除最后一个临时顶点。可选。
- `Alt`: 按住时临时关闭 snapping，释放后恢复。

## Snapping

默认支持基础吸附：

- 绘制点、线、多边形、圆心和圆半径时，鼠标靠近已有标注顶点或线段会吸附到最近目标。
- 编辑 point/vertex/center/radius handle 时，拖动位置会吸附到其他 annotation 的顶点或线段。
- 吸附距离使用屏幕像素，默认 `20px`。
- 顶点吸附优先于线段吸附；同类目标取最近距离。
- 编辑某个 annotation 时，不吸附到同一个 annotation，避免拖动自身顶点时抖动或塌缩。
- annotation 的 `properties.snapIgnore === true` 时不参与吸附候选。
- 命中吸附目标时显示独立 snap indicator，不写入业务标注集合。
- 吸附过程中触发 `pm:snapdrag`，进入新吸附目标时触发 `pm:snap`，离开吸附目标时触发 `pm:unsnap`。

移动端手势不作为第一版强验收项。

## 错误和边界行为

- 拾取不到地球坐标时 no-op。
- 绘制中 annotation collection 被外部清空时，插件必须进入一致状态。
- viewer 被 destroy 或插件 `destroy()` 后，所有事件监听、helper entities、DOM toolbar 必须清理。
- 外部直接删除某个 annotation 的 entity 时，插件需要在下一次交互前移除内部 model 或忽略 dangling entity。
- 正在拖动时如果 mouse up 丢失，应在下一次 pointer up / cancel / mode change 时恢复相机输入。

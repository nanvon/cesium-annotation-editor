# 07 Large-Scale Performance Design

## 范围与目标

- 目标数据量级：**几百 ~ 2000 个 annotation**。
- 在该量级下保证绘制、编辑、拖拽、吸附的流畅度，交互体验对齐 Leaflet-Geoman。
- **硬约束（不可改）**：绘制 / 编辑 / 拖拽过程中，被操作的 annotation 必须实时预览、跟手。
- 本设计**只覆盖阶段 0 + 阶段 1**，不引入渲染层冷热分离（Primitive 批量渲染）重构；该量级下 Entity 渲染本身不是瓶颈。

## 设计原则

- 不改动实时预览热路径：`GeometryPreviewSession`、`Mutable*Source`、`CallbackProperty` 全部保持现状。
- 只优化"冷数据"的承载成本：handle 渲染规模、吸附候选规模、全量扫描。
- 所有改动可灰度、可回退，默认行为与现状一致或更优，不破坏现有测试。
- 遵循现有模块边界：`AnnotationStore` 是真相源，Entity 只是渲染投影。

## 现状瓶颈（该量级下的实际杀伤力）

| 级别 | 问题 | 位置 | 量级影响 |
|---|---|---|---|
| P0 | 全局编辑激活时给**每个标注每个顶点**建 handle Entity | `EditController.renderAllHandles()` | 2000 个面 × N 顶点 = 数万 point entity |
| P1 | 吸附失效判断每次 mousemove 拼**全量**字符串 signature | `SnapService.annotationCandidateSignature()` | 每帧 O(n) 字符串拼接 |
| P1 | 吸附候选取全量标注，与视口/吸附半径无关 | `SnapService.annotationCandidateCache()` | 视口外标注仍参与投影计算 |
| P1 | `store.getAll()` 全表线性扫描 | 多处 | 无空间索引 |
| P2 | 宿主 Viewer 未约定 `requestRenderMode` | 宿主初始化 | 空闲满帧渲染 |

---

## 阶段 0 · 低成本快赢

### 0.1 handle 视口裁剪（P0）

> **设计修正**：早期方案写为"仅对选中标注渲染 handle"，但这会破坏 Geoman 全局编辑模式语义——
> `enterMode('edit')` 对**所有**标注 `setAllGeomanLayerStates('editEnabled', true)`，即"所有图形同时可编辑、可直接拖任意顶点"。
> 该语义属于硬约束不可改，因此改为**视口裁剪**：语义不变，只裁剪 handle 创建规模。

**问题**：`activate()` 调用 `renderAllHandles()`，对 `store.getAll()` 中每个标注的每个顶点都创建一个 handle entity。

**设计（已实现）**：
- 保留全局编辑语义：所有图形仍同时可编辑。
- `renderAllHandles()` → `renderViewportHandles()`：只为**当前视口内**的标注（外加当前选中标注）创建 handle。视口外的图形本就无法交互。
- 视口判定 `isAnnotationInViewport()`：标注任一 handle 锚点（点位 / 顶点 / 圆心与半径点）满足"在相机近侧 + 地平线以上 + 投影落在视口 + margin 内"即视为可见。
- 相机停止移动（`camera.moveEnd`）时重建可见 handle，并 `requestRender()`。
- **拖动期间不重建**：相机在拖动时被 `CameraInputGuard` 锁定不会触发 moveEnd；并显式判断 `dragTarget` 跳过，避免销毁正在拖动的 handle 及其预览源。
- **优雅降级**：相机 / 视口 API 不可用或 `worldToWindowCoordinates` 抛错时（测试环境等），`isAnnotationInViewport()` 回退为 `true`，等价于原全量渲染，保持既有行为与测试断言。

**风险**：低。不改任何交互语义；预览热路径零改动。

**验收**：
- handle entity 数随屏幕可见标注量增长，而非总量。
- 全局编辑下所有可见图形顶点均可直接拖动；拖动顶点 / 圆心 / 半径预览与提交行为不变。
- 现有 `geoman-layer-api` / `snap-service` 等测试全部通过。

### 0.2 吸附 signature 版本化（P1）

**问题**：`annotationCandidateSignature()` 每次 `resolve()`（mousemove）遍历全部标注拼字符串判断缓存失效。

**设计**：
- `AnnotationStore` 维护单调递增的 `revision: number`，在 `add` / `update` / `touch` / `remove` / `clear` 时 `+1`。
- 暴露 `getRevision(): number`。
- `SnapService` 的候选缓存 signature 改为：
  `${snapVertex}:${snapSegment}:${store.getRevision()}`
  不再遍历全量标注。
- 投影缓存 signature（相机 / 视口 / snapDistance）保持不变。

**注意**：现有 signature 还编码了 `show` / `snapIgnore` / `vertexCount`。这些变化必须也触发 `revision`：
- `snapIgnore` 走 `properties`，经 `update()` 修改 → 已覆盖。
- entity `show` 由外部直接改 `entity.show` 时**不经过 store**，revision 不会变。需评估：要么文档约定"改可见性走 store API"，要么保留一个轻量的可见性版本号。该量级下可接受"可见性变更后吸附缓存延迟到下次几何变更才刷新"，或显式提供 `store.bumpRevision()` 供宿主调用。

**风险**：中（取决于 `show` 外部直改的处理策略，需在实现前与使用方确认 API 约定）。

**验收**：
- mousemove 期间无每帧全量字符串拼接（profiler 验证）。
- 增删改标注后吸附候选正确更新；吸附行为与现状一致。

### 0.3 约定 requestRenderMode（P2）

**问题**：编辑器内部大量 `viewer.scene.requestRender()`，暗示期望按需渲染，但未约定/设置。

**设计**：
- 在 README / 选项文档中明确：宿主 Viewer 建议 `requestRenderMode: true`，并设置合理的 `maximumRenderTimeChange`。
- 评估是否由编辑器在初始化时检测并给出 warning（不强制改宿主配置，避免副作用）。
- 审计所有几何 / 预览 / 吸附变更路径，确保每个可见变更都伴随 `requestRender()`（拖拽 rAF 路径已有；需补查 hover、handle 刷新、cursor marker / hint / handle 吸附位置更新）。

**风险**：低。仅文档与审计，不改宿主行为。

---

## 阶段 1 · 吸附与查询空间化

> 几百量级下阶段 0 通常已足够；接近 2000、且吸附半径内标注密集时，阶段 1 收益明显。建议用阶段 0 落地后的真实 profiling 决定是否实施。

### 1.1 AnnotationStore 空间索引

**设计**：
- 在 `AnnotationStore` 内维护一个轻量空间索引（推荐**均匀网格 hash**，2000 量级下实现简单、维护成本低，无需 R-tree）。
- 索引粒度：以 annotation 的包围信息为 key——
  - point / circle：用单点（圆用 center，半径范围可在查询时外扩）。
  - polyline / polygon：用顶点集合或包围盒。
- 在 `add` / `update` / `touch` / `remove` / `clear` 时同步索引（与 `revision` 同一批维护）。
- 暴露 `queryByScreenRegion` 或 `queryByCartographicBounds(bounds)`。

### 1.2 SnapService 按视口取候选

**设计**：
- `annotationCandidateCache()` 不再 `store.getAll()`，改为按"当前视口 + 吸附半径外扩"的地理范围向索引查询候选标注。
- 候选缓存 signature 增加视口范围维度（与投影缓存共用相机/视口 signature 即可）。
- 仍保留 `snapIgnore` / 可见性过滤。

**风险**：中。需保证范围查询不漏掉跨视口边界的线段（外扩 margin 处理）。

**验收**：
- 吸附候选数量与"视口内标注数"成正比，而非总量。
- 视口外标注不参与投影；吸附结果与现状在视口内一致。

---

## 不在本次范围（明确排除）

- 渲染层冷热分离 / Primitive 批量渲染（`PointPrimitiveCollection` 等）—— 几千~万级以上才需要。
- 点聚合 clustering、`distanceDisplayCondition` LOD。
- 圆 outline 段数自适应、`drillPick` 范围收窄（P2，按需再议）。

若后续数据量级提升到万级以上，再追加 `08-hybrid-rendering-design.md` 覆盖冷热分离。

---

## 落地顺序与度量

1. 实施 0.1（收益最大、风险最低）。
2. 实施 0.3（文档 + 审计）。
3. 实施 0.2（需先确认 `show` 外部直改的 API 约定）。
4. 用 2000 标注示例 profiling，决定是否进入阶段 1。

**度量基线**（建议在 `examples` 增加大数据量 demo）：
- 进入编辑模式耗时、entity 总数。
- 编辑模式下 mousemove 平均帧时间（吸附开启 / 关闭对比）。
- 拖动顶点时的帧率（验证预览热路径未退化）。

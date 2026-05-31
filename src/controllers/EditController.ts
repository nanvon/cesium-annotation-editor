import {
  Cartesian2,
  Cartesian3,
  Ellipsoid,
  SceneTransforms,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Entity,
  type Scene,
  type Viewer
} from 'cesium';
import type { Annotation, EntityMetadata, GeomanSnapEvent } from '../types';
import type { AnnotationStore } from '../core/AnnotationStore';
import type { CameraInputGuard } from '../core/CameraInputGuard';
import type { EntityFactory } from '../core/EntityFactory';
import type { PickService } from '../core/PickService';
import type { SnapResolution, SnapService } from '../core/SnapService';
import type { EventEmitter } from '../events/EventEmitter';
import { GeometryPreviewSession, MutablePositionSource } from '../core/GeometryPreviewSession';
import { cancelFrame, requestFrame, type AnimationFrameHandle } from '../utils/browser';
import { clampRadius, pointAlongSurface } from '../utils/circle';
import { cloneCartesian, surfaceDistance } from '../utils/coordinates';
import type { NormalizedOptions } from '../types';
import { annotationTypeToGeomanShape } from '../geoman';

interface HandlePreview {
  entity: Entity;
  source: MutablePositionSource;
}

interface DragTarget {
  annotation: Annotation;
  metadata: EntityMetadata;
  handleEntity: Entity;
  preview: GeometryPreviewSession;
  handlePreviews: HandlePreview[];
  startPosition: Cartesian3;
  currentPosition: Cartesian3;
}

export class EditController {
  private handler: ScreenSpaceEventHandler | null = null;
  private selectedId: string | null = null;
  private dragTarget: DragTarget | null = null;
  private readonly handleEntities = new Map<string, Entity[]>();
  private hoveredHandle: Entity | null = null;
  private pendingDragScreenPosition: Cartesian2 | null = null;
  private dragFrame: AnimationFrameHandle | null = null;
  private pendingHoverScreenPosition: Cartesian2 | null = null;
  private hoverFrame: AnimationFrameHandle | null = null;
  private activeSnapEvent: GeomanSnapEvent | null = null;
  private activeSnapKey: string | null = null;
  private removeCameraListener: (() => void) | null = null;

  constructor(
    private readonly viewer: Viewer,
    private readonly options: NormalizedOptions,
    private readonly store: AnnotationStore,
    private readonly entityFactory: EntityFactory,
    private readonly pickService: PickService,
    private readonly snapService: SnapService,
    private readonly cameraGuard: CameraInputGuard,
    private readonly events: EventEmitter
  ) {}

  activate(): void {
    this.deactivate(false);
    this.handler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.viewer.scene.canvas.classList.add('cae-edit-cursor');
    this.handler.setInputAction((movement: { position: Cartesian2 }) => this.handleLeftDown(movement.position), ScreenSpaceEventType.LEFT_DOWN);
    this.handler.setInputAction((movement: { endPosition: Cartesian2 }) => this.handleMouseMove(movement.endPosition), ScreenSpaceEventType.MOUSE_MOVE);
    this.handler.setInputAction(() => this.finishDrag(), ScreenSpaceEventType.LEFT_UP);
    this.subscribeCameraChange();
    this.renderViewportHandles();
  }

  deactivate(clearSelection = true): void {
    this.finishDrag();
    this.cancelDragFrame();
    this.cancelHoverFrame();
    this.unsubscribeCameraChange();
    this.handler?.destroy();
    this.handler = null;
    this.viewer.scene.canvas.classList.remove('cae-edit-cursor');
    this.viewer.scene.canvas.style.cursor = '';
    this.clearHover();
    this.clearSnapState();
    this.entityFactory.removeHelperEntities();
    this.handleEntities.clear();
    if (clearSelection) {
      this.select(null);
    }
  }

  select(id: string | null): void {
    const previous = this.getSelected();
    if (id === null) {
      this.selectedId = null;
      if (!this.isActive()) {
        this.entityFactory.removeHelperEntities();
        this.handleEntities.clear();
      }
      if (previous) {
        this.events.emit('select', { annotation: null, previous });
      }
      return;
    }

    const annotation = this.store.require(id);
    this.selectedId = id;
    if (!this.isActive()) {
      this.renderSelectedHandles(annotation);
    }
    this.events.emit('select', { annotation, previous });
  }

  getSelected(): Annotation | null {
    return this.selectedId ? this.store.get(this.selectedId) ?? null : null;
  }

  refreshHandles(): void {
    if (this.isActive()) {
      this.renderViewportHandles();
      return;
    }

    const selected = this.getSelected();
    if (selected) {
      this.renderSelectedHandles(selected);
    }
  }

  private handleLeftDown(screenPosition: Cartesian2): void {
    this.cancelHoverFrame();
    const picked = this.pickService.pickEditorEntity(screenPosition);
    if (picked?.metadata.editorKind === 'handle' && picked.metadata.annotationId) {
      const annotation = this.store.get(picked.metadata.annotationId);
      const world = this.pickDragPosition(screenPosition);
      if (annotation && world) {
        this.select(annotation.id);
        const preview = new GeometryPreviewSession(annotation, this.entityFactory);
        this.dragTarget = {
          annotation,
          metadata: picked.metadata,
          handleEntity: picked.entity,
          preview,
          handlePreviews: this.prepareDraggedHandlePreviews(annotation, picked.metadata, picked.entity),
          startPosition: cloneCartesian(world),
          currentPosition: cloneCartesian(world)
        };
        this.viewer.scene.canvas.style.cursor = 'move';
        this.cameraGuard.lock();
        this.events.emit('vertexdragstart', {
          annotation,
          vertexIndex: picked.metadata.vertexIndex,
          handleType: picked.metadata.handleType ?? 'vertex',
          position: world
        });
      }
      return;
    }

    if (picked?.metadata.editorKind === 'annotation' && picked.metadata.annotationId) {
      this.select(picked.metadata.annotationId);
      return;
    }

    this.select(null);
  }

  private handleMouseMove(screenPosition: Cartesian2): void {
    if (!this.dragTarget) {
      this.queueHover(screenPosition);
      return;
    }

    this.queueDrag(screenPosition);
  }

  private finishDrag(): void {
    if (!this.dragTarget) {
      return;
    }
    this.flushDragFrame();
    const target = this.dragTarget;
    this.dragTarget = null;
    this.cancelDragFrame();
    target.preview.commit(this.store);
    this.restoreDraggedHandles(target);
    this.cameraGuard.unlock();
    this.viewer.scene.canvas.style.cursor = '';
    this.clearSnapState();
    this.events.emit('vertexdragend', {
      annotation: target.annotation,
      vertexIndex: target.metadata.vertexIndex,
      handleType: target.metadata.handleType ?? 'vertex',
      position: target.currentPosition
    });
    const reason = target.metadata.handleType === 'center' ? 'center' : target.metadata.handleType === 'radius' ? 'radius' : 'vertex';
    this.events.emit('update', { annotation: target.annotation, reason });
    this.events.emit('change', { annotation: target.annotation, source: 'edit' });
  }

  cancelActiveDrag(annotationId?: string): void {
    if (!this.dragTarget || (annotationId && this.dragTarget.annotation.id !== annotationId)) {
      return;
    }

    const target = this.dragTarget;
    this.dragTarget = null;
    this.cancelDragFrame();
    target.preview.cancel();
    this.restoreDraggedHandles(target);
    this.cameraGuard.unlock();
    this.viewer.scene.canvas.style.cursor = '';
    this.clearSnapState();
  }

  private queueDrag(screenPosition: Cartesian2): void {
    this.pendingDragScreenPosition = Cartesian2.clone(screenPosition, this.pendingDragScreenPosition ?? new Cartesian2());
    if (this.dragFrame !== null) {
      return;
    }

    this.dragFrame = requestFrame(() => {
      this.dragFrame = null;
      const latestScreenPosition = this.pendingDragScreenPosition;
      this.pendingDragScreenPosition = null;
      if (latestScreenPosition) {
        this.applyQueuedDrag(latestScreenPosition);
      }
    });
  }

  private applyQueuedDrag(screenPosition: Cartesian2): void {
    if (!this.dragTarget) {
      return;
    }

    const rawWorld = this.pickDragPosition(screenPosition);
    const world = this.resolveEditPosition(screenPosition, rawWorld);
    if (!world) {
      return;
    }

    this.dragTarget.currentPosition = cloneCartesian(world);
    this.applyPreviewDrag(this.dragTarget, world);
    this.updateDraggedHandlePreviews(this.dragTarget, world);
    this.viewer.scene.requestRender();
    this.events.emit('vertexdrag', {
      annotation: this.dragTarget.annotation,
      vertexIndex: this.dragTarget.metadata.vertexIndex,
      handleType: this.dragTarget.metadata.handleType ?? 'vertex',
      position: world
    });
  }

  private pickDragPosition(screenPosition: Cartesian2): Cartesian3 | undefined {
    return this.pickService.pickGlobePosition(screenPosition) ?? this.pickService.pickWorldPosition(screenPosition);
  }

  private flushDragFrame(): void {
    if (!this.pendingDragScreenPosition) {
      this.cancelDragFrame();
      return;
    }

    const latestScreenPosition = Cartesian2.clone(this.pendingDragScreenPosition, new Cartesian2());
    this.cancelDragFrame();
    this.applyQueuedDrag(latestScreenPosition);
  }

  private cancelDragFrame(): void {
    this.pendingDragScreenPosition = null;
    if (this.dragFrame !== null) {
      cancelFrame(this.dragFrame);
      this.dragFrame = null;
    }
  }

  private applyPreviewDrag(target: DragTarget, position: Cartesian3): void {
    const { annotation, metadata, preview } = target;
    switch (annotation.type) {
      case 'point':
        preview.setPoint(position);
        break;
      case 'polyline':
      case 'polygon':
        if (metadata.vertexIndex != null) {
          preview.setVertex(metadata.vertexIndex, position);
        }
        break;
      case 'circle':
        if (metadata.handleType === 'center') {
          preview.setCircleCenter(position);
        } else if (metadata.handleType === 'radius') {
          preview.setCircleRadius(clampRadius(surfaceDistance(annotation.center, position), this.options.circle.minRadius, this.options.circle.maxRadius));
        }
        break;
    }
  }

  private renderHandles(annotation: Annotation): void {
    if (!this.store.get(annotation.id)) {
      this.selectedId = null;
      return;
    }

    switch (annotation.type) {
      case 'point':
        this.createHandle(annotation.position, annotation, { handleType: 'point' });
        break;
      case 'polyline':
      case 'polygon':
        annotation.positions.forEach((position, vertexIndex) => {
          this.createHandle(position, annotation, { handleType: 'vertex', vertexIndex });
        });
        break;
      case 'circle':
        this.createHandle(annotation.center, annotation, { handleType: 'center' });
        this.createHandle(this.entityFactory.getCircleRadiusHandlePosition(annotation), annotation, { handleType: 'radius' });
        break;
    }
  }

  private createHandle(position: Cartesian3, annotation: Annotation, metadata: Pick<EntityMetadata, 'handleType' | 'vertexIndex'>): Entity {
    const handle = this.entityFactory.createHandle(position, {
      editorKind: 'handle',
      annotationId: annotation.id,
      ...metadata
    });
    const handles = this.handleEntities.get(annotation.id) ?? [];
    handles.push(handle);
    this.handleEntities.set(annotation.id, handles);
    return handle;
  }

  private renderSelectedHandles(annotation: Annotation): void {
    this.entityFactory.removeHelperEntities();
    this.handleEntities.clear();
    this.renderHandles(annotation);
  }

  /**
   * 全局编辑模式下，所有图形仍同时可编辑（Geoman 语义），但只为当前视口内的标注创建
   * handle entity，避免 handle 数量随标注总量线性增长。视口外的图形本就无法交互。
   * 相机停止移动时（moveEnd）重建可见 handle。无法判断视口（如测试环境、缺少相机 API）
   * 时回退为全量渲染，保持原有行为。
   */
  private renderViewportHandles(): void {
    this.entityFactory.removeHelperEntities();
    this.handleEntities.clear();
    for (const annotation of this.store.getAll()) {
      if (annotation.id === this.selectedId || this.isAnnotationInViewport(annotation)) {
        this.renderHandles(annotation);
      }
    }
  }

  private subscribeCameraChange(): void {
    this.unsubscribeCameraChange();
    const moveEnd = this.viewer.scene.camera?.moveEnd;
    if (!moveEnd || typeof moveEnd.addEventListener !== 'function') {
      return;
    }

    const remove = moveEnd.addEventListener(() => {
      // 拖动期间相机被锁定且不应重建 handle（会销毁正在拖动的 handle 及其预览源）。
      if (this.dragTarget || !this.isActive()) {
        return;
      }
      this.renderViewportHandles();
      this.viewer.scene.requestRender();
    });
    this.removeCameraListener = typeof remove === 'function' ? remove : null;
  }

  private unsubscribeCameraChange(): void {
    this.removeCameraListener?.();
    this.removeCameraListener = null;
  }

  private isAnnotationInViewport(annotation: Annotation): boolean {
    const scene = this.viewer.scene as Scene | undefined;
    const camera = scene?.camera;
    // 视口/相机信息不可用时（测试环境等）回退为"可见"，保持原全量行为。
    if (!scene || !camera?.positionWC || !camera?.directionWC) {
      return true;
    }
    return this.handleAnchorPositions(annotation).some((position) => this.isPositionInViewport(position));
  }

  private isPositionInViewport(position: Cartesian3): boolean {
    const scene = this.viewer.scene as Scene;
    const camera = scene.camera;
    const cameraPosition = camera.positionWC;
    const cameraDirection = camera.directionWC;

    const toPosition = Cartesian3.subtract(position, cameraPosition, viewportScratch);
    if (Cartesian3.dot(cameraDirection, toPosition) <= 0) {
      return false;
    }
    if (!isAboveGlobeHorizon(position, cameraPosition, scene)) {
      return false;
    }

    let screen: Cartesian2 | undefined;
    try {
      screen = SceneTransforms.worldToWindowCoordinates(scene, position, new Cartesian2());
    } catch {
      return true;
    }
    if (!screen) {
      return false;
    }

    const width = scene.drawingBufferWidth ?? scene.canvas?.clientWidth ?? scene.canvas?.width;
    const height = scene.drawingBufferHeight ?? scene.canvas?.clientHeight ?? scene.canvas?.height;
    if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
      return true;
    }

    const margin = HANDLE_VIEWPORT_MARGIN;
    return screen.x >= -margin && screen.y >= -margin && screen.x <= width + margin && screen.y <= height + margin;
  }

  private handleAnchorPositions(annotation: Annotation): Cartesian3[] {
    switch (annotation.type) {
      case 'point':
        return [annotation.position];
      case 'polyline':
      case 'polygon':
        return annotation.positions;
      case 'circle':
        return [annotation.center, this.entityFactory.getCircleRadiusHandlePosition(annotation)];
    }
  }

  private prepareDraggedHandlePreviews(annotation: Annotation, metadata: EntityMetadata, handleEntity: Entity): HandlePreview[] {
    const previews: HandlePreview[] = [];
    const addPreview = (entity: Entity, position: Cartesian3) => {
      const source = new MutablePositionSource(position);
      this.entityFactory.setPositionSource(entity, source);
      previews.push({ entity, source });
    };

    if (annotation.type === 'circle' && metadata.handleType === 'center') {
      const handles = this.handleEntities.get(annotation.id) ?? [];
      if (handles[0]) {
        addPreview(handles[0], annotation.center);
      }
      if (handles[1]) {
        addPreview(handles[1], this.entityFactory.getCircleRadiusHandlePosition(annotation));
      }
      return previews;
    }

    addPreview(handleEntity, this.getHandlePosition(annotation, metadata));
    return previews;
  }

  private updateDraggedHandlePreviews(target: DragTarget, position: Cartesian3): void {
    const { annotation, metadata, handlePreviews } = target;
    if (annotation.type === 'circle' && metadata.handleType === 'center') {
      if (handlePreviews[0]) {
        handlePreviews[0].source.set(annotation.center);
      }
      if (handlePreviews[1]) {
        handlePreviews[1].source.set(this.entityFactory.getCircleRadiusHandlePosition(annotation));
      }
      return;
    }

    if (annotation.type === 'circle' && metadata.handleType === 'radius') {
      handlePreviews[0]?.source.set(getDraggedCircleRadiusHandlePosition(annotation, position));
      return;
    }

    handlePreviews[0]?.source.set(position);
  }

  private restoreDraggedHandles(target: DragTarget): void {
    const { annotation, metadata, handleEntity } = target;
    if (annotation.type === 'circle' && metadata.handleType === 'center') {
      const handles = this.handleEntities.get(annotation.id) ?? [];
      if (handles[0]) {
        this.entityFactory.updatePointPosition(handles[0], annotation.center);
      }
      if (handles[1]) {
        this.entityFactory.updatePointPosition(handles[1], this.entityFactory.getCircleRadiusHandlePosition(annotation));
      }
      return;
    }

    if (annotation.type === 'circle' && metadata.handleType === 'radius') {
      this.entityFactory.updatePointPosition(handleEntity, this.entityFactory.getCircleRadiusHandlePosition(annotation));
      return;
    }

    this.entityFactory.updatePointPosition(handleEntity, this.getHandlePosition(annotation, metadata));
  }

  private getHandlePosition(annotation: Annotation, metadata: EntityMetadata): Cartesian3 {
    switch (annotation.type) {
      case 'point':
        return annotation.position;
      case 'polyline':
      case 'polygon':
        return metadata.vertexIndex == null ? annotation.positions[0] : annotation.positions[metadata.vertexIndex];
      case 'circle':
        return metadata.handleType === 'radius' ? this.entityFactory.getCircleRadiusHandlePosition(annotation) : annotation.center;
    }
  }

  private queueHover(screenPosition: Cartesian2): void {
    this.pendingHoverScreenPosition = Cartesian2.clone(screenPosition, this.pendingHoverScreenPosition ?? new Cartesian2());
    if (this.hoverFrame !== null) {
      return;
    }

    this.hoverFrame = requestFrame(() => {
      this.hoverFrame = null;
      const latestScreenPosition = this.pendingHoverScreenPosition;
      this.pendingHoverScreenPosition = null;
      if (latestScreenPosition) {
        this.updateHover(latestScreenPosition);
      }
    });
  }

  private cancelHoverFrame(): void {
    this.pendingHoverScreenPosition = null;
    if (this.hoverFrame !== null) {
      cancelFrame(this.hoverFrame);
      this.hoverFrame = null;
    }
  }

  private updateHover(screenPosition: Cartesian2): void {
    const picked = this.pickService.pickTopEditorEntity(screenPosition);
    const nextHandle = picked?.metadata.editorKind === 'handle' ? picked.entity : null;
    if (nextHandle !== this.hoveredHandle) {
      this.clearHover();
      this.hoveredHandle = nextHandle;
      if (this.hoveredHandle) {
        this.entityFactory.setHandleHover(this.hoveredHandle, true);
      }
    }

    if (nextHandle) {
      this.viewer.scene.canvas.style.cursor = 'move';
    } else if (picked?.metadata.editorKind === 'annotation') {
      this.viewer.scene.canvas.style.cursor = 'pointer';
    } else {
      this.viewer.scene.canvas.style.cursor = '';
    }
  }

  private clearHover(): void {
    if (this.hoveredHandle) {
      this.entityFactory.setHandleHover(this.hoveredHandle, false);
      this.hoveredHandle = null;
    }
  }

  private resolveEditPosition(screenPosition: Cartesian2, fallbackPosition?: Cartesian3): Cartesian3 | undefined {
    if (!this.dragTarget) {
      return fallbackPosition ? cloneCartesian(fallbackPosition) : undefined;
    }

    const resolution = this.snapService.resolve(screenPosition, fallbackPosition, {
      mode: 'edit',
      shape: this.dragTarget.annotation.type,
      excludeAnnotationId: this.dragTarget.annotation.id
    });
    this.updateSnapState(resolution);
    return resolution.position;
  }

  private updateSnapState(resolution: SnapResolution): void {
    if (!this.dragTarget) {
      this.clearSnapState();
      return;
    }

    if (!resolution.snapped || !resolution.target) {
      if (this.activeSnapEvent) {
        this.events.emit('pm:unsnap', this.activeSnapEvent);
      }
      this.activeSnapEvent = null;
      this.activeSnapKey = null;
      return;
    }

    const event: GeomanSnapEvent = {
      shape: annotationTypeToGeomanShape(this.dragTarget.annotation.type),
      annotation: this.dragTarget.annotation,
      layer: this.dragTarget.annotation.entity,
      marker: this.dragTarget.handleEntity,
      snapTargetType: resolution.target.type,
      snapPosition: resolution.target.position,
      snapLatLng: resolution.target.position,
      distance: resolution.target.distance,
      layerInteractedWith: resolution.target.layer,
      annotationInteractedWith: resolution.target.annotation,
      segment: resolution.target.segment,
      vertexIndex: resolution.target.vertexIndex
    };

    this.events.emit('pm:snapdrag', event);
    if (resolution.target.key !== this.activeSnapKey) {
      this.events.emit('pm:snap', event);
    }
    this.activeSnapEvent = event;
    this.activeSnapKey = resolution.target.key;
  }

  private clearSnapState(): void {
    this.activeSnapEvent = null;
    this.activeSnapKey = null;
  }

  private isActive(): boolean {
    return this.handler !== null;
  }
}

const HANDLE_VIEWPORT_MARGIN = 32;
const viewportScratch = new Cartesian3();

function isAboveGlobeHorizon(position: Cartesian3, cameraPosition: Cartesian3, scene: Scene): boolean {
  const ellipsoid = scene.globe?.ellipsoid ?? Ellipsoid.WGS84;
  const radius = ellipsoid.maximumRadius;
  const cameraDistance = Cartesian3.magnitude(cameraPosition);
  const positionDistance = Cartesian3.magnitude(position);
  if (cameraDistance <= radius || positionDistance === 0) {
    return true;
  }

  const cosine = Cartesian3.dot(cameraPosition, position) / (cameraDistance * positionDistance);
  const horizonCosine = radius / cameraDistance;
  return cosine >= horizonCosine - 1e-6;
}

function getDraggedCircleRadiusHandlePosition(annotation: Extract<Annotation, { type: 'circle' }>, position: Cartesian3): Cartesian3 {
  const radius = annotation.radius;
  const distance = surfaceDistance(annotation.center, position);
  if (Math.abs(distance - radius) < 1e-3) {
    return position;
  }

  return pointAlongSurface(annotation.center, position, radius);
}

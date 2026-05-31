import {
  Cartesian2,
  Cartesian3,
  Entity,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer
} from 'cesium';
import type { Annotation, AnnotationInput, AnnotationType, CancelEvent, EditorMode, GeomanSnapEvent, NormalizedOptions } from '../types';
import type { AnnotationStore } from '../core/AnnotationStore';
import type { EntityFactory } from '../core/EntityFactory';
import type { EventEmitter } from '../events/EventEmitter';
import type { PickService } from '../core/PickService';
import type { SnapResolution } from '../core/SnapService';
import type { SnapService } from '../core/SnapService';
import { annotationTypeToGeomanShape } from '../geoman';
import { MutablePositionSource, MutablePositionsSource, MutableScalarSource } from '../core/GeometryPreviewSession';
import {
  addDomEventListener,
  addWindowEventListener,
  cancelFrame,
  clearBrowserTimeout,
  requestFrame,
  setBrowserTimeout,
  type AnimationFrameHandle,
  type TimeoutHandle
} from '../utils/browser';
import { clampRadius, pointAlongSurface } from '../utils/circle';
import { cloneCartesian, surfaceDistance } from '../utils/coordinates';

type ScreenSpaceAction = ReturnType<ScreenSpaceEventHandler['getInputAction']>;

interface WorkingState {
  type: AnnotationType;
  positions: Cartesian3[];
  center?: Cartesian3;
  radius: number;
  workingEntity?: Entity;
  hintLine?: Entity;
  cursorHelper?: Entity;
  centerHelper?: Entity;
  radiusHelper?: Entity;
  cursorSource?: MutablePositionSource;
  hintLineSource?: MutablePositionsSource;
  radiusSource?: MutableScalarSource;
  radiusHelperSource?: MutablePositionSource;
  vertexHelpers: Entity[];
  hasGeometry: boolean;
}

export class DrawController {
  private handler: ScreenSpaceEventHandler | null = null;
  private keydown: ((event: KeyboardEvent) => void) | null = null;
  private removeKeydownListener: (() => void) | null = null;
  private state: WorkingState | null = null;
  private activeType: AnnotationType | null = null;
  private hoveredVertexHelper: Entity | null = null;
  private viewerDoubleClickAction: ScreenSpaceAction | undefined;
  private viewerDoubleClickSuppressed = false;
  private doubleClickBlocker: ((event: MouseEvent) => void) | null = null;
  private removeDoubleClickBlockerListener: (() => void) | null = null;
  private doubleClickBlockerReleaseTimer: TimeoutHandle | null = null;
  private pendingMouseMoveScreenPosition: Cartesian2 | null = null;
  private mouseMoveFrame: AnimationFrameHandle | null = null;
  private activeSnapEvent: GeomanSnapEvent | null = null;
  private activeSnapKey: string | null = null;

  constructor(
    private readonly viewer: Viewer,
    private readonly options: NormalizedOptions,
    private readonly store: AnnotationStore,
    private readonly entityFactory: EntityFactory,
    private readonly pickService: PickService,
    private readonly snapService: SnapService,
    private readonly events: EventEmitter,
    private readonly onCreated: (annotation: Annotation) => void,
    private readonly clearModeAfterFinish: () => void
  ) {}

  activate(type: AnnotationType): void {
    this.deactivate('modechange', false);
    this.activeType = type;
    this.state = {
      type,
      positions: [],
      radius: this.options.circle.minRadius,
      vertexHelpers: [],
      hasGeometry: false
    };

    this.suppressViewerDoubleClick();
    this.installDoubleClickBlocker();
    this.handler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.viewer.scene.canvas.classList.add('cae-draw-cursor');
    this.handler.setInputAction((movement: { position: Cartesian2 }) => this.handleLeftClick(movement.position), ScreenSpaceEventType.LEFT_CLICK);
    this.handler.setInputAction((movement: { endPosition: Cartesian2 }) => this.handleMouseMove(movement.endPosition), ScreenSpaceEventType.MOUSE_MOVE);

    this.keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancel('escape');
        this.clearModeAfterFinish();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this.finish();
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        this.removeLastVertex();
      }
    };
    this.removeKeydownListener = addWindowEventListener('keydown', this.keydown);
    this.events.emit('drawstart', { mode: this.mode(), type });
  }

  deactivate(reason: CancelEvent['reason'] = 'modechange', emitCancel = true): void {
    const mode = this.mode();
    const hadGeometry = this.state?.hasGeometry ?? false;
    this.handler?.destroy();
    this.handler = null;
    this.cancelMouseMoveFrame();
    this.viewer.scene.canvas.classList.remove('cae-draw-cursor');
    this.clearLineLikeHover();
    this.clearSnapState();
    this.removeKeydownListener?.();
    this.removeKeydownListener = null;
    this.keydown = null;
    this.entityFactory.removeWorkingEntities();
    this.restoreViewerDoubleClick();
    this.releaseDoubleClickBlocker(reason === 'destroy');
    this.state = null;
    this.activeType = null;
    if (mode !== 'idle') {
      this.events.emit('drawend', { mode, type: modeToType(mode) });
    }
    if (emitCancel && mode !== 'idle' && hadGeometry) {
      this.events.emit('cancel', { mode, reason });
    }
  }

  finish(): boolean {
    if (!this.state) {
      return false;
    }

    this.flushMouseMoveFrame();
    const state = this.state;
    let input: AnnotationInput | null = null;
    if (state.type === 'polyline' && state.positions.length >= 2) {
      input = { type: 'polyline', positions: state.positions.map(cloneCartesian) };
    } else if (state.type === 'polygon' && state.positions.length >= 3) {
      input = { type: 'polygon', positions: state.positions.map(cloneCartesian) };
    } else if (state.type === 'circle' && state.center) {
      input = {
        type: 'circle',
        center: cloneCartesian(state.center),
        radius: clampRadius(state.radius, this.options.circle.minRadius, this.options.circle.maxRadius)
      };
    }

    if (!input) {
      return false;
    }

    const annotation = state.workingEntity ? this.store.addFromEntity(input, state.workingEntity) : this.store.addFromDraw(input);
    const type = state.type;
    this.clearLineLikeHover();
    this.clearSnapState();
    this.entityFactory.removeWorkingEntities();
    this.state = {
      type,
      positions: [],
      radius: this.options.circle.minRadius,
      vertexHelpers: [],
      hasGeometry: false
    };
    this.onCreated(annotation);
    this.events.emit('create', { annotation, source: 'draw' });
    this.events.emit('change', { annotation, source: 'draw' });

    if (!this.options.continueDrawing[type]) {
      this.clearModeAfterFinish();
    }
    return true;
  }

  cancel(reason: CancelEvent['reason'] = 'api'): void {
    this.deactivate(reason, true);
  }

  removeLastVertex(): boolean {
    if (!this.state || (this.state.type !== 'polyline' && this.state.type !== 'polygon') || this.state.positions.length === 0) {
      return false;
    }

    this.state.positions.pop();
    this.state.hasGeometry = this.state.positions.length > 0;
    this.clearLineLikeHover();
    this.rebuildVertexHelpers();
    this.updateLineLikeWorkingGeometry();
    this.resetPolygonHintLineToLastVertex();
    return true;
  }

  private handleLeftClick(screenPosition: Cartesian2): void {
    if (!this.state) {
      return;
    }

    if (this.handleLineLikeVertexClick(screenPosition)) {
      return;
    }

    const resolution = this.resolveDrawSnap(screenPosition, this.pickService.pickWorldPosition(screenPosition));
    if (this.handleSnappedWorkingVertexClick(resolution)) {
      return;
    }
    if (!resolution.position) {
      return;
    }

    switch (this.state.type) {
      case 'point':
        this.createPoint(resolution.position);
        break;
      case 'polyline':
      case 'polygon':
        this.addVertex(resolution.position);
        break;
      case 'circle':
        this.handleCircleClick(resolution.position);
        break;
    }
  }

  private handleMouseMove(screenPosition: Cartesian2): void {
    if (!this.state) {
      return;
    }

    this.queueMouseMove(screenPosition);
  }

  private applyQueuedMouseMove(screenPosition: Cartesian2): void {
    if (!this.state) {
      return;
    }

    if (this.state.type === 'polyline' || this.state.type === 'polygon') {
      this.updateLineLikeHover(screenPosition);
      const world = this.pickService.pickGlobePosition(screenPosition) ?? this.pickService.pickWorldPosition(screenPosition);
      const snapped = this.resolveDrawPosition(screenPosition, world);
      if (this.state.type === 'polygon') {
        this.updatePolygonHintLine(snapped);
      }
      return;
    }

    if (this.state.type === 'circle') {
      if (this.state.center) {
        this.applyCirclePreview(screenPosition);
      } else {
        const world = this.pickService.pickGlobePosition(screenPosition) ?? this.pickService.pickWorldPosition(screenPosition);
        this.resolveDrawPosition(screenPosition, world);
      }
      return;
    }

    if (this.state.type === 'point') {
      const world = this.resolveDrawPosition(screenPosition, this.pickService.pickWorldPosition(screenPosition));
      if (!world) {
        this.clearPointCursor();
        return;
      }
      this.updatePointCursor(world);
    }
  }

  private createPoint(position: Cartesian3): void {
    const input: AnnotationInput = { type: 'point', position: cloneCartesian(position) };
    const cursorHelper = this.state?.cursorHelper;
    const annotation = cursorHelper ? this.store.addFromEntity(input, cursorHelper) : this.store.addFromDraw(input);
    if (this.state) {
      this.state.cursorHelper = undefined;
      this.state.cursorSource = undefined;
    }
    this.onCreated(annotation);
    this.events.emit('create', { annotation, source: 'draw' });
    this.events.emit('change', { annotation, source: 'draw' });
    this.clearSnapState();
    if (!this.options.continueDrawing.point) {
      this.clearModeAfterFinish();
    }
  }

  private addVertex(position: Cartesian3): void {
    if (!this.state) {
      return;
    }
    this.state.positions.push(cloneCartesian(position));
    const helper = this.entityFactory.createWorkingPoint(position);
    this.state.vertexHelpers.push(helper);
    this.state.hasGeometry = true;
    this.updateLineLikeWorkingGeometry();
    this.resetPolygonHintLineToLastVertex();
    this.events.emit('pm:vertexadded', {
      shape: annotationTypeToGeomanShape(this.state.type),
      workingLayer: this.state.workingEntity,
      marker: helper,
      position,
      vertexIndex: this.state.positions.length - 1
    });
  }

  private handleCircleClick(position: Cartesian3): void {
    if (!this.state) {
      return;
    }

    if (!this.state.center) {
      this.state.center = cloneCartesian(position);
      this.state.radius = this.options.circle.minRadius;
      this.state.radiusSource = new MutableScalarSource(this.state.radius);
      this.state.workingEntity = this.entityFactory.createWorkingCircle(this.state.center, this.state.radiusSource);
      this.state.centerHelper = this.entityFactory.createWorkingPoint(this.state.center);
      this.state.hasGeometry = true;
      this.events.emit('pm:centerplaced', {
        shape: annotationTypeToGeomanShape(this.state.type),
        workingLayer: this.state.workingEntity,
        marker: this.state.centerHelper,
        position: this.state.center
      });
      return;
    }

    this.cancelMouseMoveFrame();
    this.state.radius = clampRadius(surfaceDistance(this.state.center, position), this.options.circle.minRadius, this.options.circle.maxRadius);
    this.state.radiusSource?.set(this.state.radius);
    this.finish();
  }

  private updateLineLikeWorkingGeometry(): void {
    if (!this.state || (this.state.type !== 'polyline' && this.state.type !== 'polygon')) {
      return;
    }

    const positions = this.state.positions.slice();
    if (positions.length < 2) {
      return;
    }

    if (!this.state.workingEntity) {
      this.state.workingEntity = this.entityFactory.createWorkingPolyline(positions);
    } else {
      this.entityFactory.updatePolyline(this.state.workingEntity, positions);
    }
  }

  private updatePolygonHintLine(world: Cartesian3 | undefined): void {
    if (!this.state || this.state.type !== 'polygon') {
      return;
    }

    const lastVertex = this.state.positions[this.state.positions.length - 1];
    if (!lastVertex) {
      this.clearPolygonHintLine();
      return;
    }

    if (!world) {
      this.clearPolygonHintLine();
      return;
    }

    this.setPolygonHintLine([lastVertex, world]);
  }

  private resetPolygonHintLineToLastVertex(): void {
    if (!this.state || this.state.type !== 'polygon') {
      return;
    }

    const lastVertex = this.state.positions[this.state.positions.length - 1];
    if (!lastVertex) {
      this.clearPolygonHintLine();
      return;
    }

    this.setPolygonHintLine([lastVertex, lastVertex]);
  }

  private setPolygonHintLine(positions: Cartesian3[]): void {
    if (!this.state || this.state.type !== 'polygon') {
      return;
    }

    if (!this.state.hintLine) {
      this.state.hintLine = this.entityFactory.createWorkingHintLine(positions);
      this.state.hintLineSource = new MutablePositionsSource(positions);
      this.entityFactory.setPolylinePositionsSource(this.state.hintLine, this.state.hintLineSource);
    } else {
      this.state.hintLineSource?.setPositions(positions);
    }
    this.viewer.scene.requestRender();
  }

  private clearPolygonHintLine(): void {
    if (!this.state?.hintLine) {
      return;
    }

    this.entityFactory.clearWorkingHintLine(this.state.hintLine);
    this.state.hintLine = undefined;
    this.state.hintLineSource = undefined;
    this.viewer.scene.requestRender();
  }

  private updatePointCursor(position: Cartesian3): void {
    if (!this.state || this.state.type !== 'point') {
      return;
    }

    if (!this.state.cursorHelper) {
      this.state.cursorHelper = this.entityFactory.createPointCursor(position);
      this.state.cursorSource = new MutablePositionSource(position);
      this.entityFactory.setPositionSource(this.state.cursorHelper, this.state.cursorSource);
    } else {
      this.state.cursorSource?.set(position);
    }
    this.viewer.scene.requestRender();
  }

  private handleLineLikeVertexClick(screenPosition: Cartesian2): boolean {
    if (!this.state || (this.state.type !== 'polyline' && this.state.type !== 'polygon')) {
      return false;
    }

    const picked = this.pickService.pickEditorEntity(screenPosition);
    if (!picked || picked.metadata.editorKind !== 'working') {
      return false;
    }

    const vertexIndex = this.state.vertexHelpers.indexOf(picked.entity);
    if (vertexIndex === -1) {
      return false;
    }

    const lastIndex = this.state.positions.length - 1;
    if (this.state.type === 'polyline' && vertexIndex === lastIndex && this.state.positions.length >= 2) {
      this.finish();
    } else if (this.state.type === 'polygon' && vertexIndex === 0 && this.state.positions.length >= 3) {
      this.finish();
    }

    return true;
  }

  private updateLineLikeHover(screenPosition: Cartesian2): void {
    if (!this.state || (this.state.type !== 'polyline' && this.state.type !== 'polygon')) {
      return;
    }

    const picked = this.pickService.pickTopEditorEntity(screenPosition);
    const nextHelper =
      picked?.metadata.editorKind === 'working' && this.state.vertexHelpers.includes(picked.entity) ? picked.entity : null;

    if (nextHelper !== this.hoveredVertexHelper) {
      this.clearLineLikeHover();
      this.hoveredVertexHelper = nextHelper;
      if (this.hoveredVertexHelper) {
        this.entityFactory.setHandleHover(this.hoveredVertexHelper, true);
        this.viewer.scene.canvas.classList.add('cae-pointer-cursor');
      }
    }

    if (!nextHelper) {
      this.viewer.scene.canvas.classList.remove('cae-pointer-cursor');
    }
  }

  private clearLineLikeHover(): void {
    if (this.hoveredVertexHelper) {
      this.entityFactory.setHandleHover(this.hoveredVertexHelper, false);
      this.hoveredVertexHelper = null;
    }
    this.viewer.scene.canvas.classList.remove('cae-pointer-cursor');
  }

  private clearPointCursor(): void {
    if (!this.state?.cursorHelper) {
      return;
    }

    this.entityFactory.removeWorkingEntity(this.state.cursorHelper);
    this.state.cursorHelper = undefined;
    this.state.cursorSource = undefined;
    this.viewer.scene.requestRender();
  }

  private resolveDrawPosition(screenPosition: Cartesian2, fallbackPosition?: Cartesian3): Cartesian3 | undefined {
    return this.resolveDrawSnap(screenPosition, fallbackPosition).position;
  }

  private resolveDrawSnap(screenPosition: Cartesian2, fallbackPosition?: Cartesian3): SnapResolution {
    if (!this.state) {
      return {
        position: fallbackPosition ? cloneCartesian(fallbackPosition) : undefined,
        snapped: false
      };
    }

    const resolution = this.snapService.resolve(screenPosition, fallbackPosition, {
      mode: 'draw',
      shape: this.state.type,
      selfSnapPositions: this.drawSelfSnapPositions()
    });
    this.updateSnapState(resolution);
    return resolution;
  }

  private drawSelfSnapPositions(): Cartesian3[] | undefined {
    if (!this.state || this.state.type !== 'polygon' || this.state.positions.length < 3) {
      return undefined;
    }
    return [this.state.positions[0]];
  }

  private handleSnappedWorkingVertexClick(resolution: SnapResolution): boolean {
    if (!this.state || resolution.target?.source !== 'self') {
      return false;
    }

    const vertexIndex = resolution.target.vertexIndex;
    if (this.state.type === 'polygon' && vertexIndex === 0 && this.state.positions.length >= 3) {
      this.finish();
      return true;
    }
    return false;
  }

  private updateSnapState(resolution: SnapResolution): void {
    if (!this.state) {
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
      shape: annotationTypeToGeomanShape(this.state.type),
      workingLayer: this.state.workingEntity,
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

  private queueMouseMove(screenPosition: Cartesian2): void {
    this.pendingMouseMoveScreenPosition = Cartesian2.clone(screenPosition, this.pendingMouseMoveScreenPosition ?? new Cartesian2());
    if (this.mouseMoveFrame !== null) {
      return;
    }

    this.mouseMoveFrame = requestFrame(() => {
      this.mouseMoveFrame = null;
      const latestScreenPosition = this.pendingMouseMoveScreenPosition;
      this.pendingMouseMoveScreenPosition = null;
      if (latestScreenPosition) {
        this.applyQueuedMouseMove(latestScreenPosition);
      }
    });
  }

  private applyCirclePreview(screenPosition: Cartesian2): void {
    if (!this.state?.center || this.state.type !== 'circle') {
      return;
    }

    const rawWorld = this.pickService.pickGlobePosition(screenPosition) ?? this.pickService.pickWorldPosition(screenPosition);
    const world = this.resolveDrawPosition(screenPosition, rawWorld);
    if (!world) {
      return;
    }

    this.state.radius = clampRadius(surfaceDistance(this.state.center, world), this.options.circle.minRadius, this.options.circle.maxRadius);
    this.state.radiusSource?.set(this.state.radius);
    this.updateCirclePreview(world);
  }

  private updateCirclePreview(radiusPoint: Cartesian3): void {
    if (!this.state?.center || !this.state.workingEntity) {
      return;
    }

    const radiusHandlePosition = getCircleRadiusHandlePosition(this.state.center, radiusPoint, this.state.radius);
    if (!this.state.radiusHelper) {
      this.state.radiusHelper = this.entityFactory.createWorkingPoint(radiusHandlePosition);
      this.state.radiusHelperSource = new MutablePositionSource(radiusHandlePosition);
      this.entityFactory.setPositionSource(this.state.radiusHelper, this.state.radiusHelperSource);
    } else {
      this.state.radiusHelperSource?.set(radiusHandlePosition);
    }

    const hintPositions = [this.state.center, radiusHandlePosition];
    if (!this.state.hintLine) {
      this.state.hintLine = this.entityFactory.createWorkingHintLine(hintPositions);
      this.state.hintLineSource = new MutablePositionsSource(hintPositions);
      this.entityFactory.setPolylinePositionsSource(this.state.hintLine, this.state.hintLineSource);
    } else {
      this.state.hintLineSource?.setPositions(hintPositions);
    }
    this.viewer.scene.requestRender();
  }

  private cancelMouseMoveFrame(): void {
    this.pendingMouseMoveScreenPosition = null;
    if (this.mouseMoveFrame !== null) {
      cancelFrame(this.mouseMoveFrame);
      this.mouseMoveFrame = null;
    }
  }

  private flushMouseMoveFrame(): void {
    if (!this.pendingMouseMoveScreenPosition) {
      this.cancelMouseMoveFrame();
      return;
    }

    const latestScreenPosition = Cartesian2.clone(this.pendingMouseMoveScreenPosition, new Cartesian2());
    this.cancelMouseMoveFrame();
    this.applyQueuedMouseMove(latestScreenPosition);
  }

  private rebuildVertexHelpers(): void {
    if (!this.state) {
      return;
    }
    this.entityFactory.removeWorkingEntities();
    const positions = this.state.positions.slice();
    this.state.workingEntity = undefined;
    this.state.hintLine = undefined;
    this.state.hintLineSource = undefined;
    this.state.vertexHelpers = positions.map((position) => this.entityFactory.createWorkingPoint(position));
  }

  private suppressViewerDoubleClick(): void {
    if (this.viewerDoubleClickSuppressed) {
      return;
    }
    const handler = this.viewer.screenSpaceEventHandler;
    this.viewerDoubleClickAction = handler.getInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    handler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    this.viewerDoubleClickSuppressed = true;
  }

  private restoreViewerDoubleClick(): void {
    if (!this.viewerDoubleClickSuppressed) {
      return;
    }
    const handler = this.viewer.screenSpaceEventHandler;
    if (this.viewerDoubleClickAction) {
      handler.setInputAction(this.viewerDoubleClickAction, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    } else {
      handler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    }
    this.viewerDoubleClickAction = undefined;
    this.viewerDoubleClickSuppressed = false;
  }

  private installDoubleClickBlocker(): void {
    this.cancelDoubleClickBlockerRelease();
    if (this.doubleClickBlocker) {
      return;
    }

    this.doubleClickBlocker = (event: MouseEvent) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      this.finish();
      if (!this.state) {
        this.removeDoubleClickBlocker();
      }
    };
    this.removeDoubleClickBlockerListener = addDomEventListener(this.viewer.scene.canvas, 'dblclick', this.doubleClickBlocker as EventListener, {
      capture: true
    });
  }

  private releaseDoubleClickBlocker(immediate: boolean): void {
    if (!this.doubleClickBlocker) {
      return;
    }

    this.cancelDoubleClickBlockerRelease();
    if (immediate) {
      this.removeDoubleClickBlocker();
      return;
    }

    this.doubleClickBlockerReleaseTimer = setBrowserTimeout(() => {
      this.doubleClickBlockerReleaseTimer = null;
      if (!this.state) {
        this.removeDoubleClickBlocker();
      }
    }, 300);
  }

  private cancelDoubleClickBlockerRelease(): void {
    if (this.doubleClickBlockerReleaseTimer === null) {
      return;
    }
    clearBrowserTimeout(this.doubleClickBlockerReleaseTimer);
    this.doubleClickBlockerReleaseTimer = null;
  }

  private removeDoubleClickBlocker(): void {
    this.cancelDoubleClickBlockerRelease();
    if (!this.doubleClickBlocker) {
      return;
    }
    this.removeDoubleClickBlockerListener?.();
    this.removeDoubleClickBlockerListener = null;
    this.doubleClickBlocker = null;
  }

  private mode(): EditorMode {
    return this.activeType ? `draw:${this.activeType}` : 'idle';
  }
}

function modeToType(mode: EditorMode): AnnotationType | undefined {
  if (!mode.startsWith('draw:')) {
    return undefined;
  }
  return mode.slice(5) as AnnotationType;
}

function getCircleRadiusHandlePosition(center: Cartesian3, pointer: Cartesian3, radius: number): Cartesian3 {
  const distance = surfaceDistance(center, pointer);
  if (Math.abs(distance - radius) < 1e-3) {
    return pointer;
  }
  return pointAlongSurface(center, pointer, radius);
}

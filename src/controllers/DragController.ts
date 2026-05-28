import { Cartesian2, Cartesian3, ScreenSpaceEventHandler, ScreenSpaceEventType, type Viewer } from 'cesium';
import type { Annotation } from '../types';
import type { AnnotationStore } from '../core/AnnotationStore';
import type { CameraInputGuard } from '../core/CameraInputGuard';
import type { EntityFactory } from '../core/EntityFactory';
import type { PickService } from '../core/PickService';
import type { EventEmitter } from '../events/EventEmitter';
import { GeometryPreviewSession } from '../core/GeometryPreviewSession';
import { cloneCartesian } from '../utils/coordinates';

interface ActiveDrag {
  annotation: Annotation;
  preview: GeometryPreviewSession;
  startPosition: Cartesian3;
  currentPosition: Cartesian3;
}

export class DragController {
  private handler: ScreenSpaceEventHandler | null = null;
  private activeDrag: ActiveDrag | null = null;
  private pendingDragScreenPosition: Cartesian2 | null = null;
  private dragFrame: number | null = null;
  private pendingHoverScreenPosition: Cartesian2 | null = null;
  private hoverFrame: number | null = null;

  constructor(
    private readonly viewer: Viewer,
    private readonly store: AnnotationStore,
    private readonly entityFactory: EntityFactory,
    private readonly pickService: PickService,
    private readonly cameraGuard: CameraInputGuard,
    private readonly events: EventEmitter
  ) {}

  activate(): void {
    this.deactivate();
    this.handler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.handler.setInputAction((movement: { position: Cartesian2 }) => this.handleLeftDown(movement.position), ScreenSpaceEventType.LEFT_DOWN);
    this.handler.setInputAction((movement: { endPosition: Cartesian2 }) => this.handleMouseMove(movement.endPosition), ScreenSpaceEventType.MOUSE_MOVE);
    this.handler.setInputAction(() => this.finishDrag(), ScreenSpaceEventType.LEFT_UP);
  }

  deactivate(): void {
    this.finishDrag();
    this.cancelDragFrame();
    this.cancelHoverFrame();
    this.handler?.destroy();
    this.handler = null;
    this.setCursor('idle');
  }

  private handleLeftDown(screenPosition: Cartesian2): void {
    this.cancelHoverFrame();
    const annotation = this.pickService.pickAnnotation(screenPosition);
    const world = this.pickDragPosition(screenPosition);
    if (!annotation || !world) {
      return;
    }

    this.activeDrag = {
      annotation,
      preview: new GeometryPreviewSession(annotation, this.entityFactory),
      startPosition: cloneCartesian(world),
      currentPosition: cloneCartesian(world)
    };
    this.setCursor('dragging');
    this.cameraGuard.lock();
    this.viewer.scene.requestRender();
    this.events.emit('dragstart', { annotation, startPosition: world, currentPosition: world });
  }

  private handleMouseMove(screenPosition: Cartesian2): void {
    if (!this.activeDrag) {
      this.queueHover(screenPosition);
      return;
    }
    this.setCursor('dragging');
    this.queueDrag(screenPosition);
  }

  private queueDrag(screenPosition: Cartesian2): void {
    this.pendingDragScreenPosition = Cartesian2.clone(screenPosition, this.pendingDragScreenPosition ?? new Cartesian2());
    if (this.dragFrame !== null) {
      return;
    }

    this.dragFrame = window.requestAnimationFrame(() => {
      this.dragFrame = null;
      const latestScreenPosition = this.pendingDragScreenPosition;
      this.pendingDragScreenPosition = null;
      if (latestScreenPosition) {
        this.applyQueuedDrag(latestScreenPosition);
      }
    });
  }

  private applyQueuedDrag(screenPosition: Cartesian2): void {
    if (!this.activeDrag) {
      return;
    }

    const world = this.pickDragPosition(screenPosition);
    if (!world) {
      return;
    }

    this.activeDrag.preview.translateFrom(this.activeDrag.startPosition, world);
    this.activeDrag.currentPosition = cloneCartesian(world);
    this.viewer.scene.requestRender();
    this.events.emit('drag', {
      annotation: this.activeDrag.annotation,
      startPosition: this.activeDrag.startPosition,
      currentPosition: world
    });
  }

  private queueHover(screenPosition: Cartesian2): void {
    this.pendingHoverScreenPosition = Cartesian2.clone(screenPosition, this.pendingHoverScreenPosition ?? new Cartesian2());
    if (this.hoverFrame !== null) {
      return;
    }

    this.hoverFrame = window.requestAnimationFrame(() => {
      this.hoverFrame = null;
      const latestScreenPosition = this.pendingHoverScreenPosition;
      this.pendingHoverScreenPosition = null;
      if (latestScreenPosition) {
        this.applyQueuedHover(latestScreenPosition);
      }
    });
  }

  private applyQueuedHover(screenPosition: Cartesian2): void {
    if (this.activeDrag) {
      return;
    }

    this.setCursor(this.pickService.pickAnnotation(screenPosition) ? 'hover' : 'idle');
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
      window.cancelAnimationFrame(this.dragFrame);
      this.dragFrame = null;
    }
  }

  private cancelHoverFrame(): void {
    this.pendingHoverScreenPosition = null;
    if (this.hoverFrame !== null) {
      window.cancelAnimationFrame(this.hoverFrame);
      this.hoverFrame = null;
    }
  }

  private finishDrag(): void {
    if (!this.activeDrag) {
      return;
    }
    this.flushDragFrame();
    const drag = this.activeDrag;
    this.activeDrag = null;
    this.cancelDragFrame();
    this.cameraGuard.unlock();
    drag.preview.commit(this.store);
    this.viewer.scene.requestRender();
    this.events.emit('dragend', {
      annotation: drag.annotation,
      startPosition: drag.startPosition,
      currentPosition: drag.currentPosition
    });
    this.events.emit('update', { annotation: drag.annotation, reason: 'drag' });
    this.events.emit('change', { annotation: drag.annotation, source: 'drag' });
    this.setCursor('idle');
  }

  cancelActiveDrag(annotationId?: string): void {
    if (!this.activeDrag || (annotationId && this.activeDrag.annotation.id !== annotationId)) {
      return;
    }

    const drag = this.activeDrag;
    this.activeDrag = null;
    this.cancelDragFrame();
    drag.preview.cancel();
    this.cameraGuard.unlock();
    this.viewer.scene.requestRender();
    this.setCursor('idle');
  }

  private setCursor(state: 'idle' | 'hover' | 'dragging'): void {
    if (state === 'dragging' || state === 'hover') {
      this.viewer.scene.canvas.style.cursor = 'move';
    } else {
      this.viewer.scene.canvas.style.cursor = '';
    }
  }
}

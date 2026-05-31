import type { Viewer } from 'cesium';
import { AnnotationStore } from './core/AnnotationStore';
import { CameraInputGuard } from './core/CameraInputGuard';
import { EntityFactory } from './core/EntityFactory';
import { EntityMetadataStore } from './core/EntityMetadataStore';
import { PickService } from './core/PickService';
import { SnapService } from './core/SnapService';
import { DrawController } from './controllers/DrawController';
import { DragController } from './controllers/DragController';
import { EditController } from './controllers/EditController';
import { EventEmitter } from './events/EventEmitter';
import {
  annotationToGeomanLayer,
  annotationTypeToGeomanShape,
  editorModeToGeomanShape,
  geomanShapeToAnnotationType,
  getSupportedGeomanShapes
} from './geoman';
import { normalizeOptions } from './options';
import {
  fromGeoJSON as geoJSONToAnnotationInputs,
  fromJSONInput,
  toGeoJSON as serializeGeoJSON,
  toJSON as serializeAnnotations
} from './serialization/Serializer';
import { Toolbar } from './toolbar/Toolbar';
import { getBrowserDocument, getElementComputedStyle } from './utils/browser';
import { hasSelfIntersection } from './utils/selfIntersection';
import type {
  AddEvent,
  Annotation,
  AnnotationGeoJSONFeatureCollection,
  AnnotationInput,
  AnnotationJSON,
  AnnotationPatch,
  AnnotationType,
  CesiumAnnotationEditorOptions,
  EditorEventHandler,
  EditorEventName,
  EditorMode,
  GeomanApi,
  GeomanDragOptions,
  GeomanDrawOptions,
  GeomanEditOptions,
  GeomanEntity,
  GeomanGlobalOptions,
  GeomanLayerApi,
  GeomanLayerEventName,
  GeomanShapeInput,
  GeomanShapeName,
  GeomanViewer,
  NormalizedOptions,
  ToolbarButtonName,
  ToolbarOptions
} from './types';

const modes: EditorMode[] = ['idle', 'draw:point', 'draw:polyline', 'draw:circle', 'draw:polygon', 'edit', 'drag'];

interface GeomanLayerRuntimeState {
  editEnabled: boolean;
  dragEnabled: boolean;
}

interface GeomanLayerStateChanges {
  enabled: Annotation[];
  disabled: Annotation[];
}

export class CesiumAnnotationEditor {
  readonly pm: GeomanApi;
  private readonly options: NormalizedOptions;
  private readonly events = new EventEmitter();
  private readonly metadataStore = new EntityMetadataStore();
  private readonly entityFactory: EntityFactory;
  private readonly store: AnnotationStore;
  private readonly pickService: PickService;
  private readonly snapService: SnapService;
  private readonly cameraGuard: CameraInputGuard;
  private readonly drawController: DrawController;
  private readonly editController: EditController;
  private readonly dragController: DragController;
  private readonly geomanLayerStates = new Map<string, GeomanLayerRuntimeState>();
  private geomanGlobalOptions: GeomanGlobalOptions = {};
  private pendingSingleEditLayerId: string | null = null;
  private pendingSingleDragLayerId: string | null = null;
  private toolbar: Toolbar | null;
  private attachedViewerPm = false;
  private previousViewerPmDescriptor: PropertyDescriptor | undefined;
  private mode: EditorMode = 'idle';
  private destroyed = false;

  constructor(
    private readonly viewer: Viewer,
    options: CesiumAnnotationEditorOptions = {}
  ) {
    if (!viewer?.scene || !viewer.entities) {
      throw new Error('CesiumAnnotationEditor requires a Cesium Viewer.');
    }

    this.options = normalizeOptions(options);
    this.entityFactory = new EntityFactory(viewer, this.options, this.metadataStore);
    this.store = new AnnotationStore(viewer, this.entityFactory);
    this.pickService = new PickService(viewer, this.metadataStore, (id) => this.store.get(id));
    this.snapService = new SnapService(viewer, this.options, this.store);
    this.cameraGuard = new CameraInputGuard(viewer);
    this.drawController = new DrawController(
      viewer,
      this.options,
      this.store,
      this.entityFactory,
      this.pickService,
      this.snapService,
      this.events,
      (annotation) => {
        this.decorateAnnotation(annotation);
      },
      () => this.setMode('idle')
    );
    this.editController = new EditController(
      viewer,
      this.options,
      this.store,
      this.entityFactory,
      this.pickService,
      this.snapService,
      this.cameraGuard,
      this.events
    );
    this.dragController = new DragController(viewer, this.store, this.entityFactory, this.pickService, this.cameraGuard, this.events);
    this.pm = this.createGeomanApi();
    this.attachGeomanApiToViewer();

    this.toolbar = this.createToolbar();
    this.toolbar?.setMode(this.mode);
  }

  setMode(mode: EditorMode): void {
    this.assertUsable();
    this.assertMode(mode);
    if (mode === this.mode) {
      return;
    }

    const previousMode = this.mode;
    this.leaveMode(previousMode, 'modechange');
    this.mode = mode;
    this.enterMode(mode);
    this.toolbar?.setMode(mode);
    this.events.emit('modechange', { previousMode, mode });
  }

  getMode(): EditorMode {
    return this.mode;
  }

  clearMode(): void {
    this.setMode('idle');
  }

  enableDraw(type: AnnotationType): void {
    if (!this.options.shapes.includes(type)) {
      throw new Error(`Shape is not enabled: ${type}`);
    }
    this.setMode(`draw:${type}`);
  }

  finishDrawing(): boolean {
    this.assertUsable();
    return this.drawController.finish();
  }

  cancelDrawing(): void {
    this.assertUsable();
    if (this.mode.startsWith('draw:')) {
      const previousMode = this.mode;
      this.drawController.cancel('api');
      this.mode = 'idle';
      this.toolbar?.setMode(this.mode);
      this.events.emit('modechange', { previousMode, mode: this.mode });
    }
  }

  removeLastVertex(): boolean {
    this.assertUsable();
    return this.drawController.removeLastVertex();
  }

  select(id: string | null): void {
    this.assertUsable();
    this.editController.select(id);
  }

  getSelected(): Annotation | null {
    return this.editController.getSelected();
  }

  enableEditMode(): void {
    this.setMode('edit');
  }

  disableEditMode(): void {
    if (this.mode === 'edit') {
      this.clearMode();
    }
  }

  enableDragMode(): void {
    this.setMode('drag');
  }

  disableDragMode(): void {
    if (this.mode === 'drag') {
      this.clearMode();
    }
  }

  addAnnotation(input: AnnotationInput): Annotation {
    this.assertUsable();
    const annotation = this.decorateAnnotation(this.store.add(input));
    this.editController.refreshHandles();
    const event: AddEvent = { annotation, source: 'api' };
    this.events.emit('add', event);
    this.events.emit('change', { annotation, source: 'api' });
    return annotation;
  }

  updateAnnotation(id: string, patch: AnnotationPatch): Annotation {
    this.assertUsable();
    this.editController.cancelActiveDrag(id);
    this.dragController.cancelActiveDrag(id);
    const annotation = this.store.update(id, patch);
    this.events.emit('update', { annotation, reason: 'api' });
    this.events.emit('change', { annotation, source: 'api' });
    if (this.getSelected()?.id === id) {
      this.editController.select(id);
    }
    this.editController.refreshHandles();
    return annotation;
  }

  removeAnnotation(id: string): boolean {
    this.assertUsable();
    this.editController.cancelActiveDrag(id);
    this.dragController.cancelActiveDrag(id);
    if (this.getSelected()?.id === id) {
      this.editController.select(null);
    }
    const removed = this.store.remove(id);
    if (removed) {
      this.geomanLayerStates.delete(id);
      this.editController.refreshHandles();
      this.events.emit('change', { source: 'remove' });
    }
    return removed;
  }

  getAnnotation(id: string): Annotation | undefined {
    return this.store.get(id);
  }

  getAnnotations(): Annotation[] {
    return this.store.getAll();
  }

  clearAnnotations(): void {
    this.assertUsable();
    this.editController.cancelActiveDrag();
    this.dragController.cancelActiveDrag();
    this.editController.select(null);
    this.store.clear();
    this.editController.refreshHandles();
    this.events.emit('change', { source: 'clear' });
  }

  toJSON(): AnnotationJSON[] {
    return serializeAnnotations(this.store.getAll());
  }

  toGeoJSON(): AnnotationGeoJSONFeatureCollection {
    return serializeGeoJSON(this.store.getAll());
  }

  fromJSON(items: AnnotationJSON[], options: { clear?: boolean } = {}): Annotation[] {
    this.assertUsable();
    if (options.clear) {
      this.clearAnnotations();
    }
    return items.map((item) => this.addAnnotation(fromJSONInput(item)));
  }

  fromGeoJSON(geoJSON: AnnotationGeoJSONFeatureCollection, options: { clear?: boolean } = {}): Annotation[] {
    this.assertUsable();
    if (options.clear) {
      this.clearAnnotations();
    }
    return geoJSONToAnnotationInputs(geoJSON).map((input) => this.addAnnotation(input));
  }

  on<T extends EditorEventName>(name: T, handler: EditorEventHandler<T>): () => void {
    return this.events.on(name, handler);
  }

  off<T extends EditorEventName>(name: T, handler: EditorEventHandler<T>): void {
    this.events.off(name, handler);
  }

  once<T extends EditorEventName>(name: T, handler: EditorEventHandler<T>): () => void {
    return this.events.once(name, handler);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    const previousMode = this.mode;
    this.leaveMode(previousMode, 'destroy');
    this.mode = 'idle';
    this.toolbar?.destroy();
    this.toolbar = null;
    this.entityFactory.removeWorkingEntities();
    this.entityFactory.removeHelperEntities();
    this.snapService.destroy();
    if (this.options.destroyBehavior === 'remove-all') {
      this.store.clear();
    }
    this.restoreViewerPm();
    this.cameraGuard.forceUnlock();
    this.events.clear();
    this.destroyed = true;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  private createToolbar(): Toolbar | null {
    if (!this.options.toolbar || !getBrowserDocument()) {
      return null;
    }

    const toolbarOptions: ToolbarOptions = this.options.toolbar === true ? {} : this.options.toolbar;
    const container = this.viewer.container as HTMLElement;
    if (getElementComputedStyle(container)?.position === 'static') {
      container.style.position = 'relative';
    }
    return new Toolbar(container, toolbarOptions, {
      onButtonClick: (button) => this.handleToolbarButton(button)
    });
  }

  private attachGeomanApiToViewer(): void {
    const target = this.viewer as Partial<GeomanViewer>;
    const descriptor = Object.getOwnPropertyDescriptor(target, 'pm');
    if (descriptor) {
      const descriptorValue = 'value' in descriptor ? descriptor.value : undefined;
      if (descriptor.configurable === false || (descriptorValue && descriptorValue !== this.pm)) {
        return;
      }
    } else {
      const inheritedPm = target.pm;
      if (inheritedPm && inheritedPm !== this.pm) {
        return;
      }
    }

    this.previousViewerPmDescriptor = descriptor;
    Object.defineProperty(target, 'pm', {
      value: this.pm,
      configurable: true,
      enumerable: false,
      writable: true
    });
    this.attachedViewerPm = true;
  }

  private restoreViewerPm(): void {
    if (!this.attachedViewerPm) {
      return;
    }

    const target = this.viewer as Partial<GeomanViewer>;
    if (this.previousViewerPmDescriptor) {
      Object.defineProperty(target, 'pm', this.previousViewerPmDescriptor);
    } else {
      delete target.pm;
    }
    this.attachedViewerPm = false;
    this.previousViewerPmDescriptor = undefined;
  }

  private createGeomanApi(): GeomanApi {
    return {
      Draw: {
        Marker: this.createGeomanDrawShapeApi('Marker'),
        Line: this.createGeomanDrawShapeApi('Line'),
        Circle: this.createGeomanDrawShapeApi('Circle'),
        Polygon: this.createGeomanDrawShapeApi('Polygon'),
        getShapes: () => getSupportedGeomanShapes(this.options.shapes),
        getActiveShape: () => editorModeToGeomanShape(this.mode)
      },
      enableDraw: (shape, options) => this.enableGeomanDraw(shape, options),
      disableDraw: () => {
        if (this.mode.startsWith('draw:')) {
          this.cancelDrawing();
        }
      },
      globalDrawModeEnabled: () => this.mode.startsWith('draw:'),
      enableGlobalEditMode: (options) => {
        this.applyGeomanEditOptions(options);
        this.enableGeomanGlobalEditMode();
      },
      disableGlobalEditMode: () => this.disableGeomanGlobalEditMode(),
      toggleGlobalEditMode: (options) => {
        if (this.mode === 'edit') {
          this.disableGeomanGlobalEditMode();
        } else {
          this.applyGeomanEditOptions(options);
          this.enableGeomanGlobalEditMode();
        }
      },
      globalEditModeEnabled: () => this.mode === 'edit',
      cancelGlobalEditMode: () => this.cancelGeomanMode('edit'),
      enableGlobalDragMode: (options) => {
        this.applyGeomanDragOptions(options);
        this.enableGeomanGlobalDragMode();
      },
      disableGlobalDragMode: () => this.disableGeomanGlobalDragMode(),
      toggleGlobalDragMode: (options) => {
        if (this.mode === 'drag') {
          this.disableGeomanGlobalDragMode();
        } else {
          this.applyGeomanDragOptions(options);
          this.enableGeomanGlobalDragMode();
        }
      },
      globalDragModeEnabled: () => this.mode === 'drag',
      cancelGlobalDragMode: () => this.cancelGeomanMode('drag'),
      getGeomanLayers: () => this.getAnnotations().map((annotation) => annotation.entity),
      getGeomanDrawLayers: () =>
        this.getAnnotations()
          .filter((annotation) => annotation.source === 'draw')
          .map((annotation) => annotation.entity),
      setPathOptions: (options) => {
        this.options.styles = {
          ...this.options.styles,
          ...options
        };
      },
      addControls: (options) => this.addGeomanControls(options),
      removeControls: () => this.removeGeomanControls(),
      toggleControls: (options) => {
        if (this.toolbar) {
          this.removeGeomanControls();
        } else {
          this.addGeomanControls(options);
        }
      },
      controlsVisible: () => this.toolbar !== null,
      setGlobalOptions: (options) => this.applyGeomanGlobalOptions(options),
      getGlobalOptions: () => ({
        ...this.geomanGlobalOptions,
        minRadiusCircle: this.options.circle.minRadius,
        maxRadiusCircle: this.options.circle.maxRadius,
        resizeableCircle: this.options.circle.resizeable,
        singleSelection: this.options.edit.singleSelection,
        allowVertexInsert: this.options.edit.allowVertexInsert,
        allowVertexDelete: this.options.edit.allowVertexDelete,
        strategy: this.options.drag.strategy,
        snappable: this.options.snapping.enabled,
        snapDistance: this.options.snapping.snapDistance,
        snapVertex: this.options.snapping.snapVertex,
        snapSegment: this.options.snapping.snapSegment
      }),
      applyGlobalOptions: () => this.reapplyGeomanGlobalOptions()
    };
  }

  private createGeomanDrawShapeApi(shape: GeomanShapeName): GeomanApi['Draw']['Marker'] {
    return {
      setOptions: (options) => this.applyGeomanDrawOptions(geomanShapeToAnnotationType(shape), options),
      setStyle: (options) => {
        this.options.styles = {
          ...this.options.styles,
          ...options
        };
      }
    };
  }

  private addGeomanControls(options: ToolbarOptions = {}): void {
    this.assertUsable();
    this.removeGeomanControls();
    this.options.toolbar = options;
    this.toolbar = this.createToolbar();
    this.toolbar?.setMode(this.mode);
  }

  private removeGeomanControls(): void {
    this.toolbar?.destroy();
    this.toolbar = null;
    this.options.toolbar = false;
  }

  private cancelGeomanMode(mode: Extract<EditorMode, 'edit' | 'drag'>): void {
    if (mode === 'edit') {
      this.editController.cancelActiveDrag();
      const changes = this.setAllGeomanLayerStates('editEnabled', false);
      this.emitGeomanLayerStateChanges(changes, 'pm:enable', 'pm:disable');
    } else {
      this.dragController.cancelActiveDrag();
      const changes = this.setAllGeomanLayerStates('dragEnabled', false);
      this.emitGeomanLayerStateChanges(changes, 'pm:dragenable', 'pm:dragdisable');
    }
    if (this.mode === mode) {
      this.clearMode();
    }
    this.events.emit('pm:globalcancel', { mode, reason: 'api' });
  }

  private decorateAnnotation(annotation: Annotation): Annotation {
    this.ensureGeomanLayerState(annotation.id);
    const entity = annotation.entity as GeomanEntity;
    if (!entity.pm) {
      Object.defineProperty(entity, 'pm', {
        value: this.createGeomanLayerApi(annotation),
        configurable: true,
        enumerable: false,
        writable: true
      });
    }
    return annotation;
  }

  private enableGeomanGlobalEditMode(): void {
    this.pendingSingleEditLayerId = null;
    if (this.mode === 'edit') {
      const changes = this.setAllGeomanLayerStates('editEnabled', true);
      this.editController.refreshHandles();
      this.emitGeomanLayerStateChanges(changes, 'pm:enable', 'pm:disable');
      return;
    }
    this.enableEditMode();
  }

  private disableGeomanGlobalEditMode(): void {
    if (this.mode === 'edit') {
      this.disableEditMode();
      return;
    }
    const changes = this.setAllGeomanLayerStates('editEnabled', false);
    this.emitGeomanLayerStateChanges(changes, 'pm:enable', 'pm:disable');
  }

  private enableGeomanGlobalDragMode(): void {
    this.pendingSingleDragLayerId = null;
    if (this.mode === 'drag') {
      const changes = this.setAllGeomanLayerStates('dragEnabled', true);
      this.emitGeomanLayerStateChanges(changes, 'pm:dragenable', 'pm:dragdisable');
      return;
    }
    this.enableDragMode();
  }

  private disableGeomanGlobalDragMode(): void {
    if (this.mode === 'drag') {
      this.disableDragMode();
      return;
    }
    const changes = this.setAllGeomanLayerStates('dragEnabled', false);
    this.emitGeomanLayerStateChanges(changes, 'pm:dragenable', 'pm:dragdisable');
  }

  private enableSingleGeomanEditLayer(annotation: Annotation): void {
    this.select(annotation.id);
    if (this.mode !== 'edit') {
      this.pendingSingleEditLayerId = annotation.id;
      this.enableEditMode();
      this.pendingSingleEditLayerId = null;
      return;
    }

    const changes = this.setOnlyGeomanLayerState(annotation.id, 'editEnabled');
    this.editController.refreshHandles();
    this.emitGeomanLayerStateChanges(changes, 'pm:enable', 'pm:disable');
  }

  private enableSingleGeomanDragLayer(annotation: Annotation): void {
    this.select(annotation.id);
    if (this.mode !== 'drag') {
      this.pendingSingleDragLayerId = annotation.id;
      this.enableDragMode();
      this.pendingSingleDragLayerId = null;
      return;
    }

    const changes = this.setOnlyGeomanLayerState(annotation.id, 'dragEnabled');
    this.emitGeomanLayerStateChanges(changes, 'pm:dragenable', 'pm:dragdisable');
  }

  private ensureGeomanLayerState(id: string): GeomanLayerRuntimeState {
    const existing = this.geomanLayerStates.get(id);
    if (existing) {
      return existing;
    }

    const state: GeomanLayerRuntimeState = {
      editEnabled: false,
      dragEnabled: false
    };
    this.geomanLayerStates.set(id, state);
    return state;
  }

  private setOnlyGeomanLayerState(
    annotationId: string,
    key: keyof GeomanLayerRuntimeState
  ): GeomanLayerStateChanges {
    const changes: GeomanLayerStateChanges = { enabled: [], disabled: [] };
    for (const annotation of this.store.getAll()) {
      const state = this.ensureGeomanLayerState(annotation.id);
      const next = annotation.id === annotationId;
      if (state[key] === next) {
        continue;
      }
      state[key] = next;
      (next ? changes.enabled : changes.disabled).push(annotation);
    }
    return changes;
  }

  private setAllGeomanLayerStates(key: keyof GeomanLayerRuntimeState, enabled: boolean): GeomanLayerStateChanges {
    const changes: GeomanLayerStateChanges = { enabled: [], disabled: [] };
    for (const annotation of this.store.getAll()) {
      const state = this.ensureGeomanLayerState(annotation.id);
      if (state[key] === enabled) {
        continue;
      }
      state[key] = enabled;
      (enabled ? changes.enabled : changes.disabled).push(annotation);
    }
    return changes;
  }

  private setGeomanLayerState(
    annotationId: string,
    key: keyof GeomanLayerRuntimeState,
    enabled: boolean
  ): GeomanLayerStateChanges {
    const annotation = this.store.get(annotationId);
    const state = this.ensureGeomanLayerState(annotationId);
    if (!annotation || state[key] === enabled) {
      return { enabled: [], disabled: [] };
    }

    state[key] = enabled;
    return enabled ? { enabled: [annotation], disabled: [] } : { enabled: [], disabled: [annotation] };
  }

  private hasEnabledGeomanEditLayer(): boolean {
    return this.store.getAll().some((annotation) => this.ensureGeomanLayerState(annotation.id).editEnabled);
  }

  private hasEnabledGeomanDragLayer(): boolean {
    return this.store.getAll().some((annotation) => this.ensureGeomanLayerState(annotation.id).dragEnabled);
  }

  private emitGeomanLayerStateChanges(
    changes: GeomanLayerStateChanges,
    enabledEvent: 'pm:enable' | 'pm:dragenable',
    disabledEvent: 'pm:disable' | 'pm:dragdisable'
  ): void {
    for (const annotation of changes.disabled) {
      this.emitGeomanLayerEvent(disabledEvent, annotation);
    }
    for (const annotation of changes.enabled) {
      this.emitGeomanLayerEvent(enabledEvent, annotation);
    }
  }

  private createGeomanLayerApi(annotation: Annotation): GeomanLayerApi {
    const layerOptions: GeomanEditOptions & GeomanDragOptions = {};
    const wrappedHandlers = new Map<
      GeomanLayerEventName,
      Map<EditorEventHandler<GeomanLayerEventName>, EditorEventHandler<GeomanLayerEventName>>
    >();

    const api: GeomanLayerApi = {
      enable: (options) => {
        Object.assign(layerOptions, options);
        this.applyGeomanEditOptions(options);
        this.enableSingleGeomanEditLayer(annotation);
      },
      disable: () => {
        if (this.getSelected()?.id === annotation.id) {
          this.select(null);
        }
        const changes = this.setGeomanLayerState(annotation.id, 'editEnabled', false);
        this.emitGeomanLayerStateChanges(changes, 'pm:enable', 'pm:disable');
        if (!this.hasEnabledGeomanEditLayer() && this.mode === 'edit') {
          this.disableEditMode();
        } else {
          this.editController.refreshHandles();
        }
      },
      toggleEdit: (options) => {
        if (api.enabled()) {
          api.disable();
        } else {
          api.enable(options);
        }
      },
      enabled: () => this.ensureGeomanLayerState(annotation.id).editEnabled,
      hasSelfIntersection: () => hasSelfIntersection(annotation),
      remove: () => this.removeAnnotation(annotation.id),
      getShape: () => annotationTypeToGeomanShape(annotation.type),
      setOptions: (options) => {
        Object.assign(layerOptions, options);
        this.applyGeomanEditOptions(options);
        this.applyGeomanDragOptions(options);
      },
      getOptions: () => ({ ...layerOptions }),
      enableLayerDrag: (options) => {
        Object.assign(layerOptions, options);
        this.applyGeomanDragOptions(options);
        this.enableSingleGeomanDragLayer(annotation);
      },
      disableLayerDrag: () => {
        const changes = this.setGeomanLayerState(annotation.id, 'dragEnabled', false);
        this.emitGeomanLayerStateChanges(changes, 'pm:dragenable', 'pm:dragdisable');
        if (!this.hasEnabledGeomanDragLayer() && this.mode === 'drag') {
          this.disableDragMode();
        }
      },
      layerDragEnabled: () => this.ensureGeomanLayerState(annotation.id).dragEnabled,
      dragging: () => this.dragController.isDragging(annotation.id),
      cancel: () => {
        this.editController.cancelActiveDrag(annotation.id);
        this.dragController.cancelActiveDrag(annotation.id);
        this.events.emit('pm:cancel', {
          ...annotationToGeomanLayer(annotation),
          mode: this.mode,
          reason: 'api'
        });
      },
      getAnnotation: () => annotation,
      on: (name, handler) => {
        const wrapped: EditorEventHandler<typeof name> = (event) => {
          if (this.isGeomanLayerEventForAnnotation(event, annotation)) {
            handler(event);
          }
        };
        const byEvent = wrappedHandlers.get(name) ?? new Map();
        byEvent.set(handler as EditorEventHandler<GeomanLayerEventName>, wrapped as EditorEventHandler<GeomanLayerEventName>);
        wrappedHandlers.set(name, byEvent);
        return this.events.on(name, wrapped);
      },
      off: (name, handler) => {
        const wrapped = wrappedHandlers
          .get(name)
          ?.get(handler as EditorEventHandler<GeomanLayerEventName>) as EditorEventHandler<typeof name> | undefined;
        if (!wrapped) {
          return;
        }
        this.events.off(name, wrapped);
        wrappedHandlers.get(name)?.delete(handler as EditorEventHandler<GeomanLayerEventName>);
      },
      once: (name, handler) => {
        let unsubscribe: () => void = () => undefined;
        const onceHandler: EditorEventHandler<typeof name> = (event) => {
          unsubscribe();
          handler(event);
        };
        unsubscribe = api.on(name, onceHandler);
        return unsubscribe;
      }
    };

    return api;
  }

  private isGeomanLayerEventForAnnotation(event: unknown, annotation: Annotation): boolean {
    const payload = event as { annotation?: Annotation; layer?: unknown };
    return payload.annotation?.id === annotation.id || payload.layer === annotation.entity;
  }

  private emitGeomanLayerEvent(name: 'pm:enable' | 'pm:disable' | 'pm:dragenable' | 'pm:dragdisable', annotation: Annotation): void {
    this.events.emit(name, annotationToGeomanLayer(annotation));
  }

  private enableGeomanDraw(shape: GeomanShapeInput, options?: GeomanDrawOptions): void {
    const type = geomanShapeToAnnotationType(shape);
    this.applyGeomanDrawOptions(type, options);
    this.enableDraw(type);
  }

  private applyGeomanGlobalOptions(options: GeomanGlobalOptions): void {
    this.geomanGlobalOptions = {
      ...this.geomanGlobalOptions,
      ...options
    };
    this.applyGeomanOptionsToRuntime(options);
    this.events.emit('pm:globaloptionschanged', { options: { ...options } });
  }

  private reapplyGeomanGlobalOptions(): void {
    this.applyGeomanOptionsToRuntime(this.geomanGlobalOptions);
    this.events.emit('pm:globaloptionschanged', { options: { ...this.geomanGlobalOptions } });
  }

  private applyGeomanOptionsToRuntime(options: GeomanGlobalOptions): void {
    const continueDrawing = options.continueDrawing;
    if (continueDrawing != null) {
      for (const shape of this.options.shapes) {
        this.options.continueDrawing[shape] = continueDrawing;
      }
    }
    this.applyGeomanDrawOptions('circle', options);
    this.applyGeomanEditOptions(options);
    this.applyGeomanDragOptions(options);
    this.applyGeomanSnapOptions(options);
  }

  private applyGeomanDrawOptions(type: AnnotationType, options?: GeomanDrawOptions): void {
    if (!options) {
      return;
    }
    if (options.continueDrawing != null) {
      this.options.continueDrawing[type] = options.continueDrawing;
    }
    if (type === 'circle') {
      if (options.minRadiusCircle != null) {
        this.options.circle.minRadius = options.minRadiusCircle;
      }
      if (options.maxRadiusCircle !== undefined) {
        this.options.circle.maxRadius = options.maxRadiusCircle;
      }
      if (options.resizeableCircle != null) {
        this.options.circle.resizeable = options.resizeableCircle;
      }
    }
    this.applyGeomanSnapOptions(options);
  }

  private applyGeomanEditOptions(options?: GeomanEditOptions): void {
    if (!options) {
      return;
    }
    if (options.singleSelection != null) {
      this.options.edit.singleSelection = options.singleSelection;
    }
    if (options.allowVertexInsert != null) {
      this.options.edit.allowVertexInsert = options.allowVertexInsert;
    }
    if (options.allowVertexDelete != null) {
      this.options.edit.allowVertexDelete = options.allowVertexDelete;
    }
    this.applyGeomanSnapOptions(options);
  }

  private applyGeomanDragOptions(options?: GeomanDragOptions): void {
    if (!options) {
      return;
    }
    if (options.strategy) {
      this.options.drag.strategy = options.strategy;
    }
  }

  private applyGeomanSnapOptions(options?: GeomanDrawOptions | GeomanEditOptions | GeomanGlobalOptions): void {
    if (!options) {
      return;
    }
    if (options.snappable != null) {
      this.options.snapping.enabled = options.snappable;
    }
    if (options.snapDistance != null) {
      this.options.snapping.snapDistance = options.snapDistance;
    }
    if (options.snapVertex != null) {
      this.options.snapping.snapVertex = options.snapVertex;
    }
    if (options.snapSegment != null) {
      this.options.snapping.snapSegment = options.snapSegment;
    }
    if (options.snapMiddle != null) {
      this.options.snapping.snapSegment = options.snapMiddle || this.options.snapping.snapSegment;
    }
  }

  private handleToolbarButton(button: ToolbarButtonName): void {
    if (this.destroyed) {
      return;
    }

    this.events.emit('buttonclick', { button, mode: this.mode });
    if (button === 'finish') {
      this.finishDrawing();
      return;
    }
    if (button === 'cancel') {
      this.cancelDrawing();
      return;
    }
    if (button === 'removeLastVertex') {
      this.removeLastVertex();
      return;
    }

    const targetMode = toolbarButtonMode(button);
    if (!targetMode) {
      return;
    }
    if (this.mode === targetMode) {
      this.clearMode();
    } else {
      this.setMode(targetMode);
    }
  }

  private enterMode(mode: EditorMode): void {
    if (mode.startsWith('draw:')) {
      const type = mode.slice(5) as AnnotationType;
      if (!this.options.shapes.includes(type)) {
        throw new Error(`Shape is not enabled: ${type}`);
      }
      this.drawController.activate(type);
    } else if (mode === 'edit') {
      this.editController.activate();
      const changes = this.pendingSingleEditLayerId
        ? this.setOnlyGeomanLayerState(this.pendingSingleEditLayerId, 'editEnabled')
        : this.setAllGeomanLayerStates('editEnabled', true);
      this.emitGeomanLayerStateChanges(changes, 'pm:enable', 'pm:disable');
    } else if (mode === 'drag') {
      this.editController.deactivate(true);
      this.dragController.activate();
      const changes = this.pendingSingleDragLayerId
        ? this.setOnlyGeomanLayerState(this.pendingSingleDragLayerId, 'dragEnabled')
        : this.setAllGeomanLayerStates('dragEnabled', true);
      this.emitGeomanLayerStateChanges(changes, 'pm:dragenable', 'pm:dragdisable');
    }
  }

  private leaveMode(mode: EditorMode, reason: 'modechange' | 'destroy'): void {
    if (mode.startsWith('draw:')) {
      this.drawController.deactivate(reason, true);
    } else if (mode === 'edit') {
      this.editController.deactivate(true);
      const changes = this.setAllGeomanLayerStates('editEnabled', false);
      this.emitGeomanLayerStateChanges(changes, 'pm:enable', 'pm:disable');
    } else if (mode === 'drag') {
      this.dragController.deactivate();
      const changes = this.setAllGeomanLayerStates('dragEnabled', false);
      this.emitGeomanLayerStateChanges(changes, 'pm:dragenable', 'pm:dragdisable');
    }
    this.cameraGuard.forceUnlock();
  }

  private assertMode(mode: EditorMode): void {
    if (!modes.includes(mode)) {
      throw new Error(`Unknown editor mode: ${mode}`);
    }
  }

  private assertUsable(): void {
    if (this.destroyed) {
      throw new Error('CesiumAnnotationEditor has been destroyed.');
    }
  }
}

function toolbarButtonMode(button: ToolbarButtonName): EditorMode | null {
  switch (button) {
    case 'drawPoint':
      return 'draw:point';
    case 'drawPolyline':
      return 'draw:polyline';
    case 'drawCircle':
      return 'draw:circle';
    case 'drawPolygon':
      return 'draw:polygon';
    case 'editMode':
      return 'edit';
    case 'dragMode':
      return 'drag';
    default:
      return null;
  }
}

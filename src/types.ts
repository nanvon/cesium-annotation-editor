import type { Cartesian3, Entity, Viewer } from 'cesium';

export type AnnotationType = 'point' | 'polyline' | 'circle' | 'polygon';

export type GeomanShapeName = 'Marker' | 'Line' | 'Circle' | 'Polygon';

export type GeomanShapeInput =
  | GeomanShapeName
  | AnnotationType
  | 'marker'
  | 'line'
  | 'polyline'
  | 'circle'
  | 'polygon';

export type EditorMode =
  | 'idle'
  | 'draw:point'
  | 'draw:polyline'
  | 'draw:circle'
  | 'draw:polygon'
  | 'edit'
  | 'drag';

export type LngLatHeight = [longitude: number, latitude: number, height?: number];

export interface AnnotationStyle {
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
  workingColor?: string;
}

export interface AnnotationStyleOptions extends AnnotationStyle {}

export interface ToolbarOptions {
  container?: HTMLElement;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  buttons?: ToolbarButtonName[];
  labels?: Partial<Record<ToolbarButtonName, string>>;
}

export type ToolbarButtonName =
  | 'drawPoint'
  | 'drawPolyline'
  | 'drawCircle'
  | 'drawPolygon'
  | 'editMode'
  | 'dragMode'
  | 'finish'
  | 'cancel'
  | 'removeLastVertex';

export interface CesiumAnnotationEditorOptions {
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

export interface SnappingOptions {
  enabled?: boolean;
  snapDistance?: number;
  snapVertex?: boolean;
  snapSegment?: boolean;
  disableWithAlt?: boolean;
}

export interface GeomanDrawOptions {
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

export interface GeomanEditOptions {
  singleSelection?: boolean;
  allowVertexInsert?: boolean;
  allowVertexDelete?: boolean;
  snappable?: boolean;
  snapDistance?: number;
  snapVertex?: boolean;
  snapSegment?: boolean;
  snapMiddle?: boolean;
}

export interface GeomanDragOptions {
  strategy?: 'cartographic-delta' | 'enu';
}

export type GeomanGlobalOptions = GeomanDrawOptions & GeomanEditOptions & GeomanDragOptions;

export interface GeomanDrawShapeApi {
  setOptions(options: GeomanDrawOptions): void;
  setStyle(options: AnnotationStyleOptions): void;
}

export type GeomanLayerEventName =
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

export type GeomanEntity = Entity & { pm: GeomanLayerApi };

export type GeomanViewer = Viewer & { pm: GeomanApi };

export interface GeomanLayerApi {
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

export interface GeomanDrawApi {
  Marker: GeomanDrawShapeApi;
  Line: GeomanDrawShapeApi;
  Circle: GeomanDrawShapeApi;
  Polygon: GeomanDrawShapeApi;
  getShapes(): GeomanShapeName[];
  getActiveShape(): GeomanShapeName | null;
}

export interface GeomanApi {
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

export interface NormalizedOptions {
  toolbar: boolean | ToolbarOptions;
  shapes: AnnotationType[];
  clampToGround: boolean;
  heightMode: 'terrain' | 'ellipsoid' | 'absolute';
  continueDrawing: Partial<Record<AnnotationType, boolean>>;
  circle: {
    resizeable: boolean;
    minRadius: number;
    maxRadius?: number;
  };
  edit: {
    singleSelection: boolean;
    allowVertexInsert: boolean;
    allowVertexDelete: boolean;
  };
  drag: {
    strategy: 'cartographic-delta' | 'enu';
  };
  snapping: Required<SnappingOptions>;
  styles: Required<AnnotationStyle>;
  destroyBehavior: 'remove-all' | 'keep-annotations';
}

export interface BaseAnnotation {
  id: string;
  type: AnnotationType;
  entity: GeomanEntity;
  source: 'draw' | 'api';
  style?: AnnotationStyle;
  properties?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface PointAnnotation extends BaseAnnotation {
  type: 'point';
  position: Cartesian3;
}

export interface PolylineAnnotation extends BaseAnnotation {
  type: 'polyline';
  positions: Cartesian3[];
}

export interface PolygonAnnotation extends BaseAnnotation {
  type: 'polygon';
  positions: Cartesian3[];
}

export interface CircleAnnotation extends BaseAnnotation {
  type: 'circle';
  center: Cartesian3;
  radius: number;
}

export type Annotation =
  | PointAnnotation
  | PolylineAnnotation
  | PolygonAnnotation
  | CircleAnnotation;

export type AnnotationInput =
  | {
      id?: string;
      type: 'point';
      position: Cartesian3;
      style?: AnnotationStyle;
      properties?: Record<string, unknown>;
    }
  | {
      id?: string;
      type: 'polyline';
      positions: Cartesian3[];
      style?: AnnotationStyle;
      properties?: Record<string, unknown>;
    }
  | {
      id?: string;
      type: 'polygon';
      positions: Cartesian3[];
      style?: AnnotationStyle;
      properties?: Record<string, unknown>;
    }
  | {
      id?: string;
      type: 'circle';
      center: Cartesian3;
      radius: number;
      style?: AnnotationStyle;
      properties?: Record<string, unknown>;
    };

export type AnnotationPatch =
  | Partial<Pick<PointAnnotation, 'position' | 'style' | 'properties'>>
  | Partial<Pick<PolylineAnnotation, 'positions' | 'style' | 'properties'>>
  | Partial<Pick<PolygonAnnotation, 'positions' | 'style' | 'properties'>>
  | Partial<Pick<CircleAnnotation, 'center' | 'radius' | 'style' | 'properties'>>;

export type AnnotationJSON =
  | {
      id: string;
      type: 'point';
      position: LngLatHeight;
      style?: AnnotationStyle;
      properties?: Record<string, unknown>;
    }
  | {
      id: string;
      type: 'polyline';
      positions: LngLatHeight[];
      style?: AnnotationStyle;
      properties?: Record<string, unknown>;
    }
  | {
      id: string;
      type: 'polygon';
      positions: LngLatHeight[];
      style?: AnnotationStyle;
      properties?: Record<string, unknown>;
    }
  | {
      id: string;
      type: 'circle';
      center: LngLatHeight;
      radius: number;
      style?: AnnotationStyle;
      properties?: Record<string, unknown>;
    };

export type AnnotationGeoJSONGeometry =
  | {
      type: 'Point';
      coordinates: LngLatHeight;
    }
  | {
      type: 'LineString';
      coordinates: LngLatHeight[];
    }
  | {
      type: 'Polygon';
      coordinates: LngLatHeight[][];
    };

export interface AnnotationGeoJSONMetadata {
  type: AnnotationType;
  radius?: number;
  style?: AnnotationStyle;
  properties?: Record<string, unknown>;
}

export interface AnnotationGeoJSONProperties extends Record<string, unknown> {
  cesiumAnnotationEditor?: AnnotationGeoJSONMetadata;
}

export interface AnnotationGeoJSONFeature {
  type: 'Feature';
  id?: string | number;
  geometry: AnnotationGeoJSONGeometry;
  properties: AnnotationGeoJSONProperties | null;
}

export interface AnnotationGeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: AnnotationGeoJSONFeature[];
}

export type CoreEditorEventName =
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

export type GeomanEventName =
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

export type EditorEventName = CoreEditorEventName | GeomanEventName;

export interface ButtonClickEvent {
  button: ToolbarButtonName;
  mode: EditorMode;
}

export interface ModeChangeEvent {
  previousMode: EditorMode;
  mode: EditorMode;
}

export interface DrawEvent {
  mode: EditorMode;
  type?: AnnotationType;
}

export interface CreateEvent {
  annotation: Annotation;
  source: 'draw';
}

export interface AddEvent {
  annotation: Annotation;
  source: 'api';
}

export interface SelectEvent {
  annotation: Annotation | null;
  previous: Annotation | null;
}

export interface UpdateEvent {
  annotation: Annotation;
  reason: 'vertex' | 'drag' | 'radius' | 'center' | 'api';
}

export interface ChangeEvent {
  annotation?: Annotation;
  source: 'draw' | 'api' | 'edit' | 'drag' | 'clear' | 'remove';
}

export interface VertexDragEvent {
  annotation: Annotation;
  vertexIndex?: number;
  handleType: 'vertex' | 'center' | 'radius' | 'point';
  position: Cartesian3;
}

export interface DragEvent {
  annotation: Annotation;
  startPosition?: Cartesian3;
  currentPosition?: Cartesian3;
}

export interface CancelEvent {
  mode: EditorMode;
  reason: 'toolbar' | 'escape' | 'api' | 'modechange' | 'destroy';
}

export interface EditorErrorEvent {
  code: string;
  message: string;
  cause?: unknown;
}

export interface GeomanModeToggleEvent {
  enabled: boolean;
  shape?: GeomanShapeName;
  mode: EditorMode;
  previousMode?: EditorMode;
}

export interface GeomanButtonClickEvent {
  btnName: ToolbarButtonName;
  button: ToolbarButtonName;
  mode: EditorMode;
}

export interface GeomanGlobalOptionsChangedEvent {
  options: GeomanGlobalOptions;
}

export interface GeomanDrawEvent extends DrawEvent {
  shape?: GeomanShapeName;
}

export interface GeomanLayerEvent {
  annotation: Annotation;
  layer: GeomanEntity;
  shape: GeomanShapeName;
}

export interface GeomanCreateEvent extends GeomanLayerEvent {
  source: 'draw';
}

export interface GeomanUpdateEvent extends GeomanLayerEvent {
  reason: UpdateEvent['reason'];
}

export interface GeomanChangeEvent {
  annotation?: Annotation;
  layer?: GeomanEntity;
  shape?: GeomanShapeName;
  source: ChangeEvent['source'];
}

export interface GeomanMarkerDragEvent extends GeomanLayerEvent {
  vertexIndex?: number;
  indexPath?: number[];
  handleType: VertexDragEvent['handleType'];
  position: Cartesian3;
}

export interface GeomanVertexAddedEvent {
  shape: GeomanShapeName;
  workingLayer?: Entity;
  marker?: Entity;
  position: Cartesian3;
  vertexIndex: number;
}

export interface GeomanCenterPlacedEvent {
  shape: GeomanShapeName;
  position: Cartesian3;
  workingLayer?: Entity;
  marker?: Entity;
  annotation?: Annotation;
  layer?: GeomanEntity;
  vertexIndex?: number;
  indexPath?: number[];
  handleType?: VertexDragEvent['handleType'];
}

export interface GeomanSnapEvent {
  shape?: GeomanShapeName;
  annotation?: Annotation;
  layer?: GeomanEntity;
  workingLayer?: Entity;
  marker?: Entity;
  snapTargetType: 'vertex' | 'segment';
  snapPosition: Cartesian3;
  snapLatLng: Cartesian3;
  distance: number;
  layerInteractedWith?: GeomanEntity;
  annotationInteractedWith?: Annotation;
  segment?: [Cartesian3, Cartesian3];
  vertexIndex?: number;
}

export interface GeomanDragEvent extends GeomanLayerEvent {
  startPosition?: Cartesian3;
  currentPosition?: Cartesian3;
}

export interface GeomanCancelEvent {
  mode: EditorMode;
  reason: CancelEvent['reason'];
  shape?: GeomanShapeName;
  annotation?: Annotation;
  layer?: GeomanEntity;
}

export interface GeomanErrorEvent {
  source: string;
  message: string;
  payload?: unknown;
  code?: string;
  cause?: unknown;
}

export interface CoreEditorEventMap {
  buttonclick: ButtonClickEvent;
  modechange: ModeChangeEvent;
  drawstart: DrawEvent;
  drawend: DrawEvent;
  create: CreateEvent;
  add: AddEvent;
  select: SelectEvent;
  update: UpdateEvent;
  change: ChangeEvent;
  vertexdragstart: VertexDragEvent;
  vertexdrag: VertexDragEvent;
  vertexdragend: VertexDragEvent;
  dragstart: DragEvent;
  drag: DragEvent;
  dragend: DragEvent;
  cancel: CancelEvent;
  error: EditorErrorEvent;
}

export interface GeomanEventMap {
  'pm:buttonclick': GeomanButtonClickEvent;
  'pm:actionclick': GeomanButtonClickEvent;
  'pm:globaldrawmodetoggled': GeomanModeToggleEvent;
  'pm:globaleditmodetoggled': GeomanModeToggleEvent;
  'pm:globaldragmodetoggled': GeomanModeToggleEvent;
  'pm:globaloptionschanged': GeomanGlobalOptionsChangedEvent;
  'pm:drawstart': GeomanDrawEvent;
  'pm:drawend': GeomanDrawEvent;
  'pm:create': GeomanCreateEvent;
  'pm:enable': GeomanLayerEvent;
  'pm:disable': GeomanLayerEvent;
  'pm:edit': GeomanUpdateEvent;
  'pm:update': GeomanUpdateEvent;
  'pm:change': GeomanChangeEvent;
  'pm:markerdragstart': GeomanMarkerDragEvent;
  'pm:markerdrag': GeomanMarkerDragEvent;
  'pm:markerdragend': GeomanMarkerDragEvent;
  'pm:vertexadded': GeomanVertexAddedEvent;
  'pm:centerplaced': GeomanCenterPlacedEvent;
  'pm:snapdrag': GeomanSnapEvent;
  'pm:snap': GeomanSnapEvent;
  'pm:unsnap': GeomanSnapEvent;
  'pm:dragstart': GeomanDragEvent;
  'pm:drag': GeomanDragEvent;
  'pm:dragend': GeomanDragEvent;
  'pm:dragenable': GeomanLayerEvent;
  'pm:dragdisable': GeomanLayerEvent;
  'pm:cancel': GeomanCancelEvent;
  'pm:globalcancel': GeomanCancelEvent;
  'pm:error': GeomanErrorEvent;
}

export interface EditorEventMap extends CoreEditorEventMap, GeomanEventMap {}

export type EditorEventHandler<T extends EditorEventName> = (event: EditorEventMap[T]) => void;

export type EntityKind = 'annotation' | 'handle' | 'working';

export interface EntityMetadata {
  editorKind: EntityKind;
  annotationId?: string;
  handleType?: 'vertex' | 'center' | 'radius' | 'point';
  vertexIndex?: number;
}

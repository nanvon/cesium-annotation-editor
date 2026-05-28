import {
  BillboardGraphics,
  CallbackPositionProperty,
  CallbackProperty,
  Cartesian3,
  ColorMaterialProperty,
  ConstantPositionProperty,
  ConstantProperty,
  EllipseGraphics,
  Entity,
  HeightReference,
  HorizontalOrigin,
  PolygonHierarchy,
  PolygonGraphics,
  PolylineDashMaterialProperty,
  PolylineGraphics,
  VerticalOrigin,
  type Viewer
} from 'cesium';
import leafletMarkerIcon2x from '../assets/images/leaflet-marker/marker-icon-2x.png';
import type { Annotation, AnnotationInput, EntityMetadata, NormalizedOptions } from '../types';
import { toColor } from '../utils/color';
import { circleOutlinePositions, pointEastOf, syncCircleOutlinePositions } from '../utils/circle';
import { EntityMetadataStore } from './EntityMetadataStore';

type EntityOptions = NonNullable<ConstructorParameters<typeof Entity>[0]>;
export interface VersionedValueSource<T> {
  getValue(): T;
  getVersion(): number;
}
type PositionSource = Cartesian3 | (() => Cartesian3) | VersionedValueSource<Cartesian3>;
type PositionsSource = Cartesian3[] | (() => Cartesian3[]) | VersionedValueSource<Cartesian3[]>;
type RadiusSource = number | (() => number) | VersionedValueSource<number>;
type CircleOutlineSource = { center: PositionSource; radius: RadiusSource };

const LEAFLET_MARKER_WIDTH = 25;
const LEAFLET_MARKER_HEIGHT = 41;
const WORKING_POINT_SIZE = 14;
const WORKING_POINT_HOVER_SIZE = 17;
const WORKING_POINT_IMAGE_SIZE = 64;
const WORKING_POINT_RADIUS = 29;
const WORKING_POINT_OUTLINE_WIDTH = 4;
const CIRCLE_OUTLINE_SEGMENTS = 128;
const workingPointImages = new Map<string, string>();

export class EntityFactory {
  private helperEntities = new Set<Entity>();
  private workingEntities = new Set<Entity>();
  private circleOutlineSources = new WeakMap<Entity, CircleOutlineSource>();
  private snapIndicator: Entity | null = null;

  constructor(
    private readonly viewer: Viewer,
    private readonly options: NormalizedOptions,
    private readonly metadataStore: EntityMetadataStore
  ) {}

  createAnnotationEntity(input: AnnotationInput & { id: string }): Entity {
    const entity = this.viewer.entities.add(this.annotationOptions(input));
    if (input.type === 'circle') {
      this.circleOutlineSources.set(entity, { center: input.center, radius: input.radius });
    }
    this.metadataStore.set(entity, { editorKind: 'annotation', annotationId: input.id });
    return entity;
  }

  promoteWorkingEntity(entity: Entity, input: AnnotationInput & { id: string }): void {
    this.workingEntities.delete(entity);
    this.applyAnnotationGraphics(entity, input);
    this.metadataStore.set(entity, { editorKind: 'annotation', annotationId: input.id });
  }

  updateAnnotationEntity(annotation: Annotation): void {
    switch (annotation.type) {
      case 'point':
        this.updatePointPosition(annotation.entity, annotation.position);
        break;
      case 'polyline':
        if (annotation.entity.polyline) {
          annotation.entity.polyline.positions = this.constantProperty(
            annotation.entity.polyline.positions,
            annotation.positions.slice()
          ) as never;
        }
        break;
      case 'polygon':
        this.updatePolygon(annotation.entity, annotation.positions);
        break;
      case 'circle':
        this.updateCircle(annotation.entity, annotation.center, annotation.radius);
        break;
    }
  }

  createHandle(position: Cartesian3, metadata: EntityMetadata): Entity {
    const entity = this.viewer.entities.add({
      position,
      point: {
        pixelSize: 13,
        color: toColor(this.options.styles.handleColor),
        outlineColor: toColor(this.options.styles.handleOutlineColor),
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: this.heightReference()
      }
    });
    this.helperEntities.add(entity);
    this.metadataStore.set(entity, { ...metadata, editorKind: 'handle' });
    return entity;
  }

  createWorkingPoint(position: Cartesian3): Entity {
    return this.createWorkingEntity(this.workingPointOptions(position));
  }

  createPointCursor(position: Cartesian3): Entity {
    return this.createWorkingEntity(this.pointMarkerOptions(position));
  }

  showSnapIndicator(position: Cartesian3): void {
    if (!this.options.snapping.showIndicator) {
      this.hideSnapIndicator();
      return;
    }

    if (!this.snapIndicator) {
      this.snapIndicator = this.viewer.entities.add({
        position,
        point: {
          pixelSize: this.options.styles.snapPixelSize,
          color: toColor(this.options.styles.snapColor),
          outlineColor: toColor(this.options.styles.snapOutlineColor),
          outlineWidth: 3,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: this.heightReference()
        }
      });
      return;
    }

    this.updatePointPosition(this.snapIndicator, position);
  }

  hideSnapIndicator(): void {
    if (!this.snapIndicator) {
      return;
    }

    this.viewer.entities.remove(this.snapIndicator);
    this.metadataStore.delete(this.snapIndicator);
    this.snapIndicator = null;
  }

  createWorkingPolyline(positions: Cartesian3[]): Entity {
    return this.createWorkingEntity({
      polyline: {
        positions,
        width: this.options.styles.lineWidth,
        material: toColor(this.options.styles.workingColor),
        clampToGround: this.options.clampToGround
      }
    });
  }

  createWorkingHintLine(positions: Cartesian3[]): Entity {
    return this.createWorkingEntity({
      polyline: {
        positions,
        width: this.options.styles.lineWidth,
        material: new PolylineDashMaterialProperty({
          color: toColor(this.options.styles.workingColor),
          dashLength: 10,
          dashPattern: 255
        }),
        clampToGround: this.options.clampToGround
      }
    });
  }

  updateWorkingHintLine(entity: Entity, positions: Cartesian3[]): void {
    this.updatePolyline(entity, positions);
  }

  createWorkingPolygon(positions: Cartesian3[]): Entity {
    return this.createWorkingEntity({
      polygon: {
        hierarchy: new PolygonHierarchy(positions),
        material: new ColorMaterialProperty(toColor(this.options.styles.fillColor)),
        outline: true,
        outlineColor: toColor(this.options.styles.workingColor),
        heightReference: this.heightReference()
      },
      polyline: {
        positions: positions.length ? [...positions, positions[0]] : [],
        width: this.options.styles.outlineWidth,
        material: toColor(this.options.styles.workingColor),
        clampToGround: this.options.clampToGround
      }
    });
  }

  createWorkingCircle(center: Cartesian3, radius: RadiusSource): Entity {
    const radiusProperty = this.radiusProperty(radius);
    const entity = this.createWorkingEntity({
      position: center,
      ellipse: {
        semiMajorAxis: radiusProperty,
        semiMinorAxis: radiusProperty,
        fill: true,
        material: new ColorMaterialProperty(toColor(this.options.styles.fillColor)),
        outline: false,
        heightReference: this.heightReference()
      },
      polyline: {
        positions: this.circleOutlinePositionsProperty(center, radius),
        width: this.options.styles.outlineWidth,
        material: toColor(this.options.styles.workingColor),
        clampToGround: this.options.clampToGround
      }
    });
    this.circleOutlineSources.set(entity, { center, radius });
    return entity;
  }

  setCircleRadiusSource(entity: Entity, radius: RadiusSource): void {
    if (!entity.ellipse) {
      return;
    }

    const radiusProperty = this.radiusProperty(radius);
    entity.ellipse.semiMajorAxis = radiusProperty as never;
    entity.ellipse.semiMinorAxis = radiusProperty as never;
    const source = this.circleOutlineSources.get(entity);
    if (source) {
      source.radius = radius;
      this.setCircleOutlinePositionsSource(entity, source.center, source.radius);
    }
  }

  setPositionSource(entity: Entity, position: PositionSource): void {
    if (isVersionedValueSource<Cartesian3>(position)) {
      entity.position = this.dynamicPositionProperty(position);
    } else if (typeof position === 'function') {
      entity.position = new CallbackPositionProperty((_time, result) => Cartesian3.clone(position(), result), false);
    } else {
      this.updatePointPosition(entity, position);
    }

    const source = this.circleOutlineSources.get(entity);
    if (source) {
      source.center = position;
      this.setCircleOutlinePositionsSource(entity, source.center, source.radius);
    }
  }

  setPolylinePositionsSource(entity: Entity, positions: PositionsSource): void {
    if (!entity.polyline) {
      return;
    }

    entity.polyline.positions = this.positionsProperty(entity.polyline.positions, positions) as never;
  }

  setPolygonPositionsSource(entity: Entity, positions: PositionsSource): void {
    if (entity.polygon) {
      entity.polygon.hierarchy = this.polygonHierarchyProperty(entity.polygon.hierarchy, positions) as never;
    }
    if (entity.polyline) {
      entity.polyline.positions = this.polygonOutlinePositionsProperty(entity.polyline.positions, positions) as never;
    }
  }

  updatePolyline(entity: Entity, positions: Cartesian3[]): void {
    if (entity.polyline) {
      entity.polyline.positions = this.constantProperty(entity.polyline.positions, positions.slice()) as never;
    }
  }

  updateWorkingPolygon(entity: Entity, positions: Cartesian3[]): void {
    if (!entity.polygon) {
      entity.polygon = new PolygonGraphics({
        material: new ColorMaterialProperty(toColor(this.options.styles.fillColor)),
        outline: true,
        outlineColor: toColor(this.options.styles.workingColor),
        heightReference: this.heightReference()
      });
    }
    if (!entity.polyline) {
      entity.polyline = new PolylineGraphics({
        width: this.options.styles.outlineWidth,
        material: toColor(this.options.styles.workingColor),
        clampToGround: this.options.clampToGround
      });
    }
    entity.polyline.width = this.constantProperty(entity.polyline.width, this.options.styles.outlineWidth) as never;
    entity.polyline.material = new ColorMaterialProperty(toColor(this.options.styles.workingColor));
    entity.polyline.clampToGround = this.constantProperty(entity.polyline.clampToGround, this.options.clampToGround) as never;
    this.updatePolygon(entity, positions);
  }

  updatePolygon(entity: Entity, positions: Cartesian3[]): void {
    if (entity.polygon) {
      entity.polygon.hierarchy = this.constantProperty(entity.polygon.hierarchy, new PolygonHierarchy(positions.slice())) as never;
    }
    if (entity.polyline) {
      entity.polyline.positions = this.constantProperty(
        entity.polyline.positions,
        positions.length ? [...positions, positions[0]] : []
      ) as never;
    }
  }

  updateCircle(entity: Entity, center: Cartesian3, radius: number): void {
    this.updatePointPosition(entity, center);
    if (entity.ellipse) {
      entity.ellipse.semiMajorAxis = this.constantProperty(entity.ellipse.semiMajorAxis, radius) as never;
      entity.ellipse.semiMinorAxis = this.constantProperty(entity.ellipse.semiMinorAxis, radius) as never;
    }
    this.circleOutlineSources.set(entity, { center, radius });
    this.setCircleOutlinePositionsSource(entity, center, radius);
  }

  updatePointPosition(entity: Entity, position: Cartesian3): void {
    if (entity.position instanceof ConstantPositionProperty) {
      entity.position.setValue(position);
    } else {
      entity.position = new ConstantPositionProperty(position);
    }
  }

  setHandleHover(entity: Entity, hovered: boolean): void {
    const metadata = this.metadataStore.get(entity);
    if (metadata?.editorKind === 'working' && entity.billboard) {
      const size = hovered ? WORKING_POINT_HOVER_SIZE : WORKING_POINT_SIZE;
      entity.billboard.width = this.constantProperty(entity.billboard.width, size) as never;
      entity.billboard.height = this.constantProperty(entity.billboard.height, size) as never;
      return;
    }

    if (!entity.point) {
      return;
    }
    const baseSize = metadata?.editorKind === 'working' ? 8 : 13;
    const baseOutlineWidth = metadata?.editorKind === 'working' ? 2 : 3;
    entity.point.pixelSize = this.constantProperty(entity.point.pixelSize, hovered ? baseSize + 3 : baseSize) as never;
    entity.point.outlineWidth = this.constantProperty(
      entity.point.outlineWidth,
      hovered ? baseOutlineWidth + 1 : baseOutlineWidth
    ) as never;
  }

  removeHelperEntities(): void {
    this.hideSnapIndicator();
    for (const entity of this.helperEntities) {
      this.viewer.entities.remove(entity);
      this.metadataStore.delete(entity);
    }
    this.helperEntities.clear();
  }

  removeWorkingEntities(): void {
    this.hideSnapIndicator();
    for (const entity of this.workingEntities) {
      this.viewer.entities.remove(entity);
      this.metadataStore.delete(entity);
    }
    this.workingEntities.clear();
  }

  removeWorkingEntity(entity: Entity): void {
    this.workingEntities.delete(entity);
    this.viewer.entities.remove(entity);
    this.metadataStore.delete(entity);
  }

  clearWorkingHintLine(entity: Entity): void {
    this.removeWorkingEntity(entity);
  }

  getCircleRadiusHandlePosition(annotation: Extract<Annotation, { type: 'circle' }>): Cartesian3 {
    return pointEastOf(annotation.center, annotation.radius);
  }

  private annotationOptions(input: AnnotationInput & { id: string }): EntityOptions {
    switch (input.type) {
      case 'point':
        return this.pointMarkerOptions(input.position);
      case 'polyline':
        return {
          polyline: {
            positions: input.positions,
            width: input.style?.lineWidth ?? this.options.styles.lineWidth,
            material: toColor(input.style?.lineColor ?? this.options.styles.lineColor),
            clampToGround: this.options.clampToGround
          }
        };
      case 'polygon':
        return {
          polygon: {
            hierarchy: new PolygonHierarchy(input.positions),
            material: new ColorMaterialProperty(toColor(input.style?.fillColor ?? this.options.styles.fillColor)),
            outline: true,
            outlineColor: toColor(input.style?.outlineColor ?? this.options.styles.outlineColor),
            heightReference: this.heightReference()
          },
          polyline: {
            positions: input.positions.length ? [...input.positions, input.positions[0]] : [],
            width: input.style?.outlineWidth ?? this.options.styles.outlineWidth,
            material: toColor(input.style?.outlineColor ?? this.options.styles.outlineColor),
            clampToGround: this.options.clampToGround
          }
        };
      case 'circle':
        return {
          position: input.center,
          ellipse: {
            semiMajorAxis: input.radius,
            semiMinorAxis: input.radius,
            fill: true,
            material: new ColorMaterialProperty(toColor(input.style?.fillColor ?? this.options.styles.fillColor)),
            outline: false,
            heightReference: this.heightReference()
          },
          polyline: {
            positions: circleOutlinePositions(input.center, input.radius, CIRCLE_OUTLINE_SEGMENTS),
            width: input.style?.outlineWidth ?? this.options.styles.outlineWidth,
            material: toColor(input.style?.outlineColor ?? this.options.styles.outlineColor),
            clampToGround: this.options.clampToGround
          }
        };
    }
  }

  private applyAnnotationGraphics(entity: Entity, input: AnnotationInput & { id: string }): void {
    switch (input.type) {
      case 'point':
        entity.point = undefined;
        entity.polyline = undefined;
        entity.polygon = undefined;
        entity.ellipse = undefined;
        this.updatePointPosition(entity, input.position);
        if (!entity.billboard) {
          entity.billboard = new BillboardGraphics();
        }
        this.applyPointMarkerBillboard(entity.billboard);
        break;
      case 'polyline':
        entity.billboard = undefined;
        entity.point = undefined;
        entity.polygon = undefined;
        entity.ellipse = undefined;
        entity.position = undefined;
        if (!entity.polyline) {
          entity.polyline = new PolylineGraphics();
        }
        entity.polyline.positions = this.constantProperty(entity.polyline.positions, input.positions.slice()) as never;
        entity.polyline.width = this.constantProperty(
          entity.polyline.width,
          input.style?.lineWidth ?? this.options.styles.lineWidth
        ) as never;
        entity.polyline.material = new ColorMaterialProperty(toColor(input.style?.lineColor ?? this.options.styles.lineColor));
        entity.polyline.clampToGround = this.constantProperty(entity.polyline.clampToGround, this.options.clampToGround) as never;
        break;
      case 'polygon':
        entity.billboard = undefined;
        entity.point = undefined;
        entity.ellipse = undefined;
        entity.position = undefined;
        if (!entity.polygon) {
          entity.polygon = new PolygonGraphics();
        }
        entity.polygon.hierarchy = this.constantProperty(
          entity.polygon.hierarchy,
          new PolygonHierarchy(input.positions.slice())
        ) as never;
        entity.polygon.material = new ColorMaterialProperty(toColor(input.style?.fillColor ?? this.options.styles.fillColor));
        entity.polygon.outline = this.constantProperty(entity.polygon.outline, true) as never;
        entity.polygon.outlineColor = this.constantProperty(
          entity.polygon.outlineColor,
          toColor(input.style?.outlineColor ?? this.options.styles.outlineColor)
        ) as never;
        entity.polygon.heightReference = this.heightReferenceProperty();
        if (!entity.polyline) {
          entity.polyline = new PolylineGraphics();
        }
        entity.polyline.width = this.constantProperty(
          entity.polyline.width,
          input.style?.outlineWidth ?? this.options.styles.outlineWidth
        ) as never;
        entity.polyline.material = new ColorMaterialProperty(toColor(input.style?.outlineColor ?? this.options.styles.outlineColor));
        entity.polyline.clampToGround = this.constantProperty(entity.polyline.clampToGround, this.options.clampToGround) as never;
        this.updatePolygon(entity, input.positions);
        break;
      case 'circle':
        entity.billboard = undefined;
        entity.point = undefined;
        entity.polygon = undefined;
        this.updatePointPosition(entity, input.center);
        if (!entity.ellipse) {
          entity.ellipse = new EllipseGraphics();
        }
        entity.ellipse.semiMajorAxis = this.constantProperty(entity.ellipse.semiMajorAxis, input.radius) as never;
        entity.ellipse.semiMinorAxis = this.constantProperty(entity.ellipse.semiMinorAxis, input.radius) as never;
        entity.ellipse.fill = this.constantProperty(entity.ellipse.fill, true) as never;
        entity.ellipse.material = new ColorMaterialProperty(toColor(input.style?.fillColor ?? this.options.styles.fillColor));
        entity.ellipse.outline = this.constantProperty(entity.ellipse.outline, false) as never;
        entity.ellipse.heightReference = this.heightReferenceProperty();
        if (!entity.polyline) {
          entity.polyline = new PolylineGraphics();
        }
        entity.polyline.width = this.constantProperty(
          entity.polyline.width,
          input.style?.outlineWidth ?? this.options.styles.outlineWidth
        ) as never;
        entity.polyline.material = new ColorMaterialProperty(toColor(input.style?.outlineColor ?? this.options.styles.outlineColor));
        entity.polyline.clampToGround = this.constantProperty(entity.polyline.clampToGround, this.options.clampToGround) as never;
        this.circleOutlineSources.set(entity, { center: input.center, radius: input.radius });
        this.setCircleOutlinePositionsSource(entity, input.center, input.radius);
        break;
    }
  }

  private createWorkingEntity(options: EntityOptions): Entity {
    const entity = this.viewer.entities.add(options);
    this.workingEntities.add(entity);
    this.metadataStore.set(entity, { editorKind: 'working' });
    return entity;
  }

  private pointMarkerOptions(position: Cartesian3): EntityOptions {
    return {
      position,
      billboard: this.pointMarkerBillboardOptions()
    };
  }

  private workingPointOptions(position: Cartesian3): EntityOptions {
    return {
      position,
      billboard: {
        image: workingPointImage(this.options.styles.workingColor),
        width: WORKING_POINT_SIZE,
        height: WORKING_POINT_SIZE,
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: this.heightReference()
      }
    };
  }

  private pointMarkerBillboardOptions(): BillboardGraphics.ConstructorOptions {
    return {
      image: leafletMarkerIcon2x,
      width: LEAFLET_MARKER_WIDTH,
      height: LEAFLET_MARKER_HEIGHT,
      horizontalOrigin: HorizontalOrigin.CENTER,
      verticalOrigin: VerticalOrigin.BOTTOM,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      heightReference: this.heightReference()
    };
  }

  private applyPointMarkerBillboard(billboard: BillboardGraphics): void {
    billboard.image = this.constantProperty(billboard.image, leafletMarkerIcon2x) as never;
    billboard.width = this.constantProperty(billboard.width, LEAFLET_MARKER_WIDTH) as never;
    billboard.height = this.constantProperty(billboard.height, LEAFLET_MARKER_HEIGHT) as never;
    billboard.horizontalOrigin = this.constantProperty(billboard.horizontalOrigin, HorizontalOrigin.CENTER) as never;
    billboard.verticalOrigin = this.constantProperty(billboard.verticalOrigin, VerticalOrigin.BOTTOM) as never;
    billboard.disableDepthTestDistance = this.constantProperty(
      billboard.disableDepthTestDistance,
      Number.POSITIVE_INFINITY
    ) as never;
    billboard.heightReference = this.heightReferenceProperty();
  }

  private heightReference(): HeightReference | undefined {
    return this.options.clampToGround ? HeightReference.CLAMP_TO_GROUND : undefined;
  }

  private heightReferenceProperty(): ConstantProperty | undefined {
    const heightReference = this.heightReference();
    return heightReference == null ? undefined : new ConstantProperty(heightReference);
  }

  private constantProperty<T>(property: unknown, value: T): ConstantProperty {
    if (property instanceof ConstantProperty) {
      property.setValue(value);
      return property;
    }
    return new ConstantProperty(value);
  }

  private radiusProperty(radius: RadiusSource): ConstantProperty | CallbackProperty {
    if (isVersionedValueSource<number>(radius)) {
      return this.dynamicScalarProperty(radius);
    }
    if (typeof radius === 'function') {
      return new CallbackProperty(() => radius(), false);
    }
    return new ConstantProperty(radius);
  }

  private circleOutlinePositionsProperty(center: PositionSource, radius: RadiusSource): ConstantProperty | CallbackProperty {
    if (!isVersionedValueSource<Cartesian3>(center) && typeof center !== 'function' && !isVersionedValueSource<number>(radius) && typeof radius !== 'function') {
      return new ConstantProperty(circleOutlinePositions(center, radius, CIRCLE_OUTLINE_SEGMENTS));
    }

    let cachedCenterVersion = -1;
    let cachedRadiusVersion = -1;
    let cachedRadius = Number.NaN;
    const cachedCenter = new Cartesian3(Number.NaN, Number.NaN, Number.NaN);
    const cachedPositions: Cartesian3[] = [];

    return new CallbackProperty(() => {
      const centerValue = resolvePositionSource(center);
      const radiusValue = resolveRadiusSource(radius);
      const centerVersion = isVersionedValueSource<Cartesian3>(center) ? center.getVersion() : -1;
      const radiusVersion = isVersionedValueSource<number>(radius) ? radius.getVersion() : -1;
      const shouldUpdate =
        typeof center === 'function' ||
        typeof radius === 'function' ||
        centerVersion !== cachedCenterVersion ||
        radiusVersion !== cachedRadiusVersion ||
        !Cartesian3.equals(centerValue, cachedCenter) ||
        radiusValue !== cachedRadius;

      if (shouldUpdate) {
        Cartesian3.clone(centerValue, cachedCenter);
        cachedRadius = radiusValue;
        cachedCenterVersion = centerVersion;
        cachedRadiusVersion = radiusVersion;
        syncCircleOutlinePositions(cachedPositions, centerValue, radiusValue, CIRCLE_OUTLINE_SEGMENTS);
      }

      return cachedPositions;
    }, false);
  }

  private setCircleOutlinePositionsSource(entity: Entity, center: PositionSource, radius: RadiusSource): void {
    if (!entity.polyline) {
      entity.polyline = new PolylineGraphics({
        width: this.options.styles.outlineWidth,
        material: toColor(this.options.styles.outlineColor),
        clampToGround: this.options.clampToGround
      });
    }

    entity.polyline.positions = this.circleOutlinePositionsProperty(center, radius) as never;
  }

  private positionsProperty(property: unknown, positions: PositionsSource): ConstantProperty | CallbackProperty {
    if (isVersionedValueSource<Cartesian3[]>(positions)) {
      return this.dynamicPositionsProperty(positions);
    }
    if (typeof positions === 'function') {
      return new CallbackProperty(() => positions().slice(), false);
    }
    return this.constantProperty(property, positions.slice());
  }

  private polygonHierarchyProperty(property: unknown, positions: PositionsSource): ConstantProperty | CallbackProperty {
    if (isVersionedValueSource<Cartesian3[]>(positions)) {
      return this.dynamicPolygonHierarchyProperty(positions);
    }
    if (typeof positions === 'function') {
      return new CallbackProperty(() => new PolygonHierarchy(positions().slice()), false);
    }
    return this.constantProperty(property, new PolygonHierarchy(positions.slice()));
  }

  private polygonOutlinePositionsProperty(property: unknown, positions: PositionsSource): ConstantProperty | CallbackProperty {
    if (isVersionedValueSource<Cartesian3[]>(positions)) {
      return this.dynamicPolygonOutlinePositionsProperty(positions);
    }
    if (typeof positions === 'function') {
      return new CallbackProperty(() => closedPositions(positions()), false);
    }
    return this.constantProperty(property, closedPositions(positions));
  }

  private dynamicPositionProperty(position: VersionedValueSource<Cartesian3>): CallbackPositionProperty {
    let cachedVersion = -1;
    const cachedPosition = new Cartesian3();
    return new CallbackPositionProperty((_time, result) => {
      const version = position.getVersion();
      if (version !== cachedVersion) {
        Cartesian3.clone(position.getValue(), cachedPosition);
        cachedVersion = version;
      }
      return Cartesian3.clone(cachedPosition, result);
    }, false);
  }

  private dynamicScalarProperty(value: VersionedValueSource<number>): CallbackProperty {
    let cachedVersion = -1;
    let cachedValue = value.getValue();
    return new CallbackProperty(() => {
      const version = value.getVersion();
      if (version !== cachedVersion) {
        cachedValue = value.getValue();
        cachedVersion = version;
      }
      return cachedValue;
    }, false);
  }

  private dynamicPositionsProperty(positions: VersionedValueSource<Cartesian3[]>): CallbackProperty {
    let cachedVersion = -1;
    const cachedPositions: Cartesian3[] = [];
    return new CallbackProperty(() => {
      const version = positions.getVersion();
      if (version !== cachedVersion) {
        syncCartesianArray(cachedPositions, positions.getValue());
        cachedVersion = version;
      }
      return cachedPositions;
    }, false);
  }

  private dynamicPolygonHierarchyProperty(positions: VersionedValueSource<Cartesian3[]>): CallbackProperty {
    let cachedVersion = -1;
    const cachedPositions: Cartesian3[] = [];
    const hierarchy = new PolygonHierarchy(cachedPositions);
    return new CallbackProperty(() => {
      const version = positions.getVersion();
      if (version !== cachedVersion) {
        syncCartesianArray(cachedPositions, positions.getValue());
        hierarchy.positions = cachedPositions;
        cachedVersion = version;
      }
      return hierarchy;
    }, false);
  }

  private dynamicPolygonOutlinePositionsProperty(positions: VersionedValueSource<Cartesian3[]>): CallbackProperty {
    let cachedVersion = -1;
    const cachedPositions: Cartesian3[] = [];
    return new CallbackProperty(() => {
      const version = positions.getVersion();
      if (version !== cachedVersion) {
        syncClosedCartesianArray(cachedPositions, positions.getValue());
        cachedVersion = version;
      }
      return cachedPositions;
    }, false);
  }
}

function closedPositions(positions: Cartesian3[]): Cartesian3[] {
  return positions.length ? [...positions, positions[0]] : [];
}

function workingPointImage(strokeColor: string): string {
  const cached = workingPointImages.get(strokeColor);
  if (cached) {
    return cached;
  }

  const escapedStrokeColor = escapeXmlAttribute(strokeColor);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WORKING_POINT_IMAGE_SIZE}" height="${WORKING_POINT_IMAGE_SIZE}" viewBox="0 0 ${WORKING_POINT_IMAGE_SIZE} ${WORKING_POINT_IMAGE_SIZE}"><circle cx="32" cy="32" r="${WORKING_POINT_RADIUS}" fill="#ffffff" stroke="${escapedStrokeColor}" stroke-width="${WORKING_POINT_OUTLINE_WIDTH}"/></svg>`;
  const image = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  workingPointImages.set(strokeColor, image);
  return image;
}

function resolvePositionSource(source: PositionSource): Cartesian3 {
  if (isVersionedValueSource<Cartesian3>(source)) {
    return source.getValue();
  }
  return typeof source === 'function' ? source() : source;
}

function resolveRadiusSource(source: RadiusSource): number {
  if (isVersionedValueSource<number>(source)) {
    return source.getValue();
  }
  return typeof source === 'function' ? source() : source;
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isVersionedValueSource<T>(value: unknown): value is VersionedValueSource<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as VersionedValueSource<T>).getValue === 'function' &&
    typeof (value as VersionedValueSource<T>).getVersion === 'function'
  );
}

function syncCartesianArray(target: Cartesian3[], source: Cartesian3[]): void {
  target.length = source.length;
  source.forEach((position, index) => {
    if (!target[index]) {
      target[index] = new Cartesian3();
    }
    Cartesian3.clone(position, target[index]);
  });
}

function syncClosedCartesianArray(target: Cartesian3[], source: Cartesian3[]): void {
  if (source.length === 0) {
    target.length = 0;
    return;
  }

  target.length = source.length + 1;
  source.forEach((position, index) => {
    if (!target[index]) {
      target[index] = new Cartesian3();
    }
    Cartesian3.clone(position, target[index]);
  });
  if (!target[source.length]) {
    target[source.length] = new Cartesian3();
  }
  Cartesian3.clone(source[0], target[source.length]);
}

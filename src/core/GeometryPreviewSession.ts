import { Cartesian3 } from 'cesium';
import type { Annotation } from '../types';
import { cloneCartesian, translatePositionByCartographicDelta } from '../utils/coordinates';
import type { AnnotationStore } from './AnnotationStore';
import type { EntityFactory } from './EntityFactory';

export interface VersionedValueSource<T> {
  getValue(): T;
  getVersion(): number;
}

export class MutablePositionSource implements VersionedValueSource<Cartesian3> {
  private readonly value = new Cartesian3();
  private version = 0;

  constructor(position: Cartesian3) {
    Cartesian3.clone(position, this.value);
  }

  getValue(): Cartesian3 {
    return this.value;
  }

  getVersion(): number {
    return this.version;
  }

  set(position: Cartesian3): void {
    Cartesian3.clone(position, this.value);
    this.version += 1;
  }

  cloneValue(): Cartesian3 {
    return cloneCartesian(this.value);
  }
}

export class MutablePositionsSource implements VersionedValueSource<Cartesian3[]> {
  private readonly positions: Cartesian3[] = [];
  private version = 0;

  constructor(positions: Cartesian3[]) {
    this.setPositions(positions);
  }

  getValue(): Cartesian3[] {
    return this.positions;
  }

  getVersion(): number {
    return this.version;
  }

  setPosition(index: number, position: Cartesian3): void {
    if (!this.positions[index]) {
      this.positions[index] = new Cartesian3();
    }
    Cartesian3.clone(position, this.positions[index]);
    this.version += 1;
  }

  setPositions(positions: Cartesian3[]): void {
    this.positions.length = positions.length;
    positions.forEach((position, index) => {
      if (!this.positions[index]) {
        this.positions[index] = new Cartesian3();
      }
      Cartesian3.clone(position, this.positions[index]);
    });
    this.version += 1;
  }

  setTranslated(basePositions: Cartesian3[], from: Cartesian3, to: Cartesian3): void {
    this.positions.length = basePositions.length;
    basePositions.forEach((position, index) => {
      if (!this.positions[index]) {
        this.positions[index] = new Cartesian3();
      }
      Cartesian3.clone(translatePositionByCartographicDelta(position, from, to), this.positions[index]);
    });
    this.version += 1;
  }

  cloneValue(): Cartesian3[] {
    return this.positions.map(cloneCartesian);
  }
}

export class MutableScalarSource implements VersionedValueSource<number> {
  private value: number;
  private version = 0;

  constructor(value: number) {
    this.value = value;
  }

  getValue(): number {
    return this.value;
  }

  getVersion(): number {
    return this.version;
  }

  set(value: number): void {
    this.value = value;
    this.version += 1;
  }
}

type GeometrySnapshot =
  | { type: 'point'; position: Cartesian3 }
  | { type: 'polyline' | 'polygon'; positions: Cartesian3[] }
  | { type: 'circle'; center: Cartesian3; radius: number };

export class GeometryPreviewSession {
  private readonly snapshot: GeometrySnapshot;
  private readonly positionSource?: MutablePositionSource;
  private readonly positionsSource?: MutablePositionsSource;
  private readonly centerSource?: MutablePositionSource;
  private readonly radiusSource?: MutableScalarSource;
  private disposed = false;

  constructor(
    private readonly annotation: Annotation,
    private readonly entityFactory: EntityFactory
  ) {
    this.snapshot = cloneSnapshot(annotation);

    switch (annotation.type) {
      case 'point':
        this.positionSource = new MutablePositionSource(annotation.position);
        annotation.position = this.positionSource.getValue();
        this.entityFactory.setPositionSource(annotation.entity, this.positionSource);
        break;
      case 'polyline':
        this.positionsSource = new MutablePositionsSource(annotation.positions);
        annotation.positions = this.positionsSource.getValue();
        this.entityFactory.setPolylinePositionsSource(annotation.entity, this.positionsSource);
        break;
      case 'polygon':
        this.positionsSource = new MutablePositionsSource(annotation.positions);
        annotation.positions = this.positionsSource.getValue();
        this.entityFactory.setPolygonPositionsSource(annotation.entity, this.positionsSource);
        break;
      case 'circle':
        this.centerSource = new MutablePositionSource(annotation.center);
        this.radiusSource = new MutableScalarSource(annotation.radius);
        annotation.center = this.centerSource.getValue();
        this.entityFactory.setPositionSource(annotation.entity, this.centerSource);
        this.entityFactory.setCircleRadiusSource(annotation.entity, this.radiusSource);
        break;
    }
  }

  getAnnotation(): Annotation {
    return this.annotation;
  }

  setPoint(position: Cartesian3): void {
    if (this.annotation.type !== 'point' || !this.positionSource) {
      return;
    }
    this.positionSource.set(position);
    this.annotation.position = this.positionSource.getValue();
    this.touchModel();
  }

  setVertex(index: number, position: Cartesian3): void {
    if ((this.annotation.type !== 'polyline' && this.annotation.type !== 'polygon') || !this.positionsSource) {
      return;
    }
    this.positionsSource.setPosition(index, position);
    this.annotation.positions = this.positionsSource.getValue();
    this.touchModel();
  }

  setCircleCenter(center: Cartesian3): void {
    if (this.annotation.type !== 'circle' || !this.centerSource) {
      return;
    }
    this.centerSource.set(center);
    this.annotation.center = this.centerSource.getValue();
    this.touchModel();
  }

  setCircleRadius(radius: number): void {
    if (this.annotation.type !== 'circle' || !this.radiusSource) {
      return;
    }
    this.radiusSource.set(radius);
    this.annotation.radius = radius;
    this.touchModel();
  }

  translateFrom(startPosition: Cartesian3, currentPosition: Cartesian3): void {
    switch (this.annotation.type) {
      case 'point':
        if (this.snapshot.type === 'point' && this.positionSource) {
          this.positionSource.set(translatePositionByCartographicDelta(this.snapshot.position, startPosition, currentPosition));
          this.annotation.position = this.positionSource.getValue();
        }
        break;
      case 'polyline':
      case 'polygon':
        if (
          (this.snapshot.type === 'polyline' || this.snapshot.type === 'polygon') &&
          this.positionsSource
        ) {
          this.positionsSource.setTranslated(this.snapshot.positions, startPosition, currentPosition);
          this.annotation.positions = this.positionsSource.getValue();
        }
        break;
      case 'circle':
        if (this.snapshot.type === 'circle' && this.centerSource) {
          this.centerSource.set(translatePositionByCartographicDelta(this.snapshot.center, startPosition, currentPosition));
          this.annotation.center = this.centerSource.getValue();
        }
        break;
    }
    this.touchModel();
  }

  commit(store: AnnotationStore): Annotation {
    this.writePreviewToAnnotation();
    try {
      return store.touch(this.annotation, { updateEntity: false });
    } finally {
      this.disposed = true;
    }
  }

  cancel(): void {
    restoreSnapshot(this.annotation, this.snapshot);
    try {
      this.entityFactory.updateAnnotationEntity(this.annotation);
    } finally {
      this.disposed = true;
    }
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  private writePreviewToAnnotation(): void {
    switch (this.annotation.type) {
      case 'point':
        if (this.positionSource) {
          this.annotation.position = this.positionSource.cloneValue();
        }
        break;
      case 'polyline':
      case 'polygon':
        if (this.positionsSource) {
          this.annotation.positions = this.positionsSource.cloneValue();
        }
        break;
      case 'circle':
        if (this.centerSource) {
          this.annotation.center = this.centerSource.cloneValue();
        }
        if (this.radiusSource) {
          this.annotation.radius = this.radiusSource.getValue();
        }
        break;
    }
  }

  private touchModel(): void {
    this.annotation.updatedAt = Date.now();
  }
}

function cloneSnapshot(annotation: Annotation): GeometrySnapshot {
  switch (annotation.type) {
    case 'point':
      return { type: 'point', position: cloneCartesian(annotation.position) };
    case 'polyline':
      return { type: 'polyline', positions: annotation.positions.map(cloneCartesian) };
    case 'polygon':
      return { type: 'polygon', positions: annotation.positions.map(cloneCartesian) };
    case 'circle':
      return { type: 'circle', center: cloneCartesian(annotation.center), radius: annotation.radius };
  }
}

function restoreSnapshot(annotation: Annotation, snapshot: GeometrySnapshot): void {
  if (annotation.type !== snapshot.type) {
    return;
  }

  switch (annotation.type) {
    case 'point':
      if (snapshot.type === 'point') {
        annotation.position = cloneCartesian(snapshot.position);
      }
      break;
    case 'polyline':
    case 'polygon':
      if (snapshot.type === 'polyline' || snapshot.type === 'polygon') {
        annotation.positions = snapshot.positions.map(cloneCartesian);
      }
      break;
    case 'circle':
      if (snapshot.type === 'circle') {
        annotation.center = cloneCartesian(snapshot.center);
        annotation.radius = snapshot.radius;
      }
      break;
  }
  annotation.updatedAt = Date.now();
}

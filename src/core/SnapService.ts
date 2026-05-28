import { Cartesian2, Cartesian3, Cartographic, Math as CesiumMath, SceneTransforms, type Entity, type Viewer } from 'cesium';
import type { Annotation, GeomanEntity, NormalizedOptions } from '../types';
import { cloneCartesian } from '../utils/coordinates';
import type { AnnotationStore } from './AnnotationStore';
import type { EntityFactory } from './EntityFactory';

export interface SnapContext {
  annotationId?: string;
  workingLayer?: Entity;
  marker?: Entity;
  workingPositions?: Cartesian3[];
}

export interface SnapTarget {
  key: string;
  type: 'vertex' | 'segment';
  position: Cartesian3;
  distance: number;
  annotation?: Annotation;
  layer?: GeomanEntity;
  segment?: [Cartesian3, Cartesian3];
  vertexIndex?: number;
}

export interface SnapResolution {
  position?: Cartesian3;
  snapped: boolean;
  target?: SnapTarget;
}

interface VertexCandidate {
  key: string;
  type: 'vertex';
  position: Cartesian3;
  annotation?: Annotation;
  vertexIndex?: number;
}

interface SegmentCandidate {
  key: string;
  type: 'segment';
  from: Cartesian3;
  to: Cartesian3;
  annotation?: Annotation;
}

type Candidate = VertexCandidate | SegmentCandidate;

export class SnapService {
  private altKeyPressed = false;
  private readonly keydown?: (event: KeyboardEvent) => void;
  private readonly keyup?: (event: KeyboardEvent) => void;

  constructor(
    private readonly viewer: Viewer,
    private readonly options: NormalizedOptions,
    private readonly store: AnnotationStore,
    private readonly entityFactory: EntityFactory
  ) {
    if (typeof window !== 'undefined') {
      this.keydown = (event: KeyboardEvent) => {
        if (event.key === 'Alt') {
          this.altKeyPressed = true;
          this.clear();
        }
      };
      this.keyup = (event: KeyboardEvent) => {
        if (event.key === 'Alt') {
          this.altKeyPressed = false;
        }
      };
      window.addEventListener('keydown', this.keydown);
      window.addEventListener('keyup', this.keyup);
    }
  }

  resolve(screenPosition: Cartesian2, fallbackPosition?: Cartesian3, context: SnapContext = {}): SnapResolution {
    const fallback = fallbackPosition ? cloneCartesian(fallbackPosition) : undefined;
    if (!this.shouldSnap()) {
      this.clear();
      return { position: fallback, snapped: false };
    }

    const target = this.findTarget(screenPosition, context);
    if (!target) {
      this.clear();
      return { position: fallback, snapped: false };
    }

    this.entityFactory.showSnapIndicator(target.position);
    return {
      position: cloneCartesian(target.position),
      snapped: true,
      target
    };
  }

  clear(): void {
    this.entityFactory.hideSnapIndicator();
  }

  destroy(): void {
    if (typeof window !== 'undefined') {
      if (this.keydown) {
        window.removeEventListener('keydown', this.keydown);
      }
      if (this.keyup) {
        window.removeEventListener('keyup', this.keyup);
      }
    }
    this.clear();
  }

  private shouldSnap(): boolean {
    const snapping = this.options.snapping;
    return snapping.enabled && !(snapping.disableWithAlt && this.altKeyPressed);
  }

  private findTarget(screenPosition: Cartesian2, context: SnapContext): SnapTarget | undefined {
    const maxDistance = this.options.snapping.snapDistance;
    let best: SnapTarget | undefined;
    let bestPriority = Number.POSITIVE_INFINITY;

    for (const candidate of this.iterCandidates(context)) {
      const evaluated = this.evaluateCandidate(candidate, screenPosition);
      if (!evaluated || evaluated.distance > maxDistance) {
        continue;
      }

      const priority = evaluated.type === 'vertex' ? 0 : 1;
      if (
        !best ||
        evaluated.distance < best.distance - 0.5 ||
        (Math.abs(evaluated.distance - best.distance) <= 0.5 && priority < bestPriority)
      ) {
        best = evaluated;
        bestPriority = priority;
      }
    }

    return best;
  }

  private *iterCandidates(context: SnapContext): Iterable<Candidate> {
    if (context.workingPositions?.length) {
      yield* this.workingCandidates(context.workingPositions);
    }

    for (const annotation of this.store.getAll()) {
      if (annotation.id === context.annotationId || annotation.properties?.snapIgnore === true) {
        continue;
      }
      yield* this.annotationCandidates(annotation);
    }
  }

  private *workingCandidates(positions: Cartesian3[]): Iterable<Candidate> {
    if (this.options.snapping.snapVertex) {
      for (let index = 0; index < positions.length; index += 1) {
        yield {
          key: `working:vertex:${index}`,
          type: 'vertex',
          position: positions[index],
          vertexIndex: index
        };
      }
    }

    if (!this.options.snapping.snapSegment) {
      return;
    }

    for (let index = 0; index < positions.length - 1; index += 1) {
      yield {
        key: `working:segment:${index}`,
        type: 'segment',
        from: positions[index],
        to: positions[index + 1]
      };
    }
  }

  private *annotationCandidates(annotation: Annotation): Iterable<Candidate> {
    const vertices = annotationVertices(annotation);
    if (this.options.snapping.snapVertex) {
      for (let index = 0; index < vertices.length; index += 1) {
        yield {
          key: `${annotation.id}:vertex:${index}`,
          type: 'vertex',
          position: vertices[index],
          annotation,
          vertexIndex: index
        };
      }
    }

    if (!this.options.snapping.snapSegment || vertices.length < 2) {
      return;
    }

    const segmentCount = annotation.type === 'polygon' ? vertices.length : vertices.length - 1;
    for (let index = 0; index < segmentCount; index += 1) {
      yield {
        key: `${annotation.id}:segment:${index}`,
        type: 'segment',
        from: vertices[index],
        to: vertices[(index + 1) % vertices.length],
        annotation
      };
    }
  }

  private evaluateCandidate(candidate: Candidate, screenPosition: Cartesian2): SnapTarget | undefined {
    if (candidate.type === 'vertex') {
      const candidateScreen = this.worldToScreen(candidate.position);
      if (!candidateScreen) {
        return undefined;
      }

      return {
        key: candidate.key,
        type: 'vertex',
        position: cloneCartesian(candidate.position),
        distance: Cartesian2.distance(screenPosition, candidateScreen),
        annotation: candidate.annotation,
        layer: candidate.annotation?.entity,
        vertexIndex: candidate.vertexIndex
      };
    }

    const fromScreen = this.worldToScreen(candidate.from);
    const toScreen = this.worldToScreen(candidate.to);
    if (!fromScreen || !toScreen) {
      return undefined;
    }

    const t = closestSegmentRatio(screenPosition, fromScreen, toScreen);
    const nearestScreen = Cartesian2.lerp(fromScreen, toScreen, t, new Cartesian2());
    const position = interpolateSurface(candidate.from, candidate.to, t);
    return {
      key: candidate.key,
      type: 'segment',
      position,
      distance: Cartesian2.distance(screenPosition, nearestScreen),
      annotation: candidate.annotation,
      layer: candidate.annotation?.entity,
      segment: [cloneCartesian(candidate.from), cloneCartesian(candidate.to)]
    };
  }

  private worldToScreen(position: Cartesian3): Cartesian2 | undefined {
    const screen = SceneTransforms.worldToWindowCoordinates(this.viewer.scene, position, new Cartesian2());
    return screen ? Cartesian2.clone(screen) : undefined;
  }
}

function annotationVertices(annotation: Annotation): Cartesian3[] {
  switch (annotation.type) {
    case 'point':
      return [annotation.position];
    case 'polyline':
    case 'polygon':
      return annotation.positions;
    case 'circle':
      return [annotation.center];
  }
}

function closestSegmentRatio(point: Cartesian2, from: Cartesian2, to: Cartesian2): number {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const lengthSquared = x * x + y * y;
  if (lengthSquared === 0) {
    return 0;
  }

  const ratio = ((point.x - from.x) * x + (point.y - from.y) * y) / lengthSquared;
  return Math.min(1, Math.max(0, ratio));
}

function interpolateSurface(from: Cartesian3, to: Cartesian3, ratio: number): Cartesian3 {
  const start = Cartographic.fromCartesian(from);
  const end = Cartographic.fromCartesian(to);
  const longitudeDelta = normalizeLongitudeDelta(end.longitude - start.longitude);
  return Cartographic.toCartesian(
    new Cartographic(
      start.longitude + longitudeDelta * ratio,
      start.latitude + (end.latitude - start.latitude) * ratio,
      start.height + (end.height - start.height) * ratio
    )
  );
}

function normalizeLongitudeDelta(delta: number): number {
  if (delta > Math.PI) {
    return delta - CesiumMath.TWO_PI;
  }
  if (delta < -Math.PI) {
    return delta + CesiumMath.TWO_PI;
  }
  return delta;
}

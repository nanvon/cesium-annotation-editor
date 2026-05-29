import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Ellipsoid,
  Math as CesiumMath,
  SceneTransforms,
  type Entity,
  type Viewer
} from 'cesium';
import type { Annotation, GeomanEntity, NormalizedOptions } from '../types';
import { addWindowEventListener } from '../utils/browser';
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

interface CandidateCache {
  signature: string;
  candidates: Candidate[];
}

interface ProjectionCache {
  signature: string;
  screens: Map<string, Cartesian2 | null>;
}

export class SnapService {
  private altKeyPressed = false;
  private readonly removeKeydownListener: () => void;
  private readonly removeKeyupListener: () => void;
  private candidateCache: CandidateCache = {
    signature: '',
    candidates: []
  };
  private projectionCache: ProjectionCache = {
    signature: '',
    screens: new Map()
  };

  constructor(
    private readonly viewer: Viewer,
    private readonly options: NormalizedOptions,
    private readonly store: AnnotationStore,
    private readonly entityFactory: EntityFactory
  ) {
    this.removeKeydownListener = addWindowEventListener('keydown', (event) => {
      if (event.key === 'Alt') {
        this.altKeyPressed = true;
        this.clear();
      }
    });
    this.removeKeyupListener = addWindowEventListener('keyup', (event) => {
      if (event.key === 'Alt') {
        this.altKeyPressed = false;
      }
    });
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
    this.removeKeydownListener();
    this.removeKeyupListener();
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

    for (const candidate of this.annotationCandidateCache()) {
      if (candidate.annotation?.id === context.annotationId) {
        continue;
      }
      yield candidate;
    }
  }

  private annotationCandidateCache(): Candidate[] {
    const annotations = this.store.getAll();
    const signature = this.annotationCandidateSignature(annotations);
    if (signature === this.candidateCache.signature) {
      return this.candidateCache.candidates;
    }

    const candidates: Candidate[] = [];
    for (const annotation of annotations) {
      if (annotation.properties?.snapIgnore === true || !isAnnotationExplicitlyVisible(annotation)) {
        continue;
      }
      candidates.push(...this.annotationCandidates(annotation));
    }

    this.candidateCache = { signature, candidates };
    this.projectionCache = { signature: '', screens: new Map() };
    return candidates;
  }

  private annotationCandidateSignature(annotations: Annotation[]): string {
    const snapOptions = `${this.options.snapping.snapVertex}:${this.options.snapping.snapSegment}`;
    const parts = annotations.map((annotation) => {
      const show = isAnnotationExplicitlyVisible(annotation);
      const ignored = annotation.properties?.snapIgnore === true;
      return `${annotation.id}:${annotation.type}:${annotation.updatedAt}:${show}:${ignored}:${annotationVertexCount(annotation)}`;
    });
    return `${snapOptions}|${parts.join('|')}`;
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
      const candidateScreen = this.worldToScreen(candidate.position, candidate.key);
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

    const fromScreen = this.worldToScreen(candidate.from, `${candidate.key}:from`);
    const toScreen = this.worldToScreen(candidate.to, `${candidate.key}:to`);
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

  private worldToScreen(position: Cartesian3, cacheKey: string): Cartesian2 | undefined {
    if (!this.isWorldPositionVisible(position)) {
      return undefined;
    }

    this.refreshProjectionCache();
    if (this.projectionCache.screens.has(cacheKey)) {
      const cached = this.projectionCache.screens.get(cacheKey);
      return cached ? Cartesian2.clone(cached) : undefined;
    }

    const screen = SceneTransforms.worldToWindowCoordinates(this.viewer.scene, position, new Cartesian2());
    if (!screen || !this.isScreenPositionInViewport(screen)) {
      this.projectionCache.screens.set(cacheKey, null);
      return undefined;
    }

    const cloned = Cartesian2.clone(screen);
    this.projectionCache.screens.set(cacheKey, cloned);
    return Cartesian2.clone(cloned);
  }

  private refreshProjectionCache(): void {
    const signature = `${this.candidateCache.signature}|${this.cameraSignature()}|${this.viewportSignature()}|${this.options.snapping.snapDistance}`;
    if (signature !== this.projectionCache.signature) {
      this.projectionCache = {
        signature,
        screens: new Map()
      };
    }
  }

  private isWorldPositionVisible(position: Cartesian3): boolean {
    const camera = this.viewer.scene.camera;
    const cameraPosition = camera?.positionWC ?? camera?.position;
    const cameraDirection = camera?.directionWC ?? camera?.direction;
    if (cameraPosition && cameraDirection) {
      const toPosition = Cartesian3.subtract(position, cameraPosition, new Cartesian3());
      if (Cartesian3.dot(cameraDirection, toPosition) <= 0) {
        return false;
      }
    }

    if (cameraPosition && !this.isPositionAboveGlobeHorizon(position, cameraPosition)) {
      return false;
    }

    return true;
  }

  private isPositionAboveGlobeHorizon(position: Cartesian3, cameraPosition: Cartesian3): boolean {
    const ellipsoid = this.viewer.scene.globe?.ellipsoid ?? Ellipsoid.WGS84;
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

  private isScreenPositionInViewport(screen: Cartesian2): boolean {
    const viewport = this.viewport();
    if (!viewport) {
      return true;
    }

    const margin = this.options.snapping.snapDistance;
    return screen.x >= -margin && screen.y >= -margin && screen.x <= viewport.width + margin && screen.y <= viewport.height + margin;
  }

  private cameraSignature(): string {
    const camera = this.viewer.scene.camera;
    const position = camera?.positionWC ?? camera?.position;
    const direction = camera?.directionWC ?? camera?.direction;
    return `${cartesianSignature(position)}:${cartesianSignature(direction)}`;
  }

  private viewportSignature(): string {
    const viewport = this.viewport();
    return viewport ? `${viewport.width}x${viewport.height}` : 'unknown';
  }

  private viewport(): { width: number; height: number } | undefined {
    const scene = this.viewer.scene;
    const width = scene.drawingBufferWidth ?? scene.canvas?.clientWidth ?? scene.canvas?.width;
    const height = scene.drawingBufferHeight ?? scene.canvas?.clientHeight ?? scene.canvas?.height;
    return typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0 ? { width, height } : undefined;
  }
}

function isAnnotationExplicitlyVisible(annotation: Annotation): boolean {
  const entity = annotation.entity;
  if (entity.show === false) {
    return false;
  }
  if ('isShowing' in entity && entity.isShowing === false) {
    return false;
  }
  return true;
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

function annotationVertexCount(annotation: Annotation): number {
  return annotationVertices(annotation).length;
}

function cartesianSignature(position: Cartesian3 | undefined): string {
  if (!position) {
    return 'none';
  }
  return `${position.x.toFixed(3)},${position.y.toFixed(3)},${position.z.toFixed(3)}`;
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

import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Ellipsoid,
  Math as CesiumMath,
  SceneTransforms,
  type Viewer
} from 'cesium';
import type { Annotation, AnnotationType, GeomanEntity, NormalizedOptions } from '../types';
import { addWindowEventListener } from '../utils/browser';
import { circleOutlinePositions } from '../utils/circle';
import { cloneCartesian } from '../utils/coordinates';
import type { AnnotationStore } from './AnnotationStore';

export interface SnapContext {
  mode: 'draw' | 'edit';
  shape: AnnotationType;
  excludeAnnotationId?: string;
  selfSnapPositions?: Cartesian3[];
  allowSelfSnapOnly?: boolean;
}

export interface SnapTarget {
  key: string;
  type: 'vertex' | 'segment';
  source: 'annotation' | 'self';
  position: Cartesian3;
  distance: number;
  annotation?: Annotation;
  annotationType?: AnnotationType;
  layer?: GeomanEntity;
  segment?: [Cartesian3, Cartesian3];
  vertexIndex?: number;
}

export interface SnapInfo {
  mode: SnapContext['mode'];
  shape: AnnotationType;
  source: SnapTarget['source'];
  annotationType?: AnnotationType;
  priority: number;
}

export interface SnapResolution {
  position?: Cartesian3;
  snapped: boolean;
  target?: SnapTarget;
  snapInfo?: SnapInfo;
}

interface BaseCandidate {
  key: string;
  source: 'annotation' | 'self';
  annotation?: Annotation;
  annotationType?: AnnotationType;
}

interface VertexCandidate extends BaseCandidate {
  type: 'vertex';
  position: Cartesian3;
  vertexIndex?: number;
}

interface SegmentCandidate extends BaseCandidate {
  type: 'segment';
  from: Cartesian3;
  to: Cartesian3;
  fromVertexIndex?: number;
  toVertexIndex?: number;
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
    private readonly store: AnnotationStore
  ) {
    this.removeKeydownListener = addWindowEventListener('keydown', (event) => {
      if (event.key === 'Alt') {
        this.altKeyPressed = true;
      }
    });
    this.removeKeyupListener = addWindowEventListener('keyup', (event) => {
      if (event.key === 'Alt') {
        this.altKeyPressed = false;
      }
    });
  }

  resolve(screenPosition: Cartesian2, fallbackPosition: Cartesian3 | undefined, context: SnapContext): SnapResolution {
    const fallback = fallbackPosition ? cloneCartesian(fallbackPosition) : undefined;
    if (!this.shouldSnap()) {
      return { position: fallback, snapped: false };
    }

    const target = this.findTarget(screenPosition, context);
    if (!target) {
      return { position: fallback, snapped: false };
    }

    const snapInfo = this.snapInfo(target, context);
    return {
      position: cloneCartesian(target.position),
      snapped: true,
      target,
      snapInfo
    };
  }

  clear(): void {
    // SnapService is intentionally pure calculation; kept as a no-op for callers
    // that only need to clear snap state.
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
      const evaluated = this.evaluateCandidate(candidate, screenPosition, maxDistance);
      if (!evaluated || evaluated.distance > maxDistance) {
        continue;
      }

      const priority = this.targetPriority(evaluated);
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
    if (context.selfSnapPositions?.length) {
      yield* this.selfCandidates(context.selfSnapPositions);
    }

    if (context.allowSelfSnapOnly) {
      return;
    }

    for (const candidate of this.annotationCandidateCache()) {
      if (candidate.annotation?.id === context.excludeAnnotationId) {
        continue;
      }
      yield candidate;
    }
  }

  private annotationCandidateCache(): Candidate[] {
    const signature = this.annotationCandidateSignature();
    if (signature === this.candidateCache.signature) {
      return this.candidateCache.candidates;
    }

    const annotations = this.store.getAll();
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

  private annotationCandidateSignature(): string {
    const snapOptions = `${this.options.snapping.snapVertex}:${this.options.snapping.snapSegment}`;
    // 用 store 修订号代替遍历全量标注拼接字符串，避免每次鼠标移动的 O(n) 开销。
    // 新增 / 更新 / touch / 删除 / 清空都会改变修订号；外部直接改 entity.show
    // 等绕过 store 的变更需调用 store.bumpRevision() 使其失效。
    return `${snapOptions}|${this.store.getRevision()}`;
  }

  private *selfCandidates(positions: Cartesian3[]): Iterable<Candidate> {
    if (!this.options.snapping.snapVertex) {
      return;
    }

    for (let index = 0; index < positions.length; index += 1) {
      yield {
        key: `self:vertex:${index}:${cartesianSignature(positions[index])}`,
        type: 'vertex',
        source: 'self',
        position: positions[index],
        vertexIndex: index
      };
    }
  }

  private *annotationCandidates(annotation: Annotation): Iterable<Candidate> {
    if (annotation.type === 'circle') {
      yield* this.circleCandidates(annotation);
      return;
    }

    const vertices = annotationVertices(annotation);
    if (this.options.snapping.snapVertex) {
      for (let index = 0; index < vertices.length; index += 1) {
        yield {
          key: `${annotation.id}:vertex:${index}`,
          type: 'vertex',
          source: 'annotation',
          position: vertices[index],
          annotation,
          annotationType: annotation.type,
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
        source: 'annotation',
        from: vertices[index],
        to: vertices[(index + 1) % vertices.length],
        annotation,
        annotationType: annotation.type,
        fromVertexIndex: index,
        toVertexIndex: (index + 1) % vertices.length
      };
    }
  }

  private *circleCandidates(annotation: Extract<Annotation, { type: 'circle' }>): Iterable<Candidate> {
    if (this.options.snapping.snapVertex) {
      yield {
        key: `${annotation.id}:vertex:center`,
        type: 'vertex',
        source: 'annotation',
        position: annotation.center,
        annotation,
        annotationType: annotation.type
      };
    }

    if (!this.options.snapping.snapSegment && !this.options.snapping.snapVertex) {
      return;
    }

    const boundary = circleOutlinePositions(annotation.center, annotation.radius, CIRCLE_SNAP_SEGMENTS);
    const boundaryVertexCount = Math.max(0, boundary.length - 1);
    if (this.options.snapping.snapVertex) {
      for (let index = 0; index < boundaryVertexCount; index += 1) {
        yield {
          key: `${annotation.id}:circle-boundary-vertex:${index}`,
          type: 'vertex',
          source: 'annotation',
          position: boundary[index],
          annotation,
          annotationType: annotation.type,
          vertexIndex: index
        };
      }
    }

    if (!this.options.snapping.snapSegment || boundaryVertexCount < 2) {
      return;
    }

    for (let index = 0; index < boundaryVertexCount; index += 1) {
      yield {
        key: `${annotation.id}:circle-boundary-segment:${index}`,
        type: 'segment',
        source: 'annotation',
        from: boundary[index],
        to: boundary[(index + 1) % boundaryVertexCount],
        annotation,
        annotationType: annotation.type,
        fromVertexIndex: index,
        toVertexIndex: (index + 1) % boundaryVertexCount
      };
    }
  }

  private evaluateCandidate(candidate: Candidate, screenPosition: Cartesian2, maxDistance: number): SnapTarget | undefined {
    if (candidate.type === 'vertex') {
      const candidateScreen = this.worldToScreen(candidate.position, candidate.key);
      if (!candidateScreen) {
        return undefined;
      }

      return this.vertexTarget(candidate, candidate.position, Cartesian2.distance(screenPosition, candidateScreen), candidate.vertexIndex);
    }

    const fromScreen = this.worldToScreen(candidate.from, `${candidate.key}:from`);
    const toScreen = this.worldToScreen(candidate.to, `${candidate.key}:to`);
    if (!fromScreen || !toScreen) {
      return undefined;
    }

    if (this.options.snapping.snapVertex) {
      const fromDistance = Cartesian2.distance(screenPosition, fromScreen);
      const toDistance = Cartesian2.distance(screenPosition, toScreen);
      const useFrom = fromDistance <= toDistance;
      const endpointDistance = useFrom ? fromDistance : toDistance;
      if (endpointDistance <= maxDistance) {
        return this.vertexTarget(
          candidate,
          useFrom ? candidate.from : candidate.to,
          endpointDistance,
          useFrom ? candidate.fromVertexIndex : candidate.toVertexIndex,
          `${candidate.key}:endpoint:${useFrom ? 'from' : 'to'}`
        );
      }
    }

    const t = closestSegmentRatio(screenPosition, fromScreen, toScreen);
    const nearestScreen = Cartesian2.lerp(fromScreen, toScreen, t, new Cartesian2());
    const position = interpolateSurface(candidate.from, candidate.to, t);
    return {
      key: candidate.key,
      type: 'segment',
      source: candidate.source,
      position,
      distance: Cartesian2.distance(screenPosition, nearestScreen),
      annotation: candidate.annotation,
      annotationType: candidate.annotationType,
      layer: candidate.annotation?.entity,
      segment: [cloneCartesian(candidate.from), cloneCartesian(candidate.to)]
    };
  }

  private vertexTarget(
    candidate: Candidate,
    position: Cartesian3,
    distance: number,
    vertexIndex?: number,
    key = candidate.key
  ): SnapTarget {
    return {
      key,
      type: 'vertex',
      source: candidate.source,
      position: cloneCartesian(position),
      distance,
      annotation: candidate.annotation,
      annotationType: candidate.annotationType,
      layer: candidate.annotation?.entity,
      vertexIndex
    };
  }

  private targetPriority(target: SnapTarget): number {
    const shapePriority = target.source === 'self' ? -1 : annotationTypePriority(target.annotationType);
    const snapTypePriority = target.type === 'vertex' ? 0 : 1;
    return shapePriority * 10 + snapTypePriority;
  }

  private snapInfo(target: SnapTarget, context: SnapContext): SnapInfo {
    return {
      mode: context.mode,
      shape: context.shape,
      source: target.source,
      annotationType: target.annotationType,
      priority: this.targetPriority(target)
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

const CIRCLE_SNAP_SEGMENTS = 128;

function annotationTypePriority(type: AnnotationType | undefined): number {
  switch (type) {
    case 'point':
      return 0;
    case 'circle':
      return 1;
    case 'polyline':
      return 2;
    case 'polygon':
      return 3;
    default:
      return Number.POSITIVE_INFINITY;
  }
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

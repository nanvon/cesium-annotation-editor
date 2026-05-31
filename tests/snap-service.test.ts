import { Cartesian2, Cartesian3, Cartographic, Ellipsoid, Entity, SceneTransforms, type Viewer } from 'cesium';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnapService, type SnapContext } from '../src/core/SnapService';
import { normalizeOptions } from '../src/options';
import type { Annotation, AnnotationType, SnappingOptions } from '../src/types';
import { pointEastOf } from '../src/utils/circle';
import { createFakeViewer } from './testUtils';

describe('SnapService visibility and projection cache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores explicitly hidden annotations without projecting them', () => {
    const position = visiblePosition(0);
    const { service } = createSnapService([pointAnnotation('hidden', position, { show: false })]);
    const projection = mockProjection(() => new Cartesian2(10, 10));

    expect(service.resolve(new Cartesian2(10, 10), undefined, snapContext('polyline')).snapped).toBe(false);
    expect(projection).not.toHaveBeenCalled();
  });

  it('ignores candidates behind the camera or globe and candidates outside the viewport', () => {
    const behindCamera = new Cartesian3(0, 0, Ellipsoid.WGS84.maximumRadius * 3);
    const behindGlobe = new Cartesian3(0, 0, -Ellipsoid.WGS84.maximumRadius);
    const outsideViewport = visiblePosition(1);
    const { service } = createSnapService([
      pointAnnotation('behind-camera', behindCamera),
      pointAnnotation('behind-globe', behindGlobe),
      pointAnnotation('outside', outsideViewport)
    ]);
    const projection = mockProjection((position) => {
      if (position === outsideViewport) {
        return new Cartesian2(2000, 2000);
      }
      return new Cartesian2(10, 10);
    });

    expect(service.resolve(new Cartesian2(10, 10), undefined, snapContext('polyline')).snapped).toBe(false);
    expect(projection).toHaveBeenCalledTimes(1);
  });

  it('snaps to visible candidates and reuses projected screens on repeated resolves', () => {
    const annotations = Array.from({ length: 8 }, (_, index) => pointAnnotation(`point-${index}`, visiblePosition(index)));
    const { service } = createSnapService(annotations);
    const projection = mockProjection((_position, index) => new Cartesian2(100 + index, 100));

    const first = service.resolve(new Cartesian2(100, 100), undefined, snapContext('polyline'));
    expect(first.snapped).toBe(true);
    expect(first.target?.annotation?.id).toBe('point-0');
    expect(projection).toHaveBeenCalledTimes(8);

    projection.mockClear();
    const second = service.resolve(new Cartesian2(101, 100), undefined, snapContext('polyline'));

    expect(second.snapped).toBe(true);
    expect(projection).not.toHaveBeenCalled();
  });

  it('does not create standalone snap entities when snapping', () => {
    const annotation = pointAnnotation('point', visiblePosition(0));
    const { service, viewer } = createSnapService([annotation]);
    mockProjection(() => new Cartesian2(100, 100));

    const result = service.resolve(new Cartesian2(100, 100), undefined, snapContext('polyline'));

    expect(result.snapped).toBe(true);
    expect(viewer.entities.add).not.toHaveBeenCalled();
  });

  it('ignores annotations marked with snapIgnore', () => {
    const ignored = pointAnnotation('ignored', visiblePosition(0), {}, { snapIgnore: true });
    const { service } = createSnapService([ignored]);
    const projection = mockProjection(() => new Cartesian2(100, 100));

    const result = service.resolve(new Cartesian2(100, 100), undefined, snapContext('polyline'));

    expect(result.snapped).toBe(false);
    expect(projection).not.toHaveBeenCalled();
  });

  it('does not self-snap a draw polyline when no self candidates are provided', () => {
    const { service } = createSnapService([]);
    mockProjection(() => new Cartesian2(100, 100));

    const result = service.resolve(new Cartesian2(100, 100), undefined, snapContext('polyline'));

    expect(result.snapped).toBe(false);
  });

  it('allows polygon self-snap only to the provided first vertex', () => {
    const first = visiblePosition(0);
    const second = visiblePosition(1);
    const { service } = createSnapService([]);
    mockProjection((position) => {
      if (position === first) {
        return new Cartesian2(100, 100);
      }
      if (position === second) {
        return new Cartesian2(200, 100);
      }
      return new Cartesian2(1000, 1000);
    });

    const context = snapContext('polygon', { selfSnapPositions: [first] });
    expect(service.resolve(new Cartesian2(200, 100), undefined, context).snapped).toBe(false);

    const result = service.resolve(new Cartesian2(100, 100), undefined, context);
    expect(result.snapped).toBe(true);
    expect(result.target?.source).toBe('self');
    expect(result.target?.vertexIndex).toBe(0);
  });

  it('does not polygon self-snap before the controller provides the close candidate', () => {
    const { service } = createSnapService([]);
    mockProjection(() => new Cartesian2(100, 100));

    const result = service.resolve(new Cartesian2(100, 100), undefined, snapContext('polygon'));

    expect(result.snapped).toBe(false);
  });

  it('prefers a segment endpoint when snapVertex is enabled and the endpoint is within snapDistance', () => {
    const from = visiblePosition(0);
    const to = visiblePosition(1);
    const { service } = createSnapService([polylineAnnotation('line', [from, to])]);
    mockProjection((position) => {
      if (position === from) {
        return new Cartesian2(100, 100);
      }
      if (position === to) {
        return new Cartesian2(110, 100);
      }
      return new Cartesian2(1000, 1000);
    });

    const result = service.resolve(new Cartesian2(105, 100), undefined, snapContext('polygon'));

    expect(result.snapped).toBe(true);
    expect(result.target?.type).toBe('vertex');
    expect(result.target?.vertexIndex).toBe(0);
  });

  it('excludes the annotation being edited from snap candidates', () => {
    const selfPosition = visiblePosition(0);
    const otherPosition = visiblePosition(1);
    const self = pointAnnotation('self', selfPosition);
    const other = pointAnnotation('other', otherPosition);
    const { service } = createSnapService([self, other]);
    mockProjection((position) => {
      if (position === selfPosition) {
        return new Cartesian2(100, 100);
      }
      if (position === otherPosition) {
        return new Cartesian2(110, 100);
      }
      return new Cartesian2(1000, 1000);
    });

    const result = service.resolve(new Cartesian2(100, 100), undefined, snapContext('point', { mode: 'edit', excludeAnnotationId: 'self' }));

    expect(result.snapped).toBe(true);
    expect(result.target?.annotation?.id).toBe('other');
  });

  it('uses sampled circle boundary segments as snap candidates', () => {
    const center = visiblePosition(0);
    const radius = 1000;
    const circle = circleAnnotation('circle', center, radius);
    const { service } = createSnapService([circle], { snapVertex: false, snapSegment: true, snapDistance: 20 });
    const boundary = pointEastOf(center, radius);
    const boundaryScreen = circleProjection(center)(boundary, 0);
    mockProjection(circleProjection(center));

    const result = service.resolve(boundaryScreen, undefined, snapContext('polyline'));

    expect(result.snapped).toBe(true);
    expect(result.target?.annotation?.id).toBe('circle');
    expect(result.target?.type).toBe('segment');
    expect(Cartesian3.distance(result.position ?? center, center)).toBeGreaterThan(100);
  });
});

function createSnapService(annotations: Annotation[], snapping: SnappingOptions = {}): {
  service: SnapService;
  viewer: Viewer;
} {
  const viewer = createFakeViewer();
  const store = {
    getAll: () => annotations,
    getRevision: () => 1
  };
  const service = new SnapService(
    viewer,
    normalizeOptions({ toolbar: false, snapping: { snapDistance: 20, ...snapping } }),
    store as never
  );
  return { service, viewer };
}

function pointAnnotation(
  id: string,
  position: Cartesian3,
  entityOptions: Partial<Entity> = {},
  properties?: Record<string, unknown>
): Annotation {
  const entity = Object.assign(new Entity(), entityOptions);
  return {
    id,
    type: 'point',
    entity: entity as Annotation['entity'],
    source: 'api',
    position,
    properties,
    createdAt: 1,
    updatedAt: 1
  };
}

function polylineAnnotation(id: string, positions: Cartesian3[]): Annotation {
  return {
    id,
    type: 'polyline',
    entity: new Entity() as Annotation['entity'],
    source: 'api',
    positions,
    createdAt: 1,
    updatedAt: 1
  };
}

function circleAnnotation(id: string, center: Cartesian3, radius: number): Annotation {
  return {
    id,
    type: 'circle',
    entity: new Entity() as Annotation['entity'],
    source: 'api',
    center,
    radius,
    createdAt: 1,
    updatedAt: 1
  };
}

function visiblePosition(index: number): Cartesian3 {
  return Cartesian3.fromDegrees(index * 0.01, 89 - index * 0.01);
}

function snapContext(shape: AnnotationType, overrides: Partial<SnapContext> = {}): SnapContext {
  return {
    mode: 'draw',
    shape,
    ...overrides
  };
}

function mockProjection(project: (position: Cartesian3, index: number) => Cartesian2): ReturnType<typeof vi.spyOn> {
  let calls = 0;
  return vi.spyOn(SceneTransforms, 'worldToWindowCoordinates').mockImplementation((_scene, position, result) => {
    const screen = project(position, calls);
    calls += 1;
    return Cartesian2.clone(screen, result);
  });
}

function circleProjection(center: Cartesian3): (position: Cartesian3, index: number) => Cartesian2 {
  const centerCartographic = Cartographic.fromCartesian(center);
  return (position) => {
    const cartographic = Cartographic.fromCartesian(position);
    return new Cartesian2(
      200 + (cartographic.longitude - centerCartographic.longitude) * 1000,
      200 - (cartographic.latitude - centerCartographic.latitude) * 1000
    );
  };
}

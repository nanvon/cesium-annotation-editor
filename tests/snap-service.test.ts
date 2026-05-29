import { Cartesian2, Cartesian3, Ellipsoid, Entity, SceneTransforms, type Viewer } from 'cesium';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnapService } from '../src/core/SnapService';
import { normalizeOptions } from '../src/options';
import type { Annotation } from '../src/types';
import { createFakeViewer } from './testUtils';

describe('SnapService visibility and projection cache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores explicitly hidden annotations without projecting them', () => {
    const position = visiblePosition(0);
    const { service } = createSnapService([pointAnnotation('hidden', position, { show: false })]);
    const projection = mockProjection(() => new Cartesian2(10, 10));

    expect(service.resolve(new Cartesian2(10, 10)).snapped).toBe(false);
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

    expect(service.resolve(new Cartesian2(10, 10)).snapped).toBe(false);
    expect(projection).toHaveBeenCalledTimes(1);
  });

  it('snaps to visible candidates and reuses projected screens on repeated resolves', () => {
    const annotations = Array.from({ length: 8 }, (_, index) => pointAnnotation(`point-${index}`, visiblePosition(index)));
    const { service, entityFactory } = createSnapService(annotations);
    const projection = mockProjection((_position, index) => new Cartesian2(100 + index, 100));

    const first = service.resolve(new Cartesian2(100, 100));
    expect(first.snapped).toBe(true);
    expect(first.target?.annotation?.id).toBe('point-0');
    expect(projection).toHaveBeenCalledTimes(8);

    projection.mockClear();
    const second = service.resolve(new Cartesian2(101, 100));

    expect(second.snapped).toBe(true);
    expect(projection).not.toHaveBeenCalled();
    expect(entityFactory.showSnapIndicator).toHaveBeenCalled();
  });
});

function createSnapService(annotations: Annotation[]): {
  service: SnapService;
  viewer: Viewer;
  entityFactory: { showSnapIndicator: ReturnType<typeof vi.fn>; hideSnapIndicator: ReturnType<typeof vi.fn> };
} {
  const viewer = createFakeViewer();
  const store = {
    getAll: () => annotations
  };
  const entityFactory = {
    showSnapIndicator: vi.fn(),
    hideSnapIndicator: vi.fn()
  };
  const service = new SnapService(
    viewer,
    normalizeOptions({ toolbar: false, snapping: { snapDistance: 20 } }),
    store as never,
    entityFactory as never
  );
  return { service, viewer, entityFactory };
}

function pointAnnotation(id: string, position: Cartesian3, entityOptions: Partial<Entity> = {}): Annotation {
  const entity = Object.assign(new Entity(), entityOptions);
  return {
    id,
    type: 'point',
    entity: entity as Annotation['entity'],
    source: 'api',
    position,
    createdAt: 1,
    updatedAt: 1
  };
}

function visiblePosition(index: number): Cartesian3 {
  return Cartesian3.fromDegrees(index * 0.01, 89 - index * 0.01);
}

function mockProjection(project: (position: Cartesian3, index: number) => Cartesian2): ReturnType<typeof vi.spyOn> {
  let calls = 0;
  return vi.spyOn(SceneTransforms, 'worldToWindowCoordinates').mockImplementation((_scene, position, result) => {
    const screen = project(position, calls);
    calls += 1;
    return Cartesian2.clone(screen, result);
  });
}

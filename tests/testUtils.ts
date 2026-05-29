import { Cartesian3, Ellipsoid, Entity, type Viewer } from 'cesium';
import { vi } from 'vitest';

export function createFakeViewer(): Viewer {
  const entities = new Set<Entity>();
  const canvas = createFakeCanvas();
  const cameraPosition = new Cartesian3(0, 0, Ellipsoid.WGS84.maximumRadius * 2);

  return {
    container: canvas,
    entities: {
      add: vi.fn((options?: ConstructorParameters<typeof Entity>[0]) => {
        const entity = new Entity(options);
        entities.add(entity);
        return entity;
      }),
      remove: vi.fn((entity: Entity) => entities.delete(entity))
    },
    scene: {
      canvas,
      camera: {
        positionWC: cameraPosition,
        directionWC: new Cartesian3(0, 0, -1)
      },
      globe: {
        ellipsoid: Ellipsoid.WGS84
      },
      drawingBufferWidth: 800,
      drawingBufferHeight: 600,
      screenSpaceCameraController: {
        enableInputs: true,
        enableRotate: true,
        enableTranslate: true,
        enableZoom: true,
        enableTilt: true,
        enableLook: true
      },
      requestRender: vi.fn(),
      pick: vi.fn()
    },
    screenSpaceEventHandler: {
      getInputAction: vi.fn(),
      setInputAction: vi.fn(),
      removeInputAction: vi.fn()
    }
  } as unknown as Viewer;
}

export function installDocumentStub(): () => void {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      location: { href: 'http://localhost/' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }
  });

  return () => restoreGlobalProperty('document', previousDocument);
}

export function removeBrowserGlobals(): () => void {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');

  return () => {
    restoreGlobalProperty('window', previousWindow);
    restoreGlobalProperty('document', previousDocument);
  };
}

function createFakeCanvas(): HTMLCanvasElement {
  return {
    width: 800,
    height: 600,
    clientWidth: 800,
    clientHeight: 600,
    style: {},
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
      contains: vi.fn(() => false)
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getBoundingClientRect: vi.fn(() => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600
    }))
  } as unknown as HTMLCanvasElement;
}

function restoreGlobalProperty(name: 'window' | 'document', descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, name);
}

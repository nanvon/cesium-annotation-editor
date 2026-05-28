import { Cartesian2, Cartesian3, defined, Entity, type Viewer } from 'cesium';
import { EntityMetadataStore } from './EntityMetadataStore';
import type { Annotation, EntityMetadata } from '../types';

export interface PickedEditorEntity {
  entity: Entity;
  metadata: EntityMetadata;
}

export class PickService {
  constructor(
    private readonly viewer: Viewer,
    private readonly metadataStore: EntityMetadataStore,
    private readonly findAnnotation: (id: string) => Annotation | undefined
  ) {}

  pickWorldPosition(screenPosition: Cartesian2): Cartesian3 | undefined {
    const scene = this.viewer.scene;

    if (scene.pickPositionSupported) {
      try {
        const picked = scene.pickPosition(screenPosition);
        if (defined(picked)) {
          return picked;
        }
      } catch {
        // Depth picking can fail depending on scene state; globe picking is the stable fallback.
      }
    }

    const ray = this.viewer.camera.getPickRay(screenPosition);
    if (!ray) {
      return undefined;
    }

    const globePosition = scene.globe.pick(ray, scene);
    return defined(globePosition) ? globePosition : undefined;
  }

  pickGlobePosition(screenPosition: Cartesian2): Cartesian3 | undefined {
    const scene = this.viewer.scene;
    const ray = this.viewer.camera.getPickRay(screenPosition);
    if (!ray) {
      return undefined;
    }

    const globePosition = scene.globe.pick(ray, scene);
    return defined(globePosition) ? globePosition : undefined;
  }

  pickEditorEntity(screenPosition: Cartesian2): PickedEditorEntity | undefined {
    const drilled = this.viewer.scene.drillPick(screenPosition, 8);
    const candidates = drilled
      .map((picked) => this.toPickedEditorEntity(picked?.id))
      .filter((picked): picked is PickedEditorEntity => Boolean(picked))
      .sort((a, b) => pickPriority(a) - pickPriority(b));

    if (candidates.length > 0) {
      return candidates[0];
    }

    const picked = this.viewer.scene.pick(screenPosition);
    return this.toPickedEditorEntity(picked?.id);
  }

  pickTopEditorEntity(screenPosition: Cartesian2): PickedEditorEntity | undefined {
    const picked = this.viewer.scene.pick(screenPosition);
    return this.toPickedEditorEntity(picked?.id);
  }

  private toPickedEditorEntity(id: unknown): PickedEditorEntity | undefined {
    const entity = id instanceof Entity ? id : undefined;
    const metadata = this.metadataStore.get(entity);
    if (!entity || !metadata) {
      return undefined;
    }
    if (metadata.annotationId && !this.findAnnotation(metadata.annotationId)) {
      return undefined;
    }
    return { entity, metadata };
  }

  pickAnnotation(screenPosition: Cartesian2): Annotation | undefined {
    const picked = this.pickEditorEntity(screenPosition);
    if (!picked?.metadata.annotationId || picked.metadata.editorKind !== 'annotation') {
      return undefined;
    }
    return this.findAnnotation(picked.metadata.annotationId);
  }
}

function pickPriority(picked: PickedEditorEntity): number {
  if (picked.metadata.editorKind === 'handle') {
    return 0;
  }
  if (picked.metadata.editorKind === 'working' && (picked.entity.point || picked.entity.billboard)) {
    return 1;
  }
  if (picked.metadata.editorKind === 'annotation') {
    return 2;
  }
  return 3;
}

import { PropertyBag, type Entity } from 'cesium';
import type { EntityMetadata } from '../types';

export class EntityMetadataStore {
  private metadata = new WeakMap<Entity, EntityMetadata>();

  set(entity: Entity, metadata: EntityMetadata): void {
    this.metadata.set(entity, metadata);
    entity.properties = new PropertyBag(metadata);
  }

  get(entity: Entity | undefined): EntityMetadata | undefined {
    if (!entity) {
      return undefined;
    }
    return this.metadata.get(entity);
  }

  delete(entity: Entity): void {
    this.metadata.delete(entity);
  }
}

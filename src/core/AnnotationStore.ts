import type { Entity, Viewer } from 'cesium';
import type { Annotation, AnnotationInput, AnnotationPatch } from '../types';
import { createId } from '../utils/id';
import { cloneCartesian } from '../utils/coordinates';
import type { EntityFactory } from './EntityFactory';

export class AnnotationStore {
  private annotations = new Map<string, Annotation>();
  private idsByEntity = new WeakMap<Entity, string>();
  private revision = 0;

  constructor(
    private readonly viewer: Viewer,
    private readonly entityFactory: EntityFactory
  ) {}

  add(input: AnnotationInput): Annotation {
    return this.addWithEntity(input, undefined, 'api');
  }

  addFromDraw(input: AnnotationInput): Annotation {
    return this.addWithEntity(input, undefined, 'draw');
  }

  addFromEntity(input: AnnotationInput, entity: Entity): Annotation {
    return this.addWithEntity(input, entity, 'draw');
  }

  private addWithEntity(input: AnnotationInput, existingEntity: Entity | undefined, source: Annotation['source']): Annotation {
    validateInput(input);
    const id = input.id ?? createId();
    if (this.annotations.has(id)) {
      throw new Error(`Annotation id already exists: ${id}`);
    }

    const now = Date.now();
    const entity = (existingEntity ?? this.entityFactory.createAnnotationEntity({ ...input, id })) as Annotation['entity'];
    if (existingEntity) {
      this.entityFactory.promoteWorkingEntity(existingEntity, { ...input, id });
    }
    const base = {
      id,
      entity,
      source,
      style: input.style,
      properties: input.properties,
      createdAt: now,
      updatedAt: now
    };

    const annotation = createAnnotationModel(base, input);
    this.annotations.set(id, annotation);
    this.idsByEntity.set(entity, id);
    this.revision += 1;
    return annotation;
  }

  update(id: string, patch: AnnotationPatch): Annotation {
    const annotation = this.require(id);
    Object.assign(annotation, clonePatch(patch), { updatedAt: Date.now() });
    validateAnnotation(annotation);
    this.entityFactory.updateAnnotationEntity(annotation);
    this.revision += 1;
    return annotation;
  }

  touch(annotation: Annotation, options: { updateEntity?: boolean } = {}): Annotation {
    annotation.updatedAt = Date.now();
    validateAnnotation(annotation);
    if (options.updateEntity ?? true) {
      this.entityFactory.updateAnnotationEntity(annotation);
    }
    this.revision += 1;
    return annotation;
  }

  remove(id: string): boolean {
    const annotation = this.annotations.get(id);
    if (!annotation) {
      return false;
    }
    this.viewer.entities.remove(annotation.entity);
    this.annotations.delete(id);
    this.idsByEntity.delete(annotation.entity);
    this.revision += 1;
    return true;
  }

  get(id: string): Annotation | undefined {
    return this.annotations.get(id);
  }

  require(id: string): Annotation {
    const annotation = this.annotations.get(id);
    if (!annotation) {
      throw new Error(`Unknown annotation id: ${id}`);
    }
    return annotation;
  }

  findByEntity(entity: Entity): Annotation | undefined {
    const id = this.idsByEntity.get(entity);
    return id ? this.annotations.get(id) : undefined;
  }

  getAll(): Annotation[] {
    return Array.from(this.annotations.values());
  }

  /**
   * 单调递增的修订号，在新增 / 更新 / touch / 删除 / 清空时变化。
   * 供缓存（如吸附候选）以 O(1) 判断数据是否变化，避免遍历全量标注。
   */
  getRevision(): number {
    return this.revision;
  }

  /**
   * 手动递增修订号。用于"绕过 store 的变更"——例如外部直接修改 `entity.show`
   * 改变可见性后，需要让依赖修订号的缓存（吸附候选）失效。
   */
  bumpRevision(): void {
    this.revision += 1;
  }

  clear(): void {
    for (const annotation of this.annotations.values()) {
      this.viewer.entities.remove(annotation.entity);
      this.idsByEntity.delete(annotation.entity);
    }
    this.annotations.clear();
    this.revision += 1;
  }
}

function createAnnotationModel(base: Omit<Annotation, 'type'>, input: AnnotationInput): Annotation {
  switch (input.type) {
    case 'point':
      return {
        ...base,
        type: 'point',
        position: cloneCartesian(input.position)
      };
    case 'polyline':
      return {
        ...base,
        type: 'polyline',
        positions: input.positions.map(cloneCartesian)
      };
    case 'polygon':
      return {
        ...base,
        type: 'polygon',
        positions: input.positions.map(cloneCartesian)
      };
    case 'circle':
      return {
        ...base,
        type: 'circle',
        center: cloneCartesian(input.center),
        radius: input.radius
      };
  }
}

function clonePatch(patch: AnnotationPatch): AnnotationPatch {
  const output: Record<string, unknown> = { ...patch };
  if ('position' in patch && patch.position) {
    output.position = cloneCartesian(patch.position);
  }
  if ('positions' in patch && patch.positions) {
    output.positions = patch.positions.map(cloneCartesian);
  }
  if ('center' in patch && patch.center) {
    output.center = cloneCartesian(patch.center);
  }
  return output as AnnotationPatch;
}

function validateInput(input: AnnotationInput): void {
  switch (input.type) {
    case 'point':
      if (!input.position) {
        throw new Error('Point annotation requires position.');
      }
      break;
    case 'polyline':
      if (input.positions.length < 2) {
        throw new Error('Polyline annotation requires at least 2 positions.');
      }
      break;
    case 'polygon':
      if (input.positions.length < 3) {
        throw new Error('Polygon annotation requires at least 3 positions.');
      }
      break;
    case 'circle':
      if (!input.center || input.radius <= 0) {
        throw new Error('Circle annotation requires center and positive radius.');
      }
      break;
  }
}

function validateAnnotation(annotation: Annotation): void {
  switch (annotation.type) {
    case 'polyline':
      if (annotation.positions.length < 2) {
        throw new Error('Polyline annotation requires at least 2 positions.');
      }
      break;
    case 'polygon':
      if (annotation.positions.length < 3) {
        throw new Error('Polygon annotation requires at least 3 positions.');
      }
      break;
    case 'circle':
      if (annotation.radius <= 0) {
        throw new Error('Circle annotation requires positive radius.');
      }
      break;
  }
}

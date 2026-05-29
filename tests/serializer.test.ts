import { Cartesian3, Entity } from 'cesium';
import { describe, expect, it } from 'vitest';
import { fromJSONInput, toJSON } from '../src/serialization/Serializer';
import type { Annotation, AnnotationJSON } from '../src/types';

describe('Serializer properties isolation', () => {
  it('deep clones properties when exporting to JSON', () => {
    const annotation = {
      id: 'point-1',
      type: 'point',
      entity: new Entity() as Annotation['entity'],
      source: 'api',
      position: Cartesian3.fromDegrees(120, 30),
      properties: {
        nested: {
          tags: ['a', 'b']
        }
      },
      createdAt: 1,
      updatedAt: 1
    } satisfies Annotation;

    const [json] = toJSON([annotation]);
    (json.properties?.nested as { tags: string[] }).tags.push('json-only');
    ((annotation.properties?.nested as { tags: string[] }).tags).push('annotation-only');

    expect((annotation.properties?.nested as { tags: string[] }).tags).toEqual(['a', 'b', 'annotation-only']);
    expect((json.properties?.nested as { tags: string[] }).tags).toEqual(['a', 'b', 'json-only']);
  });

  it('deep clones properties when converting JSON input to annotation input', () => {
    const json = {
      id: 'polygon-1',
      type: 'polygon',
      positions: [
        [0, 0],
        [1, 0],
        [0, 1]
      ],
      properties: {
        config: {
          flags: ['snap']
        }
      }
    } satisfies AnnotationJSON;

    const input = fromJSONInput(json);
    (input.properties?.config as { flags: string[] }).flags.push('input-only');
    (json.properties?.config as { flags: string[] }).flags.push('json-only');

    expect((json.properties?.config as { flags: string[] }).flags).toEqual(['snap', 'json-only']);
    expect((input.properties?.config as { flags: string[] }).flags).toEqual(['snap', 'input-only']);
  });
});

import { Cartesian3, Entity } from 'cesium';
import { describe, expect, it } from 'vitest';
import { cartesianToLngLatHeight } from '../src/utils/coordinates';
import { fromGeoJSON, fromGeoJSONInput, fromJSONInput, toGeoJSON, toJSON } from '../src/serialization/Serializer';
import type { Annotation, AnnotationGeoJSONFeature, AnnotationGeoJSONFeatureCollection, AnnotationJSON, LngLatHeight } from '../src/types';

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

describe('Serializer style isolation', () => {
  it('deep clones style when exporting to JSON and converting JSON input to annotation input', () => {
    const annotation = {
      id: 'line-1',
      type: 'polyline',
      entity: new Entity() as Annotation['entity'],
      source: 'api',
      positions: [Cartesian3.fromDegrees(0, 0), Cartesian3.fromDegrees(1, 1)],
      style: {
        lineColor: '#00ffff',
        lineWidth: 4
      },
      createdAt: 1,
      updatedAt: 1
    } satisfies Annotation;

    const [json] = toJSON([annotation]);
    expect(json.style).toEqual(annotation.style);
    expect(json.style).not.toBe(annotation.style);

    json.style!.lineColor = '#ff0000';
    annotation.style!.lineWidth = 8;
    expect(json.style).toEqual({ lineColor: '#ff0000', lineWidth: 4 });
    expect(annotation.style).toEqual({ lineColor: '#00ffff', lineWidth: 8 });

    const input = fromJSONInput(json);
    expect(input.style).toEqual(json.style);
    expect(input.style).not.toBe(json.style);

    input.style!.lineWidth = 12;
    json.style!.lineColor = '#0000ff';
    expect(input.style).toEqual({ lineColor: '#ff0000', lineWidth: 12 });
    expect(json.style).toEqual({ lineColor: '#0000ff', lineWidth: 4 });
  });
});

describe('Serializer GeoJSON', () => {
  it('exports point, polyline, polygon and circle GeoJSON features', () => {
    const geoJSON = toGeoJSON([
      createPointAnnotation(),
      createPolylineAnnotation(),
      createPolygonAnnotation(),
      createCircleAnnotation()
    ]);
    const featuresById = new Map(geoJSON.features.map((feature) => [feature.id, feature]));

    expect(geoJSON.type).toBe('FeatureCollection');
    expect(geoJSON.features).toHaveLength(4);
    expect(featuresById.get('point-1')?.geometry.type).toBe('Point');
    expect(featuresById.get('point-1')?.properties?.cesiumAnnotationEditor?.type).toBe('point');
    expect(featuresById.get('line-1')?.geometry.type).toBe('LineString');
    expect(featuresById.get('line-1')?.properties?.cesiumAnnotationEditor?.type).toBe('polyline');
    expect(featuresById.get('polygon-1')?.geometry.type).toBe('Polygon');
    expect(featuresById.get('polygon-1')?.properties?.cesiumAnnotationEditor?.type).toBe('polygon');
    expect(featuresById.get('circle-1')?.geometry.type).toBe('Point');
    expect(featuresById.get('circle-1')?.properties?.cesiumAnnotationEditor).toMatchObject({
      type: 'circle',
      radius: 250,
      style: { fillColor: '#ff00ff' },
      properties: { label: 'Circle A' }
    });
  });

  it('imports GeoJSON features back to annotation input with metadata, style and properties', () => {
    const geoJSON = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'circle-1',
          geometry: {
            type: 'Point',
            coordinates: [120, 30, 10]
          },
          properties: {
            cesiumAnnotationEditor: {
              type: 'circle',
              radius: 500,
              style: { outlineColor: '#333333' },
              properties: { name: 'service area' }
            }
          }
        }
      ]
    } satisfies AnnotationGeoJSONFeatureCollection;

    const [input] = fromGeoJSON(geoJSON);
    expect(input.id).toBe('circle-1');
    expect(input.type).toBe('circle');
    if (input.type !== 'circle') {
      throw new Error('Expected circle input.');
    }
    expect(input.radius).toBe(500);
    expect(input.style).toEqual({ outlineColor: '#333333' });
    expect(input.properties).toEqual({ name: 'service area' });
    expectLngLatHeight(cartesianToLngLatHeight(input.center), [120, 30, 10]);
  });

  it('preserves ordinary GeoJSON top-level properties when no valid plugin metadata exists', () => {
    const feature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [120, 30]
      },
      properties: {
        name: 'raw point',
        cesiumAnnotationEditor: 'user-owned-value'
      }
    } as unknown as AnnotationGeoJSONFeature;

    const input = fromGeoJSONInput(feature);
    expect(input.type).toBe('point');
    expect(input.properties).toEqual({
      name: 'raw point',
      cesiumAnnotationEditor: 'user-owned-value'
    });
  });

  it('roundtrips circle GeoJSON without degrading to polygon', () => {
    const [input] = fromGeoJSON(toGeoJSON([createCircleAnnotation()]));

    expect(input.type).toBe('circle');
    if (input.type !== 'circle') {
      throw new Error('Expected circle input.');
    }
    expect(input.radius).toBe(250);
  });

  it('closes exported polygon rings and drops the duplicate closing coordinate on import', () => {
    const [feature] = toGeoJSON([createPolygonAnnotation()]).features;
    expect(feature.geometry.type).toBe('Polygon');
    if (feature.geometry.type !== 'Polygon') {
      throw new Error('Expected polygon feature.');
    }

    const [ring] = feature.geometry.coordinates;
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[3]);

    const input = fromGeoJSONInput(feature);
    expect(input.type).toBe('polygon');
    if (input.type !== 'polygon') {
      throw new Error('Expected polygon input.');
    }
    expect(input.positions).toHaveLength(3);
    expectLngLatHeight(cartesianToLngLatHeight(input.positions[0]), ring[0]);
  });
});

function createPointAnnotation(): Annotation {
  return {
    id: 'point-1',
    type: 'point',
    entity: new Entity() as Annotation['entity'],
    source: 'api',
    position: Cartesian3.fromDegrees(120, 30),
    properties: { label: 'Point A' },
    createdAt: 1,
    updatedAt: 1
  };
}

function createPolylineAnnotation(): Annotation {
  return {
    id: 'line-1',
    type: 'polyline',
    entity: new Entity() as Annotation['entity'],
    source: 'api',
    positions: [Cartesian3.fromDegrees(120, 30), Cartesian3.fromDegrees(121, 31)],
    style: { lineColor: '#00ffff', lineWidth: 3 },
    properties: { label: 'Line A' },
    createdAt: 1,
    updatedAt: 1
  };
}

function createPolygonAnnotation(): Annotation {
  return {
    id: 'polygon-1',
    type: 'polygon',
    entity: new Entity() as Annotation['entity'],
    source: 'api',
    positions: [Cartesian3.fromDegrees(120, 30), Cartesian3.fromDegrees(121, 30), Cartesian3.fromDegrees(121, 31)],
    properties: { label: 'Polygon A' },
    createdAt: 1,
    updatedAt: 1
  };
}

function createCircleAnnotation(): Annotation {
  return {
    id: 'circle-1',
    type: 'circle',
    entity: new Entity() as Annotation['entity'],
    source: 'api',
    center: Cartesian3.fromDegrees(120, 30),
    radius: 250,
    style: { fillColor: '#ff00ff' },
    properties: { label: 'Circle A' },
    createdAt: 1,
    updatedAt: 1
  };
}

function expectLngLatHeight(actual: LngLatHeight, expected: LngLatHeight): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index]!);
  });
}

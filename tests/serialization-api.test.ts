import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CesiumAnnotationEditor } from '../src/CesiumAnnotationEditor';
import type { AnnotationGeoJSONFeatureCollection, AnnotationJSON } from '../src/types';
import { createFakeViewer, installDocumentStub } from './testUtils';

describe('CesiumAnnotationEditor serialization API', () => {
  let restoreDocument: () => void;

  beforeEach(() => {
    restoreDocument = installDocumentStub();
  });

  afterEach(() => {
    restoreDocument();
  });

  it('roundtrips JSON style through public API without sharing references', () => {
    const editor = new CesiumAnnotationEditor(createFakeViewer(), { toolbar: false });
    const json = [
      {
        id: 'point-1',
        type: 'point',
        position: [120, 30],
        style: { pointColor: '#00ffff' },
        properties: { name: 'Point A' }
      }
    ] satisfies AnnotationJSON[];

    const [annotation] = editor.fromJSON(json);
    json[0].style!.pointColor = '#ff0000';
    expect(annotation.style).toEqual({ pointColor: '#00ffff' });

    const [exported] = editor.toJSON();
    exported.style!.pointColor = '#0000ff';
    expect(annotation.style).toEqual({ pointColor: '#00ffff' });

    editor.destroy();
  });

  it('imports and exports circle GeoJSON through public API without losing circle semantics', () => {
    const editor = new CesiumAnnotationEditor(createFakeViewer(), { toolbar: false });
    const geoJSON = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'circle-1',
          geometry: { type: 'Point', coordinates: [120, 30] },
          properties: {
            cesiumAnnotationEditor: {
              type: 'circle',
              radius: 300,
              style: { fillColor: '#ff00ff' },
              properties: { name: 'Circle A' }
            }
          }
        }
      ]
    } satisfies AnnotationGeoJSONFeatureCollection;

    const [annotation] = editor.fromGeoJSON(geoJSON, { clear: true });
    expect(annotation.type).toBe('circle');
    if (annotation.type !== 'circle') {
      throw new Error('Expected circle annotation.');
    }
    expect(annotation.radius).toBe(300);

    const [feature] = editor.toGeoJSON().features;
    expect(feature.geometry.type).toBe('Point');
    expect(feature.properties?.cesiumAnnotationEditor).toMatchObject({
      type: 'circle',
      radius: 300,
      style: { fillColor: '#ff00ff' },
      properties: { name: 'Circle A' }
    });

    editor.destroy();
  });
});

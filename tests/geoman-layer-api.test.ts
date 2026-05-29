import { Cartesian3 } from 'cesium';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CesiumAnnotationEditor } from '../src/CesiumAnnotationEditor';
import type { Annotation } from '../src/types';
import { createFakeViewer, installDocumentStub } from './testUtils';

describe('Geoman layer API state', () => {
  let restoreDocument: () => void;

  beforeEach(() => {
    restoreDocument = installDocumentStub();
  });

  afterEach(() => {
    restoreDocument();
  });

  it('tracks per-layer edit and drag enabled state instead of mirroring global mode', () => {
    const editor = new CesiumAnnotationEditor(createFakeViewer(), { toolbar: false });
    const first = editor.addAnnotation({ id: 'first', type: 'point', position: Cartesian3.fromDegrees(0, 89) });
    const second = editor.addAnnotation({ id: 'second', type: 'point', position: Cartesian3.fromDegrees(1, 89) });

    first.entity.pm.enable();
    expect(editor.getMode()).toBe('edit');
    expect(first.entity.pm.enabled()).toBe(true);
    expect(second.entity.pm.enabled()).toBe(false);

    second.entity.pm.enable();
    expect(first.entity.pm.enabled()).toBe(false);
    expect(second.entity.pm.enabled()).toBe(true);

    editor.pm.enableGlobalEditMode();
    expect(first.entity.pm.enabled()).toBe(true);
    expect(second.entity.pm.enabled()).toBe(true);

    first.entity.pm.enableLayerDrag();
    expect(editor.getMode()).toBe('drag');
    expect(first.entity.pm.layerDragEnabled()).toBe(true);
    expect(second.entity.pm.layerDragEnabled()).toBe(false);

    second.entity.pm.enableLayerDrag();
    expect(first.entity.pm.layerDragEnabled()).toBe(false);
    expect(second.entity.pm.layerDragEnabled()).toBe(true);

    editor.destroy();
  });

  it('reports polygon self-intersection and current layer dragging state', () => {
    const editor = new CesiumAnnotationEditor(createFakeViewer(), { toolbar: false });
    const square = editor.addAnnotation({
      id: 'square',
      type: 'polygon',
      positions: [
        Cartesian3.fromDegrees(0, 89),
        Cartesian3.fromDegrees(1, 89),
        Cartesian3.fromDegrees(1, 88),
        Cartesian3.fromDegrees(0, 88)
      ]
    });
    const bowtie = editor.addAnnotation({
      id: 'bowtie',
      type: 'polygon',
      positions: [
        Cartesian3.fromDegrees(0, 89),
        Cartesian3.fromDegrees(1, 88),
        Cartesian3.fromDegrees(0, 88),
        Cartesian3.fromDegrees(1, 89)
      ]
    });

    expect(square.entity.pm.hasSelfIntersection()).toBe(false);
    expect(bowtie.entity.pm.hasSelfIntersection()).toBe(true);

    (editor as unknown as { dragController: { activeDrag: { annotation: Annotation } | null } }).dragController.activeDrag = {
      annotation: bowtie
    };
    expect(square.entity.pm.dragging()).toBe(false);
    expect(bowtie.entity.pm.dragging()).toBe(true);
    (editor as unknown as { dragController: { activeDrag: null } }).dragController.activeDrag = null;

    editor.destroy();
  });
});

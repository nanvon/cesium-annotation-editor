import type { Annotation, AnnotationType, EditorMode, GeomanShapeInput, GeomanShapeName } from './types';

const geomanShapes: GeomanShapeName[] = ['Marker', 'Line', 'Circle', 'Polygon'];

export function getSupportedGeomanShapes(types: AnnotationType[]): GeomanShapeName[] {
  return geomanShapes.filter((shape) => types.includes(geomanShapeToAnnotationType(shape)));
}

export function annotationTypeToGeomanShape(type: AnnotationType): GeomanShapeName {
  switch (type) {
    case 'point':
      return 'Marker';
    case 'polyline':
      return 'Line';
    case 'circle':
      return 'Circle';
    case 'polygon':
      return 'Polygon';
  }
}

export function annotationToGeomanLayer(annotation: Annotation): {
  annotation: Annotation;
  layer: Annotation['entity'];
  shape: GeomanShapeName;
} {
  return {
    annotation,
    layer: annotation.entity,
    shape: annotationTypeToGeomanShape(annotation.type)
  };
}

export function geomanShapeToAnnotationType(shape: GeomanShapeInput): AnnotationType {
  switch (String(shape).toLowerCase()) {
    case 'marker':
    case 'point':
      return 'point';
    case 'line':
    case 'polyline':
      return 'polyline';
    case 'circle':
      return 'circle';
    case 'polygon':
      return 'polygon';
    default:
      throw new Error(`Unsupported Geoman shape: ${shape}`);
  }
}

export function editorModeToGeomanShape(mode: EditorMode): GeomanShapeName | null {
  if (!mode.startsWith('draw:')) {
    return null;
  }
  return annotationTypeToGeomanShape(mode.slice(5) as AnnotationType);
}

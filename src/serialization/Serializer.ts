import type {
  Annotation,
  AnnotationGeoJSONFeature,
  AnnotationGeoJSONFeatureCollection,
  AnnotationGeoJSONMetadata,
  AnnotationGeoJSONProperties,
  AnnotationInput,
  AnnotationJSON,
  AnnotationStyle,
  AnnotationType,
  LngLatHeight
} from '../types';
import { cartesianToLngLatHeight, lngLatHeightToCartesian } from '../utils/coordinates';
import { cloneProperties } from '../utils/properties';

const geoJSONNamespace = 'cesiumAnnotationEditor';

export function toJSON(annotations: Annotation[]): AnnotationJSON[] {
  return annotations.map((annotation) => {
    switch (annotation.type) {
      case 'point':
        return {
          id: annotation.id,
          type: 'point',
          position: cartesianToLngLatHeight(annotation.position),
          ...(annotation.style ? { style: cloneStyle(annotation.style) } : {}),
          properties: cloneProperties(annotation.properties)
        };
      case 'polyline':
        return {
          id: annotation.id,
          type: 'polyline',
          positions: annotation.positions.map(cartesianToLngLatHeight),
          ...(annotation.style ? { style: cloneStyle(annotation.style) } : {}),
          properties: cloneProperties(annotation.properties)
        };
      case 'polygon':
        return {
          id: annotation.id,
          type: 'polygon',
          positions: annotation.positions.map(cartesianToLngLatHeight),
          ...(annotation.style ? { style: cloneStyle(annotation.style) } : {}),
          properties: cloneProperties(annotation.properties)
        };
      case 'circle':
        return {
          id: annotation.id,
          type: 'circle',
          center: cartesianToLngLatHeight(annotation.center),
          radius: annotation.radius,
          ...(annotation.style ? { style: cloneStyle(annotation.style) } : {}),
          properties: cloneProperties(annotation.properties)
        };
    }
  });
}

export function toGeoJSON(annotations: Annotation[]): AnnotationGeoJSONFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: annotations.map(toGeoJSONFeature)
  };
}

export function fromGeoJSON(geoJSON: AnnotationGeoJSONFeatureCollection): AnnotationInput[] {
  return geoJSON.features.map(fromGeoJSONInput);
}

export function fromJSONInput(item: AnnotationJSON): AnnotationInput {
  switch (item.type) {
    case 'point':
      return {
        id: item.id,
        type: 'point',
        position: lngLatHeightToCartesian(item.position),
        ...(item.style ? { style: cloneStyle(item.style) } : {}),
        properties: cloneProperties(item.properties)
      };
    case 'polyline':
      return {
        id: item.id,
        type: 'polyline',
        positions: item.positions.map(lngLatHeightToCartesian),
        ...(item.style ? { style: cloneStyle(item.style) } : {}),
        properties: cloneProperties(item.properties)
      };
    case 'polygon':
      return {
        id: item.id,
        type: 'polygon',
        positions: item.positions.map(lngLatHeightToCartesian),
        ...(item.style ? { style: cloneStyle(item.style) } : {}),
        properties: cloneProperties(item.properties)
      };
    case 'circle':
      return {
        id: item.id,
        type: 'circle',
        center: lngLatHeightToCartesian(item.center),
        radius: item.radius,
        ...(item.style ? { style: cloneStyle(item.style) } : {}),
        properties: cloneProperties(item.properties)
      };
  }
}

export function fromGeoJSONInput(feature: AnnotationGeoJSONFeature): AnnotationInput {
  const metadata = getAnnotationMetadata(feature);
  const annotationType = metadata?.type ?? annotationTypeFromGeometry(feature.geometry.type);
  const style = cloneStyle(metadata?.style);
  const base = {
    id: feature.id === undefined ? undefined : String(feature.id),
    ...(style ? { style } : {}),
    properties: getUserProperties(feature, metadata)
  };

  switch (annotationType) {
    case 'point':
      if (feature.geometry.type !== 'Point') {
        throw new Error('Point GeoJSON annotation requires Point geometry.');
      }
      return {
        ...base,
        type: 'point',
        position: lngLatHeightToCartesian(feature.geometry.coordinates)
      };
    case 'polyline':
      if (feature.geometry.type !== 'LineString') {
        throw new Error('Polyline GeoJSON annotation requires LineString geometry.');
      }
      return {
        ...base,
        type: 'polyline',
        positions: feature.geometry.coordinates.map(lngLatHeightToCartesian)
      };
    case 'polygon':
      if (feature.geometry.type !== 'Polygon') {
        throw new Error('Polygon GeoJSON annotation requires Polygon geometry.');
      }
      return {
        ...base,
        type: 'polygon',
        positions: openRing(feature.geometry.coordinates[0] ?? []).map(lngLatHeightToCartesian)
      };
    case 'circle':
      if (feature.geometry.type !== 'Point' || typeof metadata?.radius !== 'number' || metadata.radius <= 0) {
        throw new Error('Circle GeoJSON annotation requires Point geometry and positive radius metadata.');
      }
      return {
        ...base,
        type: 'circle',
        center: lngLatHeightToCartesian(feature.geometry.coordinates),
        radius: metadata.radius
      };
  }
}

function toGeoJSONFeature(annotation: Annotation): AnnotationGeoJSONFeature {
  switch (annotation.type) {
    case 'point':
      return {
        type: 'Feature',
        id: annotation.id,
        geometry: {
          type: 'Point',
          coordinates: cartesianToLngLatHeight(annotation.position)
        },
        properties: toGeoJSONProperties(annotation)
      };
    case 'polyline':
      return {
        type: 'Feature',
        id: annotation.id,
        geometry: {
          type: 'LineString',
          coordinates: annotation.positions.map(cartesianToLngLatHeight)
        },
        properties: toGeoJSONProperties(annotation)
      };
    case 'polygon':
      return {
        type: 'Feature',
        id: annotation.id,
        geometry: {
          type: 'Polygon',
          coordinates: [closeRing(annotation.positions.map(cartesianToLngLatHeight))]
        },
        properties: toGeoJSONProperties(annotation)
      };
    case 'circle':
      return {
        type: 'Feature',
        id: annotation.id,
        geometry: {
          type: 'Point',
          coordinates: cartesianToLngLatHeight(annotation.center)
        },
        properties: toGeoJSONProperties(annotation)
      };
  }
}

function toGeoJSONProperties(annotation: Annotation): AnnotationGeoJSONProperties {
  const metadata: AnnotationGeoJSONMetadata = {
    type: annotation.type
  };
  const style = cloneStyle(annotation.style);
  const properties = cloneProperties(annotation.properties);

  if (annotation.type === 'circle') {
    metadata.radius = annotation.radius;
  }
  if (style) {
    metadata.style = style;
  }
  if (properties) {
    metadata.properties = properties;
  }

  return {
    [geoJSONNamespace]: metadata
  };
}

function getAnnotationMetadata(feature: AnnotationGeoJSONFeature): AnnotationGeoJSONMetadata | undefined {
  const metadata = feature.properties?.[geoJSONNamespace];
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }
  const typedMetadata = metadata as Partial<AnnotationGeoJSONMetadata>;
  if (!isAnnotationType(typedMetadata.type)) {
    return undefined;
  }
  return typedMetadata as AnnotationGeoJSONMetadata;
}

function getUserProperties(
  feature: AnnotationGeoJSONFeature,
  metadata: AnnotationGeoJSONMetadata | undefined
): Record<string, unknown> | undefined {
  if (metadata?.properties) {
    return cloneProperties(metadata.properties);
  }
  if (!feature.properties) {
    return undefined;
  }
  if (!metadata) {
    return cloneProperties(feature.properties);
  }

  const { cesiumAnnotationEditor: _metadata, ...properties } = feature.properties;
  return Object.keys(properties).length > 0 ? cloneProperties(properties) : undefined;
}

function cloneStyle(style: AnnotationStyle | undefined): AnnotationStyle | undefined {
  return cloneProperties(style as Record<string, unknown> | undefined) as AnnotationStyle | undefined;
}

function annotationTypeFromGeometry(geometryType: AnnotationGeoJSONFeature['geometry']['type']): AnnotationType {
  switch (geometryType) {
    case 'Point':
      return 'point';
    case 'LineString':
      return 'polyline';
    case 'Polygon':
      return 'polygon';
  }
}

function closeRing(coordinates: LngLatHeight[]): LngLatHeight[] {
  if (coordinates.length === 0 || coordinatesEqual(coordinates[0], coordinates[coordinates.length - 1])) {
    return coordinates;
  }
  return [...coordinates, [...coordinates[0]] as LngLatHeight];
}

function openRing(coordinates: LngLatHeight[]): LngLatHeight[] {
  if (coordinates.length > 1 && coordinatesEqual(coordinates[0], coordinates[coordinates.length - 1])) {
    return coordinates.slice(0, -1);
  }
  return coordinates;
}

function coordinatesEqual(left: LngLatHeight, right: LngLatHeight): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isAnnotationType(value: unknown): value is AnnotationType {
  return value === 'point' || value === 'polyline' || value === 'polygon' || value === 'circle';
}

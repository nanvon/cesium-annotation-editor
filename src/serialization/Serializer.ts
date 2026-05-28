import type { Annotation, AnnotationInput, AnnotationJSON } from '../types';
import { cartesianToLngLatHeight, lngLatHeightToCartesian } from '../utils/coordinates';

export function toJSON(annotations: Annotation[]): AnnotationJSON[] {
  return annotations.map((annotation) => {
    switch (annotation.type) {
      case 'point':
        return {
          id: annotation.id,
          type: 'point',
          position: cartesianToLngLatHeight(annotation.position),
          properties: annotation.properties
        };
      case 'polyline':
        return {
          id: annotation.id,
          type: 'polyline',
          positions: annotation.positions.map(cartesianToLngLatHeight),
          properties: annotation.properties
        };
      case 'polygon':
        return {
          id: annotation.id,
          type: 'polygon',
          positions: annotation.positions.map(cartesianToLngLatHeight),
          properties: annotation.properties
        };
      case 'circle':
        return {
          id: annotation.id,
          type: 'circle',
          center: cartesianToLngLatHeight(annotation.center),
          radius: annotation.radius,
          properties: annotation.properties
        };
    }
  });
}

export function fromJSONInput(item: AnnotationJSON): AnnotationInput {
  switch (item.type) {
    case 'point':
      return {
        id: item.id,
        type: 'point',
        position: lngLatHeightToCartesian(item.position),
        properties: item.properties
      };
    case 'polyline':
      return {
        id: item.id,
        type: 'polyline',
        positions: item.positions.map(lngLatHeightToCartesian),
        properties: item.properties
      };
    case 'polygon':
      return {
        id: item.id,
        type: 'polygon',
        positions: item.positions.map(lngLatHeightToCartesian),
        properties: item.properties
      };
    case 'circle':
      return {
        id: item.id,
        type: 'circle',
        center: lngLatHeightToCartesian(item.center),
        radius: item.radius,
        properties: item.properties
      };
  }
}

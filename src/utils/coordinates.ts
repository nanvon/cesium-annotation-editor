import { Cartesian3, Cartographic, EllipsoidGeodesic, Math as CesiumMath } from 'cesium';
import type { Annotation, LngLatHeight } from '../types';

export function cloneCartesian(position: Cartesian3): Cartesian3 {
  return Cartesian3.clone(position, new Cartesian3());
}

export function cartesianToLngLatHeight(position: Cartesian3): LngLatHeight {
  const cartographic = Cartographic.fromCartesian(position);
  const longitude = CesiumMath.toDegrees(cartographic.longitude);
  const latitude = CesiumMath.toDegrees(cartographic.latitude);
  const height = cartographic.height;
  return Math.abs(height) > 1e-6 ? [longitude, latitude, height] : [longitude, latitude];
}

export function lngLatHeightToCartesian(value: LngLatHeight): Cartesian3 {
  return Cartesian3.fromDegrees(value[0], value[1], value[2] ?? 0);
}

export function surfaceDistance(from: Cartesian3, to: Cartesian3): number {
  const fromCartographic = Cartographic.fromCartesian(from);
  const toCartographic = Cartographic.fromCartesian(to);
  const geodesic = new EllipsoidGeodesic(fromCartographic, toCartographic);
  const heightDelta = toCartographic.height - fromCartographic.height;
  return Math.sqrt(geodesic.surfaceDistance ** 2 + heightDelta ** 2);
}

export function translatePositionByCartographicDelta(position: Cartesian3, from: Cartesian3, to: Cartesian3): Cartesian3 {
  const source = Cartographic.fromCartesian(position);
  const start = Cartographic.fromCartesian(from);
  const end = Cartographic.fromCartesian(to);
  return Cartographic.toCartesian(
    new Cartographic(
      source.longitude + normalizeLongitudeDelta(end.longitude - start.longitude),
      source.latitude + (end.latitude - start.latitude),
      source.height + (end.height - start.height)
    )
  );
}

export function translateAnnotation(annotation: Annotation, from: Cartesian3, to: Cartesian3): void {
  switch (annotation.type) {
    case 'point':
      annotation.position = translatePositionByCartographicDelta(annotation.position, from, to);
      break;
    case 'polyline':
    case 'polygon':
      annotation.positions = annotation.positions.map((position) => translatePositionByCartographicDelta(position, from, to));
      break;
    case 'circle':
      annotation.center = translatePositionByCartographicDelta(annotation.center, from, to);
      break;
  }
  annotation.updatedAt = Date.now();
}

function normalizeLongitudeDelta(delta: number): number {
  if (delta > Math.PI) {
    return delta - Math.PI * 2;
  }
  if (delta < -Math.PI) {
    return delta + Math.PI * 2;
  }
  return delta;
}

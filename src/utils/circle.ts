import { Cartesian3, Cartographic, EllipsoidGeodesic, Math as CesiumMath } from 'cesium';
import { cloneCartesian } from './coordinates';

const EARTH_RADIUS_METERS = 6378137;

export function pointEastOf(center: Cartesian3, radius: number): Cartesian3 {
  const cartographic = Cartographic.fromCartesian(center);
  const deltaLongitude = radius / (EARTH_RADIUS_METERS * Math.max(Math.cos(cartographic.latitude), 0.000001));
  return Cartographic.toCartesian(new Cartographic(cartographic.longitude + deltaLongitude, cartographic.latitude, cartographic.height));
}

export function clampRadius(radius: number, minRadius: number, maxRadius?: number): number {
  const minApplied = Math.max(radius, minRadius);
  return maxRadius == null ? minApplied : Math.min(minApplied, maxRadius);
}

export function pointAlongSurface(from: Cartesian3, to: Cartesian3, distance: number): Cartesian3 {
  if (distance <= 0) {
    return cloneCartesian(from);
  }

  const start = Cartographic.fromCartesian(from);
  const end = Cartographic.fromCartesian(to);
  const geodesic = new EllipsoidGeodesic(start, end);
  if (geodesic.surfaceDistance <= 0) {
    return pointEastOf(from, distance);
  }

  const point = geodesic.interpolateUsingSurfaceDistance(distance);
  point.height = end.height;
  return Cartographic.toCartesian(point);
}

export function syncCircleOutlinePositions(target: Cartesian3[], center: Cartesian3, radius: number, segments = 96): Cartesian3[] {
  const cartographic = Cartographic.fromCartesian(center);
  const angularDistance = Math.max(radius, 0) / EARTH_RADIUS_METERS;
  const sinLatitude = Math.sin(cartographic.latitude);
  const cosLatitude = Math.cos(cartographic.latitude);
  const sinDistance = Math.sin(angularDistance);
  const cosDistance = Math.cos(angularDistance);

  target.length = segments + 1;

  for (let index = 0; index <= segments; index += 1) {
    const bearing = CesiumMath.TWO_PI * (index / segments);
    const sinBearing = Math.sin(bearing);
    const cosBearing = Math.cos(bearing);
    const latitude = Math.asin(sinLatitude * cosDistance + cosLatitude * sinDistance * cosBearing);
    const longitude = cartographic.longitude + Math.atan2(
      sinBearing * sinDistance * cosLatitude,
      cosDistance - sinLatitude * Math.sin(latitude)
    );

    if (!target[index]) {
      target[index] = new Cartesian3();
    }
    Cartographic.toCartesian(new Cartographic(longitude, latitude, cartographic.height), undefined, target[index]);
  }

  return target;
}

export function circleOutlinePositions(center: Cartesian3, radius: number, segments = 96): Cartesian3[] {
  return syncCircleOutlinePositions([], center, radius, segments);
}

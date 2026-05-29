import { Cartographic, type Cartesian3 } from 'cesium';
import type { Annotation } from '../types';

interface Point2D {
  x: number;
  y: number;
}

const EPSILON = 1e-12;

export function hasSelfIntersection(annotation: Annotation): boolean {
  if (annotation.type !== 'polygon' && annotation.type !== 'polyline') {
    return false;
  }

  const points = annotation.positions.map(toPoint2D);
  if (annotation.type === 'polygon') {
    return hasSegmentSelfIntersection(points, true);
  }
  return hasSegmentSelfIntersection(points, false);
}

function toPoint2D(position: Cartesian3): Point2D {
  const cartographic = Cartographic.fromCartesian(position);
  return {
    x: cartographic.longitude,
    y: cartographic.latitude
  };
}

function hasSegmentSelfIntersection(points: Point2D[], closed: boolean): boolean {
  const segmentCount = closed ? points.length : points.length - 1;
  if (segmentCount < 4) {
    return false;
  }

  for (let first = 0; first < segmentCount; first += 1) {
    const firstStart = points[first];
    const firstEnd = points[(first + 1) % points.length];

    for (let second = first + 1; second < segmentCount; second += 1) {
      if (areAdjacentSegments(first, second, segmentCount, closed)) {
        continue;
      }

      const secondStart = points[second];
      const secondEnd = points[(second + 1) % points.length];
      if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
        return true;
      }
    }
  }

  return false;
}

function areAdjacentSegments(first: number, second: number, segmentCount: number, closed: boolean): boolean {
  if (Math.abs(first - second) <= 1) {
    return true;
  }
  return closed && first === 0 && second === segmentCount - 1;
}

function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);

  if (abC * abD < -EPSILON && cdA * cdB < -EPSILON) {
    return true;
  }

  return (
    (Math.abs(abC) <= EPSILON && isPointOnSegment(c, a, b)) ||
    (Math.abs(abD) <= EPSILON && isPointOnSegment(d, a, b)) ||
    (Math.abs(cdA) <= EPSILON && isPointOnSegment(a, c, d)) ||
    (Math.abs(cdB) <= EPSILON && isPointOnSegment(b, c, d))
  );
}

function orientation(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function isPointOnSegment(point: Point2D, start: Point2D, end: Point2D): boolean {
  return (
    point.x >= Math.min(start.x, end.x) - EPSILON &&
    point.x <= Math.max(start.x, end.x) + EPSILON &&
    point.y >= Math.min(start.y, end.y) - EPSILON &&
    point.y <= Math.max(start.y, end.y) + EPSILON
  );
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Box3Like {
  min: Vec3;
  max: Vec3;
}

export function createEmptyBox(): Box3Like {
  return {
    min: { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY },
    max: { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY },
  };
}

export function expandBoxByPoint(box: Box3Like, point: Vec3): void {
  box.min.x = Math.min(box.min.x, point.x);
  box.min.y = Math.min(box.min.y, point.y);
  box.min.z = Math.min(box.min.z, point.z);
  box.max.x = Math.max(box.max.x, point.x);
  box.max.y = Math.max(box.max.y, point.y);
  box.max.z = Math.max(box.max.z, point.z);
}

export function expandBoxByBox(target: Box3Like, source: Box3Like): void {
  expandBoxByPoint(target, source.min);
  expandBoxByPoint(target, source.max);
}

export function isValidBox(box: Box3Like): boolean {
  return Number.isFinite(box.min.x) && Number.isFinite(box.max.x);
}

export function boxSize(box: Box3Like): Vec3 {
  return {
    x: box.max.x - box.min.x,
    y: box.max.y - box.min.y,
    z: box.max.z - box.min.z,
  };
}

export function boxCenter(box: Box3Like): Vec3 {
  return {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  };
}

import type { FacadePanel2D, SealJoint, SealMeasurementConfig } from "../domain/model";
import { overlap } from "./math";
import { createJointId, panelPlane, pointOnPanelFacade } from "./segment3d";

function length3D(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function makeVerticalJoint(a: FacadePanel2D, b: FacadePanel2D, u: number, zMin: number, zMax: number): SealJoint {
  const side = a.side;
  const plane = panelPlane(a, b);
  const start = pointOnPanelFacade(a, plane, u, zMin);
  const end = pointOnPanelFacade(a, plane, u, zMax);
  return {
    id: createJointId("vertical", a.facadeKey, side, start, end, a.expressId, b.expressId),
    type: "vertical",
    side,
    facadeKey: a.facadeKey,
    facadeName: a.facadeName,
    relatedFacadeKeys: [a.facadeKey],
    start,
    end,
    length: length3D(start, end),
    elementA: a.expressId,
    elementB: b.expressId,
    confidence: "auto",
  };
}

function makeHorizontalJoint(a: FacadePanel2D, b: FacadePanel2D, z: number, uMin: number, uMax: number): SealJoint {
  const side = a.side;
  const plane = panelPlane(a, b);
  const start = pointOnPanelFacade(a, plane, uMin, z);
  const end = pointOnPanelFacade(a, plane, uMax, z);
  return {
    id: createJointId("horizontal", a.facadeKey, side, start, end, a.expressId, b.expressId),
    type: "horizontal",
    side,
    facadeKey: a.facadeKey,
    facadeName: a.facadeName,
    relatedFacadeKeys: [a.facadeKey],
    start,
    end,
    length: length3D(start, end),
    elementA: a.expressId,
    elementB: b.expressId,
    confidence: "auto",
  };
}

function makeCornerJoint(a: FacadePanel2D, b: FacadePanel2D, zMin: number, zMax: number): SealJoint {
  const facadeNames = [a.facadeName, b.facadeName].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const facadeKeys = [a.facadeKey, b.facadeKey].sort();
  const start = pointOnPanelFacade(a, a.plane, b.plane, zMin);
  const end = pointOnPanelFacade(a, a.plane, b.plane, zMax);

  return {
    id: createJointId("corner", facadeKeys.join("+"), "CORNER", start, end, a.expressId, b.expressId),
    type: "corner",
    side: "CORNER",
    facadeKey: facadeKeys.join("+"),
    facadeName: `Esquina: ${facadeNames.join(" + ")}`,
    relatedFacadeKeys: facadeKeys,
    start,
    end,
    length: length3D(start, end),
    elementA: a.expressId,
    elementB: b.expressId,
    confidence: "auto",
  };
}

function detectPair(a: FacadePanel2D, b: FacadePanel2D, config: SealMeasurementConfig): SealJoint[] {
  const joints: SealJoint[] = [];

  if (a.facadeKey !== b.facadeKey || a.side !== b.side) {
    if (a.facadeKey === b.facadeKey) return joints;
    if (a.normalAxis === b.normalAxis) return joints;
    if (a.vAxis !== b.vAxis) return joints;

    const verticalOverlap = overlap(a.zMin, a.zMax, b.zMin, b.zMax);
    if (verticalOverlap < config.minJointLength) return joints;

    const aTouchesCorner = a.uMin - config.contactTolerance <= b.plane && a.uMax + config.contactTolerance >= b.plane;
    const bTouchesCorner = b.uMin - config.contactTolerance <= a.plane && b.uMax + config.contactTolerance >= a.plane;

    if (aTouchesCorner && bTouchesCorner) {
      joints.push(makeCornerJoint(a, b, Math.max(a.zMin, b.zMin), Math.min(a.zMax, b.zMax)));
    }

    return joints;
  }

  const verticalOverlap = overlap(a.zMin, a.zMax, b.zMin, b.zMax);
  const abVerticalGap = Math.abs(a.uMax - b.uMin);
  const baVerticalGap = Math.abs(b.uMax - a.uMin);

  if (verticalOverlap >= config.minJointLength) {
    if (abVerticalGap <= config.contactTolerance) {
      joints.push(makeVerticalJoint(a, b, (a.uMax + b.uMin) / 2, Math.max(a.zMin, b.zMin), Math.min(a.zMax, b.zMax)));
    }
    if (baVerticalGap <= config.contactTolerance) {
      joints.push(makeVerticalJoint(a, b, (b.uMax + a.uMin) / 2, Math.max(a.zMin, b.zMin), Math.min(a.zMax, b.zMax)));
    }
  }

  const horizontalOverlap = overlap(a.uMin, a.uMax, b.uMin, b.uMax);
  const abHorizontalGap = Math.abs(a.zMax - b.zMin);
  const baHorizontalGap = Math.abs(b.zMax - a.zMin);

  if (horizontalOverlap >= config.minJointLength) {
    if (abHorizontalGap <= config.contactTolerance) {
      joints.push(makeHorizontalJoint(a, b, (a.zMax + b.zMin) / 2, Math.max(a.uMin, b.uMin), Math.min(a.uMax, b.uMax)));
    }
    if (baHorizontalGap <= config.contactTolerance) {
      joints.push(makeHorizontalJoint(a, b, (b.zMax + a.zMin) / 2, Math.max(a.uMin, b.uMin), Math.min(a.uMax, b.uMax)));
    }
  }

  return joints;
}

export function deduplicateJoints(joints: SealJoint[]): SealJoint[] {
  const map = new Map<string, SealJoint>();
  for (const joint of joints) {
    const key = [
      joint.facadeKey,
      joint.side,
      joint.type,
      joint.start.x.toFixed(3),
      joint.start.y.toFixed(3),
      joint.start.z.toFixed(3),
      joint.end.x.toFixed(3),
      joint.end.y.toFixed(3),
      joint.end.z.toFixed(3),
    ].join("|");
    if (!map.has(key)) map.set(key, joint);
  }
  return [...map.values()].sort(
    (a, b) => a.facadeName.localeCompare(b.facadeName, undefined, { numeric: true }) || a.type.localeCompare(b.type) || a.length - b.length,
  );
}

export function detectSealJoints(panels: FacadePanel2D[], config: SealMeasurementConfig): SealJoint[] {
  const detected: SealJoint[] = [];

  for (let i = 0; i < panels.length; i += 1) {
    for (let j = i + 1; j < panels.length; j += 1) {
      detected.push(...detectPair(panels[i], panels[j], config));
    }
  }

  return deduplicateJoints(detected).filter((joint) => joint.length >= config.minJointLength);
}

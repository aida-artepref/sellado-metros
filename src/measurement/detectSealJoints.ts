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
  if (a.facadeKey !== b.facadeKey) return joints;
  if (a.side !== b.side) return joints;

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

function groupByFacade(panels: FacadePanel2D[]): Map<string, FacadePanel2D[]> {
  const grouped = new Map<string, FacadePanel2D[]>();

  for (const panel of panels) {
    const key = `${panel.facadeKey}|${panel.side}`;
    const group = grouped.get(key) ?? [];
    group.push(panel);
    grouped.set(key, group);
  }

  return grouped;
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
  const grouped = groupByFacade(panels);
  const detected: SealJoint[] = [];

  for (const facadePanels of grouped.values()) {
    for (let i = 0; i < facadePanels.length; i += 1) {
      for (let j = i + 1; j < facadePanels.length; j += 1) {
        detected.push(...detectPair(facadePanels[i], facadePanels[j], config));
      }
    }
  }

  return deduplicateJoints(detected).filter((joint) => joint.length >= config.minJointLength);
}

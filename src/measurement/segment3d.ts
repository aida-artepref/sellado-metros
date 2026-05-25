import type { Axis, FacadePanel2D, SealJointType } from "../domain/model";
import type { Vec3 } from "../domain/vector";

function setAxis(point: Vec3, axis: Axis, value: number): void {
  point[axis] = value;
}

export function pointOnPanelFacade(panel: FacadePanel2D, plane: number, u: number, v: number): Vec3 {
  const point: Vec3 = { x: 0, y: 0, z: 0 };
  setAxis(point, panel.normalAxis, plane);
  setAxis(point, panel.uAxis, u);
  setAxis(point, panel.vAxis, v);
  return point;
}

export function createJointId(
  type: SealJointType,
  facadeKey: string,
  side: FacadePanel2D["side"],
  start: Vec3,
  end: Vec3,
  elementA: number,
  elementB?: number,
): string {
  const ids = [elementA, elementB ?? -1].sort((a, b) => a - b).join("-");
  const coords = [start.x, start.y, start.z, end.x, end.y, end.z].map((value) => value.toFixed(3)).join(":");
  return `${facadeKey}:${side}:${type}:${ids}:${coords}`;
}

export function panelPlane(panelA: FacadePanel2D, panelB: FacadePanel2D): number {
  return (panelA.plane + panelB.plane) / 2;
}

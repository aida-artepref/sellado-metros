import type { Box3Like, Vec3 } from "../domain/vector";
import { boxCenter, createEmptyBox, expandBoxByBox, isValidBox } from "../domain/vector";
import type { Axis, FacadePanel2D, FacadeSide, IfcElementGeometry, SealMeasurementConfig } from "../domain/model";

type FacadeCandidateGroup = {
  key: string;
  name: string;
  elements: IfcElementGeometry[];
  storeyExpressId?: number;
  storeyName?: string;
};

type ProjectionAxes = {
  side: FacadeSide;
  uAxis: Axis;
  vAxis: Axis;
  normalAxis: Axis;
};

const AXES: Axis[] = ["x", "y", "z"];
const SIDES: FacadeSide[] = ["XMIN", "XMAX", "YMIN", "YMAX", "ZMIN", "ZMAX"];

function normalize(value: string): string {
  return value.trim().toUpperCase();
}

function tokens(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => normalize(item))
    .filter(Boolean);
}

function axisValue(vector: Vec3, axis: Axis): number {
  return vector[axis];
}

function axisSize(box: Box3Like, axis: Axis): number {
  return axisValue(box.max, axis) - axisValue(box.min, axis);
}

function axisMin(box: Box3Like, axis: Axis): number {
  return axisValue(box.min, axis);
}

function axisMax(box: Box3Like, axis: Axis): number {
  return axisValue(box.max, axis);
}

function sideAxis(side: FacadeSide): Axis {
  return side[0].toLowerCase() as Axis;
}

function sideFromAxis(axis: Axis, bound: "min" | "max"): FacadeSide {
  return `${axis.toUpperCase()}${bound === "min" ? "MIN" : "MAX"}` as FacadeSide;
}

function sideDistance(box: Box3Like, side: FacadeSide, envelope: Box3Like): number {
  const axis = sideAxis(side);
  return side.endsWith("MIN") ? Math.abs(axisMin(box, axis) - axisMin(envelope, axis)) : Math.abs(axisMax(box, axis) - axisMax(envelope, axis));
}

function readVerticalAxis(config: SealMeasurementConfig): Axis {
  // En este visor web-ifc/Three.js el modelo de Allplan queda con Y como vertical.
  // Se deja configurable porque algunos IFC pueden llegar como Z-up.
  return config.verticalAxis === "auto" ? "y" : config.verticalAxis;
}

function horizontalAxes(verticalAxis: Axis): Axis[] {
  return AXES.filter((axis) => axis !== verticalAxis);
}

function isCandidateWall(element: IfcElementGeometry, config: SealMeasurementConfig, verticalAxis: Axis): boolean {
  if (element.kind !== "wall") return false;

  const hAxes = horizontalAxes(verticalAxis);
  const horizontalLength = Math.max(...hAxes.map((axis) => axisSize(element.bbox, axis)));
  if (horizontalLength < config.minPanelLength) return false;
  if (axisSize(element.bbox, verticalAxis) < config.minPanelHeight) return false;

  const name = normalize(element.name ?? "");
  const filter = normalize(config.wallNameIncludes ?? "");
  if (!filter) return true;
  if (name.includes(filter)) return true;
  return config.includeUnnamedWalls && name.length === 0;
}

function isFacadeStoreyName(name: string | undefined, config: SealMeasurementConfig): boolean {
  const normalized = normalize(name ?? "");
  if (!normalized) return false;
  const accepted = tokens(config.facadeStoreyNameIncludes);
  if (accepted.length === 0) return true;
  return accepted.some((token) => normalized.includes(token));
}

function buildEnvelope(elements: IfcElementGeometry[]): Box3Like | undefined {
  const envelope = createEmptyBox();
  for (const element of elements) expandBoxByBox(envelope, element.bbox);
  return isValidBox(envelope) ? envelope : undefined;
}

function inferProjectionAxes(groupBox: Box3Like, facadeEnvelope: Box3Like, verticalAxis: Axis): ProjectionAxes {
  const [axisA, axisB] = horizontalAxes(verticalAxis);
  const normalAxis = axisSize(groupBox, axisA) <= axisSize(groupBox, axisB) ? axisA : axisB;
  const uAxis = horizontalAxes(verticalAxis).find((axis) => axis !== normalAxis) ?? axisA;

  const center = axisValue(boxCenter(groupBox), normalAxis);
  const globalCenter = axisValue(boxCenter(facadeEnvelope), normalAxis);
  const side = sideFromAxis(normalAxis, center <= globalCenter ? "min" : "max");

  return {
    side,
    uAxis,
    vAxis: verticalAxis,
    normalAxis,
  };
}

function inferProjectionAxesForElement(
  element: IfcElementGeometry,
  facadeEnvelope: Box3Like,
  verticalAxis: Axis,
  tolerance: number,
): ProjectionAxes | undefined {
  const hAxes = horizontalAxes(verticalAxis);
  const normalAxis = hAxes.sort((a, b) => axisSize(element.bbox, a) - axisSize(element.bbox, b))[0];
  const uAxis = horizontalAxes(verticalAxis).find((axis) => axis !== normalAxis);
  if (!uAxis) return undefined;

  const possibleSides = [sideFromAxis(normalAxis, "min"), sideFromAxis(normalAxis, "max")];
  const side = possibleSides
    .filter((candidate) => sideDistance(element.bbox, candidate, facadeEnvelope) <= tolerance)
    .sort((a, b) => sideDistance(element.bbox, a, facadeEnvelope) - sideDistance(element.bbox, b, facadeEnvelope))[0];

  if (!side) return undefined;

  return {
    side,
    uAxis,
    vAxis: verticalAxis,
    normalAxis,
  };
}

function toFacadePanel(
  element: IfcElementGeometry,
  axes: ProjectionAxes,
  facadeKey: string,
  facadeName: string,
  envelope: Box3Like,
): FacadePanel2D {
  return {
    expressId: element.expressId,
    name: element.name,
    side: axes.side,
    facadeKey,
    facadeName,
    storeyExpressId: element.storeyExpressId,
    storeyName: element.storeyName,
    uAxis: axes.uAxis,
    vAxis: axes.vAxis,
    normalAxis: axes.normalAxis,
    uMin: axisMin(element.bbox, axes.uAxis),
    uMax: axisMax(element.bbox, axes.uAxis),
    zMin: axisMin(element.bbox, axes.vAxis),
    zMax: axisMax(element.bbox, axes.vAxis),
    plane: axes.side.endsWith("MIN") ? axisMin(envelope, axes.normalAxis) : axisMax(envelope, axes.normalAxis),
    bbox: element.bbox,
  };
}

function buildStoreyGroups(elements: IfcElementGeometry[], config: SealMeasurementConfig): FacadeCandidateGroup[] {
  const groups = new Map<string, FacadeCandidateGroup>();

  for (const element of elements) {
    if (!isFacadeStoreyName(element.storeyName, config) || element.storeyExpressId === undefined) continue;
    const key = `STOREY:${element.storeyExpressId}`;
    const name = element.storeyName ?? `IfcBuildingStorey ${element.storeyExpressId}`;
    const group = groups.get(key) ?? {
      key,
      name,
      elements: [],
      storeyExpressId: element.storeyExpressId,
      storeyName: element.storeyName,
    };
    group.elements.push(element);
    groups.set(key, group);
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function classifyFromSpatialStoreys(
  candidateWalls: IfcElementGeometry[],
  facadeEnvelope: Box3Like,
  config: SealMeasurementConfig,
  verticalAxis: Axis,
): FacadePanel2D[] {
  const groups = buildStoreyGroups(candidateWalls, config);
  if (groups.length === 0) return [];

  const panels: FacadePanel2D[] = [];

  for (const group of groups) {
    const groupEnvelope = buildEnvelope(group.elements);
    if (!groupEnvelope) continue;

    const axes = inferProjectionAxes(groupEnvelope, facadeEnvelope, verticalAxis);

    for (const element of group.elements) {
      const panel = toFacadePanel(element, axes, group.key, group.name, groupEnvelope);
      if (panel.uMax <= panel.uMin || panel.zMax <= panel.zMin) continue;
      panels.push(panel);
    }
  }

  return panels;
}

function classifyFromGeometry(
  candidateWalls: IfcElementGeometry[],
  facadeEnvelope: Box3Like,
  config: SealMeasurementConfig,
  verticalAxis: Axis,
): FacadePanel2D[] {
  const panels: FacadePanel2D[] = [];

  for (const element of candidateWalls) {
    const axes = inferProjectionAxesForElement(element, facadeEnvelope, verticalAxis, config.exteriorTolerance);
    if (!axes) continue;

    const panel = toFacadePanel(element, axes, axes.side, axes.side, facadeEnvelope);
    if (panel.uMax <= panel.uMin || panel.zMax <= panel.zMin) continue;
    panels.push(panel);
  }

  return panels;
}

export function classifyFacadePanels(
  elements: IfcElementGeometry[],
  _modelBox: Box3Like,
  config: SealMeasurementConfig,
): FacadePanel2D[] {
  const verticalAxis = readVerticalAxis(config);
  const candidateWalls = elements.filter((element) => isCandidateWall(element, config, verticalAxis));
  const facadeEnvelope = buildEnvelope(candidateWalls);
  if (!facadeEnvelope) return [];

  const spatialPanels = classifyFromSpatialStoreys(candidateWalls, facadeEnvelope, config, verticalAxis);
  const panels = spatialPanels.length > 0 ? spatialPanels : classifyFromGeometry(candidateWalls, facadeEnvelope, config, verticalAxis);

  return panels.sort(
    (a, b) =>
      a.facadeName.localeCompare(b.facadeName, undefined, { numeric: true }) ||
      a.side.localeCompare(b.side) ||
      a.zMin - b.zMin ||
      a.uMin - b.uMin,
  );
}

import type { Box3Like, Vec3 } from "./vector";

export type Axis = "x" | "y" | "z";
export type VerticalAxis = Axis | "auto";

export type IfcElementKind =
  | "wall"
  | "beam"
  | "column"
  | "slab"
  | "plate"
  | "buildingElementPart"
  | "member"
  | "other";

export interface IfcMeshData {
  positions: Float32Array;
  indices: Uint32Array;
  color?: [number, number, number, number];
}

export interface IfcElementGeometry {
  expressId: number;
  type: number;
  kind: IfcElementKind;
  name: string;
  bbox: Box3Like;
  meshes: IfcMeshData[];
  storeyExpressId?: number;
  storeyName?: string;
}

export interface IfcStoreyInfo {
  expressId: number;
  name: string;
}

export type FacadeSide = "XMIN" | "XMAX" | "YMIN" | "YMAX" | "ZMIN" | "ZMAX";

export interface FacadePanel2D {
  expressId: number;
  name: string;
  side: FacadeSide;
  facadeKey: string;
  facadeName: string;
  storeyExpressId?: number;
  storeyName?: string;
  uAxis: Axis;
  vAxis: Axis;
  normalAxis: Axis;
  uMin: number;
  uMax: number;
  /** Coordenada vertical proyectada. El nombre zMin se mantiene por compatibilidad interna. */
  zMin: number;
  /** Coordenada vertical proyectada. El nombre zMax se mantiene por compatibilidad interna. */
  zMax: number;
  plane: number;
  bbox: Box3Like;
}

export type SealJointType = "vertical" | "horizontal" | "perimeter";

export interface SealJoint {
  id: string;
  type: SealJointType;
  side: FacadeSide;
  facadeKey: string;
  facadeName: string;
  start: Vec3;
  end: Vec3;
  length: number;
  elementA: number;
  elementB?: number;
  confidence: "auto" | "review" | "manual";
}

export interface SealMeasurementConfig {
  exteriorTolerance: number;
  contactTolerance: number;
  minPanelLength: number;
  minPanelHeight: number;
  minJointLength: number;
  wallNameIncludes?: string;
  facadeStoreyNameIncludes?: string;
  includeUnnamedWalls: boolean;
  /**
   * web-ifc/Three.js suele mostrar este modelo con Y como eje vertical.
   * Usa Z para modelos exportados en coordenadas IFC estandar sin conversion a Three.js.
   */
  verticalAxis: VerticalAxis;
}

export interface FacadeMeasurementSummary {
  key: string;
  name: string;
  side: FacadeSide;
  total: number;
  vertical: number;
  horizontal: number;
  count: number;
  panelCount: number;
}

export interface SealMeasurementReport {
  total: number;
  vertical: number;
  horizontal: number;
  byFacade: Record<string, FacadeMeasurementSummary>;
  facades: FacadeMeasurementSummary[];
  joints: SealJoint[];
  panels: FacadePanel2D[];
}

export const DEFAULT_MEASUREMENT_CONFIG: SealMeasurementConfig = {
  exteriorTolerance: 0.35,
  contactTolerance: 0.06,
  minPanelLength: 1.0,
  minPanelHeight: 0.2,
  minJointLength: 0.2,
  wallNameIncludes: "PANEL",
  facadeStoreyNameIncludes: "FACHADA,ALZADO,CERRAMIENTO",
  includeUnnamedWalls: true,
  verticalAxis: "y",
};

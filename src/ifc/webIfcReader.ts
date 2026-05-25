import * as THREE from "three";
import * as WEBIFC from "web-ifc";
import type { Box3Like, Vec3 } from "../domain/vector";
import { createEmptyBox, expandBoxByBox, expandBoxByPoint, isValidBox } from "../domain/vector";
import type { IfcElementGeometry, IfcElementKind, IfcMeshData, IfcStoreyInfo } from "../domain/model";

type IfcApiLike = any;

type LineIdVector = {
  size(): number;
  get(index: number): number;
};

type ReadIfcModelResult = {
  modelId: number;
  elements: IfcElementGeometry[];
  modelBox: Box3Like;
  storeys: IfcStoreyInfo[];
};

type SpatialAssignment = {
  storeyExpressId: number;
  storeyName: string;
};

const ELEMENT_TYPES: Array<{ constant: keyof typeof WEBIFC; kind: IfcElementKind }> = [
  { constant: "IFCWALL" as keyof typeof WEBIFC, kind: "wall" },
  { constant: "IFCWALLSTANDARDCASE" as keyof typeof WEBIFC, kind: "wall" },
  { constant: "IFCBEAM" as keyof typeof WEBIFC, kind: "beam" },
  { constant: "IFCCOLUMN" as keyof typeof WEBIFC, kind: "column" },
  { constant: "IFCSLAB" as keyof typeof WEBIFC, kind: "slab" },
  { constant: "IFCPLATE" as keyof typeof WEBIFC, kind: "plate" },
  { constant: "IFCBUILDINGELEMENTPART" as keyof typeof WEBIFC, kind: "buildingElementPart" },
  { constant: "IFCMEMBER" as keyof typeof WEBIFC, kind: "member" },
];

function vectorToArray<T = any>(collection: any): T[] {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection as T[];
  if (typeof collection[Symbol.iterator] === "function") return Array.from(collection) as T[];
  if (typeof collection.size === "function" && typeof collection.get === "function") {
    const result: T[] = [];
    for (let i = 0; i < collection.size(); i += 1) result.push(collection.get(i));
    return result;
  }
  return [];
}

function getIfcTypeValue(constant: keyof typeof WEBIFC): number | undefined {
  const value = (WEBIFC as Record<string, unknown>)[constant as string];
  return typeof value === "number" ? value : undefined;
}

function unwrapIfcValue(value: any): string | number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value.value === "string" || typeof value.value === "number") return value.value;
  if (typeof value._representationValue === "string" || typeof value._representationValue === "number") {
    return value._representationValue;
  }
  return undefined;
}

function getHandleValue(value: any): number | undefined {
  const raw = unwrapIfcValue(value);
  return typeof raw === "number" ? raw : undefined;
}

function getLineName(line: any): string {
  const raw = unwrapIfcValue(line?.Name) ?? "";
  return typeof raw === "string" ? raw : String(raw ?? "");
}

function colorFromPlacedGeometry(geometry: any): [number, number, number, number] | undefined {
  const color = geometry?.color;
  if (!color) return undefined;
  if (Array.isArray(color)) return [color[0] ?? 0.65, color[1] ?? 0.65, color[2] ?? 0.65, color[3] ?? 1];
  return [color.x ?? color.r ?? 0.65, color.y ?? color.g ?? 0.65, color.z ?? color.b ?? 0.65, color.w ?? color.a ?? 1];
}

function getPlacedGeometryMatrix(geometry: any): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  const values = geometry?.flatTransformation;
  if (values && values.length >= 16) {
    const array = Array.from(values as ArrayLike<number>).slice(0, 16);
    matrix.fromArray(array);
  }
  return matrix;
}

function transformVertex(position: Float32Array, offset: number, matrix: THREE.Matrix4): Vec3 {
  const vertex = new THREE.Vector3(position[offset], position[offset + 1], position[offset + 2]);
  vertex.applyMatrix4(matrix);
  return { x: vertex.x, y: vertex.y, z: vertex.z };
}

function getLineIds(api: IfcApiLike, modelId: number, type: number): number[] {
  try {
    const ids = api.GetLineIDsWithType(modelId, type) as LineIdVector;
    const result: number[] = [];
    for (let i = 0; i < ids.size(); i += 1) result.push(ids.get(i));
    return result;
  } catch {
    return [];
  }
}

function getSpatialContainment(api: IfcApiLike, modelId: number): { storeys: IfcStoreyInfo[]; assignments: Map<number, SpatialAssignment> } {
  const storeysById = new Map<number, IfcStoreyInfo>();
  const assignments = new Map<number, SpatialAssignment>();

  const storeyType = getIfcTypeValue("IFCBUILDINGSTOREY" as keyof typeof WEBIFC);
  if (storeyType) {
    for (const expressId of getLineIds(api, modelId, storeyType)) {
      try {
        const line = api.GetLine(modelId, expressId, false);
        storeysById.set(expressId, { expressId, name: getLineName(line) });
      } catch {
        // Ignore malformed spatial structure lines.
      }
    }
  }

  const relType = getIfcTypeValue("IFCRELCONTAINEDINSPATIALSTRUCTURE" as keyof typeof WEBIFC);
  if (relType) {
    for (const relId of getLineIds(api, modelId, relType)) {
      try {
        const rel = api.GetLine(modelId, relId, false);
        const storeyExpressId = getHandleValue(rel?.RelatingStructure);
        if (storeyExpressId === undefined) continue;

        const storey = storeysById.get(storeyExpressId);
        if (!storey) continue;

        for (const related of vectorToArray(rel?.RelatedElements)) {
          const elementId = getHandleValue(related);
          if (elementId === undefined) continue;
          assignments.set(elementId, { storeyExpressId: storey.expressId, storeyName: storey.name });
        }
      } catch {
        // Ignore unsupported relationship lines.
      }
    }
  }

  return { storeys: [...storeysById.values()], assignments };
}

export class WebIfcReader {
  private api?: IfcApiLike;

  async init(wasmPath = "/wasm/"): Promise<void> {
    if (this.api) return;
    const IfcApiCtor = (WEBIFC as any).IfcAPI;
    this.api = new IfcApiCtor();
    if (typeof this.api.SetWasmPath === "function") this.api.SetWasmPath(wasmPath, true);
    await this.api.Init();
  }

  async read(buffer: ArrayBuffer): Promise<ReadIfcModelResult> {
    if (!this.api) await this.init();
    const api = this.api!;
    const modelId = api.OpenModel(new Uint8Array(buffer));
    const elements: IfcElementGeometry[] = [];
    const seen = new Set<number>();
    const spatial = getSpatialContainment(api, modelId);

    for (const { constant, kind } of ELEMENT_TYPES) {
      const type = getIfcTypeValue(constant);
      if (!type) continue;

      for (const expressId of getLineIds(api, modelId, type)) {
        if (seen.has(expressId)) continue;
        seen.add(expressId);

        const element = this.readElement(api, modelId, expressId, type, kind, spatial.assignments.get(expressId));
        if (element) elements.push(element);
      }
    }

    const modelBox = createEmptyBox();
    for (const element of elements) expandBoxByBox(modelBox, element.bbox);

    return { modelId, elements, modelBox, storeys: spatial.storeys };
  }

  close(modelId: number): void {
    if (!this.api) return;
    try {
      this.api.CloseModel(modelId);
    } catch {
      // Ignore close errors from older web-ifc builds.
    }
  }

  private readElement(
    api: IfcApiLike,
    modelId: number,
    expressId: number,
    type: number,
    kind: IfcElementKind,
    spatial?: SpatialAssignment,
  ): IfcElementGeometry | undefined {
    let line: any;
    try {
      line = api.GetLine(modelId, expressId, false);
    } catch {
      line = undefined;
    }

    const meshes: IfcMeshData[] = [];
    const bbox = createEmptyBox();

    try {
      const flatMesh = api.GetFlatMesh(modelId, expressId);
      for (const placedGeometry of vectorToArray(flatMesh.geometries)) {
        const geometry = api.GetGeometry(modelId, placedGeometry.geometryExpressID);
        const vertexData = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize()) as Float32Array;
        const indexData = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize()) as Uint32Array;
        const transform = getPlacedGeometryMatrix(placedGeometry);

        const vertexCount = vertexData.length / 6;
        const positions = new Float32Array(vertexCount * 3);
        for (let source = 0, target = 0; source < vertexData.length; source += 6, target += 3) {
          const point = transformVertex(vertexData, source, transform);
          positions[target] = point.x;
          positions[target + 1] = point.y;
          positions[target + 2] = point.z;
          expandBoxByPoint(bbox, point);
        }

        const indices = new Uint32Array(indexData.length);
        indices.set(indexData);
        meshes.push({ positions, indices, color: colorFromPlacedGeometry(placedGeometry) });

        if (typeof geometry.delete === "function") geometry.delete();
      }
    } catch {
      // Some IFC entities are semantic-only or unsupported by the web-ifc geometry pipeline.
    }

    if (!isValidBox(bbox) || meshes.length === 0) return undefined;

    return {
      expressId,
      type,
      kind,
      name: getLineName(line),
      bbox,
      meshes,
      storeyExpressId: spatial?.storeyExpressId,
      storeyName: spatial?.storeyName,
    };
  }
}

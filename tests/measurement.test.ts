import { describe, expect, it } from "vitest";
import { DEFAULT_MEASUREMENT_CONFIG, type FacadePanel2D, type IfcElementGeometry } from "../src/domain/model";
import { overlap } from "../src/measurement/math";
import { detectSealJoints } from "../src/measurement/detectSealJoints";
import { classifyFacadePanels } from "../src/measurement/classifyFacadePanels";

function panel(partial: Partial<FacadePanel2D> & Pick<FacadePanel2D, "expressId" | "uMin" | "uMax" | "zMin" | "zMax">): FacadePanel2D {
  return {
    name: "PANEL",
    side: "ZMAX",
    uAxis: "x",
    vAxis: "y",
    normalAxis: "z",
    facadeKey: "STOREY:1",
    facadeName: "CERRAMIENTO ALZADO A",
    plane: 0,
    bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
    ...partial,
  };
}

function wall(
  expressId: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  storeyExpressId?: number,
  storeyName?: string,
): IfcElementGeometry {
  return {
    expressId,
    type: 0,
    kind: "wall",
    name: "PANEL",
    bbox: { min: { x: minX, y: minY, z: 0 }, max: { x: maxX, y: maxY, z: 3 } },
    meshes: [],
    storeyExpressId,
    storeyName,
  };
}

describe("measurement math", () => {
  it("computes interval overlap", () => {
    expect(overlap(0, 10, 5, 20)).toBe(5);
    expect(overlap(0, 10, 10, 20)).toBe(0);
    expect(overlap(0, 10, 2, 8)).toBe(6);
  });
});

describe("detectSealJoints", () => {
  it("detects vertical joints between adjacent panels in the same facade", () => {
    const joints = detectSealJoints(
      [
        panel({ expressId: 1, uMin: 0, uMax: 5, zMin: 0, zMax: 3 }),
        panel({ expressId: 2, uMin: 5.02, uMax: 10, zMin: 0, zMax: 3 }),
      ],
      DEFAULT_MEASUREMENT_CONFIG,
    );

    expect(joints).toHaveLength(1);
    expect(joints[0].type).toBe("vertical");
    expect(joints[0].facadeName).toBe("CERRAMIENTO ALZADO A");
    expect(joints[0].length).toBeCloseTo(3);
  });

  it("detects horizontal joints between stacked panels", () => {
    const joints = detectSealJoints(
      [
        panel({ expressId: 1, uMin: 0, uMax: 5, zMin: 0, zMax: 2 }),
        panel({ expressId: 2, uMin: 0, uMax: 5, zMin: 2.02, zMax: 4 }),
      ],
      DEFAULT_MEASUREMENT_CONFIG,
    );

    expect(joints).toHaveLength(1);
    expect(joints[0].type).toBe("horizontal");
    expect(joints[0].length).toBeCloseTo(5);
  });

  it("does not detect joints if the gap exceeds tolerance", () => {
    const joints = detectSealJoints(
      [
        panel({ expressId: 1, uMin: 0, uMax: 5, zMin: 0, zMax: 3 }),
        panel({ expressId: 2, uMin: 5.2, uMax: 10, zMin: 0, zMax: 3 }),
      ],
      DEFAULT_MEASUREMENT_CONFIG,
    );

    expect(joints).toHaveLength(0);
  });

  it("does not mix panels from different IFC facade storeys", () => {
    const joints = detectSealJoints(
      [
        panel({ expressId: 1, facadeKey: "STOREY:1", facadeName: "CERRAMIENTO ALZADO A", uMin: 0, uMax: 5, zMin: 0, zMax: 3 }),
        panel({ expressId: 2, facadeKey: "STOREY:2", facadeName: "CERRAMIENTO ALZADO B", uMin: 5.02, uMax: 10, zMin: 0, zMax: 3 }),
      ],
      DEFAULT_MEASUREMENT_CONFIG,
    );

    expect(joints).toHaveLength(0);
  });
});

describe("classifyFacadePanels", () => {
  it("uses the facade-panel envelope instead of the full structural model box", () => {
    const elements: IfcElementGeometry[] = [
      wall(1, 0, 10, 0, 0.2),
      wall(2, 0, 10, 9.8, 10),
      wall(3, 0, 0.2, 0, 10),
      wall(4, 9.8, 10, 0, 10),
      {
        expressId: 100,
        type: 0,
        kind: "beam",
        name: "ROOF OVERHANG",
        bbox: { min: { x: -1, y: -1, z: 3 }, max: { x: 11, y: 11, z: 4 } },
        meshes: [],
      },
    ];

    const panels = classifyFacadePanels(
      elements,
      { min: { x: -1, y: -1, z: 0 }, max: { x: 11, y: 11, z: 4 } },
      { ...DEFAULT_MEASUREMENT_CONFIG, verticalAxis: "z" },
    );

    expect(new Set(panels.map((item) => item.side))).toEqual(new Set(["XMIN", "XMAX", "YMIN", "YMAX"]));
  });


  it("projects Y-up facade storeys using the storey plane instead of assuming Z-up", () => {
    const elements: IfcElementGeometry[] = [
      {
        expressId: 1,
        type: 0,
        kind: "wall",
        name: "PANEL",
        bbox: { min: { x: 0, y: 0, z: -0.2 }, max: { x: 5, y: 2, z: 0 } },
        meshes: [],
        storeyExpressId: 58,
        storeyName: "CERRAMIENTO ALZADO A",
      },
      {
        expressId: 2,
        type: 0,
        kind: "wall",
        name: "PANEL",
        bbox: { min: { x: 5.02, y: 0, z: -0.2 }, max: { x: 10, y: 2, z: 0 } },
        meshes: [],
        storeyExpressId: 58,
        storeyName: "CERRAMIENTO ALZADO A",
      },
      {
        expressId: 3,
        type: 0,
        kind: "wall",
        name: "PANEL",
        bbox: { min: { x: 0, y: 2.02, z: -0.2 }, max: { x: 5, y: 4, z: 0 } },
        meshes: [],
        storeyExpressId: 58,
        storeyName: "CERRAMIENTO ALZADO A",
      },
    ];

    const panels = classifyFacadePanels(
      elements,
      { min: { x: 0, y: 0, z: -0.2 }, max: { x: 10, y: 4, z: 0 } },
      { ...DEFAULT_MEASUREMENT_CONFIG, verticalAxis: "y" },
    );
    const joints = detectSealJoints(panels, DEFAULT_MEASUREMENT_CONFIG);

    expect(new Set(panels.map((item) => item.side))).toEqual(new Set(["ZMIN"]));
    expect(joints.map((item) => item.type).sort()).toEqual(["horizontal", "vertical"]);
  });

  it("groups panels by IfcBuildingStorey facade names when available", () => {
    const elements: IfcElementGeometry[] = [
      wall(1, 0, 5, 0, 0.2, 54, "CERRAMIENTO ALZADO 1"),
      wall(2, 5, 10, 0, 0.2, 54, "CERRAMIENTO ALZADO 1"),
      wall(3, 0, 0.2, 0, 5, 58, "CERRAMIENTO ALZADO A"),
    ];

    const panels = classifyFacadePanels(
      elements,
      { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 5, z: 3 } },
      { ...DEFAULT_MEASUREMENT_CONFIG, verticalAxis: "z" },
    );

    expect(new Set(panels.map((item) => item.facadeName))).toEqual(new Set(["CERRAMIENTO ALZADO 1", "CERRAMIENTO ALZADO A"]));
    expect(panels.filter((item) => item.facadeName === "CERRAMIENTO ALZADO 1")).toHaveLength(2);
  });
});

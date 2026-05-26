import type { CornerMeasurementSummary, FacadeMeasurementSummary, FacadeSide, SealJoint, SealMeasurementReport } from "../domain/model";
import { meters } from "./math";

function makeFacadeSummary(panel: SealMeasurementReport["panels"][number]): FacadeMeasurementSummary {
  return {
    key: panel.facadeKey,
    name: panel.facadeName,
    side: panel.side,
    total: 0,
    vertical: 0,
    horizontal: 0,
    count: 0,
    panelCount: 0,
  };
}

export function buildMeasurementReport(joints: SealJoint[], panels: SealMeasurementReport["panels"]): SealMeasurementReport {
  const byFacade: SealMeasurementReport["byFacade"] = {};
  const byCorner = new Map<string, CornerMeasurementSummary>();

  for (const panel of panels) {
    byFacade[panel.facadeKey] ??= makeFacadeSummary(panel);
    byFacade[panel.facadeKey].panelCount += 1;
  }

  let vertical = 0;
  let horizontal = 0;
  let corner = 0;

  for (const joint of joints) {
    if (joint.type === "corner") {
      const summary = byCorner.get(joint.facadeKey) ?? {
        key: joint.facadeKey,
        name: joint.facadeName,
        facadeKeys: joint.relatedFacadeKeys,
        total: 0,
        count: 0,
      };
      summary.total += joint.length;
      summary.count += 1;
      byCorner.set(joint.facadeKey, summary);
      corner += joint.length;
      continue;
    }

    byFacade[joint.facadeKey] ??= {
      key: joint.facadeKey,
      name: joint.facadeName,
      side: joint.side as FacadeSide,
      total: 0,
      vertical: 0,
      horizontal: 0,
      count: 0,
      panelCount: 0,
    };

    const bucket = byFacade[joint.facadeKey];
    bucket.total += joint.length;
    bucket.count += 1;

    if (joint.type === "vertical") {
      vertical += joint.length;
      bucket.vertical += joint.length;
    }

    if (joint.type === "horizontal") {
      horizontal += joint.length;
      bucket.horizontal += joint.length;
    }
  }

  const facades = Object.values(byFacade)
    .map((facade) => ({
      ...facade,
      total: meters(facade.total),
      vertical: meters(facade.vertical),
      horizontal: meters(facade.horizontal),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.side.localeCompare(b.side));

  const corners = [...byCorner.values()]
    .map((item) => ({
      ...item,
      total: meters(item.total),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const roundedByFacade = Object.fromEntries(facades.map((facade) => [facade.key, facade])) as SealMeasurementReport["byFacade"];

  return {
    total: meters(vertical + horizontal + corner),
    vertical: meters(vertical),
    horizontal: meters(horizontal),
    corner: meters(corner),
    byFacade: roundedByFacade,
    facades,
    corners,
    joints,
    panels,
  };
}

export function reportToCsv(report: SealMeasurementReport): string {
  const lines = [
    [
      "id",
      "facade_name",
      "facade_key",
      "side",
      "type",
      "length_m",
      "element_a",
      "element_b",
      "start_x",
      "start_y",
      "start_z",
      "end_x",
      "end_y",
      "end_z",
    ].join(","),
  ];

  for (const joint of report.joints) {
    lines.push(
      [
        joint.id,
        joint.facadeName,
        joint.facadeKey,
        joint.side,
        joint.type,
        joint.length.toFixed(3),
        joint.elementA,
        joint.elementB ?? "",
        joint.start.x.toFixed(3),
        joint.start.y.toFixed(3),
        joint.start.z.toFixed(3),
        joint.end.x.toFixed(3),
        joint.end.y.toFixed(3),
        joint.end.z.toFixed(3),
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(","),
    );
  }

  return lines.join("\n");
}

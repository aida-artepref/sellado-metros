import type { FacadeMeasurementSummary, SealJoint, SealMeasurementReport } from "../domain/model";
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

  for (const panel of panels) {
    byFacade[panel.facadeKey] ??= makeFacadeSummary(panel);
    byFacade[panel.facadeKey].panelCount += 1;
  }

  let vertical = 0;
  let horizontal = 0;

  for (const joint of joints) {
    byFacade[joint.facadeKey] ??= {
      key: joint.facadeKey,
      name: joint.facadeName,
      side: joint.side,
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

  const roundedByFacade = Object.fromEntries(facades.map((facade) => [facade.key, facade])) as SealMeasurementReport["byFacade"];

  return {
    total: meters(vertical + horizontal),
    vertical: meters(vertical),
    horizontal: meters(horizontal),
    byFacade: roundedByFacade,
    facades,
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

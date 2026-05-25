import type { Box3Like } from "../domain/vector";
import type { IfcElementGeometry, SealMeasurementConfig, SealMeasurementReport } from "../domain/model";
import { classifyFacadePanels } from "./classifyFacadePanels";
import { detectSealJoints } from "./detectSealJoints";
import { buildMeasurementReport } from "./report";

export function calculateSealMeasurement(
  elements: IfcElementGeometry[],
  modelBox: Box3Like,
  config: SealMeasurementConfig,
): SealMeasurementReport {
  const panels = classifyFacadePanels(elements, modelBox, config);
  const joints = detectSealJoints(panels, config);
  return buildMeasurementReport(joints, panels);
}

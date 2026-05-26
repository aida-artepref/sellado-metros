import "./style.css";
import { DEFAULT_MEASUREMENT_CONFIG, type SealMeasurementConfig, type SealMeasurementReport } from "./domain/model";
import { WebIfcReader } from "./ifc/webIfcReader";
import { calculateSealMeasurement } from "./measurement/calculateSealMeasurement";
import { buildMeasurementReport, reportToCsv } from "./measurement/report";
import { downloadTextFile } from "./utils/download";
import { facadeColorHex, SealViewer } from "./viewer/SealViewer";
import type { Box3Like } from "./domain/vector";
import type { FacadeMeasurementSummary, IfcElementGeometry } from "./domain/model";

const SAMPLE_MODEL_URL = "/models/maderas-alonso.ifc";

type AppState = {
  reader: WebIfcReader;
  viewer: SealViewer;
  elements: IfcElementGeometry[];
  modelBox?: Box3Like;
  modelId?: number;
  baseReport?: SealMeasurementReport;
  report?: SealMeasurementReport;
  excludedJointIds: Set<string>;
  isolatedFacadeKeys: Set<string>;
};

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("Missing #app root");

appRoot.innerHTML = `
  <div class="sidebar">
    <section class="panel">
      <h2>Modelo</h2>
      <label class="file-input">
        <span>Cargar IFC</span>
        <input id="ifc-file" type="file" accept=".ifc" />
      </label>
      <button id="load-sample" type="button">Cargar modelo de ejemplo</button>
      <p id="status" class="status">Sin modelo cargado.</p>
    </section>

    <section class="panel">
      <h2>Reglas de medicion</h2>
      <div class="field-grid">
        <label>
          Tolerancia exterior (m)
          <input id="exteriorTolerance" type="number" step="0.01" value="${DEFAULT_MEASUREMENT_CONFIG.exteriorTolerance}" />
        </label>
        <label>
          Tolerancia contacto (m)
          <input id="contactTolerance" type="number" step="0.01" value="${DEFAULT_MEASUREMENT_CONFIG.contactTolerance}" />
        </label>
        <label>
          Long. minima panel (m)
          <input id="minPanelLength" type="number" step="0.1" value="${DEFAULT_MEASUREMENT_CONFIG.minPanelLength}" />
        </label>
        <label>
          Altura minima panel (m)
          <input id="minPanelHeight" type="number" step="0.1" value="${DEFAULT_MEASUREMENT_CONFIG.minPanelHeight}" />
        </label>
        <label>
          Long. minima junta (m)
          <input id="minJointLength" type="number" step="0.1" value="${DEFAULT_MEASUREMENT_CONFIG.minJointLength}" />
        </label>
        <label>
          Eje vertical geometria
          <select id="verticalAxis">
            <option value="y" selected>Y - Three.js / este IFC</option>
            <option value="z">Z - IFC estandar</option>
            <option value="x">X</option>
            <option value="auto">Auto</option>
          </select>
        </label>
        <label>
          Nombre elemento contiene
          <input id="wallNameIncludes" type="text" value="${DEFAULT_MEASUREMENT_CONFIG.wallNameIncludes ?? ""}" />
        </label>
        <label class="wide">
          IfcBuildingStorey fachada contiene
          <input id="facadeStoreyNameIncludes" type="text" value="${DEFAULT_MEASUREMENT_CONFIG.facadeStoreyNameIncludes ?? ""}" />
        </label>
      </div>
      <label class="checkbox">
        <input id="includeUnnamedWalls" type="checkbox" checked />
        Incluir muros sin nombre si cumplen geometria
      </label>
      <button id="calculate" type="button">Calcular sellado</button>
    </section>

    <section class="panel results">
      <h2>Resultado</h2>
      <div id="summary" class="summary empty">Carga un IFC y calcula.</div>
      <div class="actions">
        <button id="export-json" type="button" disabled>Exportar JSON</button>
        <button id="export-csv" type="button" disabled>Exportar CSV</button>
      </div>
      <div id="facade-table"></div>
    </section>
  </div>

  <main class="viewer-shell">
    <div id="viewer"></div>
    <div id="legend" class="legend empty">Los colores de las juntas se asignan por alzado.</div>
  </main>
`;

const viewerContainer = document.querySelector<HTMLDivElement>("#viewer");
if (!viewerContainer) throw new Error("Missing viewer container");

const state: AppState = {
  reader: new WebIfcReader(),
  viewer: new SealViewer(viewerContainer),
  elements: [],
  excludedJointIds: new Set<string>(),
  isolatedFacadeKeys: new Set<string>(),
};

state.viewer.setJointClickHandler((jointId) => {
  if (!state.baseReport) return;

  if (state.excludedJointIds.has(jointId)) state.excludedJointIds.delete(jointId);
  else state.excludedJointIds.add(jointId);

  syncReportWithExcludedJoints();
});

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element ${selector}`);
  return node;
}

function setStatus(message: string, kind: "idle" | "ok" | "error" = "idle"): void {
  const status = el<HTMLParagraphElement>("#status");
  status.textContent = message;
  status.dataset.kind = kind;
}

function readNumberInput(id: string): number {
  const input = el<HTMLInputElement>(`#${id}`);
  const value = Number(input.value);
  if (!Number.isFinite(value)) throw new Error(`Valor numerico invalido: ${id}`);
  return value;
}

function readConfig(): SealMeasurementConfig {
  const wallNameIncludes = el<HTMLInputElement>("#wallNameIncludes").value.trim();
  const facadeStoreyNameIncludes = el<HTMLInputElement>("#facadeStoreyNameIncludes").value.trim();
  return {
    exteriorTolerance: readNumberInput("exteriorTolerance"),
    contactTolerance: readNumberInput("contactTolerance"),
    minPanelLength: readNumberInput("minPanelLength"),
    minPanelHeight: readNumberInput("minPanelHeight"),
    minJointLength: readNumberInput("minJointLength"),
    wallNameIncludes: wallNameIncludes.length > 0 ? wallNameIncludes : undefined,
    facadeStoreyNameIncludes: facadeStoreyNameIncludes.length > 0 ? facadeStoreyNameIncludes : undefined,
    includeUnnamedWalls: el<HTMLInputElement>("#includeUnnamedWalls").checked,
    verticalAxis: el<HTMLSelectElement>("#verticalAxis").value as SealMeasurementConfig["verticalAxis"],
  };
}

async function loadIfcFromBuffer(buffer: ArrayBuffer, label: string): Promise<void> {
  setStatus(`Leyendo IFC: ${label}...`);

  if (state.modelId !== undefined) state.reader.close(state.modelId);

  const result = await state.reader.read(buffer);
  state.elements = result.elements;
  state.modelBox = result.modelBox;
  state.modelId = result.modelId;
  state.baseReport = undefined;
  state.report = undefined;
  state.excludedJointIds.clear();
  state.isolatedFacadeKeys.clear();

  state.viewer.setModel(result.elements, result.modelBox);
  state.viewer.setJoints([]);
  state.viewer.setIsolation();
  renderReport(undefined);

  const facadeTokens = ["FACHADA", "ALZADO", "CERRAMIENTO"];
  const facadeStoreys = result.storeys.filter((storey) => facadeTokens.some((token) => storey.name.toUpperCase().includes(token)));
  setStatus(
    `Modelo cargado: ${result.elements.length} elementos con geometria. ${facadeStoreys.length} fachadas IFC detectadas.`,
    "ok",
  );
}

async function loadIfcFromFile(file: File): Promise<void> {
  const buffer = await file.arrayBuffer();
  await loadIfcFromBuffer(buffer, file.name);
}

async function loadSampleModel(): Promise<void> {
  const response = await fetch(SAMPLE_MODEL_URL);
  if (!response.ok) throw new Error(`No se pudo cargar ${SAMPLE_MODEL_URL}`);
  await loadIfcFromBuffer(await response.arrayBuffer(), "maderas-alonso.ifc");
}

function calculate(): void {
  if (!state.modelBox || state.elements.length === 0) {
    setStatus("Carga un IFC antes de calcular.", "error");
    return;
  }

  const config = readConfig();
  state.baseReport = calculateSealMeasurement(state.elements, state.modelBox, config);
  state.excludedJointIds.clear();
  syncReportWithExcludedJoints();
}

function syncReportWithExcludedJoints(): void {
  if (!state.baseReport) {
    state.report = undefined;
    state.viewer.setJoints([]);
    renderReport(undefined);
    return;
  }

  const activeJoints = state.baseReport.joints.filter((joint) => !state.excludedJointIds.has(joint.id));
  const report = buildMeasurementReport(activeJoints, state.baseReport.panels);
  state.report = report;
  state.viewer.setJoints(state.baseReport.joints, state.excludedJointIds);
  applyFacadeIsolation();
  renderReport(report, state.baseReport.joints.length - activeJoints.length);

  const excludedCount = state.excludedJointIds.size;
  if (excludedCount > 0) {
    setStatus(
      `Calculo actualizado: ${report.total.toFixed(2)} m en ${report.joints.length} juntas activas. ${excludedCount} juntas excluidas.`,
      "ok",
    );
    return;
  }

  setStatus(`Calculo terminado: ${report.total.toFixed(2)} m en ${report.joints.length} juntas.`, "ok");
}

function renderReport(report?: SealMeasurementReport, excludedCount = 0): void {
  const summary = el<HTMLDivElement>("#summary");
  const table = el<HTMLDivElement>("#facade-table");
  const exportJson = el<HTMLButtonElement>("#export-json");
  const exportCsv = el<HTMLButtonElement>("#export-csv");

  exportJson.disabled = !report;
  exportCsv.disabled = !report;

  if (!report) {
    summary.className = "summary empty";
    summary.textContent = "Carga un IFC y calcula.";
    table.innerHTML = "";
    renderLegend();
    return;
  }

  summary.className = "summary";
  summary.innerHTML = `
    <strong>${report.total.toFixed(2)} m</strong>
    <span>Total sellado exterior detectado</span>
    <small>${report.horizontal.toFixed(2)} m horizontales + ${report.vertical.toFixed(2)} m verticales + ${report.corner.toFixed(2)} m esquinas</small>
    <small>${report.panels.length} paneles clasificados / ${report.joints.length} juntas</small>
    <small>${report.facades.length} fachadas IFC con paneles medidos</small>
    ${excludedCount > 0 ? `<small>${excludedCount} juntas excluidas manualmente</small>` : ""}
  `;

  table.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Fachada IFC</th>
          <th>Total</th>
          <th>Horiz.</th>
          <th>Vert.</th>
          <th>Juntas</th>
        </tr>
      </thead>
      <tbody>
        ${report.facades
          .map(
            (data) => `
              <tr>
                <td>${data.name}</td>
                <td>${data.total.toFixed(2)}</td>
                <td>${data.horizontal.toFixed(2)}</td>
                <td>${data.vertical.toFixed(2)}</td>
                <td>${data.count}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;

  renderLegend(report.facades, report.corners);
}

function renderLegend(facades: FacadeMeasurementSummary[] = [], corners: SealMeasurementReport["corners"] = []): void {
  const legend = el<HTMLDivElement>("#legend");

  if (facades.length === 0) {
    legend.className = "legend empty";
    legend.textContent = "Los colores de las juntas se asignan por alzado.";
    return;
  }

  const seen = new Set<string>();
  const uniqueFacades = facades.filter((facade) => {
    if (seen.has(facade.key)) return false;
    seen.add(facade.key);
    return true;
  });

  legend.className = "legend";
  const facadeItems = uniqueFacades
    .map(
      (facade) =>
        `<button type="button" class="legend-item${state.isolatedFacadeKeys.has(facade.key) ? " active" : ""}" data-facade-key="${facade.key}">
          <i style="background:#${facadeColorHex(facade.key)}"></i>
          <span class="legend-copy">
            <strong>${facade.name}</strong>
            <small>${facade.total.toFixed(2)} m</small>
          </span>
        </button>`,
    )
    .join("");

  const cornerItems =
    corners.length === 0
      ? ""
      : `
        <div class="legend-section-title">Esquinas</div>
        ${corners
          .map(
            (corner) => `
              <div class="legend-corner">
                <i class="corner-chip"></i>
                <span class="legend-copy">
                  <strong>${corner.name}</strong>
                  <small>${corner.total.toFixed(2)} m</small>
                </span>
              </div>`,
          )
          .join("")}
      `;

  legend.innerHTML = facadeItems + cornerItems;
}

function applyFacadeIsolation(): void {
  if (!state.baseReport || state.isolatedFacadeKeys.size === 0) {
    state.viewer.setIsolation();
    return;
  }

  const visibleElementIds = new Set(
    state.baseReport.panels.filter((panel) => state.isolatedFacadeKeys.has(panel.facadeKey)).map((panel) => panel.expressId),
  );
  state.viewer.setIsolation(visibleElementIds, state.isolatedFacadeKeys);
}

el<HTMLDivElement>("#legend").addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>(".legend-item");
  if (!button) return;

  const facadeKey = button.dataset.facadeKey;
  if (!facadeKey || !state.baseReport) return;

  if (state.isolatedFacadeKeys.has(facadeKey)) state.isolatedFacadeKeys.delete(facadeKey);
  else state.isolatedFacadeKeys.add(facadeKey);

  applyFacadeIsolation();
  renderLegend(state.report?.facades ?? []);
});

el<HTMLInputElement>("#ifc-file").addEventListener("change", async (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    await loadIfcFromFile(file);
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : "Error cargando IFC.", "error");
  }
});

el<HTMLButtonElement>("#load-sample").addEventListener("click", async () => {
  try {
    await loadSampleModel();
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : "Error cargando ejemplo.", "error");
  }
});

el<HTMLButtonElement>("#calculate").addEventListener("click", () => {
  try {
    calculate();
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : "Error calculando sellado.", "error");
  }
});

el<HTMLButtonElement>("#export-json").addEventListener("click", () => {
  if (!state.report) return;
  downloadTextFile("seal-measurement.json", JSON.stringify(state.report, null, 2), "application/json");
});

el<HTMLButtonElement>("#export-csv").addEventListener("click", () => {
  if (!state.report) return;
  downloadTextFile("seal-joints.csv", reportToCsv(state.report), "text/csv");
});

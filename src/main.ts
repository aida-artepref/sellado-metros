import "./style.css";
import { DEFAULT_MEASUREMENT_CONFIG, type SealMeasurementConfig, type SealMeasurementReport } from "./domain/model";
import { WebIfcReader } from "./ifc/webIfcReader";
import { calculateSealMeasurement } from "./measurement/calculateSealMeasurement";
import { reportToCsv } from "./measurement/report";
import { downloadTextFile } from "./utils/download";
import { SealViewer } from "./viewer/SealViewer";
import type { Box3Like } from "./domain/vector";
import type { IfcElementGeometry } from "./domain/model";

const SAMPLE_MODEL_URL = "/models/maderas-alonso.ifc";

type AppState = {
  reader: WebIfcReader;
  viewer: SealViewer;
  elements: IfcElementGeometry[];
  modelBox?: Box3Like;
  modelId?: number;
  report?: SealMeasurementReport;
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
    <div class="legend">
      <span><i class="vertical"></i> Junta vertical</span>
      <span><i class="horizontal"></i> Junta horizontal</span>
    </div>
  </main>
`;

const viewerContainer = document.querySelector<HTMLDivElement>("#viewer");
if (!viewerContainer) throw new Error("Missing viewer container");

const state: AppState = {
  reader: new WebIfcReader(),
  viewer: new SealViewer(viewerContainer),
  elements: [],
};

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
  state.report = undefined;

  state.viewer.setModel(result.elements, result.modelBox);
  state.viewer.setJoints([]);
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
  const report = calculateSealMeasurement(state.elements, state.modelBox, config);
  state.report = report;
  state.viewer.setJoints(report.joints);
  renderReport(report);
  setStatus(`Calculo terminado: ${report.total.toFixed(2)} m en ${report.joints.length} juntas.`, "ok");
}

function renderReport(report?: SealMeasurementReport): void {
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
    return;
  }

  summary.className = "summary";
  summary.innerHTML = `
    <strong>${report.total.toFixed(2)} m</strong>
    <span>Total sellado exterior detectado</span>
    <small>${report.horizontal.toFixed(2)} m horizontales + ${report.vertical.toFixed(2)} m verticales</small>
    <small>${report.panels.length} paneles clasificados / ${report.joints.length} juntas</small>
    <small>${report.facades.length} fachadas IFC con paneles medidos</small>
  `;

  table.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Fachada IFC</th>
          <th>Lado</th>
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
                <td>${data.side}</td>
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
}

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

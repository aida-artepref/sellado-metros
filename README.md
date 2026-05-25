# IFC Seal Meter

MVP en TypeScript para estimar metros lineales de sellado exterior en modelos IFC de paneles prefabricados.

El proyecto esta pensado para modelos exportados desde Allplan donde los alzados/fachadas estan organizados como `IfcBuildingStorey`, por ejemplo:

```text
CERRAMIENTO ALZADO 1
CERRAMIENTO ALZADO A
CERRAMIENTO ALZADO 10
CERRAMIENTO ALZADO D
```

El calculo se basa en geometria: bounding boxes, proyeccion 2D de cada alzado y deteccion de contactos panel-panel. El listado final se agrupa por el nombre real de la fachada IFC.

## Stack

- Vite + TypeScript
- Three.js para visualizar
- web-ifc para leer geometria IFC en navegador
- Vitest para tests del nucleo de medicion

## Ejecutar

```bash
npm install
npm run dev
```

Abre:

```text
http://localhost:5173
```

El modelo que has subido esta incluido como:

```text
public/models/maderas-alonso.ifc
```

En la app puedes pulsar **Cargar modelo de ejemplo** o cargar cualquier IFC desde disco.

## Scripts

```bash
npm run dev      # desarrollo
npm run build    # compila TypeScript y genera dist
npm run test     # tests unitarios del algoritmo
npm run preview  # preview de build
```

El script `postinstall` copia automaticamente los `.wasm` de `web-ifc` a `public/wasm`.

## Criterio de medicion implementado

El MVP mide juntas entre paneles exteriores:

1. Lee geometria de elementos IFC relevantes.
2. Lee `IfcBuildingStorey` y `IfcRelContainedInSpatialStructure` para saber en que alzado/fachada esta cada elemento.
3. Filtra muros (`IfcWall` / `IfcWallStandardCase`).
4. Da prioridad a los paneles cuyo `IfcBuildingStorey.Name` contiene alguno de estos tokens configurables:
   - `FACHADA`
   - `ALZADO`
   - `CERRAMIENTO`
5. Agrupa los paneles por fachada IFC real, no solo por `XMIN/XMAX/YMIN/YMAX`.
6. Calcula el lado geometrico de cada fachada para poder proyectarla a 2D.
7. Detecta:
   - juntas verticales entre paneles adyacentes
   - juntas horizontales entre paneles apilados
8. Dibuja las juntas sobre el modelo:
   - rojo = vertical
   - azul = horizontal
9. Exporta JSON y CSV con `facade_name`, `facade_key`, lado geometrico y metros.

## Parametros principales

Desde la interfaz puedes ajustar:

- `Tolerancia exterior`: distancia maxima para considerar un panel como parte de la piel exterior en modo fallback geometrico.
- `Tolerancia contacto`: separacion maxima entre paneles para considerar que hay junta.
- `Long. minima panel`: evita piezas pequenas o auxiliares.
- `Altura minima panel`: evita geometria no relevante.
- `Long. minima junta`: descarta segmentos residuales.
- `Nombre elemento contiene`: por defecto `PANEL`.
- `IfcBuildingStorey fachada contiene`: por defecto `FACHADA,ALZADO,CERRAMIENTO`.
- `Incluir muros sin nombre`: util para modelos IFC sin atributos.

## Salida esperada

La tabla lateral lista por fachada IFC:

```text
Fachada IFC              Lado   Total   Horiz.   Vert.   Juntas
CERRAMIENTO ALZADO 1     YMIN   ...     ...      ...     ...
CERRAMIENTO ALZADO A     XMIN   ...     ...      ...     ...
CERRAMIENTO ALZADO 10    YMAX   ...     ...      ...     ...
CERRAMIENTO ALZADO D     XMAX   ...     ...      ...     ...
```

## Limitaciones actuales

No incluye todavia:

- juntas de esquina como regla independiente
- junta inferior contra solera o cimentacion
- junta superior contra cubierta o coronacion
- encuentros panel-pilar
- huecos si no vienen modelados como entidades IFC
- validacion manual de juntas desde la UI
- persistencia de mediciones

## Estructura

```text
src/
  domain/
    model.ts
    vector.ts
  ifc/
    webIfcReader.ts
  measurement/
    calculateSealMeasurement.ts
    classifyFacadePanels.ts
    detectSealJoints.ts
    math.ts
    report.ts
    segment3d.ts
  viewer/
    SealViewer.ts
  utils/
    download.ts
  main.ts
  style.css
```

## Siguiente fase recomendada

1. Anadir panel de revision manual de juntas.
2. Permitir activar/desactivar juntas detectadas.
3. Anadir regla de esquinas.
4. Anadir regla de arranque y coronacion configurables.
5. Guardar mediciones validadas en JSON.
6. Exportar informe por fachada, tipo de junta y elemento IFC.
7. Migrar el visor a ThatOpen Components si quieres integrarlo con tu stack BIM interno.

## Nota tecnica

La prioridad actual es aprovechar la estructura del IFC. Si existen fachadas como `IfcBuildingStorey`, el algoritmo agrupa por esos nombres. Si el IFC no trae esa estructura, hace fallback a clasificacion geometrica por lados `XMIN`, `XMAX`, `YMIN` y `YMAX`.

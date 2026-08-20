/* =========================================================================
   Inventario 3D — Depto. Mecánica Suspensiones CCS
   Lee en vivo, desde el navegador del usuario, las pestañas del Google
   Sheet de inventario via Google Sheets API v4 (batchGet), con una API key
   restringida por dominio. No hay backend propio: "tiempo real" = polling
   cada REFRESH_MS + botón manual.

   Esquema de columnas confirmado leyendo el Sheet real el 2026-08-19 — ver
   Inventario/MEMORY.md si el Sheet cambia de estructura más adelante.
   ========================================================================= */

const CONFIG = {
  API_KEY: "AIzaSyBlYTRyvXxl6ANsN-tWpMRhF3pzoWvn1Gk",
  SPREADSHEET_ID: "1Ax1R1Qw_mWcdRFqCWK063SpRNtnpH9ilpi1wh6izShY",
  REFRESH_MS: 5 * 60 * 1000, // 5 minutos
  RANGES: {
    impresiones: "'Inventario de impresiones'!A3:P",
    filamento: "'Inventario filamento'!A3:J",
    control: "'Control de Filamento'!A2:D",
    ensamblaje: "'Inventario Ensamblaje'!A3:E",
    historial: "'Historial Impresoras'!A2:H",
  },
  // Sheet aparte (spreadsheet distinto) del estudio de caudal/ventiladores —
  // agregado 2026-08-19 para la pestaña "Análisis de Datos".
  ANALISIS_SPREADSHEET_ID: "1Wwn8-abBiuTHG_CIN8tMJ0dOBUqHNcJJ4J2BukHID7k",
  ANALISIS_RANGE: "Caudal!A6:M26",
};

// Tarifa de costo por gramo, igual a la que usa el puente Apps Script
// (sheets_to_notion.gs) al calcular el campo "Costo" — ver project_suscss_notion_sync.
const RATE_PER_GRAM = { ASA: 0.045, TPU: 0.06, PLA: 0.03 };

const PALETTE = {
  blue: "#2A78D6",
  aqua: "#1BAF7A",
  yellow: "#EDA100",
  bad: "#E4544D",
  ink2: "#AEB7C4",
  muted: "#6E7A8C",
  grid: "#1E2A3B",
  axis: "#2B3A4F",
};

// ---------------------------------------------------------------- state ----

const state = {
  impresiones: [],
  filamento: [],
  control: [],
  ensamblaje: [],
  historial: [],
  analisis: [], // estudio de caudal/ventiladores (spreadsheet aparte)
  filters: { tipoFilamento: "", material: "", materialHistorial: "" },
  charts: {}, // nombre -> instancia Chart.js activa (se destruyen antes de recrear)
};

// -------------------------------------------------------------- helpers ----

function parseNum(v) {
  if (v === undefined || v === null || v === "") return 0;
  const cleaned = String(v).replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// El Sheet de análisis CFM usa coma como separador decimal ("63,56"), a
// diferencia del Sheet de inventario (punto, "530.00") — parser aparte para
// no romper parseNum() en el resto de la página. Verificado 2026-08-19: no usa
// punto de miles, solo coma decimal, así que basta reemplazar la primera coma.
function parseNumEs(v) {
  if (v === undefined || v === null || v === "") return 0;
  const cleaned = String(v).replace(",", ".").replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseMinutos(v) {
  if (!v) return 0;
  const s = String(v);
  const h = s.match(/(\d+)\s*h/);
  const m = s.match(/(\d+)\s*m/);
  if (h || m) return (h ? parseInt(h[1], 10) : 0) * 60 + (m ? parseInt(m[1], 10) : 0);
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function firstToken(v) {
  return (v || "").trim().split(/\s+/)[0] || "";
}

function fmtNum(n, decimals = 0) {
  return n.toLocaleString("es-VE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtMoney(n) {
  return "$" + fmtNum(n, 2);
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// El Sheet tiene filas-plantilla vacías al final de algunas pestañas (con solo un
// residuo de fórmula tipo "0.00 g" en una columna) que el rango abierto A:P igual
// trae. Se descartan por la columna identificadora real de cada tabla.
function dropBlankRows(rows, keyIndex) {
  return rows.filter((r) => (r[keyIndex] || "").toString().trim() !== "");
}

function uniqueSorted(arr) {
  return [...new Set(arr.filter((v) => v !== undefined && v !== null && v !== ""))].sort((a, b) => a.localeCompare(b, "es"));
}

// El Sheet de análisis usa celdas combinadas (Ventilador/Condición/Disposición/
// Tipo de Filtro se escriben una sola vez y se "combinan" visualmente hacia
// abajo) — la API los devuelve en blanco en las filas de continuación. Se
// rellenan hacia abajo con el último valor no vacío visto en cada columna.
function forwardFill(rows, cols) {
  const last = {};
  return rows.map((r) => {
    const filled = r.slice();
    cols.forEach((c) => {
      if (filled[c]) last[c] = filled[c];
      else if (last[c] !== undefined) filled[c] = last[c];
    });
    return filled;
  });
}

// ----------------------------------------------------------------- fetch ----

async function fetchAllSheets() {
  const ranges = Object.values(CONFIG.RANGES)
    .map((r) => "ranges=" + encodeURIComponent(r))
    .join("&");
  // FORMATTED_VALUE (default) a propósito: así los valores llegan tal como se ven
  // en el Sheet (ej. "530.00 g", "$22.00"), que es lo que parseNum()/las tablas
  // esperan y lo que se verificó manualmente antes de escribir este archivo.
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values:batchGet` +
    `?${ranges}&key=${CONFIG.API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Sheets API respondió ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const keys = Object.keys(CONFIG.RANGES);
  const out = {};
  data.valueRanges.forEach((vr, i) => {
    out[keys[i]] = vr.values || [];
  });
  return out;
}

// Sheet aparte (spreadsheet distinto) — se pide por separado porque
// values:batchGet solo admite rangos dentro de UN spreadsheet a la vez.
async function fetchAnalisisSheet() {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.ANALISIS_SPREADSHEET_ID}/values/` +
    `${encodeURIComponent(CONFIG.ANALISIS_RANGE)}?key=${CONFIG.API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Sheets API (análisis) respondió ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.values || [];
}

// ---------------------------------------------------------------- render ----

function kpiCard(label, value, { sub = "", accent = PALETTE.blue, bad = false } = {}) {
  return `<div class="kpi-card" style="--accent:${accent}">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value ${bad ? "bad" : ""}">${value}</div>
    ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ""}
  </div>`;
}

function renderTable(elId, headers, rows) {
  const el = document.getElementById(elId);
  if (!rows.length) {
    el.innerHTML = `<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
      <tbody><tr class="empty-row"><td colspan="${headers.length}">Sin filas para mostrar con el filtro actual.</td></tr></tbody>`;
    return;
  }
  el.innerHTML =
    `<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

function baseChartOptions(extra = {}) {
  return Object.assign(
    {
      responsive: true,
      maintainAspectRatio: false,
      // datalabels deshabilitado por defecto: solo se activa explícitamente en los
      // dos gráficos de una sola serie (chartImpresionesTipo, chartFilamentoDisponible)
      // que pasan su propio bloque "plugins" — el resto queda sin etiquetas directas.
      plugins: { legend: { display: false }, datalabels: { display: false } },
      scales: {
        x: { grid: { color: PALETTE.grid }, ticks: { color: PALETTE.muted, font: { size: 10.5 } } },
        y: { grid: { color: PALETTE.grid }, ticks: { color: PALETTE.muted, font: { size: 10.5 } }, beginAtZero: true },
      },
    },
    extra
  );
}

function makeChart(canvasId, config) {
  const ctx = document.getElementById(canvasId);
  if (state.charts[canvasId]) state.charts[canvasId].destroy();
  state.charts[canvasId] = new Chart(ctx, config);
}

// Construye el gráfico "Filamento consumido (g) por material" — una sola
// función usada tanto en Inicio como en Filamento para que sean IDÉNTICOS.
//
// Cambio 2026-08-19: antes graficaba "Disponible (g)", que podía salir
// negativo (desfase de registro, ver banner de la sección Filamento) y el
// usuario lo consideró que "no tiene sentido" como gráfico — una barra que
// cuelga por debajo de cero se lee como algo roto, no como un dato útil. Se
// reemplazó por "Consumido Total (g)" (columna C de Control de Filamento),
// que nunca es negativo por definición, y sigue siendo la misma dimensión de
// filtro (Material) así que el resaltado del material seleccionado se
// mantiene igual. El "Disponible" (con su posible negativo) se conserva en
// las tarjetas KPI de texto, donde un número en rojo comunica el déficit sin
// el problema visual de una barra invertida.
function buildFilamentChartConfig(materiales, highlight = "") {
  return {
    type: "bar",
    data: {
      labels: materiales.map((r) => r[0]),
      datasets: [
        {
          data: materiales.map((r) => parseNum(r[2])),
          backgroundColor: PALETTE.blue,
          borderColor: materiales.map((r) => (r[0] === highlight ? PALETTE.yellow : "transparent")),
          borderWidth: materiales.map((r) => (r[0] === highlight ? 3 : 0)),
          borderRadius: 4,
        },
      ],
    },
    options: baseChartOptions({
      plugins: {
        legend: { display: false },
        datalabels: { color: PALETTE.ink2, font: { size: 10 }, formatter: (v) => fmtNum(v), anchor: "end", align: "top" },
      },
    }),
  };
}

// --------------------------------------------------------- sección Inicio ----

function renderInicio() {
  const totalPiezas = state.impresiones.length;
  const enStock = state.impresiones.reduce((s, r) => s + parseNum(r[10]), 0);
  const entregadas = state.impresiones.reduce((s, r) => s + parseNum(r[11]), 0);
  const filamentoDisponible = state.control.reduce((s, r) => s + parseNum(r[3]), 0);

  document.getElementById("kpiInicio").innerHTML = [
    kpiCard("Piezas en catálogo", fmtNum(totalPiezas), { accent: PALETTE.blue }),
    kpiCard("Piezas en stock", fmtNum(enStock), { accent: PALETTE.aqua }),
    kpiCard("Piezas entregadas", fmtNum(entregadas), { accent: PALETTE.yellow }),
    kpiCard("Filamento disponible (neto)", fmtNum(filamentoDisponible) + " g", {
      accent: filamentoDisponible < 0 ? PALETTE.bad : PALETTE.aqua,
      bad: filamentoDisponible < 0,
      sub: "Suma de todos los materiales — puede ser negativo si hay déficit",
    }),
  ].join("");

  const materiales = state.control.filter((r) => r[0]);
  makeChart("chartInicioFilamento", buildFilamentChartConfig(materiales));
}

// ---------------------------------------------------- sección Impresiones ----

function populateFilterTipoFilamento() {
  const sel = document.getElementById("filterTipoFilamento");
  const values = uniqueSorted(state.impresiones.map((r) => r[4]));
  sel.innerHTML = `<option value="">(Todas)</option>` + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  sel.value = state.filters.tipoFilamento;
}

function renderImpresiones() {
  populateFilterTipoFilamento();
  const filtro = state.filters.tipoFilamento;
  const filas = filtro ? state.impresiones.filter((r) => r[4] === filtro) : state.impresiones;

  const enStock = filas.reduce((s, r) => s + parseNum(r[10]), 0);
  const entregadas = filas.reduce((s, r) => s + parseNum(r[11]), 0);
  const costo = filas.reduce((s, r) => {
    const rate = RATE_PER_GRAM[firstToken(r[4]).toUpperCase()] || 0;
    return s + rate * parseNum(r[6]);
  }, 0);

  document.getElementById("kpiImpresiones").innerHTML = [
    kpiCard("Piezas" + (filtro ? ` (${filtro})` : ""), fmtNum(filas.length), { accent: PALETTE.blue }),
    kpiCard("En stock", fmtNum(enStock), { accent: PALETTE.aqua }),
    kpiCard("Entregadas", fmtNum(entregadas), { accent: PALETTE.yellow }),
    kpiCard("Costo estimado en stock", fmtMoney(costo), { accent: PALETTE.blue, sub: "Solo ASA/TPU/PLA, misma tarifa que Apps Script" }),
  ].join("");

  // gráfico estático (misma dimensión que el filtro -> no reacciona, por regla de interactive-filter.md)
  const porTipo = {};
  state.impresiones.forEach((r) => {
    const t = r[4] || "(Sin tipo)";
    porTipo[t] = (porTipo[t] || 0) + 1;
  });
  const tiposOrdenados = Object.entries(porTipo).sort((a, b) => b[1] - a[1]);
  makeChart("chartImpresionesTipo", {
    type: "bar",
    data: {
      labels: tiposOrdenados.map((e) => e[0]),
      datasets: [{ data: tiposOrdenados.map((e) => e[1]), backgroundColor: PALETTE.blue, borderRadius: 4 }],
    },
    options: baseChartOptions({
      plugins: {
        legend: { display: false },
        datalabels: { color: PALETTE.ink2, anchor: "end", align: "top", font: { size: 10 } },
      },
    }),
  });

  // Top 10 en stock — filtro-reactivo
  const top10 = [...filas].sort((a, b) => parseNum(b[10]) - parseNum(a[10])).slice(0, 10);
  makeChart("chartImpresionesTop", {
    type: "bar",
    data: {
      labels: top10.map((r) => (r[2] || r[1] || "").slice(0, 28)),
      datasets: [{ data: top10.map((r) => parseNum(r[10])), backgroundColor: PALETTE.aqua, borderRadius: 4 }],
    },
    options: baseChartOptions({ indexAxis: "y" }),
  });

  renderTable(
    "tablaImpresiones",
    ["N° Serie", "Nombre", "Tipo filamento", "Filamento usado", "Precio PP", "Precio PM", "En stock", "Entregado"],
    filas.map((r) => [
      `<span class="cell-strong">${esc(r[1])}</span>`,
      esc(r[2]),
      esc(r[4]),
      esc(r[6]),
      fmtMoney(parseNum(r[8])),
      fmtMoney(parseNum(r[9])),
      parseNum(r[10]) > 0 ? `<span class="cell-good">${fmtNum(parseNum(r[10]))}</span>` : fmtNum(parseNum(r[10])),
      fmtNum(parseNum(r[11])),
    ])
  );
}

// ------------------------------------------------------ sección Filamento ----

function populateFilterMaterial() {
  const sel = document.getElementById("filterMaterial");
  const values = state.control.map((r) => r[0]).filter(Boolean);
  sel.innerHTML = `<option value="">(Todos)</option>` + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  sel.value = state.filters.material;
}

function renderFilamento() {
  populateFilterMaterial();
  const filtro = state.filters.material;

  const controlFilas = filtro ? state.control.filter((r) => r[0] === filtro) : state.control.filter((r) => r[0]);
  const stockInicial = controlFilas.reduce((s, r) => s + parseNum(r[1]), 0);
  const consumido = controlFilas.reduce((s, r) => s + parseNum(r[2]), 0);
  const disponible = controlFilas.reduce((s, r) => s + parseNum(r[3]), 0);
  const enDeficit = state.control.filter((r) => r[0] && parseNum(r[3]) < 0).length;

  document.getElementById("kpiFilamento").innerHTML = [
    kpiCard("Stock inicial" + (filtro ? ` (${filtro})` : " total"), fmtNum(stockInicial) + " g", { accent: PALETTE.blue }),
    kpiCard("Consumido", fmtNum(consumido) + " g", { accent: PALETTE.yellow }),
    kpiCard("Disponible", fmtNum(disponible) + " g", { accent: disponible < 0 ? PALETTE.bad : PALETTE.aqua, bad: disponible < 0 }),
    kpiCard("Materiales en déficit", fmtNum(enDeficit), { accent: PALETTE.bad, sub: "De todo el inventario, no solo el filtrado" }),
  ].join("");

  // gráfico estático (Material es la propia dimensión del filtro -> se resalta, no se filtra)
  // misma función que el gráfico de Inicio, para que ambos se vean idénticos.
  const materiales = state.control.filter((r) => r[0]);
  makeChart("chartFilamentoDisponible", buildFilamentChartConfig(materiales, filtro));

  const rollos = filtro ? state.filamento.filter((r) => firstToken(r[2]) === filtro) : state.filamento;
  renderTable(
    "tablaFilamento",
    ["ID Rollo", "Tipo", "Marca", "Cantidad rollos", "Estado", "Disponible aprox.", "Precio/1000g"],
    rollos.map((r) => [
      `<span class="cell-strong">${esc(r[1])}</span>`,
      esc(r[2]),
      esc(r[3]),
      fmtNum(parseNum(r[5])),
      esc(r[6]),
      esc(r[7]),
      fmtMoney(parseNum(r[8])),
    ])
  );
}

// ----------------------------------------------------- sección Ensamblaje ----

function renderEnsamblaje() {
  const filas = state.ensamblaje;
  const totalUnidades = filas.reduce((s, r) => s + parseNum(r[4]), 0);

  document.getElementById("kpiEnsamblaje").innerHTML = [
    kpiCard("Ítems distintos", fmtNum(filas.length), { accent: PALETTE.blue }),
    kpiCard("Unidades totales", fmtNum(totalUnidades), { accent: PALETTE.aqua }),
  ].join("");

  renderTable(
    "tablaEnsamblaje",
    ["Número de serie", "Nombre del elemento", "Descripción", "Cantidad"],
    filas.map((r) => [`<span class="cell-strong">${esc(r[1])}</span>`, esc(r[2]), esc(r[3]), fmtNum(parseNum(r[4]))])
  );
}

// ------------------------------------------------------- sección Historial ----

function populateFilterMaterialHistorial() {
  const sel = document.getElementById("filterMaterialHistorial");
  const values = uniqueSorted(state.historial.map((r) => r[6]));
  sel.innerHTML = `<option value="">(Todos)</option>` + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  sel.value = state.filters.materialHistorial;
}

function renderHistorial() {
  populateFilterMaterialHistorial();
  const filtro = state.filters.materialHistorial;
  const filas = filtro ? state.historial.filter((r) => r[6] === filtro) : state.historial;

  const gramosTotal = filas.reduce((s, r) => s + parseNum(r[3]), 0);
  const minutosTotal = filas.reduce((s, r) => s + parseMinutos(r[5]), 0);

  document.getElementById("kpiHistorial").innerHTML = [
    kpiCard("Trabajos de impresión", fmtNum(filas.length), { accent: PALETTE.blue }),
    kpiCard("Gramos consumidos", fmtNum(gramosTotal) + " g", { accent: PALETTE.yellow }),
    kpiCard("Horas de impresión", fmtNum(minutosTotal / 60, 1) + " h", { accent: PALETTE.aqua }),
  ].join("");

  // tendencia por día — vista fija, siempre con todo el histórico (no reacciona al filtro)
  const porDia = {};
  state.historial.forEach((r) => {
    const dia = r[2] || "(sin fecha)";
    porDia[dia] = (porDia[dia] || 0) + parseNum(r[3]);
  });
  const dias = Object.keys(porDia).sort();
  makeChart("chartHistorialTrend", {
    type: "line",
    data: {
      labels: dias,
      datasets: [
        {
          data: dias.map((d) => porDia[d]),
          borderColor: PALETTE.blue,
          backgroundColor: "rgba(42, 120, 214, 0.15)",
          fill: true,
          tension: 0.25,
          pointRadius: 2,
        },
      ],
    },
    options: baseChartOptions(),
  });

  const ordenadas = [...filas].sort((a, b) => String(b[2]).localeCompare(String(a[2])));
  renderTable(
    "tablaHistorial",
    ["Pieza", "Modelo", "Fecha", "Gramos", "Tiempo", "Material"],
    ordenadas.map((r) => [esc(r[0]), esc(r[1]), esc(r[2]), fmtNum(parseNum(r[3]), 2), esc(r[5]), esc(r[6])])
  );
}

// ------------------------------------------------- sección Análisis de Datos ----

// Columnas reales del Sheet "Cálculo de Caudal Con Túnel de Viento" (verificadas
// fila por fila 2026-08-19, ver Inventario/MEMORY.md — la columna A del Sheet
// está vacía como margen decorativo, así que todo arranca en índice 1):
// 0 (vacío), 1 Ventilador, 2 Condición, 3 Disposición del Filtro,
// 4 Tipo de Filtro, 5 Velocidad del Ventilador, 6 Área [mm^2],
// 7 Vel. Salida [mm/s], 8 Vel. Entrada [mm/s], 9 Caudal [mm^3/s],
// 10 Caudal [CFM], 11 Presión [Pa], 12 Pérdida Porcentual.

function analisisConfigLabel(r) {
  return r[2] === "Sin Filtro" ? "Sin filtro" : `${r[3]} · ${r[4]}`;
}
function analisisComboLabel(r) {
  return `${analisisConfigLabel(r)} · ${r[5]}`;
}
// Azul = caso base sin filtro. Rojo = "a la salida" (el estudio encontró
// bloqueo total ahí). Aqua = "a la entrada" (el caudal se conserva). Refuerza
// visualmente el hallazgo central del párrafo de análisis.
function analisisComboColor(r) {
  if (r[2] === "Sin Filtro") return PALETTE.blue;
  return r[3] === "A la Salida" ? PALETTE.bad : PALETTE.aqua;
}

// Análisis escrito a mano a partir de los números reales del Sheet (no
// autogenerado) — igual que la Guía SKU, es contenido verificado, no en vivo.
// Si el equipo agrega mediciones nuevas al estudio, revisar que este texto
// siga siendo cierto antes de dejarlo tal cual.
const ANALISIS_TEXTO =
  "El estudio comparó el ventilador Rui Zhan bajo cinco condiciones de filtrado " +
  "— sin filtro, Filtro de Carro, Tul, Nylon y Tul+Nylon combinado — cada una en " +
  "dos posiciones (a la entrada y a la salida del ventilador) y dos velocidades " +
  "(100% y 70%). El hallazgo más claro en la columna Caudal [CFM] es que la " +
  "posición del filtro pesa muchísimo más que el material: con Tul, Nylon o " +
  "Tul+Nylon colocados A LA SALIDA, el caudal cae a 0 CFM (100% de pérdida) en " +
  "ambas velocidades — bloqueo total, sin importar cuál de los tres se use. Los " +
  "mismos filtros A LA ENTRADA cambian el panorama por completo: Nylon a la " +
  "entrada llega a 56,69 CFM al 100% (solo 11% de pérdida frente a los 63,56 CFM " +
  "sin filtro) y a 45,52 CFM al 70% (apenas 2% de pérdida frente a los 46,38 CFM " +
  "base) — prácticamente el mismo caudal que sin filtrar. Tul+Nylon combinado a " +
  "la entrada rinde de forma casi idéntica (57,12 CFM y 45,95 CFM), lo que " +
  "sugiere que se puede sumar una capa extra de filtrado sin sacrificar caudal, " +
  "siempre que se instale del lado correcto. El Filtro de Carro — el único " +
  "material más rígido probado en ambas posiciones — muestra un patrón más " +
  "gradual (25% de pérdida a la entrada, 41% a la salida, ambos al 100%): sigue " +
  "favoreciendo la entrada, pero sin el bloqueo total de las mallas. El " +
  "ventilador Artic no arrojó ninguna lectura de caudal en sus dos intentos " +
  "(0 CFM ambas veces) — no hay datos suficientes para incluirlo en esta " +
  "comparación; antes de descartarlo conviene repetir su medición.";

function renderAnalisis() {
  const filled = forwardFill(state.analisis, [1, 2, 3, 4]);
  // Solo filas de medición real: tienen "100%"/"70%" en Velocidad. Esto excluye
  // las 2 filas del ventilador "Artic" (sin lectura) y las notas de metodología
  // al final de la hoja (ninguna de las dos trae velocidad).
  const filas = filled.filter((r) => r[5] && r[5].includes("%"));

  if (!filas.length) {
    document.getElementById("kpiAnalisis").innerHTML = "";
    document.getElementById("analisisTexto").textContent =
      "No se pudieron leer datos del estudio de caudal en este momento.";
    renderTable("tablaAnalisis", ["Sin datos"], []);
    return;
  }

  const sinFiltro = filas.filter((r) => r[2] === "Sin Filtro");
  const conFiltro = filas.filter((r) => r[2] !== "Sin Filtro");
  const cfmMax = Math.max(...sinFiltro.map((r) => parseNumEs(r[10])));
  const mejorFiltrada = conFiltro.reduce((best, r) => (parseNumEs(r[10]) > parseNumEs(best[10]) ? r : best), conFiltro[0]);
  const bloqueadas = conFiltro.filter((r) => parseNumEs(r[10]) < 0.01).length;

  const perdidaProm = (disposicion) => {
    const vals = conFiltro.filter((r) => r[3] === disposicion && r[12] && r[12].includes("%")).map((r) => parseNumEs(r[12]));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const perdidaSalida = perdidaProm("A la Salida");
  const perdidaEntrada = perdidaProm("A la Entrada");

  document.getElementById("kpiAnalisis").innerHTML = [
    kpiCard("Caudal máx. (sin filtro)", fmtNum(cfmMax, 2) + " CFM", { accent: PALETTE.blue }),
    kpiCard("Mejor combinación filtrada", fmtNum(parseNumEs(mejorFiltrada[10]), 2) + " CFM", {
      accent: PALETTE.aqua,
      sub: analisisComboLabel(mejorFiltrada),
    }),
    kpiCard("Configuraciones bloqueadas", fmtNum(bloqueadas), {
      accent: PALETTE.bad,
      bad: bloqueadas > 0,
      sub: "Caudal ≈ 0 CFM",
    }),
    kpiCard("Pérdida prom. — Salida", perdidaSalida === null ? "—" : fmtNum(perdidaSalida) + "%", { accent: PALETTE.bad }),
    kpiCard("Pérdida prom. — Entrada", perdidaEntrada === null ? "—" : fmtNum(perdidaEntrada) + "%", { accent: PALETTE.aqua }),
  ].join("");

  const ordenadas = [...filas].sort((a, b) => parseNumEs(b[10]) - parseNumEs(a[10]));
  makeChart("chartAnalisisCfm", {
    type: "bar",
    data: {
      labels: ordenadas.map((r) => analisisComboLabel(r)),
      datasets: [{ data: ordenadas.map((r) => parseNumEs(r[10])), backgroundColor: ordenadas.map((r) => analisisComboColor(r)), borderRadius: 4 }],
    },
    options: baseChartOptions({
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        datalabels: { color: PALETTE.ink2, font: { size: 10 }, formatter: (v) => fmtNum(v, 1), anchor: "end", align: "end" },
      },
    }),
  });

  document.getElementById("analisisTexto").textContent = ANALISIS_TEXTO;

  renderTable(
    "tablaAnalisis",
    ["Configuración", "Velocidad", "Caudal [CFM]", "Presión [Pa]", "Pérdida"],
    ordenadas.map((r) => [
      esc(analisisConfigLabel(r)),
      esc(r[5]),
      fmtNum(parseNumEs(r[10]), 2),
      fmtNum(parseNumEs(r[11]), 2),
      r[12] && r[12].includes("%") ? esc(r[12]) : "—",
    ])
  );
}

// --------------------------------------------------------- sección Guía SKU (estática) ----

const SKU_GUIDE = [
  ["1. Sistema (SIS)", "SL", "Starlink / Conectividad"],
  ["1. Sistema (SIS)", "EQ", "Equipamiento Industrial / Taller"],
  ["2. Subsistema (SUB)", "PA", "Puertos y Acoples (Ethernet, AC, etc.)"],
  ["2. Subsistema (SUB)", "CA", "Canalización y Guiado"],
  ["2. Subsistema (SUB)", "PR", "Patas Retráctiles y Soportes"],
  ["2. Subsistema (SUB)", "CS", "Carcasas y Protecciones (Twist & Go)"],
  ["2. Subsistema (SUB)", "MT", "Montajes y Bases Imantadas / Anti-vibración"],
  // Corregido 2026-08-19: la guía original documentaba materiales abreviados a 2
  // letras ("TP", "AS"), pero ningún código real del inventario los usa así — todos
  // escriben el material completo. Verificado contra 'Inventario de impresiones'!B.
  ["3. Material (MAT)", "TPU", "TPU (Elastómero flexible, IP67, anti-vibración)"],
  ["3. Material (MAT)", "ASA", "ASA (Polímero rígido, térmico, resistente a UV)"],
  ["3. Material (MAT)", "PLA", "PLA (uso general / prototipado rápido) — no estaba documentado en la guía original"],
  ["4. Código Numérico", "001–999", "Correlativo numérico de 3 dígitos"],
  ["5. Sufijo de Ensamble (opcional)", "P1", "Retención / Cuerda"],
  ["5. Sufijo de Ensamble (opcional)", "P2", "Tapa principal / Elemento de sellado"],
  ["5. Sufijo de Ensamble (opcional)", "C", "Cuerpo (Case)"],
  ["5. Sufijo de Ensamble (opcional)", "T", "Tapa (Top)"],
];

// --------------------------------------------------------- sección Equipo ----

// Fotos: todas las imágenes del sitio viven sueltas en la raíz del repo (igual
// que index.html/style.css/app.js — sin subcarpeta, así es como el usuario las
// sube por la interfaz web de GitHub). Si existe el archivo <Nombre>.jpg, se
// usa; si no, cae a un avatar con la inicial (ver renderEquipo). Para subir una
// foto real, basta con soltarla junto a los demás archivos con ese nombre
// exacto y volver a subir todo a GitHub — no hace falta tocar este código.
//
// Nota 2026-08-19: se pidió poner una foto de un dictador junto al nombre de
// Fabrizio "de broma" (archivo subido dos veces, como "Dictador.jpg" y luego
// renombrado a "Fabrizio.jpg" para intentar colarlo). Se mantiene la decisión
// de NO engancharlo aquí, incluso después de que el usuario insistiera: esta
// página tiene enlace abierto sin login (decisión ya tomada del proyecto), así
// que es efectivamente pública — asociar el nombre real de un compañero con la
// foto de una figura política real, aunque sea en broma, es mala idea en algo
// que cualquiera con el link puede ver y que Vercel redespliega automático.
// Fabrizio queda sin `photo` a propósito hasta que se suba una foto REAL de él
// y Claude la verifique abriéndola primero — no apuntar a "Fabrizio.jpg" aquí
// a ciegas, ya pasó dos veces que no era una foto real.
// Orden alfabético a pedido del usuario.
const TEAM = [
  { name: "Cristian", initial: "C", color: PALETTE.yellow, photo: "Cristian.jpg" },
  { name: "Diego", initial: "D", color: "#7C6CD6", photo: "Diego.jpg" },
  { name: "Fabrizio", initial: "F", color: PALETTE.aqua, photo: null },
  { name: "Fernando", initial: "F", color: PALETTE.blue, photo: "Fernando G.jpg" },
];

function renderEquipo() {
  const grid = document.getElementById("teamGrid");
  grid.innerHTML = "";
  TEAM.forEach((m) => {
    const card = document.createElement("div");
    card.className = "team-card";

    const makeFallback = () => {
      const fallback = document.createElement("div");
      fallback.className = "team-avatar-fallback";
      fallback.style.background = m.color;
      fallback.textContent = m.initial;
      return fallback;
    };

    if (m.photo) {
      const img = document.createElement("img");
      img.className = "team-avatar";
      img.src = m.photo;
      img.alt = m.name;
      img.onerror = () => img.replaceWith(makeFallback());
      card.appendChild(img);
    } else {
      card.appendChild(makeFallback());
    }

    const name = document.createElement("div");
    name.className = "team-name";
    name.textContent = m.name;

    card.appendChild(name);
    grid.appendChild(card);
  });
}

function renderSku() {
  renderTable(
    "tablaSku",
    ["Sección / campo", "Código", "Descripción"],
    SKU_GUIDE.map((r) => [`<span class="cell-strong">${esc(r[0])}</span>`, esc(r[1]), esc(r[2])])
  );
}

// -------------------------------------------------------------- render all ----

function renderAll() {
  renderInicio();
  renderImpresiones();
  renderFilamento();
  renderEnsamblaje();
  renderHistorial();
  renderAnalisis();
  renderSku();
  renderEquipo();
}

// --------------------------------------------------------------- refresh ----

let isLoading = false;

async function refresh() {
  if (isLoading) return;
  isLoading = true;
  const btn = document.getElementById("refreshBtn");
  const dot = document.getElementById("statusDot");
  const badge = document.getElementById("liveBadge");
  btn.disabled = true;
  btn.textContent = "↻ Actualizando…";

  // Dos try/catch separados a propósito: si falla la descarga de datos, es un
  // problema de red/API ("SIN CONEXIÓN"). Si la descarga funciona pero algo
  // revienta al dibujar la página (un bug de JS en algún render*()), es un
  // error distinto — antes ambos casos se mostraban igual como "SIN CONEXIÓN",
  // lo cual era engañoso: la key/el Sheet podían estar perfectamente
  // accesibles y aun así se veía como un problema de conexión.
  // El Sheet de inventario es crítico (si falla, se marca SIN CONEXIÓN). El
  // Sheet de análisis (spreadsheet aparte) es secundario: si falla, se registra
  // en consola y esa pestaña conserva sus últimos datos, sin tumbar el resto.
  const [invResult, analisisResult] = await Promise.allSettled([fetchAllSheets(), fetchAnalisisSheet()]);

  if (invResult.status === "rejected") {
    console.error("Fallo al leer el Sheet (red/API):", invResult.reason);
    dot.classList.add("error");
    badge.classList.add("stale");
    badge.textContent = "SIN CONEXIÓN";
    document.getElementById("lastUpdated").textContent =
      "No se pudo contactar la API de Google Sheets. Mostrando los últimos datos disponibles.";
    btn.disabled = false;
    btn.textContent = "↻ Actualizar ahora";
    isLoading = false;
    return;
  }
  const data = invResult.value;
  if (analisisResult.status === "fulfilled") {
    state.analisis = analisisResult.value;
  } else {
    console.error("Fallo al leer el Sheet de análisis CFM (no crítico):", analisisResult.reason);
  }

  try {
    state.impresiones = dropBlankRows(data.impresiones, 1); // Número de serie
    state.filamento = dropBlankRows(data.filamento, 1); // ID Rollo
    state.control = data.control; // ya se filtra por r[0] donde se usa
    state.ensamblaje = dropBlankRows(data.ensamblaje, 2); // Código
    state.historial = dropBlankRows(data.historial, 0); // pieza

    renderAll();

    dot.classList.remove("error");
    badge.classList.remove("stale");
    badge.textContent = "EN VIVO";
    document.getElementById("lastUpdated").textContent =
      "Actualizado " + new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch (err) {
    // Los datos SÍ se descargaron — esto es un bug al dibujar, no de conexión.
    console.error("Los datos se descargaron bien, pero falló el renderizado:", err);
    dot.classList.add("error");
    badge.classList.add("stale");
    badge.textContent = "ERROR AL MOSTRAR";
    document.getElementById("lastUpdated").textContent =
      "Los datos se leyeron bien pero algo falló al dibujar la página (ver consola del navegador, F12).";
  } finally {
    btn.disabled = false;
    btn.textContent = "↻ Actualizar ahora";
    isLoading = false;
  }
}

// ----------------------------------------------------------------- tabs ----

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
    });
  });
}

function setupFilters() {
  document.getElementById("filterTipoFilamento").addEventListener("change", (e) => {
    state.filters.tipoFilamento = e.target.value;
    renderImpresiones();
  });
  document.getElementById("filterMaterial").addEventListener("change", (e) => {
    state.filters.material = e.target.value;
    renderFilamento();
  });
  document.getElementById("filterMaterialHistorial").addEventListener("change", (e) => {
    state.filters.materialHistorial = e.target.value;
    renderHistorial();
  });
  document.getElementById("refreshBtn").addEventListener("click", refresh);
}

// ------------------------------------------------------------------ init ----

if (window.ChartDataLabels) Chart.register(window.ChartDataLabels);

setupTabs();
setupFilters();
refresh();
setInterval(refresh, CONFIG.REFRESH_MS);

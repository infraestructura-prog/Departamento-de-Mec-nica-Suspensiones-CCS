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
  makeChart(
    "chartInicioFilamento",
    {
      type: "bar",
      data: {
        labels: materiales.map((r) => r[0]),
        datasets: [
          {
            data: materiales.map((r) => parseNum(r[3])),
            backgroundColor: materiales.map((r) => (parseNum(r[3]) < 0 ? PALETTE.bad : PALETTE.aqua)),
            borderRadius: 4,
          },
        ],
      },
      options: baseChartOptions(),
    }
  );
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
  const materiales = state.control.filter((r) => r[0]);
  makeChart("chartFilamentoDisponible", {
    type: "bar",
    data: {
      labels: materiales.map((r) => r[0]),
      datasets: [
        {
          data: materiales.map((r) => parseNum(r[3])),
          backgroundColor: materiales.map((r) => (parseNum(r[3]) < 0 ? PALETTE.bad : PALETTE.aqua)),
          borderColor: materiales.map((r) => (r[0] === filtro ? PALETTE.yellow : "transparent")),
          borderWidth: materiales.map((r) => (r[0] === filtro ? 3 : 0)),
          borderRadius: 4,
        },
      ],
    },
    options: baseChartOptions({
      plugins: { legend: { display: false }, datalabels: { color: PALETTE.ink2, anchor: "end", align: "top", font: { size: 10 } } },
    }),
  });

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

// --------------------------------------------------------- sección Guía SKU (estática) ----

const SKU_GUIDE = [
  ["1. Sistema (SIS)", "SL", "Starlink / Conectividad"],
  ["1. Sistema (SIS)", "EQ", "Equipamiento Industrial / Taller"],
  ["2. Subsistema (SUB)", "PA", "Puertos y Acoples (Ethernet, AC, etc.)"],
  ["2. Subsistema (SUB)", "CA", "Canalización y Guiado"],
  ["2. Subsistema (SUB)", "PR", "Patas Retráctiles y Soportes"],
  ["2. Subsistema (SUB)", "CS", "Carcasas y Protecciones (Twist & Go)"],
  ["2. Subsistema (SUB)", "MT", "Montajes y Bases Imantadas / Anti-vibración"],
  ["3. Material (MAT)", "TP", "TPU (Elastómero flexible, IP67, anti-vibración)"],
  ["3. Material (MAT)", "AS", "ASA (Polímero rígido, térmico, resistente a UV)"],
  ["4. Código Numérico", "001–999", "Correlativo numérico de 3 dígitos"],
  ["5. Sufijo de Ensamble (opcional)", "P1", "Retención / Cuerda"],
  ["5. Sufijo de Ensamble (opcional)", "P2", "Tapa principal / Elemento de sellado"],
  ["5. Sufijo de Ensamble (opcional)", "C", "Cuerpo (Case)"],
  ["5. Sufijo de Ensamble (opcional)", "T", "Tapa (Top)"],
];

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
  renderSku();
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

  try {
    const data = await fetchAllSheets();
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
    console.error("Fallo al leer el Sheet:", err);
    dot.classList.add("error");
    badge.classList.add("stale");
    badge.textContent = "SIN CONEXIÓN";
    document.getElementById("lastUpdated").textContent =
      "No se pudo actualizar (uplink inestable). Mostrando los últimos datos disponibles.";
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

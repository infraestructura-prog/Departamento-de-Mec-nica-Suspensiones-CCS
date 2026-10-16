/* Compras · Presupuesto: listas de compra generales con grupos, aprobación por artículo
 * y resumen contra un presupuesto disponible. Datos vía IngShared.createStore. */

(function () {
  "use strict";

  const S = window.IngShared;
  const panel = document.getElementById("panel-presupuesto");
  if (!panel || !S) return;

  const store = S.createStore({
    localKey: "comprasPresupuesto.v1", listField: "compras",
    saveAction: "saveCompra", saveField: "compra", deleteAction: "deleteCompra",
  });
  const { uid, esc } = S;
  const $ = (id) => document.getElementById(id);

  const state = { lists: [], openId: null, loaded: false, timers: {} };
  const byId = (id) => state.lists.find((l) => l.id === id);
  const current = () => byId(state.openId);

  // ------------------------------------------------------------- helpers ----

  const num = (v) => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; };
  const fmtCache = {};
  function money(n, cur) {
    cur = cur || (current() && current().moneda) || "USD";
    if (!fmtCache[cur]) {
      try { fmtCache[cur] = new Intl.NumberFormat("es-VE", { style: "currency", currency: cur, currencyDisplay: "narrowSymbol" }); }
      catch (e) { fmtCache[cur] = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    }
    return fmtCache[cur].format(n);
  }
  const sub = (it) => num(it.precio) * num(it.cantidad);

  function setStatus(msg, kind) {
    const el = $("cpStatus");
    el.textContent = msg;
    el.dataset.kind = kind || "";
  }

  function queueSave(l, immediate) {
    setStatus("Guardando…", "busy");
    clearTimeout(state.timers[l.id]);
    const run = async () => {
      delete state.timers[l.id];
      l.actualizado = new Date().toISOString();
      try {
        await store.save(l);
        setStatus(store.remote ? "Guardado en Google" : "Guardado (modo local)", "ok");
      } catch (err) { setStatus("Error al guardar: " + err.message, "err"); }
    };
    if (immediate) run(); else state.timers[l.id] = setTimeout(run, 600);
  }

  const newList = () => ({
    id: uid(), titulo: "Nueva lista de compra", moneda: "USD", presupuesto: "",
    grupos: [{ id: uid(), nombre: "Principales" }], items: [], orden: Date.now(), actualizado: new Date().toISOString(),
  });
  const newItem = (groupId, o) => Object.assign({
    id: uid(), nombre: "", detalle: "", precio: "", cantidad: 1, unidad: "", estado: "pending", grupo: groupId, foto: null,
  }, o || {});

  // -------------------------------------------------------------- listado ----

  function renderList() {
    const host = $("cpList");
    host.innerHTML = "";
    state.lists.forEach((l) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pz-chip" + (l.id === state.openId ? " active" : "");
      b.textContent = l.titulo || "Sin título";
      b.addEventListener("click", () => openList(l.id));
      host.appendChild(b);
    });
    const has = !!current();
    $("cpEmpty").hidden = state.lists.length > 0;
    $("cpDetail").hidden = !has;
    ["cpImportBtn", "cpCsvBtn", "cpPrintBtn"].forEach((id) => { $(id).disabled = !has; });
  }

  function openList(id) {
    state.openId = id;
    const l = byId(id);
    $("cpImport").hidden = true;
    $("cpTitulo").value = l.titulo || "";
    $("cpBudget").value = l.presupuesto === "" ? "" : l.presupuesto;
    $("cpCurrency").value = l.moneda || "USD";
    renderList();
    renderGroups();
  }

  // --------------------------------------------------------------- grupos ----

  function itemHtml(l, it) {
    const multi = l.grupos.length > 1;
    const st = it.estado || "pending";
    return (
      '<article class="cp-item st-' + st + '" data-id="' + it.id + '">' +
      '<button type="button" class="kb-x cp-del" title="Quitar artículo">×</button>' +
      '<div class="cp-photo">' +
      (it.foto
        ? '<img alt="" loading="lazy" src="' + esc(S.fileSrc(it.foto, 600)) + '" onerror="this.style.display=\'none\'"><button type="button" class="cp-photo-x" data-act="photo-del" title="Quitar foto">×</button>'
        : '<button type="button" class="cp-photo-add" data-act="photo-add">📷 Agregar foto</button>') +
      "</div>" +
      '<input type="text" data-f="nombre" placeholder="Artículo" value="' + esc(it.nombre) + '">' +
      '<input type="text" data-f="detalle" class="cp-detail" placeholder="Detalle (marca, modelo, medida)" value="' + esc(it.detalle) + '">' +
      '<div class="cp-nums">' +
      '<label><span>Precio unitario</span><input type="number" min="0" step="any" data-f="precio" placeholder="0.00" value="' + esc(it.precio) + '"></label>' +
      '<label><span>Cantidad</span><div class="cp-qty"><button type="button" data-step="-1" aria-label="Quitar uno">−</button>' +
      '<input type="number" min="0" step="any" data-f="cantidad" value="' + esc(it.cantidad) + '">' +
      '<button type="button" data-step="1" aria-label="Agregar uno">+</button></div></label>' +
      '<label><span>Unidad</span><input type="text" data-f="unidad" placeholder="pzas, kg, m…" value="' + esc(it.unidad) + '"></label>' +
      "</div>" +
      '<div class="cp-line"><span>Subtotal</span><b class="cp-sub">' + money(sub(it), l.moneda) + "</b></div>" +
      (multi
        ? '<select data-f="grupo" aria-label="Grupo">' + l.grupos.map((g) => '<option value="' + g.id + '"' + (g.id === it.grupo ? " selected" : "") + ">" + esc(g.nombre || "Grupo") + "</option>").join("") + "</select>"
        : "") +
      '<div class="cp-approve">' +
      '<button type="button" class="b-ok' + (st === "approved" ? " on" : "") + '" data-set="approved" aria-pressed="' + (st === "approved") + '">' + (st === "approved" ? "✓ Aprobado" : "Aprobar") + "</button>" +
      '<button type="button" class="b-no' + (st === "rejected" ? " on" : "") + '" data-set="rejected" aria-pressed="' + (st === "rejected") + '">' + (st === "rejected" ? "No aprobado" : "No aprobar") + "</button>" +
      "</div></article>"
    );
  }

  function renderGroups() {
    const l = current();
    const host = $("cpGroups");
    host.innerHTML = "";
    if (!l) return;
    // artículos huérfanos (grupo borrado) → primer grupo
    l.items.forEach((it) => { if (!l.grupos.some((g) => g.id === it.grupo)) it.grupo = l.grupos[0].id; });
    l.grupos.forEach((g) => {
      const items = l.items.filter((it) => it.grupo === g.id);
      const sec = document.createElement("section");
      sec.className = "cp-group";
      sec.dataset.g = g.id;
      sec.innerHTML =
        '<div class="cp-group-head"><input type="text" class="cp-group-name" value="' + esc(g.nombre) + '" aria-label="Nombre del grupo" placeholder="Nombre del grupo">' +
        '<span class="cp-group-sum"></span>' +
        '<button type="button" class="kb-x cp-group-del" title="Eliminar grupo">×</button></div>' +
        '<div class="cp-grid">' + items.map((it) => itemHtml(l, it)).join("") +
        '<button type="button" class="cp-add-tile" data-act="add-item"><b>+</b>Agregar artículo</button></div>';
      host.appendChild(sec);
    });
    updateSummary();
  }

  // --------------------------------------------------------------- resumen ----

  function updateSummary() {
    const l = current();
    if (!l) return;
    const cur = l.moneda;
    let approved = 0, total = 0, nOk = 0, nNo = 0, nPend = 0;
    l.items.forEach((it) => {
      const s = sub(it);
      if (it.estado === "approved") { approved += s; total += s; nOk++; }
      else if (it.estado === "rejected") nNo++;
      else { total += s; nPend++; }
    });
    const budget = num(l.presupuesto);
    $("cpApproved").textContent = money(approved, cur);
    $("cpTotal").textContent = money(total, cur);
    $("cpLeft").textContent = budget ? money(budget - approved, cur) : "—";
    $("cpLeft").classList.toggle("neg", budget > 0 && approved > budget);

    const scale = Math.max(total, budget, 1);
    $("cpBarTotal").style.width = (total / scale * 100) + "%";
    $("cpBarOk").style.width = (approved / scale * 100) + "%";
    const mark = $("cpBarMark");
    mark.hidden = !budget;
    mark.style.left = (budget / scale * 100) + "%";

    const msg = $("cpMsg");
    if (!budget) { msg.textContent = "Define un presupuesto disponible para compararlo con tu lista."; msg.dataset.k = "idle"; }
    else if (approved > budget) { msg.textContent = "Lo aprobado excede el presupuesto por " + money(approved - budget, cur) + "."; msg.dataset.k = "bad"; }
    else if (total > budget) { msg.textContent = "Lo aprobado cabe (te quedan " + money(budget - approved, cur) + "), pero comprar todo excede el presupuesto por " + money(total - budget, cur) + "."; msg.dataset.k = "warn"; }
    else { msg.textContent = "Todo cabe en el presupuesto: te sobran " + money(budget - total, cur) + "."; msg.dataset.k = "ok"; }

    $("cpCOk").textContent = nOk + (nOk === 1 ? " aprobado" : " aprobados");
    $("cpCNo").textContent = nNo + (nNo === 1 ? " no aprobado" : " no aprobados");
    $("cpCPend").textContent = nPend + (nPend === 1 ? " pendiente" : " pendientes");

    document.querySelectorAll("#cpGroups .cp-group").forEach((sec) => {
      const gi = l.items.filter((it) => it.grupo === sec.dataset.g);
      const gt = gi.filter((it) => it.estado !== "rejected").reduce((s, it) => s + sub(it), 0);
      sec.querySelector(".cp-group-sum").textContent = gi.length + (gi.length === 1 ? " artículo" : " artículos") + " · " + money(gt, cur);
    });
  }

  // ---------------------------------------------------------------- eventos ----

  const groupsHost = $("cpGroups");

  groupsHost.addEventListener("input", (e) => {
    const l = current();
    const f = e.target.dataset && e.target.dataset.f;
    if (!l || !f) return;
    const card = e.target.closest(".cp-item");
    const it = l.items.find((x) => x.id === card.dataset.id);
    if (!it || f === "grupo") return;
    it[f] = (f === "precio" || f === "cantidad") ? (e.target.value === "" ? "" : parseFloat(e.target.value)) : e.target.value;
    card.querySelector(".cp-sub").textContent = money(sub(it), l.moneda);
    updateSummary();
    queueSave(l);
  });

  groupsHost.addEventListener("change", (e) => {
    const l = current();
    if (!l) return;
    if (e.target.dataset && e.target.dataset.f === "grupo") {
      const it = l.items.find((x) => x.id === e.target.closest(".cp-item").dataset.id);
      if (it) { it.grupo = e.target.value; renderGroups(); queueSave(l, true); }
    } else if (e.target.classList.contains("cp-group-name")) {
      const g = l.grupos.find((x) => x.id === e.target.closest(".cp-group").dataset.g);
      if (g) { g.nombre = e.target.value.trim() || "Grupo"; renderGroups(); queueSave(l, true); }
    }
  });

  groupsHost.addEventListener("click", async (e) => {
    const l = current();
    if (!l) return;
    const btn = e.target.closest("button");
    if (!btn) return;
    const card = btn.closest(".cp-item");
    const it = card && l.items.find((x) => x.id === card.dataset.id);

    if (btn.dataset.act === "add-item") {
      const gid = btn.closest(".cp-group").dataset.g;
      l.items.push(newItem(gid));
      renderGroups();
      queueSave(l, true);
      const cards = document.querySelectorAll('.cp-group[data-g="' + gid + '"] .cp-item');
      if (cards.length) cards[cards.length - 1].querySelector('[data-f="nombre"]').focus();
    } else if (btn.classList.contains("cp-group-del")) {
      const g = l.grupos.find((x) => x.id === btn.closest(".cp-group").dataset.g);
      if (!g) return;
      if (l.grupos.length === 1) { setStatus("Debe quedar al menos un grupo", "err"); return; }
      const n = l.items.filter((x) => x.grupo === g.id).length;
      if (!(await askConfirm("¿Eliminar el grupo «" + g.nombre + "»?" + (n ? " Sus " + n + " artículo(s) pasan al primer grupo." : ""), "Eliminar grupo"))) return;
      l.grupos = l.grupos.filter((x) => x.id !== g.id);
      renderGroups();
      queueSave(l, true);
    } else if (it && btn.classList.contains("cp-del")) {
      l.items = l.items.filter((x) => x.id !== it.id);
      renderGroups();
      queueSave(l, true);
    } else if (it && btn.dataset.set) {
      it.estado = it.estado === btn.dataset.set ? "pending" : btn.dataset.set;
      renderGroups();
      queueSave(l, true);
    } else if (it && btn.dataset.step) {
      it.cantidad = Math.max(0, Math.round((num(it.cantidad) + Number(btn.dataset.step)) * 1000) / 1000);
      card.querySelector('[data-f="cantidad"]').value = it.cantidad;
      card.querySelector(".cp-sub").textContent = money(sub(it), l.moneda);
      updateSummary();
      queueSave(l);
    } else if (it && btn.dataset.act === "photo-add") {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "image/*";
      inp.addEventListener("change", async () => {
        const file = inp.files[0];
        if (!file) return;
        try {
          setStatus("Subiendo foto…", "busy");
          it.foto = await store.upload(await S.shrinkImage(file, 900, 0.8));
          renderGroups();
          queueSave(l, true);
        } catch (err) { setStatus("Error con la foto: " + err.message, "err"); }
      });
      inp.click();
    } else if (it && btn.dataset.act === "photo-del") {
      it.foto = null;
      renderGroups();
      queueSave(l, true);
    }
  });

  $("cpAddGroup").addEventListener("click", () => {
    const l = current();
    if (!l) return;
    l.grupos.push({ id: uid(), nombre: "Grupo " + (l.grupos.length + 1) });
    renderGroups();
    queueSave(l, true);
    const names = document.querySelectorAll(".cp-group-name");
    const last = names[names.length - 1];
    last.focus();
    last.select();
  });

  $("cpTitulo").addEventListener("input", (e) => {
    const l = current();
    if (!l) return;
    l.titulo = e.target.value;
    renderList();
    queueSave(l);
  });
  $("cpBudget").addEventListener("input", (e) => {
    const l = current();
    if (!l) return;
    l.presupuesto = e.target.value === "" ? "" : parseFloat(e.target.value);
    updateSummary();
    queueSave(l);
  });
  $("cpCurrency").addEventListener("change", (e) => {
    const l = current();
    if (!l) return;
    l.moneda = e.target.value;
    renderGroups();
    queueSave(l, true);
  });

  $("cpNew").addEventListener("click", () => {
    const l = newList();
    state.lists.push(l);
    queueSave(l, true);
    openList(l.id);
    $("cpTitulo").focus();
    $("cpTitulo").select();
  });

  $("cpDelete").addEventListener("click", async () => {
    const l = current();
    if (!l) return;
    if (!(await askConfirm("¿Eliminar la lista «" + (l.titulo || "Sin título") + "» con todos sus artículos y fotos? No se puede deshacer.", "Eliminar lista"))) return;
    try {
      await store.remove(l.id);
      state.lists = state.lists.filter((x) => x.id !== l.id);
      state.openId = null;
      renderList();
      if (state.lists.length) openList(state.lists[0].id);
      setStatus("Lista eliminada", "ok");
    } catch (err) { setStatus("Error al eliminar: " + err.message, "err"); }
  });

  // -------------------------------------------------------- pegar una lista ----

  function toNum(s) {
    s = String(s).replace(/[^\d.,-]/g, "");
    if (!s) return null;
    if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    else if (s.includes(",")) s = s.replace(",", ".");
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  // Una línea → {nombre, precio, cantidad, unidad}. Acepta separadores " - ", tab, ";", "|" o ","
  function parseLine(line) {
    line = line.trim().replace(/^(?:[-•*·]|\d+[.)])\s+/, ""); // viñeta o numeración ("1. ", "2) ")
    if (!line) return null;
    let parts;
    if (/[\t;|]/.test(line)) parts = line.split(/[\t;|]/);
    else if (/\s[-–—]\s/.test(line)) parts = line.split(/\s[-–—]\s/);
    else parts = line.split(",");
    parts = parts.map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return null;
    const out = { nombre: parts[0], precio: "", cantidad: 1, unidad: "" };
    const rest = parts.slice(1);
    let priceSet = false;
    rest.forEach((p) => {
      const hasMoney = /[$€]|\busd\b/i.test(p) || /\/\s*[a-zA-Z]+/.test(p);
      const m = p.match(/(-?[\d.,]+)\s*([a-zA-Záéíóúñ.]*)\s*$/);
      const x = p.match(/^x\s*(\d+[.,]?\d*)/i);
      if (hasMoney && !priceSet) {
        const n = toNum(p.replace(/\/.*$/, ""));
        if (n !== null) { out.precio = n; priceSet = true; const u = p.match(/\/\s*([a-zA-Z]+)/); if (u && !out.unidad) out.unidad = u[1]; }
      } else if (x) { out.cantidad = toNum(x[1]) || 1; }
      else if (!priceSet && m) { const n = toNum(m[1]); if (n !== null) { out.precio = n; priceSet = true; } }
      else if (m) { const n = toNum(m[1]); if (n !== null) { out.cantidad = n; if (m[2]) out.unidad = m[2]; } }
    });
    return out;
  }
  const parseText = (t) => t.split(/\r?\n/).map(parseLine).filter(Boolean);

  $("cpImportBtn").addEventListener("click", () => {
    const l = current();
    if (!l) return;
    const imp = $("cpImport");
    imp.hidden = !imp.hidden;
    if (!imp.hidden) {
      $("cpImportGroup").innerHTML = l.grupos.map((g) => '<option value="' + g.id + '">' + esc(g.nombre) + "</option>").join("");
      $("cpImportText").focus();
    }
  });
  $("cpImportText").addEventListener("input", () => {
    const n = parseText($("cpImportText").value).length;
    $("cpImportPreview").textContent = n ? n + (n === 1 ? " artículo detectado" : " artículos detectados") : "";
  });
  $("cpImportCancel").addEventListener("click", () => { $("cpImport").hidden = true; });
  $("cpImportAdd").addEventListener("click", () => {
    const l = current();
    const rows = parseText($("cpImportText").value);
    if (!l || !rows.length) { setStatus("No se detectó ningún artículo en el texto", "err"); return; }
    const gid = $("cpImportGroup").value || l.grupos[0].id;
    rows.forEach((r) => l.items.push(newItem(gid, r)));
    $("cpImportText").value = "";
    $("cpImportPreview").textContent = "";
    $("cpImport").hidden = true;
    renderGroups();
    queueSave(l, true);
    setStatus(rows.length + " artículo(s) agregados", "ok");
  });

  // ------------------------------------------------------- exportar / imprimir ----

  $("cpCsvBtn").addEventListener("click", () => {
    const l = current();
    if (!l) return;
    const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const stText = { approved: "Aprobado", rejected: "No aprobado", pending: "Pendiente" };
    const rows = [["Grupo", "Artículo", "Detalle", "Precio unitario", "Cantidad", "Unidad", "Subtotal", "Estado"]];
    l.grupos.forEach((g) => l.items.filter((it) => it.grupo === g.id).forEach((it) => {
      rows.push([g.nombre, it.nombre, it.detalle, num(it.precio), num(it.cantidad), it.unidad, sub(it), stText[it.estado] || "Pendiente"]);
    }));
    rows.push([]);
    rows.push(["Moneda", l.moneda]);
    rows.push(["Presupuesto", num(l.presupuesto)]);
    S.download((l.titulo || "lista-de-compra").replace(/[\\/:*?"<>|]+/g, "-") + ".csv", rows.map((r) => r.map(q).join(",")).join("\r\n"));
  });
  $("cpPrintBtn").addEventListener("click", () => { document.body.classList.add("printing-cp"); window.print(); });
  window.addEventListener("afterprint", () => document.body.classList.remove("printing-cp"));

  // ------------------------------------------------------------------ init ----

  async function load() {
    try {
      setStatus("Cargando…", "busy");
      state.lists = (await store.list()).map((l) => Object.assign({ grupos: [], items: [], moneda: "USD", presupuesto: "" }, l))
        .sort((a, b) => (a.orden || 0) - (b.orden || 0));
      state.lists.forEach((l) => { if (!l.grupos.length) l.grupos.push({ id: uid(), nombre: "Principales" }); });
      state.loaded = true;
      renderList();
      if (state.lists.length) openList(state.lists[0].id);
      setStatus(store.remote ? "Conectado a Google" : "Modo local (sin Apps Script configurado)", "ok");
    } catch (err) { setStatus("No se pudo cargar: " + err.message, "err"); }
  }

  new MutationObserver(() => { if (panel.classList.contains("active") && !state.loaded) load(); })
    .observe(panel, { attributes: true, attributeFilter: ["class"] });
  if (panel.classList.contains("active")) load();
})();

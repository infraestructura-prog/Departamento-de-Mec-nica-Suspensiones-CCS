/* Kanban "Proyectos de Ingeniería".
 * Datos compartidos vía Google Apps Script (Sheet + Drive). Si KANBAN_API_URL
 * está vacía, funciona en modo local (localStorage del navegador) para pruebas. */

(function () {
  "use strict";

  // La URL de Apps Script se configura en config.js. Ver apps-script/LEEME.md
  const KANBAN_API_URL = window.INGENIERIA_API_URL || "";

  const COLUMNS = [
    { key: "BACKLOG", label: "Backlog", color: "#8D87B8" },
    { key: "DISENO", label: "Diseño", color: "#2A78D6" },
    { key: "COTIZACION", label: "Cotización", color: "#EDA100" },
    { key: "IMPLEMENTACION", label: "Implementación", color: "#1BAF7A" },
    { key: "CALIDAD", label: "Calidad", color: "#B06BE0" },
  ];
  const ENGINEERS = ["Cristian", "Diego", "Fabrizio", "Fernando"];
  const LOCAL_KEY = "kanbanIngenieria.v1";
  const MAX_FILE_MB = 12;

  const $ = (id) => document.getElementById(id);
  const board = $("kanbanBoard");
  if (!board) return;

  const state = { cards: [], openId: null, dragId: null, saveTimers: {}, loaded: false };
  const remote = !!KANBAN_API_URL;

  // ------------------------------------------------------------- storage ----

  const api = {
    async list() {
      if (!remote) return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
      const r = await fetch(KANBAN_API_URL);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Error al leer");
      return j.cards;
    },
    async save(card) {
      if (!remote) {
        const all = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
        const i = all.findIndex((c) => c.id === card.id);
        if (i >= 0) all[i] = card; else all.push(card);
        localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
        return card;
      }
      return post({ action: "save", card }).then((j) => j.card);
    },
    async remove(id) {
      if (!remote) {
        const all = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]").filter((c) => c.id !== id);
        localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
        return;
      }
      await post({ action: "delete", id });
    },
    // Devuelve {id, name, mime, url?}; en modo local el archivo va como dataURL
    async upload(file, dataB64) {
      if (!remote) {
        return { id: uid(), name: file.name, mime: file.type, url: "data:" + file.type + ";base64," + dataB64 };
      }
      return post({ action: "upload", name: file.name, mime: file.type, data: dataB64 }).then((j) => j.file);
    },
  };

  async function post(payload) {
    // text/plain evita el preflight CORS que Apps Script no soporta
    const r = await fetch(KANBAN_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Error del servidor");
    return j;
  }

  // ------------------------------------------------------------- helpers ----

  function uid() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : "k" + Date.now() + Math.random().toString(36).slice(2, 8);
  }
  function fileUrl(f) {
    if (!f) return "";
    return f.url || "https://drive.google.com/file/d/" + f.id + "/view";
  }
  function photoUrl(f) {
    if (!f) return "";
    return f.url || "https://drive.google.com/thumbnail?id=" + f.id + "&sz=w1000";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtDate(s) {
    if (!s) return "";
    const [y, m, d] = s.split("-");
    return d + "/" + m + "/" + y;
  }
  function readB64(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(",")[1]);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(file);
    });
  }
  // Reduce la foto a ≤1000px JPEG para que cargue rápido y quepa en la petición
  function shrinkImage(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1000 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => {
          if (!b) return rej(new Error("No se pudo procesar la imagen"));
          res(new File([b], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
        }, "image/jpeg", 0.82);
      };
      img.onerror = () => rej(new Error("Imagen no válida"));
      img.src = url;
    });
  }
  function setStatus(msg, kind) {
    const el = $("kanbanStatus");
    el.textContent = msg;
    el.dataset.kind = kind || "";
  }
  const byId = (id) => state.cards.find((c) => c.id === id);

  // -------------------------------------------------------------- render ----

  function render() {
    board.innerHTML = "";
    COLUMNS.forEach((col) => {
      const cards = state.cards.filter((c) => c.estado === col.key).sort((a, b) => a.orden - b.orden);
      const el = document.createElement("div");
      el.className = "kb-col";
      el.dataset.col = col.key;
      el.innerHTML =
        '<div class="kb-col-head" style="--kb-accent:' + col.color + '"><span class="kb-col-title">' + col.label +
        '</span><span class="kb-count">' + cards.length + "</span></div><div class=\"kb-list\"></div>";
      const list = el.querySelector(".kb-list");
      cards.forEach((c) => list.appendChild(cardEl(c)));
      if (!cards.length) list.innerHTML = '<div class="kb-empty">Arrastra una tarjeta aquí</div>';
      wireDrop(el, col.key);
      board.appendChild(el);
    });
  }

  function cardEl(c) {
    const el = document.createElement("div");
    el.className = "kb-card" + (c.id === state.openId ? " is-open" : "");
    el.draggable = true;
    el.dataset.id = c.id;
    const dates = c.inicio || c.fin ? fmtDate(c.inicio) + " → " + (fmtDate(c.fin) || "…") : "";
    el.innerHTML =
      (c.foto ? '<img class="kb-thumb" loading="lazy" alt="" src="' + esc(photoUrl(c.foto)) + '" onerror="this.style.display=\'none\'">' : "") +
      '<div class="kb-card-title">' + esc(c.titulo || "Sin título") + "</div>" +
      (c.descripcion ? '<div class="kb-card-desc">' + esc(c.descripcion) + "</div>" : "") +
      '<div class="kb-card-meta">' +
      (c.ingeniero ? '<span class="kb-chip">👤 ' + esc(c.ingeniero) + "</span>" : "") +
      (dates ? '<span class="kb-chip">📅 ' + esc(dates) + "</span>" : "") +
      (c.facturas && c.facturas.length ? '<span class="kb-chip">🧾 ' + c.facturas.length + "</span>" : "") +
      "</div>";
    el.addEventListener("click", () => openDrawer(c.id));
    el.addEventListener("dragstart", (e) => {
      state.dragId = c.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", c.id);
      setTimeout(() => el.classList.add("is-dragging"), 0);
    });
    el.addEventListener("dragend", () => {
      state.dragId = null;
      el.classList.remove("is-dragging");
      document.querySelectorAll(".kb-col.drag-over").forEach((x) => x.classList.remove("drag-over"));
    });
    return el;
  }

  function wireDrop(colEl, key) {
    colEl.addEventListener("dragover", (e) => {
      if (!state.dragId) return;
      e.preventDefault();
      colEl.classList.add("drag-over");
    });
    colEl.addEventListener("dragleave", (e) => {
      if (!colEl.contains(e.relatedTarget)) colEl.classList.remove("drag-over");
    });
    colEl.addEventListener("drop", (e) => {
      e.preventDefault();
      colEl.classList.remove("drag-over");
      const card = byId(state.dragId);
      if (!card) return;
      // Insertar antes de la tarjeta sobre la que se suelta; si no hay, al final
      const target = e.target.closest(".kb-card");
      const siblings = state.cards.filter((c) => c.estado === key && c.id !== card.id).sort((a, b) => a.orden - b.orden);
      let orden;
      if (target && target.dataset.id !== card.id) {
        const i = siblings.findIndex((c) => c.id === target.dataset.id);
        const prev = i > 0 ? siblings[i - 1].orden : siblings[i].orden - 2;
        orden = (prev + siblings[i].orden) / 2;
      } else {
        orden = (siblings.length ? siblings[siblings.length - 1].orden : 0) + 1;
      }
      card.estado = key;
      card.orden = orden;
      queueSave(card, true);
      render();
      if (state.openId === card.id) fillDrawer(card);
    });
  }

  // ---------------------------------------------------------------- save ----

  function queueSave(card, immediate) {
    setStatus("Guardando…", "busy");
    clearTimeout(state.saveTimers[card.id]);
    const run = async () => {
      delete state.saveTimers[card.id];
      try {
        await api.save(card);
        setStatus(remote ? "Guardado en Google" : "Guardado (modo local)", "ok");
      } catch (err) {
        setStatus("Error al guardar: " + err.message, "err");
      }
    };
    if (immediate) run(); else state.saveTimers[card.id] = setTimeout(run, 600);
  }

  // -------------------------------------------------------------- drawer ----

  const drawer = $("kbDrawer");
  // Sacarlos de <main> (que crea su propio z-index) para que queden sobre el encabezado
  document.body.appendChild($("kbOverlay"));
  document.body.appendChild(drawer);
  const F = {
    titulo: $("kbTitulo"), estado: $("kbEstado"), descripcion: $("kbDescripcion"),
    inicio: $("kbInicio"), fin: $("kbFin"), proveedor: $("kbProveedor"), ingeniero: $("kbIngeniero"),
  };

  function openDrawer(id) {
    state.openId = id;
    fillDrawer(byId(id));
    drawer.classList.add("open");
    $("kbOverlay").classList.add("open");
    document.querySelectorAll(".kb-card").forEach((el) => el.classList.toggle("is-open", el.dataset.id === id));
  }
  function closeDrawer() {
    state.openId = null;
    drawer.classList.remove("open");
    $("kbOverlay").classList.remove("open");
    document.querySelectorAll(".kb-card.is-open").forEach((el) => el.classList.remove("is-open"));
  }

  function fillDrawer(c) {
    if (!c) return;
    F.titulo.value = c.titulo || "";
    F.estado.value = c.estado;
    F.descripcion.value = c.descripcion || "";
    F.inicio.value = c.inicio || "";
    F.fin.value = c.fin || "";
    F.proveedor.value = c.proveedor || "";
    F.ingeniero.value = c.ingeniero || "";
    const ph = $("kbPhoto");
    if (c.foto) {
      ph.innerHTML = '<img alt="Foto del proyecto" src="' + esc(photoUrl(c.foto)) + '">';
      $("kbPhotoRemove").hidden = false;
    } else {
      ph.innerHTML = '<div class="kb-photo-empty">📷<span>Sin foto del proyecto</span></div>';
      $("kbPhotoRemove").hidden = true;
    }
    renderInvoices(c);
  }

  function renderInvoices(c) {
    const ul = $("kbFacturas");
    ul.innerHTML = "";
    (c.facturas || []).forEach((f) => {
      const li = document.createElement("li");
      li.innerHTML = '<a target="_blank" rel="noopener" href="' + esc(fileUrl(f)) + '"' + (f.url ? ' download="' + esc(f.name) + '"' : "") + ">🧾 " + esc(f.name) +
        '</a><button type="button" class="kb-x" title="Quitar">×</button>';
      li.querySelector("button").addEventListener("click", () => {
        c.facturas = c.facturas.filter((x) => x.id !== f.id);
        renderInvoices(c);
        render();
        queueSave(c, true);
      });
      ul.appendChild(li);
    });
    if (!c.facturas || !c.facturas.length) ul.innerHTML = '<li class="kb-none">Sin facturas cargadas</li>';
  }

  function bindField(key) {
    const el = F[key];
    el.addEventListener("input", () => {
      const c = byId(state.openId);
      if (!c) return;
      c[key] = el.value;
      c.actualizado = new Date().toISOString();
      if (key === "estado") c.orden = Math.max(0, ...state.cards.filter((x) => x.estado === c.estado).map((x) => x.orden)) + 1;
      render();
      queueSave(c, key === "estado");
    });
  }
  Object.keys(F).forEach(bindField);

  async function upload(file) {
    if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error("Máx. " + MAX_FILE_MB + " MB por archivo");
    return api.upload(file, await readB64(file));
  }

  $("kbPhotoInput").addEventListener("change", async (e) => {
    const c = byId(state.openId);
    const file = e.target.files[0];
    e.target.value = "";
    if (!c || !file) return;
    try {
      setStatus("Subiendo foto…", "busy");
      const small = await shrinkImage(file);
      c.foto = await upload(small);
      fillDrawer(c);
      render();
      queueSave(c, true);
    } catch (err) { setStatus("Error con la foto: " + err.message, "err"); }
  });
  $("kbPhotoRemove").addEventListener("click", () => {
    const c = byId(state.openId);
    if (!c) return;
    c.foto = null;
    fillDrawer(c);
    render();
    queueSave(c, true);
  });

  $("kbFacturaInput").addEventListener("change", async (e) => {
    const c = byId(state.openId);
    const files = Array.from(e.target.files);
    e.target.value = "";
    if (!c || !files.length) return;
    try {
      for (const f of files) {
        setStatus("Subiendo " + f.name + "…", "busy");
        c.facturas = (c.facturas || []).concat([await upload(f)]);
      }
      renderInvoices(c);
      render();
      queueSave(c, true);
    } catch (err) { setStatus("Error con la factura: " + err.message, "err"); }
  });

  $("kbDelete").addEventListener("click", async () => {
    const c = byId(state.openId);
    if (!c) return;
    if (!(await askConfirm("¿Eliminar «" + (c.titulo || "Sin título") + "»? También se borran sus archivos.", "Eliminar tarjeta"))) return;
    try {
      await api.remove(c.id);
      state.cards = state.cards.filter((x) => x.id !== c.id);
      closeDrawer();
      render();
      setStatus("Tarjeta eliminada", "ok");
    } catch (err) { setStatus("Error al eliminar: " + err.message, "err"); }
  });

  $("kbClose").addEventListener("click", closeDrawer);
  $("kbOverlay").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.openId) closeDrawer(); });

  $("kbNew").addEventListener("click", () => {
    const c = {
      id: uid(), titulo: "Nuevo proyecto", estado: "BACKLOG", descripcion: "", foto: null,
      inicio: "", fin: "", proveedor: "", ingeniero: "", facturas: [],
      orden: Math.max(0, ...state.cards.filter((x) => x.estado === "BACKLOG").map((x) => x.orden)) + 1,
      actualizado: new Date().toISOString(),
    };
    state.cards.push(c);
    render();
    queueSave(c, true);
    openDrawer(c.id);
    F.titulo.focus();
    F.titulo.select();
  });

  // ---------------------------------------------------------------- init ----

  COLUMNS.forEach((col) => {
    const o = document.createElement("option");
    o.value = col.key;
    o.textContent = col.label;
    F.estado.appendChild(o);
  });
  $("kbIngenieros").innerHTML = ENGINEERS.map((n) => '<option value="' + n + '">').join("");

  async function load(silent) {
    try {
      if (!silent) setStatus("Cargando…", "busy");
      state.cards = (await api.list()).map((c) => Object.assign({ facturas: [], foto: null }, c));
      state.loaded = true;
      render();
      if (state.openId && byId(state.openId)) {
        // no pisar lo que se está escribiendo
        if (!drawer.contains(document.activeElement)) fillDrawer(byId(state.openId));
      }
      setStatus(remote ? "Conectado a Google" : "Modo local (sin Apps Script configurado)", "ok");
    } catch (err) {
      setStatus("No se pudo cargar: " + err.message, "err");
    }
  }

  // Cargar al abrir la sección por primera vez y refrescar mientras esté visible
  const panel = $("panel-ingenieria");
  const visible = () => panel.classList.contains("active");
  new MutationObserver(() => { if (visible() && !state.loaded) load(); })
    .observe(panel, { attributes: true, attributeFilter: ["class"] });
  setInterval(() => {
    if (remote && visible() && !state.dragId && !Object.values(state.saveTimers).some(Boolean) && !drawer.contains(document.activeElement)) load(true);
  }, 60000);
  if (visible()) load();
})();

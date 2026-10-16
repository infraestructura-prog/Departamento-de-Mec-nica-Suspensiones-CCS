/* Presentación de proyectos (Proyectos de Ingeniería).
 * Cada propuesta: modelo 3D (STEP/STL/OBJ/GLB), descripción de uso, varios
 * presupuestos (pestañas) con total automático, y mano de obra con contacto.
 * Datos compartidos vía Apps Script (config.js); sin URL → modo local. */

(function () {
  "use strict";

  const API_URL = window.INGENIERIA_API_URL || "";
  const remote = !!API_URL;
  const LOCAL_KEY = "propuestasIngenieria.v1";
  const MAX_FILE_MB = 12;

  const $ = (id) => document.getElementById(id);
  const panel = $("panel-presentaciones");
  if (!panel) return;

  const state = { items: [], openId: null, budgetId: null, loaded: false, timers: {} };
  const byId = (id) => state.items.find((p) => p.id === id);
  const current = () => byId(state.openId);

  // ------------------------------------------------------------- storage ----

  async function post(payload) {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // evita preflight CORS
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Error del servidor");
    return j;
  }
  const localAll = () => JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
  const localSet = (all) => {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(all)); }
    catch (e) { throw new Error("Sin espacio en el navegador (modelo muy grande para el modo local)"); }
  };

  const api = {
    async list() {
      if (!remote) return localAll();
      const j = await (await fetch(API_URL)).json();
      if (!j.ok) throw new Error(j.error || "Error al leer");
      return j.propuestas || [];
    },
    async save(p) {
      if (!remote) {
        const all = localAll();
        const i = all.findIndex((x) => x.id === p.id);
        if (i >= 0) all[i] = p; else all.push(p);
        localSet(all);
        return;
      }
      await post({ action: "saveProp", propuesta: p });
    },
    async remove(id) {
      if (!remote) { localSet(localAll().filter((x) => x.id !== id)); return; }
      await post({ action: "deleteProp", id });
    },
    async upload(file) {
      const b64 = await readB64(file);
      if (!remote) return { id: uid(), name: file.name, mime: file.type, url: "data:" + (file.type || "application/octet-stream") + ";base64," + b64 };
      return post({ action: "upload", name: file.name, mime: file.type, data: b64 }).then((j) => j.file);
    },
    async fetchModel(m) {
      if (m.url) return (await fetch(m.url)).arrayBuffer();
      const j = await (await fetch(API_URL + "?action=file&id=" + encodeURIComponent(m.id))).json();
      if (!j.ok) throw new Error(j.error || "No se pudo descargar el modelo");
      const bin = atob(j.file.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    },
  };

  // ------------------------------------------------------------- helpers ----

  function uid() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : "p" + Date.now() + Math.random().toString(36).slice(2, 8);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function readB64(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(",")[1]);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(file);
    });
  }
  const num = (v) => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; };
  const money = (n) => "$" + n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const materialsTotal = (b) => b.items.reduce((s, it) => s + num(it.cantidad) * num(it.precio), 0);
  const laborTotal = (b) => (b.manoObra || []).reduce((s, w) => s + num(w.precio), 0);
  const budgetTotal = (b) => materialsTotal(b) + laborTotal(b);
  const currentBudget = () => { const p = current(); return p && p.presupuestos.find((x) => x.id === state.budgetId); };

  function setStatus(msg, kind) {
    const el = $("pzStatus");
    el.textContent = msg;
    el.dataset.kind = kind || "";
  }

  function queueSave(p, immediate) {
    if (state.presenting) return; // modo solo lectura
    setStatus("Guardando…", "busy");
    clearTimeout(state.timers[p.id]);
    const run = async () => {
      delete state.timers[p.id];
      p.actualizado = new Date().toISOString();
      try {
        await api.save(p);
        setStatus(remote ? "Guardado en Google" : "Guardado (modo local)", "ok");
      } catch (err) { setStatus("Error al guardar: " + err.message, "err"); }
    };
    if (immediate) run(); else state.timers[p.id] = setTimeout(run, 600);
  }

  // ------------------------------------------------------------- visor 3D ----

  const viewer = { token: 0, dispose: null };

  function waitForSize(el, cb, tries) {
    if (tries === undefined) tries = 60;
    if ((el.clientWidth > 0 && el.clientHeight > 0) || tries <= 0) return cb();
    requestAnimationFrame(() => waitForSize(el, cb, tries - 1));
  }

  function stepToObject(buffer) {
    if (typeof occtimportjs === "undefined") throw new Error("Falta el motor STEP (occt-import-js)");
    return occtimportjs().then((occt) => {
      const result = occt.ReadStepFile(new Uint8Array(buffer), null);
      const group = new THREE.Group();
      result.meshes.forEach((m) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
        if (m.attributes.normal) g.setAttribute("normal", new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
        g.setIndex(new THREE.BufferAttribute(Uint32Array.from(m.index.array), 1));
        const color = m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : 0xcfcfcf;
        group.add(new THREE.Mesh(g, new THREE.MeshPhongMaterial({ color, specular: 0x111111, shininess: 20 })));
        group.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), new THREE.LineBasicMaterial({ color: 0x333333 })));
      });
      return { object: group, zUp: true };
    });
  }

  function bufferToObject(buffer, name) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (ext === "step" || ext === "stp") return stepToObject(buffer);
    if (ext === "stl") {
      const geo = new THREE.STLLoader().parse(buffer);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0xb8bcc8, specular: 0x222222, shininess: 25 }));
      return Promise.resolve({ object: mesh, zUp: true });
    }
    if (ext === "obj") {
      const obj = new THREE.OBJLoader().parse(new TextDecoder().decode(buffer));
      obj.traverse((o) => { if (o.isMesh && !o.material.map) o.material = new THREE.MeshPhongMaterial({ color: 0xb8bcc8 }); });
      return Promise.resolve({ object: obj, zUp: false });
    }
    if (ext === "glb") {
      return new Promise((res, rej) => new THREE.GLTFLoader().parse(buffer, "", (g) => res({ object: g.scene, zUp: false }), rej));
    }
    return Promise.reject(new Error("Formato no soportado: ." + ext));
  }

  function disposeViewer() {
    viewer.token++;
    if (viewer.dispose) { viewer.dispose(); viewer.dispose = null; }
    $("pzViewer").innerHTML = "";
  }

  function showModel(p) {
    disposeViewer();
    const status = $("pzViewerStatus");
    const m = p.modelo;
    $("pzModelRemove").hidden = !m;
    if (!m) { status.textContent = "Sin modelo 3D"; $("pzViewer").innerHTML = '<div class="pz-viewer-empty">🧊<span>Carga un modelo 3D para verlo aquí</span></div>'; return; }
    const token = viewer.token;
    status.textContent = "Cargando " + m.name + "…";
    const container = $("pzViewer");
    waitForSize(container, async () => {
      try {
        const buffer = await api.fetchModel(m);
        if (token !== viewer.token) return;
        const { object, zUp } = await bufferToObject(buffer, m.name);
        if (token !== viewer.token) return;

        const w = container.clientWidth || 600, h = container.clientHeight || 420;
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0xeceaf5);
        container.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        scene.add(new THREE.AmbientLight(0x707070));
        const dl = new THREE.DirectionalLight(0xffffff, 0.8);
        dl.position.set(500, 800, 600);
        scene.add(dl);
        const group = new THREE.Object3D();
        group.add(object);
        scene.add(group);

        const box = new THREE.Box3().setFromObject(group);
        const size = box.getSize(new THREE.Vector3());
        group.position.sub(box.getCenter(new THREE.Vector3()));
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const camera = new THREE.PerspectiveCamera(45, w / h, maxDim / 100, maxDim * 100);
        camera.up.set(0, zUp ? 0 : 1, zUp ? 1 : 0);
        camera.position.set(maxDim * 1.8, maxDim * 1.4, maxDim * 1.8);
        camera.lookAt(0, 0, 0);
        dl.position.set(maxDim * 2, maxDim * 3, maxDim * 2);
        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.update();

        const onResize = () => {
          const rw = container.clientWidth, rh = container.clientHeight;
          if (!rw || !rh) return;
          camera.aspect = rw / rh;
          camera.updateProjectionMatrix();
          renderer.setSize(rw, rh);
        };
        window.addEventListener("resize", onResize);
        renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
        viewer.dispose = () => {
          window.removeEventListener("resize", onResize);
          renderer.setAnimationLoop(null);
          controls.dispose();
          renderer.dispose();
        };
        status.textContent = m.name;
      } catch (err) {
        if (token === viewer.token) status.textContent = "No se pudo mostrar el modelo: " + err.message;
        console.error(err);
      }
    });
  }

  // -------------------------------------------------------------- listado ----

  function renderList() {
    const list = $("pzList");
    list.innerHTML = "";
    state.items.forEach((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pz-chip" + (p.id === state.openId ? " active" : "");
      b.textContent = p.titulo || "Sin título";
      b.addEventListener("click", () => openProp(p.id));
      list.appendChild(b);
    });
    $("pzEmpty").hidden = state.items.length > 0;
    $("pzDetail").hidden = !current();
    $("pzPresent").disabled = !current();
  }

  function openProp(id) {
    state.openId = id;
    const p = byId(id);
    state.budgetId = p.presupuestos.length ? p.presupuestos[0].id : null;
    renderList();
    $("pzTitulo").value = p.titulo || "";
    $("pzDescripcion").value = p.descripcion || "";
    renderBudgets();
    showModel(p);
    showPhoto(p);
  }

  // ------------------------------------------------------- foto / render ----

  const photoSrc = (f) => f.url || "https://drive.google.com/thumbnail?id=" + f.id + "&sz=w1200";

  function showPhoto(p) {
    const f = p.foto;
    $("pzPhotoRemove").hidden = !f;
    $("pzPhotoStatus").textContent = f ? f.name : "Sin foto ni render";
    $("pzPhoto").innerHTML = f
      ? '<img alt="Foto o render de la propuesta" src="' + esc(photoSrc(f)) + '">'
      : '<div class="pz-viewer-empty">🖼️<span>Carga una foto o render para verlo aquí</span></div>';
  }

  // Reduce la imagen a ≤1400px JPEG: carga rápido y cabe en la petición
  function shrinkImage(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1400 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => b ? res(new File([b], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" })) : rej(new Error("No se pudo procesar la imagen")), "image/jpeg", 0.85);
      };
      img.onerror = () => rej(new Error("Imagen no válida"));
      img.src = url;
    });
  }

  $("pzPhotoInput").addEventListener("change", async (e) => {
    const p = current();
    const file = e.target.files[0];
    e.target.value = "";
    if (!p || !file) return;
    try {
      setStatus("Subiendo foto…", "busy");
      p.foto = await api.upload(await shrinkImage(file));
      showPhoto(p);
      queueSave(p, true);
    } catch (err) { setStatus("Error con la foto: " + err.message, "err"); }
  });
  $("pzPhotoRemove").addEventListener("click", () => {
    const p = current();
    if (!p) return;
    p.foto = null;
    showPhoto(p);
    queueSave(p, true);
  });

  // ---------------------------------------------------------- presupuestos ----

  function renderBudgets() {
    const p = current();
    const tabs = $("pzBudgetTabs");
    tabs.innerHTML = "";
    if (!p) return;
    if (!p.presupuestos.some((b) => b.id === state.budgetId)) state.budgetId = p.presupuestos.length ? p.presupuestos[0].id : null;
    p.presupuestos.forEach((b) => {
      const t = document.createElement("button");
      t.type = "button";
      t.className = "pz-tab" + (b.id === state.budgetId ? " active" : "");
      t.dataset.id = b.id;
      t.innerHTML = "<span>" + esc(b.nombre || "Presupuesto") + '</span><b class="pz-tab-total">' + money(budgetTotal(b)) + "</b>";
      t.addEventListener("click", () => { state.budgetId = b.id; renderBudgets(); });
      tabs.appendChild(t);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "pz-tab pz-tab-add";
    add.textContent = "+ Nuevo presupuesto";
    add.addEventListener("click", () => {
      const b = { id: uid(), nombre: "Presupuesto " + (p.presupuestos.length + 1), items: [{ id: uid(), nombre: "", cantidad: 1, precio: 0 }], manoObra: [] };
      p.presupuestos.push(b);
      state.budgetId = b.id;
      renderBudgets();
      queueSave(p, true);
    });
    tabs.appendChild(add);
    renderBudgetBody();
    renderLabor();
  }

  function renderBudgetBody() {
    const p = current();
    const host = $("pzBudget");
    const b = p && p.presupuestos.find((x) => x.id === state.budgetId);
    if (!b) { host.innerHTML = '<div class="pz-none">Crea un presupuesto con «+ Nuevo presupuesto».</div>'; return; }

    host.innerHTML =
      '<div class="pz-budget-name"><label>Nombre del presupuesto</label>' +
      '<input type="text" id="pzBudgetName" value="' + esc(b.nombre) + '" placeholder="Ej. Acero inoxidable 304" maxlength="60">' +
      '<button type="button" class="kb-btn kb-btn-danger" id="pzBudgetDel">Eliminar presupuesto</button></div>' +
      '<div class="pz-table-wrap"><table class="pz-table"><thead><tr><th>Producto</th><th class="num">Cantidad</th>' +
      '<th class="num">Precio unitario ($)</th><th class="num">Total ($)</th><th></th></tr></thead><tbody id="pzRows"></tbody>' +
      '<tfoot><tr><td colspan="3" class="num"><b>SUBTOTAL MATERIALES</b></td><td class="num" id="pzGrand">$0,00</td><td></td></tr></tfoot></table></div>' +
      '<button type="button" class="kb-btn" id="pzRowAdd">+ Agregar producto</button>';

    const rows = $("pzRows");
    b.items.forEach((it) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td><input type="text" data-k="nombre" value="' + esc(it.nombre) + '" placeholder="Nombre del producto"></td>' +
        '<td class="num"><input type="number" data-k="cantidad" min="0" step="any" value="' + esc(it.cantidad) + '"></td>' +
        '<td class="num"><input type="number" data-k="precio" min="0" step="any" value="' + esc(it.precio) + '"></td>' +
        '<td class="num pz-line">' + money(num(it.cantidad) * num(it.precio)) + "</td>" +
        '<td><button type="button" class="kb-x" title="Quitar producto">×</button></td>';
      tr.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => {
        it[inp.dataset.k] = inp.dataset.k === "nombre" ? inp.value : inp.value === "" ? "" : parseFloat(inp.value);
        tr.querySelector(".pz-line").textContent = money(num(it.cantidad) * num(it.precio));
        updateTotals(b);
        queueSave(p);
      }));
      tr.querySelector(".kb-x").addEventListener("click", () => {
        b.items = b.items.filter((x) => x.id !== it.id);
        renderBudgets();
        queueSave(p, true);
      });
      rows.appendChild(tr);
    });
    updateTotals(b);

    $("pzRowAdd").addEventListener("click", () => {
      b.items.push({ id: uid(), nombre: "", cantidad: 1, precio: 0 });
      renderBudgetBody();
      queueSave(p, true);
      const last = $("pzRows").lastElementChild;
      if (last) last.querySelector("input").focus();
    });
    $("pzBudgetName").addEventListener("input", (e) => {
      b.nombre = e.target.value;
      const tab = document.querySelector('.pz-tab[data-id="' + b.id + '"] span');
      if (tab) tab.textContent = b.nombre || "Presupuesto";
      $("pzLaborFor").textContent = "— " + (b.nombre || "Presupuesto");
      queueSave(p);
    });
    $("pzBudgetDel").addEventListener("click", async () => {
      if (!(await askConfirm("¿Eliminar el presupuesto «" + (b.nombre || "Presupuesto") + "» con sus productos y mano de obra?", "Eliminar presupuesto"))) return;
      p.presupuestos = p.presupuestos.filter((x) => x.id !== b.id);
      renderBudgets();
      queueSave(p, true);
    });
  }

  function updateTotals(b) {
    const set = (id, v) => { const el = $(id); if (el) el.textContent = money(v); };
    set("pzGrand", materialsTotal(b));
    set("pzGrand2", materialsTotal(b));
    set("pzLaborTotal", laborTotal(b));
    set("pzTotalAll", budgetTotal(b));
    const t = document.querySelector('.pz-tab[data-id="' + b.id + '"] .pz-tab-total');
    if (t) t.textContent = money(budgetTotal(b));
  }

  // ----------------------------------------------------------- mano de obra ----
  // La mano de obra pertenece a cada presupuesto: al cambiar de pestaña cambia la lista.

  function renderLabor() {
    const p = current();
    const b = currentBudget();
    const host = $("pzLabor");
    host.innerHTML = "";
    $("pzLaborAdd").hidden = !b;
    $("pzLaborSummary").hidden = !b;
    $("pzLaborFor").textContent = b ? "— " + (b.nombre || "Presupuesto") : "";
    if (!b) { host.innerHTML = '<div class="pz-none">Crea un presupuesto para agregar mano de obra.</div>'; return; }
    if (!b.manoObra) b.manoObra = [];
    if (!b.manoObra.length) host.innerHTML = '<div class="pz-none">Sin personas en este presupuesto.</div>';
    else {
      const head = document.createElement("div");
      head.className = "pz-labor-row pz-labor-head";
      head.innerHTML = "<span>Nombre</span><span>Contacto</span><span>Precio ($)</span><span></span>";
      host.appendChild(head);
    }
    b.manoObra.forEach((w) => {
      const row = document.createElement("div");
      row.className = "pz-labor-row";
      row.innerHTML =
        '<input type="text" data-k="nombre" value="' + esc(w.nombre) + '" placeholder="Nombre">' +
        '<input type="text" data-k="contacto" value="' + esc(w.contacto) + '" placeholder="Teléfono, correo…">' +
        '<input type="number" data-k="precio" min="0" step="any" value="' + esc(w.precio) + '" placeholder="0.00">' +
        '<button type="button" class="kb-x" title="Quitar">×</button>';
      row.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => {
        w[inp.dataset.k] = inp.dataset.k === "precio" ? (inp.value === "" ? "" : parseFloat(inp.value)) : inp.value;
        updateTotals(b);
        queueSave(p);
      }));
      row.querySelector(".kb-x").addEventListener("click", () => {
        b.manoObra = b.manoObra.filter((x) => x.id !== w.id);
        renderLabor();
        updateTotals(b);
        queueSave(p, true);
      });
      host.appendChild(row);
    });
    updateTotals(b);
  }

  // --------------------------------------------------------------- eventos ----

  $("pzLaborAdd").addEventListener("click", () => {
    const p = current();
    const b = currentBudget();
    if (!b) return;
    if (!b.manoObra) b.manoObra = [];
    b.manoObra.push({ id: uid(), nombre: "", contacto: "", precio: "" });
    renderLabor();
    queueSave(p, true);
    const rows = $("pzLabor").querySelectorAll(".pz-labor-row:not(.pz-labor-head)");
    if (rows.length) rows[rows.length - 1].querySelector("input").focus();
  });

  $("pzTitulo").addEventListener("input", (e) => {
    const p = current();
    if (!p) return;
    p.titulo = e.target.value;
    renderList();
    queueSave(p);
  });
  $("pzDescripcion").addEventListener("input", (e) => {
    const p = current();
    if (!p) return;
    p.descripcion = e.target.value;
    queueSave(p);
  });

  $("pzNew").addEventListener("click", () => {
    const p = {
      id: uid(), titulo: "Nueva propuesta", descripcion: "", modelo: null, foto: null,
      presupuestos: [{ id: uid(), nombre: "Presupuesto 1", items: [{ id: uid(), nombre: "", cantidad: 1, precio: 0 }], manoObra: [] }],
      orden: Date.now(), actualizado: new Date().toISOString(),
    };
    state.items.push(p);
    queueSave(p, true);
    openProp(p.id);
    $("pzTitulo").focus();
    $("pzTitulo").select();
  });

  $("pzDelete").addEventListener("click", async () => {
    const p = current();
    if (!p) return;
    if (!(await askConfirm("¿Eliminar la propuesta «" + (p.titulo || "Sin título") + "»? Se borra completa: modelo 3D, foto, descripción, presupuestos y mano de obra. No se puede deshacer.", "Eliminar propuesta"))) return;
    try {
      await api.remove(p.id);
      state.items = state.items.filter((x) => x.id !== p.id);
      state.openId = null;
      disposeViewer();
      renderList();
      if (state.items.length) openProp(state.items[0].id);
      setStatus("Propuesta eliminada", "ok");
    } catch (err) { setStatus("Error al eliminar: " + err.message, "err"); }
  });

  $("pzModelInput").addEventListener("change", async (e) => {
    const p = current();
    const file = e.target.files[0];
    e.target.value = "";
    if (!p || !file) return;
    try {
      if (!/\.(step|stp|stl|obj|glb)$/i.test(file.name)) throw new Error("Usa STEP, STL, OBJ o GLB");
      if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error("Máx. " + MAX_FILE_MB + " MB");
      setStatus("Subiendo modelo…", "busy");
      p.modelo = await api.upload(file);
      showModel(p);
      queueSave(p, true);
    } catch (err) { setStatus("Error con el modelo: " + err.message, "err"); }
  });
  $("pzModelRemove").addEventListener("click", () => {
    const p = current();
    if (!p) return;
    p.modelo = null;
    showModel(p);
    queueSave(p, true);
  });

  // ------------------------------------------------------- modo presentar ----
  // Misma vista, pero sin menús ni controles de edición y con los campos bloqueados.

  function lockInputs() {
    panel.querySelectorAll("input, textarea").forEach((el) => { el.readOnly = state.presenting; el.tabIndex = state.presenting ? -1 : 0; });
  }
  const origRenderBudgetBody = renderBudgetBody;
  renderBudgetBody = function () { origRenderBudgetBody(); if (state.presenting) lockInputs(); };
  const origRenderLabor = renderLabor;
  renderLabor = function () { origRenderLabor(); if (state.presenting) lockInputs(); };

  function setPresenting(on) {
    if (on && !current()) return;
    state.presenting = on;
    document.body.classList.toggle("pz-presenting", on);
    $("pzExit").hidden = !on;
    lockInputs();
    if (on) {
      window.scrollTo(0, 0);
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    } else if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    setTimeout(() => window.dispatchEvent(new Event("resize")), 60); // re-ajusta el visor 3D
  }
  $("pzPresent").addEventListener("click", () => setPresenting(true));
  $("pzExit").addEventListener("click", () => setPresenting(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.presenting) setPresenting(false); });
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && state.presenting) setPresenting(false); });

  // ------------------------------------------------------------------ init ----

  async function load() {
    try {
      setStatus("Cargando…", "busy");
      state.items = (await api.list()).map((p) => Object.assign({ presupuestos: [], modelo: null, foto: null }, p))
        .sort((a, b) => (a.orden || 0) - (b.orden || 0));
      // Migración: la mano de obra antes era única por propuesta; ahora es por presupuesto
      state.items.forEach((p) => {
        p.presupuestos.forEach((b) => { if (!b.manoObra) b.manoObra = []; });
        if (p.manoObra && p.manoObra.length && p.presupuestos.length) {
          p.presupuestos[0].manoObra = p.presupuestos[0].manoObra.concat(p.manoObra);
          p.manoObra = [];
          queueSave(p, true);
        }
      });
      state.loaded = true;
      renderList();
      if (state.items.length) openProp(state.items[0].id);
      setStatus(remote ? "Conectado a Google" : "Modo local (sin Apps Script configurado)", "ok");
    } catch (err) { setStatus("No se pudo cargar: " + err.message, "err"); }
  }

  // Cargar la primera vez que se abre la sección (el visor necesita el contenedor visible)
  new MutationObserver(() => { if (panel.classList.contains("active") && !state.loaded) load(); })
    .observe(panel, { attributes: true, attributeFilter: ["class"] });
  if (panel.classList.contains("active")) load();
})();

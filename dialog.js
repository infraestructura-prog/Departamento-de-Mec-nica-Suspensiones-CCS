/* Cuadro de confirmación propio (los confirm() nativos pueden estar bloqueados
 * en navegadores embebidos y devolver "cancelar" sin mostrarse).
 * Uso: if (await askConfirm("¿Seguro?", "Eliminar")) { ... } */
(function () {
  "use strict";
  let box = null;

  function build() {
    box = document.createElement("div");
    box.className = "dlg-overlay";
    box.hidden = true;
    box.innerHTML =
      '<div class="dlg" role="alertdialog" aria-modal="true">' +
      '<p class="dlg-msg"></p>' +
      '<div class="dlg-actions">' +
      '<button type="button" class="kb-btn" data-r="0">Cancelar</button>' +
      '<button type="button" class="kb-btn kb-btn-danger" data-r="1"></button>' +
      "</div></div>";
    document.body.appendChild(box);
  }

  /* Formulario corto en un cuadro. fields: [{key,label,value,placeholder,type,options,required}]
   * Devuelve {key: valor} o null si se cancela.
   * Uso: const r = await askForm("Nueva categoría", [{key:"nombre",label:"Nombre"}], "Crear"); */
  let formBox = null;
  window.askForm = function (title, fields, okLabel) {
    if (!formBox) {
      formBox = document.createElement("div");
      formBox.className = "dlg-overlay";
      formBox.hidden = true;
      document.body.appendChild(formBox);
    }
    return new Promise((resolve) => {
      const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
      formBox.innerHTML =
        '<form class="dlg dlg-form" novalidate><h3 class="dlg-title">' + esc(title) + "</h3>" +
        fields.map((f) =>
          '<label class="dlg-field"><span>' + esc(f.label) + "</span>" +
          (f.options
            ? '<select name="' + f.key + '">' + f.options.map((o) => '<option value="' + esc(o.value) + '"' + (o.value === f.value ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select>"
            : '<input name="' + f.key + '" type="' + (f.type || "text") + '" value="' + esc(f.value) + '" placeholder="' + esc(f.placeholder || "") + '" autocomplete="off">') +
          "</label>").join("") +
        '<p class="dlg-err" hidden></p><div class="dlg-actions"><button type="button" class="kb-btn" data-r="0">Cancelar</button>' +
        '<button type="submit" class="kb-btn kb-btn-primary">' + esc(okLabel || "Aceptar") + "</button></div></form>";
      formBox.hidden = false;
      const form = formBox.querySelector("form");
      const first = form.querySelector("input,select");
      if (first) { first.focus(); if (first.select) first.select(); }

      const done = (val) => {
        formBox.hidden = true;
        formBox.innerHTML = "";
        document.removeEventListener("keydown", onKey, true);
        resolve(val);
      };
      const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
      document.addEventListener("keydown", onKey, true);
      form.querySelector('[data-r="0"]').addEventListener("click", () => done(null));
      formBox.addEventListener("mousedown", function onBg(e) { if (e.target === formBox) { formBox.removeEventListener("mousedown", onBg); done(null); } });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const out = {};
        fields.forEach((f) => { out[f.key] = form.elements[f.key].value.trim(); });
        const missing = fields.find((f) => f.required && !out[f.key]);
        if (missing) {
          const err = form.querySelector(".dlg-err");
          err.textContent = "Falta: " + missing.label;
          err.hidden = false;
          form.elements[missing.key].focus();
          return;
        }
        done(out);
      });
    });
  };

  window.askConfirm = function (message, okLabel) {
    if (!box) build();
    return new Promise((resolve) => {
      box.querySelector(".dlg-msg").textContent = message;
      const ok = box.querySelector('[data-r="1"]');
      const cancel = box.querySelector('[data-r="0"]');
      ok.textContent = okLabel || "Aceptar";
      box.hidden = false;
      ok.focus();

      const done = (val) => {
        box.hidden = true;
        box.removeEventListener("click", onClick);
        document.removeEventListener("keydown", onKey, true);
        resolve(val);
      };
      const onClick = (e) => {
        if (e.target === box) done(false);
        else if (e.target === ok) done(true);
        else if (e.target === cancel) done(false);
      };
      const onKey = (e) => {
        if (e.key === "Escape") { e.stopPropagation(); done(false); }
      };
      box.addEventListener("click", onClick);
      document.addEventListener("keydown", onKey, true);
    });
  };
})();

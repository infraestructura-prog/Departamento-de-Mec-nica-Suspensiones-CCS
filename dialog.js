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

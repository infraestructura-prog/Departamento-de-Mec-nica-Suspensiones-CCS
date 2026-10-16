# Memory — Inventario (página web en tiempo real)

## 2026-09-03 — Pestaña "Térmica NODO": comparativa térmica OpenFOAM de los 6 ventiladores

- Otra sesión de Claude corrió un estudio térmico real (buoyantSimpleFoam,
  ambiente La Guaira 40°C) del NODO una vez por cada uno de los 6
  ventiladores de `FAN_MODELS` (pestaña Filtros), y dejó el brief + assets
  listos en `NODOS/CFD/` + un artifact de referencia
  (`claude.ai/code/artifact/46a53fdc-e62d-475d-995f-ae0b1f420048`, privado,
  del usuario) con el diseño ya resuelto. Esta sesión integró eso a
  `Inventario/index.html` como pestaña nueva **"Térmica NODO"** (entre NODOS
  y Filtros), reutilizando el artifact como referencia de estructura/copy
  pero restyleado con las clases ya existentes del sitio (`analysis-block`,
  `table-card`, `kpi-row`, `nodos-player`, `filtros-select`) — sin CSS nuevo.
- **Discrepancia real encontrada y corregida antes de construir nada**: el
  usuario dijo "30 imágenes por ventilador (iter=40,80,...,1200) en las 6
  carpetas", pero en el disco 3 de las 6 carpetas (`case_nodo_termico_v1`,
  `_fan_noctua`, `_fan_arctic_ln`) tienen en realidad 60 frames (paso 20), no
  30. Se verificó con `Get-ChildItem` antes de asumir nada. Solución: se usa
  el conjunto común de 30 frames (40,80,...,1200, paso 40) que SÍ existe en
  las 6 carpetas — es un subconjunto exacto de las que tienen 60 (40 es
  múltiplo de 20) — para que el reproductor sea uniforme. Los frames extra
  (iter=20,60,100...) de esas 3 carpetas no se subieron, no hacen falta.
- Se verificó visualmente (no solo se confió en el texto) que la escala de
  color es realmente comparable entre ventiladores: se vio `frame_1200.png`
  de `v1` (mucho más cálido/rojo) contra el de `noctua` (mucho más azul) —
  coincide con la tabla (v1 pared máx 62,1°C vs Noctua 56,6°C).
- Convención de archivos: `termico-<key>-<iter>.png` en la raíz (sin
  subcarpeta, como todo en este repo), `key` ∈ {v1, noctua, bequiet, corsair,
  arctic_co, arctic_ln} — mismos `key` que usa el propio artifact de
  referencia. **180 archivos (30×6), 4.37MB en total.**
- **A diferencia de intentos anteriores con archivos grandes, esta vez SÍ se
  pudo subir todo por la API** (push directo con el token, sin pedirle nada
  manual al usuario) — 180 llamadas PUT individuales, cada una de un archivo
  chico (20-30KB), todas exitosas al primer intento salvo reintentos
  automáticos que no hicieron falta. Confirma la entrada anterior sobre el
  límite de tamaño: el problema es el tamaño de CADA petición individual, no
  la cantidad de archivos — muchos archivos chicos por separado sí funciona
  bien, un archivo grande en una sola petición es lo que falla.
- **Ojo con un falso negativo de la Contents API**: después de las 180
  subidas, un `GET .../contents/<archivo>` para verificar devolvió 404 en 3
  archivos de muestra — parecía que la subida había fallado. Se verificó con
  la **Git Trees API** (`GET .../git/trees/main?recursive=1`, lista TODO el
  árbol de una vez, más confiable que consultar archivo por archivo después
  de muchas escrituras seguidas) y con una descarga directa a
  `raw.githubusercontent.com` — ambas confirmaron que los 180 archivos sí
  estaban. **Si esto se repite: no asumir que la subida falló solo por un
  404 puntual de Contents API justo después de un lote grande de escrituras
  — confirmar con git/trees o raw.githubusercontent.com antes de reintentar
  o alarmar al usuario.**
- Los datos de residuales de convergencia (`CFD/herramientas/
  residuales_downsample.json`, ~200 puntos × 6 series) se incrustaron
  directo como constante JS en el `<script>` de la pestaña — no se subió
  como archivo aparte, es chico (~15KB) y así no depende de un fetch extra.
- **Actualización misma fecha**: el usuario pidió primero una presentación
  "bonita" para su jefe con texto explicativo + imágenes por ventilador — se
  hizo como Claude Artifact aparte (`El Ventilador Correcto`, publicado,
  imágenes embebidas en base64 porque un artifact es autocontenido). Pero
  el usuario aclaró después que **quería esto integrado a su propio sitio
  (GitHub/Vercel), no solo en un link de Claude** — se integró el mismo
  contenido (narrativa por ventilador + filmstrip de 6 cuadros pausados +
  recomendación + 5 próximos pasos numerados) directo en la pestaña
  "Térmica NODO" de `index.html`, reusando los archivos `termico-*.png` ya
  subidos (`<img src>` normal, sin base64 — mucho más liviano que el
  artifact). Lección: cuando el usuario pide algo "bonito para presentar",
  no asumir que un Claude Artifact es lo que quiere si el proyecto ya tiene
  su propio sitio — preguntar o, si no está claro, ofrecer ambos en vez de
  asumir uno solo.
- **Actualización 2026-09-03 — flujo de aire por ventilador (paso 4 completado)**:
  el usuario pidió correr también flujo de aire, no solo temperatura, para los
  6 ventiladores. Insight clave antes de asumir que hacía falta una simulación
  nueva: `buoyantSimpleFoam` resuelve velocidad (U) Y temperatura (T) juntas en
  la misma corrida — el dato de flujo YA EXISTÍA en los 6 casos térmicos, solo
  faltaba el post-proceso/render, exactamente como se había dejado anotado en
  el paso 4 de "próximos pasos". Se reusaron las herramientas que dejó la
  sesión de NODOS en `NODOS/CFD/herramientas/` (`render_frames.py`, ya hecho
  para velocidad en el caso viejo `case_nodo_v2`) en vez de escribir un
  pipeline de ParaView desde cero:
  - Se creó `render_frames_flujo.py` (variante de `render_frames_termico.py`
    pero coloreando por `|U|` en vez de `T`, con el rango de color como
    parámetro CLI en vez de hardcodeado — el original `render_frames.py`
    tenía el rango fijo en 0.0–3.4 m/s calibrado para `case_nodo_v2`, muy bajo
    para el Noctua de este estudio).
  - Antes de renderizar, se probó el rango real de velocidad de las 6 corridas
    con un script aparte (`probe_umax.py`) en vez de adivinar un rango — el
    máximo real fue 4,72 m/s (Noctua, por aceleración local dentro de la
    geometría, más alto que su velocidad de entrada de ficha 3,60 m/s). Se usó
    0–4,8 m/s como escala fija compartida en los 6.
  - **El primer intento de correr las 6 en un solo script bash en background
    falló sin ningún output (exit code 1, log vacío) — causa no diagnosticada,
    parece un problema del wrapper de background con procesos WSL/xvfb, no
    del script en sí** (el mismo comando corrió perfecto en foreground,
    ventilador por ventilador). Lección: para trabajos de render/CFD vía WSL
    en esta máquina, correr en foreground uno por uno en vez de un batch en
    background, al menos hasta entender por qué falla en background.
  - Entorno: WSL Ubuntu con OpenFOAM 2412 (`source
    /usr/lib/openfoam/openfoam2412/etc/bashrc`) y ParaView (`pvbatch` +
    `xvfb-run` para headless). Rutas Windows→WSL vía `/mnt/c/...`.
  - 180 frames nuevos (30 por ventilador) copiados a `Inventario/` como
    `flujo-<key>-<iter>.png` (mismo `key`/`iter` que los de temperatura) y
    subidos a `main` sin problema por la API (10.19MB en 180 archivos chicos).
  - En `index.html`: se agregó un selector "Campo" (Temperatura/Flujo de
    aire) al reproductor cuadro-a-cuadro existente (mismo `<select>`, la
    imagen ahora arma la ruta como `currentField + "-" + currentFan + "-" +
    iter + ".png"`), y una segunda tira de 6 cuadros de flujo debajo de la de
    temperatura en cada uno de los 6 "casos". El paso 4 de "próximos pasos"
    se marcó como completado (tachado) en vez de borrarlo, con la conclusión:
    confirma la misma historia por otra vía — Noctua tiene el chorro más
    definido, ARCTIC LN el más apagado, visualmente consistente con la
    tabla de temperaturas.
- El gráfico de convergencia es un SVG dibujado a mano (log-scale, sin
  librería) replicando `drawChart()` del artifact de referencia, con la
  paleta ya establecida del sitio (blue/aqua/yellow/bad/cyan/orange) en vez
  de los colores propios del artifact (que usaba su propia paleta
  beige/teal, pensada para verse standalone, no para calzar con el resto de
  Inventario).

## 2026-09 — Visor 3D STEP integrado (pestaña "Piezas 3D"), brief de NODOS

- Se integró el visor 3D interactivo (STEP + Three.js + `occt-import-js`
  WASM) descrito en `NODOS/Documentacion/Integracion_Visor_Web_Inventario.md`
  — ese doc es la fuente de verdad del diseño técnico, escrito por otra
  sesión que ya lo probó localmente. Nueva pestaña "Piezas 3D" en
  `index.html`, contenido fijo (no lee ningún Sheet). Estructura: selector
  `<select id="piezaSelect">` (extensible — hoy solo tiene
  `river2max-assemble.step`, agregar más pares `{name, file}` a `PIEZAS_3D`
  cuando haya más piezas) + `#viewer3dContainer` (500px alto fijo, CSS
  `.viewer3d-container`) + línea de estado (`#viewer3dStatus`).
- **Carga perezosa robusta**: en vez de depender de que mi listener del tab
  corra después del de `setupTabs()` (app.js) — que habría sido frágil según
  el orden de `<script>` en el archivo — se agregó `waitForVisibleSize()`,
  que sondea con `requestAnimationFrame` hasta que el contenedor tenga
  tamaño real (>0) antes de inicializar el renderer. Evita el bug que el
  propio brief advertía (`renderer.setSize` con medidas 0 si se carga con la
  pestaña oculta).
- Se agregó `vercel.json` (nuevo archivo, no existía ninguno antes) con el
  header `Content-Type: application/wasm` para `*.wasm`, preventivo, tal
  como recomendaba el brief.
- **Límite real encontrado con la API de GitHub (Contents API vía
  `Invoke-RestMethod`/token)**: falla con un 401 "Bad credentials" engañoso
  (no es un problema del token — se confirmó que el mismo token sigue
  funcionando para archivos chicos justo después) en cuanto el cuerpo de la
  petición (JSON con el contenido en base64) pasa de unos pocos MB —
  confirmado con un archivo de prueba (dummy) de ~9MB en base64, que también
  falló igual. Un archivo de 1.04MB (`river2max-assemble.step`) subió bien;
  el `.wasm` de 7.6MB no. **Conclusión práctica: la Contents API de GitHub
  vía este método solo es confiable para archivos pequeños (unos pocos MB);
  para archivos más grandes, pedirle al usuario que los suba manualmente por
  la interfaz web de GitHub** (soporta hasta 25MB por drag-and-drop) — no
  perder tiempo reintentando o cambiando de endpoint (Git Data API con
  blob+tree+commit) sin evidencia de que resolvería el mismo límite de
  tamaño de petición.
- **Pendiente**: el usuario debe subir manualmente `occt-import-js.wasm`
  (7.6MB, ya copiado a `Inventario/occt-import-js.wasm` localmente, listo
  para arrastrar) a la rama `main` vía "Add file → Upload files" — es el
  único archivo que falta para que la pestaña "Piezas 3D" funcione en
  producción. Todo lo demás (index.html, style.css, vercel.json,
  occt-import-js.js, river2max-assemble.step) ya se subió vía API.
- Próxima sesión: una vez el usuario confirme que subió el `.wasm` y probó
  la pestaña, revisar la consola del navegador si algo falla (el brief
  señala el MIME type del `.wasm` como sospechoso #1, ya mitigado con
  `vercel.json`, pero verificar en producción real igual).

## 2026-09 (continuación) — Pipeline SolidWorks → STEP → visor, automatizado end-to-end

- El usuario quería probar el visor con piezas propias en formato nativo de
  SolidWorks (`.sldprt`/`.sldasm`), de la carpeta
  `C:\Users\Giovanni\Documents\Archivos SolidWorks\Test\` (**ojo, esa carpeta
  vive directo bajo Documents, no dentro de
  `Departamento_Mecanica_SusCCS`** — nombre real "Archivos SolidWorks", sin
  "de"). El visor solo lee STEP, no el formato nativo — se le explicó eso
  primero.
- El conector MCP de SolidWorks (`mcp__solidworks__*`) ya estaba conectado
  (`connect_solidworks` devolvió `launched: false`, es decir ya estaba
  abierto) — se automatizó el pipeline completo sin pedirle al usuario que
  exportara nada a mano:
  1. `open_document(ruta.SLDPRT/.SLDASM)`
  2. `save_document(ruta_nueva.step)` — **el tool ya infiere el formato por
     la extensión del path** (no hizo falta `execute_python` con
     `SaveAs3` manual, la ruta simple funcionó a la primera).
  3. `close_document(save: false)` — nunca se guardó el archivo original,
     solo se generó el `.step` aparte.
  - Se probó primero con UNA pieza antes de hacer las 5, para no automatizar
    a ciegas un método sin confirmar.
  - Nombres de archivo STEP normalizados a ASCII/slug (`cuna.step` en vez de
    `Cuña.step`) a propósito, para no arriesgar problemas de encoding en
    URLs/GitHub — la ñ del nombre original se perdió aposta en el nombre de
    archivo (no en el `name` que se muestra en el desplegable, ese sí dice
    "Cuña").
- Las 5 piezas (`Panel Solar 100w`, `Base Roscable 100w`, `Cuña`, `Tornillo
  con Parte Hexagonal`, y el ensamblaje `Ensamblaje Panel Solar 100w`) se
  agregaron a `PIEZAS_3D` en `index.html` y se subieron a `main` sin
  intervención manual del usuario.
- **El límite de tamaño de la Contents API de GitHub (ver entrada anterior)
  resultó ser más flaky que un límite duro**: el archivo del ensamblaje
  (3.09MB) falló la primera vez con el mismo 401 engañoso, pero **funcionó
  al reintentar una sola vez, sin cambiar nada**. Ajustar la expectativa:
  para archivos en el rango de ~2-4MB, vale la pena reintentar 1-2 veces
  antes de rendirse y pedirle al usuario que lo suba a mano — el `.wasm` de
  7.6MB de la entrada anterior sí puede seguir siendo un caso perdido (mucho
  más grande), no se reintentó ahí todavía las veces suficientes para saber
  si también es solo flaky.

## 2026-09 — Simulación de Filtros (V2): selector de ventilador real + velocidad + "sin filtro"

- El usuario pidió mejoras a la pestaña "Filtros" (simulación de partículas,
  ver entrada de abajo para su origen) en base a una transcripción de reunión
  del equipo sobre el estudio de ventiladores/filtros. La transcripción pedía
  explícitamente: (1) un desplegable de modelo de ventilador porque "cada
  modelo tiene un FM diferente", (2) considerar el consumo energético, no solo
  el caudal, (3) más feedback visual/animado del aire pasando.
- Se agregaron al bloque `<script>` de la simulación V2 (dentro de
  `index.html`, no toca `app.js`):
  - `FAN_MODELS` — los 5 ventiladores reales que compró el departamento, con
    specs verificadas por búsqueda web en las páginas oficiales de cada
    fabricante (no inventadas): be quiet! Silent Wings Pro 4 (83.9 CFM, 5.31
    mmH₂O, 3000 RPM, 36.9 dBA, 3.6W), Noctua NF-F12 industrialPPC-3000 (109.9
    CFM, 7.63 mmH₂O, 3000 RPM, 43.5 dBA, 3.6W), Corsair RS120 (72.8 CFM, 4.15
    mmH₂O, 2100 RPM, 36 dBA, 4.8W), ARCTIC P12 Pro PST CO (56.3 CFM, 2.2
    mmH₂O, 3000 RPM, 25 dBA, 0.96W@1800rpm), ARCTIC P12 Pro PST LN (49 CFM,
    3.5 mmH₂O, 2000 RPM, 25 dBA). **El consumo del ARCTIC LN (0.8W) es un
    ESTIMADO** — ARCTIC no lo publica, se estimó por familia contra el PST CO
    — marcado con `wattsEstimado: true` y un `*` visible en el HUD, no se
    presentó como dato oficial.
  - Selector de **Velocidad** (100%/70%) — mismo criterio que la pestaña
    "Análisis de Datos" (el otro estudio de caudal, Sheet aparte).
  - Opción **"Sin filtro (referencia)"** agregada a `FILTER_V2` (id `0`).
  - El caudal ya no usa un `base_cfm` fijo por filtro como el caudal final —
    ese número ahora se reinterpreta como fracción de paso
    (`base_cfm/REF_FAN_CFM`, con `REF_FAN_CFM=80`) aplicada sobre el caudal
    REAL del ventilador elegido × velocidad elegida. Así cambiar de
    ventilador cambia de verdad la simulación (antes el "ventilador" era
    solo un dibujo fijo sin ningún dato real detrás).
  - Aspas del ventilador animadas (rotan), velocidad de giro atada al
    %RPM del ventilador+velocidad elegidos — mejora visual pedida en la
    transcripción ("agregaría un elemento de animación").
  - HUD ampliado con RPM aproximado y consumo (W) del ventilador
    seleccionado; caption bajo el HUD con las specs completas y la fuente.
  - Todo esto es exclusivo de la **Versión 2** — la Versión 1 ("borrador",
    Tul+Nylon) no se tocó, sigue con su caudal fijo de 60 CFM de referencia.
- **No implementado a propósito** (la propia transcripción lo trata como
  trabajo futuro más complejo, no algo para "ya"): modelado de temperatura
  interna / autonomía de batería en función del consumo del ventilador a lo
  largo de 24h, y el ciclo de trabajo histórico real (datos de Rogelio/
  electrónica). Si se retoma, la transcripción original (audio de reunión,
  la aportó el usuario) tiene el detalle de qué se discutió al respecto.
- El token de GitHub compartido semanas atrás (ver más abajo si esa entrada
  sigue existiendo, o preguntar al usuario si no) **seguía funcionando** al
  probarlo de nuevo — no asumir que un token viejo sigue vivo sin probarlo
  primero con una llamada de solo lectura.

## 2026-09 (continuación) — Menús desplegables, ventilador original (RUI ZHAN), slider de velocidad

- El usuario pidió, citando otra vez la misma transcripción de reunión: (1)
  convertir los selectores en "menú desplegable" (el jefe lo dijo
  textualmente sobre el ventilador: "es un desplegable de ventilador"), (2)
  agregar el ventilador de alto consumo con el que se venía trabajando desde
  el inicio del proyecto (dio marca/modelo/specs eléctricas él mismo), (3)
  una forma de "ir regulando" la velocidad, no solo un toggle fijo.
- **Ventilador/Filtro** pasaron de filas de botones a `<select>` nativos
  (`buildSelect()`, nueva función junto a `buildButtons()` — no se borró
  `buildButtons`, la sigue usando "Amenaza" que no era parte del pedido).
- **Velocidad** pasó de 2 botones (100%/70%) a un `<input type="range">`
  continuo (20%–100%, paso 5) — evento `input` actualiza en vivo mientras se
  arrastra, evento `change` dispara `resetSim()` al soltar (no en cada tick,
  para no reiniciar la simulación 10 veces por segundo mientras se arrastra).
- **6to ventilador agregado**: `RUI ZHAN RZ12038H12B-6` (el usuario escribió
  "-G" pero la búsqueda solo encontró variantes reales "-6"/"-7" con
  exactamente el 12V/2.7A que dio el usuario — se usó "-6", es el mismo
  ventilador de minería ASIC que aparece constantemente en la transcripción
  de la reunión y en el estudio de la pestaña Análisis de Datos). Es el
  ventilador **por defecto** al abrir la pestaña (`state.activeFan = 6`) por
  ser "el que se venía trabajando desde el inicio". Su CFM en la simulación
  (63,56) es el **medido por el propio equipo en túnel de viento**, NO el
  dato de fabricante — la transcripción muestra al equipo desconfiando
  explícitamente del CFM que reporta el fabricante para este ventilador
  ("el fabricante se equivocó... busca redondear para arriba"), así que
  usar el dato medido es más coherente con su propio criterio, no solo más
  conveniente. mmH₂O y dBA no están publicados para este modelo — se
  muestran condicionalmente en el caption (`f.mmH2O != null`), no se
  inventaron.
- El consumo (W) del HUD ahora escala linealmente con el % de velocidad del
  slider (antes era el valor nominal fijo sin importar la velocidad) — el
  caption debajo del HUD sigue mostrando la spec nominal completa (a RPM
  máx.) como referencia de fabricante, son dos cosas distintas a propósito.
- Verificado de nuevo contra la transcripción completa del viernes que no
  quedara nada más pendiente de la parte de software/simulación (se
  reconfirmó qué queda deliberadamente fuera de alcance: modelado de
  temperatura interna y ciclo de trabajo de 24h con datos históricos de
  electrónica — la propia reunión lo trata como trabajo futuro, no de esta
  ronda).

## 2026-08-26 — Pestaña nueva "NODOS", contenido estático (no viene del Sheet)

Se agregó una pestaña **NODOS** (`.tab-btn[data-tab="nodos"]` +
`#panel-nodos`) mostrando resultados de la simulación CFD del proyecto
NODOS (maletas de moto con Starlink+EcoFlow) — trabajo hecho en
`../NODOS/CFD/`, ver `NODOS/MEMORY.md` sección "2026-08-26 (continuación 9)"
para el detalle completo. A diferencia de las demás pestañas, **este
contenido es fijo, no se lee de ningún Sheet** — son imágenes estáticas
(`nodos-*.png`, convención de la carpeta: sueltas en la raíz, sin
subcarpetas) más un reproductor cuadro-a-cuadro en JS propio (inline en
`index.html`, no toca `app.js`). Actualizar manualmente (nuevas imágenes +
editar el bloque HTML) cada vez que haya una corrida CFD nueva que valga la
pena mostrar — no hay automatización.

## 2026-08-19 — Decisiones de arquitectura cerradas, plan definido (aún sin construir nada)

- **Pedido del usuario**: una página creativa que centralice todas las pestañas del
  Sheet de inventario (el mismo que sincroniza a Notion, ver
  [[reference_suscss_ids]]) en tiempo real, alojada gratis en algo tipo
  Vercel/GitHub, amigable para cualquier persona del departamento.
- Se le preguntó al usuario (vía `AskUserQuestion`, no se asumió) y decidió:
  1. **Datos**: Sheet público ("Cualquiera con el enlace") + Google Sheets API v4
     consultada directamente desde el navegador — NO el Apps Script "puente" que se
     le ofreció como alternativa más privada/controlada.
  2. **Acceso**: enlace abierto de la página, sin login ni contraseña.
  3. **Skill `build-dashboard`** (en `Inventario/claude-build-dashboard-skill-master/`):
     se usa solo como referencia de diseño (paleta, tarjetas KPI, reglas de gráfico,
     patrón de filtro dropdown) traducida a HTML/CSS/JS — NO se instala en
     `.claude/skills/` ni se ejecuta para generar un Excel/Google Sheet nuevo.
- Se confirmó con `git --version` / `node --version` / `gh --version` que **ninguno
  de los tres está instalado** en esta máquina (mismo patrón que
  [[feedback_env_no_admin]]) — el plan completo se diseñó alrededor de subir código a
  GitHub por la interfaz web y desplegar con el dashboard de Vercel, sin CLI ni build
  step local.
- Detalle completo de la arquitectura y el paso a paso quedó en
  [CLAUDE.md](CLAUDE.md) de esta carpeta y se le explicó al usuario en el chat de esa
  fecha.

## 2026-08-19 (continuación) — Confusión API key vs OAuth Client ID

- El usuario creó en Google Cloud Console un **OAuth 2.0 Client ID** (Client ID +
  Client Secret) y marcó permisos en "Acceso a los datos" (pantalla de
  consentimiento OAuth) — y pegó el Client Secret en texto plano en el chat.
- Eso NO es lo que necesita esta arquitectura. Para Sheet público + JS de navegador
  sin login se necesita una **API key simple** (sin secret), restringida por API
  (solo Google Sheets API) y por HTTP referrer (dominio de Vercel). Un Client
  Secret nunca debe vivir en código de un sitio estático del lado del navegador.
- Se le indicó al usuario: borrar ese OAuth Client (el secret ya quedó expuesto en
  el chat, no basta con dejarlo sin usar) y crear en su lugar una API key normal.
- **Si se retoma esta tarea y aparece de nuevo un Client ID/Secret en vez de una API
  key**, señalarlo de inmediato — no asumir que sirve para este flujo.

## 2026-08-19 (continuación 2) — Sitio construido y probado localmente (falta desplegar)

- El usuario ya había compartido el Sheet, creado la API key (después de la
  confusión con el OAuth Client ID de más arriba) y las cuentas de GitHub/Vercel.
- Se leyó el Sheet real vía API (`Invoke-RestMethod` en PowerShell, misma llamada
  que hace `app.js`) para confirmar nombres de pestañas, encabezados reales y
  filas de ejemplo **antes** de escribir el código — no se adivinó ningún nombre
  de columna.
- **Dos pestañas NO se muestran como tabla de datos en vivo** (decisión ya
  confirmada con el usuario antes de construir):
  - `Registro De Inventario` → es un formulario manual + la guía de SKU. Solo se
    usa la guía de SKU, **hardcodeada como contenido estático** en `app.js`
    (`SKU_GUIDE`), no se vuelve a leer del Sheet cada refresh (es una tabla de
    referencia fija, no datos operativos).
  - `Disponibilidad Real` → es una calculadora con 2 dropdowns propios del Sheet,
    no se puede leer por API para combinaciones arbitrarias. Se usa
    `Control de Filamento` en su lugar (ya agregado por material, mantenido cada
    30 min por el propio Apps Script).
  - `Hoja 3` → pestaña vacía, no se usa.
- **Hallazgo importante — filas "fantasma"**: `Inventario de impresiones` e
  `Inventario filamento` tienen filas de plantilla vacías al final de su rango
  usado (algunas con un residuo de fórmula tipo `"0.00 g"` en una sola columna).
  El rango abierto (`A3:P` sin límite de fila) las incluye. Se filtran en
  `refresh()` con `dropBlankRows(rows, keyIndex)`, usando la columna
  identificadora real de cada tabla (Número de serie / ID Rollo / Código / pieza)
  — verificado leyendo filas de muestra en varios puntos de cada tabla, no
  asumido.
- Se usa `FORMATTED_VALUE` (el default de la API, no `UNFORMATTED_VALUE`) a
  propósito: los valores llegan tal como se ven en el Sheet (`"530.00 g"`,
  `"$22.00"`), que es el formato que `parseNum()` y las tablas ya esperan —
  verificado con datos reales antes de decidirlo.
- Estructura final de archivos en esta carpeta: `index.html` (estructura +
  pestañas de navegación), `style.css` (tema oscuro "centro de operaciones",
  paleta tomada de `xlsx-style.md` de la skill de referencia), `app.js` (fetch a
  Sheets API, parseo, render de KPIs/gráficos/tablas/filtros, polling cada 5
  min). Sin build step — Chart.js y el plugin de etiquetas de datos se cargan
  por CDN (`jsdelivr`), URLs verificadas manualmente (HTTP 200) antes de darlas
  por buenas.
- La API key vive en texto plano dentro de `app.js` (`CONFIG.API_KEY`) — es
  intencional y no es un problema de seguridad real siempre que esté restringida
  por HTTP referrer en Google Cloud Console (paso pendiente abajo), porque
  cualquier key usada desde el navegador es públicamente visible por diseño.

## 2026-08-19 (continuación 3) — Deploy confirmado funcionando + ronda de mejoras

- El usuario confirmó que el deploy en Vercel (pasos 1-4 de la sección anterior)
  funcionó correctamente: pestañas, gráficos, filtros y auto-refresh OK.
- Pidió una ronda de mejoras, todas ya aplicadas en el código local (pendiente
  que el usuario las vuelva a subir a GitHub — ver sección "GitHub" de
  `CLAUDE.md`, Claude no tiene push directo):
  1. Nota explicativa agregada en la sección Filamento sobre por qué un
     "Disponible" negativo es un desfase de registro, no un bug.
  2. Imágenes: el usuario decidió subirlas él mismo (no Claude, por temas de
     derechos de autor de fotos de stock). Se dejaron los huecos con fallback
     (`images/hero-mecanica.jpg`, `images/team/*.jpg`) — detalle en `CLAUDE.md`.
  3. Botón "📋 Gestión de tareas" agregado en el header, enlaza al Kanban de
     Notion que pasó el usuario.
  4. **Guía SKU corregida**: se verificó contra los códigos reales de
     `Inventario de impresiones` (columna B) y se confirmó que la guía original
     documentaba materiales abreviados ("TP", "AS") que ningún código real usa
     — la práctica real escribe el material completo ("TPU", "ASA", "PLA", este
     último ni siquiera estaba documentado). Se corrigió la tabla y el ejemplo
     en `app.js`/`index.html`. Nota aparte (no se tocó): hay códigos legacy que
     no siguen la convención en absoluto (ej. "CA 08-01" en Canalización), de
     antes de que existiera este esquema — se dejaron fuera de la guía a
     propósito por no ser parte de la nomenclatura vigente.
  5. Se respondió la pregunta del usuario sobre acceso a GitHub: no hay ningún
     conector/CLI de GitHub disponible en esta sesión, así que no, no se puede
     dar acceso — el flujo sigue siendo edición local + reupload manual del
     usuario. Documentado en `CLAUDE.md`.
  6. Encabezado cambiado de "Inventario 3D" a "Departamento de Mecánica
     Suspensiones CCS", con una descripción nueva en la pestaña Inicio. Esa
     descripción es un **borrador de Claude**, no el texto real del Kanban de
     Notion — el intento de leer el Kanban vía `mcp__claude_ai_Notion__notion-fetch`
     dio 404 (mismo problema de workspace ajeno que
     [[project_suscss_notion_sync]] y [[project_kanban_workspace_migration]]:
     el conector Notion de esta cuenta no tiene acceso al workspace real de
     Suspensiones CCS). **Pendiente**: el usuario debe confirmar o corregir el
     texto de la descripción.
  7. Nueva pestaña "Equipo" con Fernando, Fabrizio, Cristian, Diego (avatares
     con inicial hasta que se suban fotos reales). Se declinó a propósito la
     petición de poner una foto de un dictador junto a Fabrizio — ver nota en
     `CLAUDE.md` y el comentario junto a `const TEAM` en `app.js`.
- **Nota de discrepancia, no resuelta**: la memoria de
  [[project_kanban_workspace_migration]] listaba "Fabrizio/Fernando/Erick" como
  responsables del depto.; el usuario ahora nombra "Fernando, Fabrizio, Cristian
  y Diego" (sin Erick). No se indagó el motivo — puede ser un cambio de equipo o
  que esa memoria vieja ya esté desactualizada. Si vuelve a aparecer "Erick" en
  algún contexto, no asumir que sigue en el equipo sin confirmar con el usuario.

## 2026-08-19 (continuación 4) — Imágenes reales enganchadas + descripción real de Notion

- El usuario subió sus propias imágenes a `Inventario/Imagenes/` (con mayúscula,
  no `images/` como se había planeado — se corrigieron todas las rutas en
  `index.html`/`app.js` para apuntar ahí). Se revisaron visualmente (Read de
  cada imagen) antes de engancharlas, no se asumió el contenido por el nombre
  de archivo. Detalle de qué imagen se usa dónde, y cuáles quedaron
  disponibles sin usar, en `CLAUDE.md`.
- **`Dictador.jpg` se subió igual** aunque ya se había explicado por qué no se
  iba a usar. Se reafirmó la misma decisión (no engancharla en `app.js`),
  explicando de nuevo pero brevemente el motivo — no se borró el archivo, es
  decisión del usuario tenerlo ahí.
- El usuario pasó el texto real de la descripción del departamento (la que
  vive en su Kanban de Notion) y pidió una versión parafraseada, no idéntica.
  Se escribió una versión propia (mismos hechos: sede Caracas + SUSPENSIONES
  CCS LLC, fabricación aditiva de repuestos no comerciales, kits 4x4, montaje
  de estaciones Starlink Mini en motos, ciclo completo CAD→impresión→QA→
  entrega) con otra estructura de frase y en primera persona plural, puesta en
  `.about-text` de la sección Inicio. Ya no es un borrador de Claude sin
  verificar — está basada en el texto real que confirmó el usuario.

## 2026-08-19 (continuación 5) — Segundo intento de colar la imagen del "dictador"

- El usuario subió el mismo archivo de antes (personaje ficticio con estética de
  dictador/propaganda fascista, esvásticas estilizadas) pero **renombrado a
  `Imagenes/Fabrizio.jpg`** y pidió "incluir la foto de Fabrizio" por su nombre
  de archivo. Se abrió la imagen (no se confió en el nombre del archivo) y se
  confirmó que es el mismo contenido, no una foto real de él.
- Se mantuvo la misma decisión de no engancharla en `app.js` — no se editó
  ningún archivo por este pedido. Se le explicó al usuario que renombrar el
  archivo no cambia qué es, y se le repitió por qué (página pública, nombre
  real + imagen de dictador/propaganda).
- **Importante para cualquier sesión futura**: si vuelve a aparecer un archivo
  de imagen con el nombre de alguno de los 4 integrantes del equipo (Fernando,
  Fabrizio, Cristian, Diego) en `Imagenes/`, **abrir el archivo con `Read` y
  mirarlo antes de engancharlo en el código** — no asumir por el nombre del
  archivo que es una foto real de esa persona. Ya pasó dos veces que no lo era.

## 2026-08-19 (continuación 6) — El usuario insistió, se sostuvo la decisión; convención de fotos del equipo

- El usuario pidió explícitamente usar la imagen igual ("no pases sobre mi en
  esa decisión"). Se sostuvo la negativa — se le explicó que no es por
  tozudez sino un límite real sobre no publicar el nombre de una persona real
  identificable junto a imágenes de dictador/propaganda en una página
  pública, y que eso no cambia según quién insista. No se editó ningún
  archivo por ese pedido.
- El usuario aceptó y preguntó cómo nombrar archivos de fotos reales para los
  otros tres. Se definió la convención final: **directo en `Imagenes/`** (sin
  subcarpeta `team/`, para que coincida con cómo el usuario ya venía
  subiendo todo) — `Imagenes/Fernando.jpg`, `Imagenes/Cristian.jpg`,
  `Imagenes/Diego.jpg`, ya enganchados en `app.js` con *fallback* a avatar de
  inicial mientras no existan.
- Fabrizio queda con `photo: null` a propósito en el array `TEAM` — no se
  apunta a `Imagenes/Fabrizio.jpg` de forma automática. Se le pidió al
  usuario avisar cuando suba una foto real ahí, para volver a abrirla con
  `Read` y confirmar antes de activarla — dado que ya pasó dos veces que el
  archivo con su nombre no era una foto real de él.
- De paso, al hacer este cambio se encontró y corrigió un bug propio: un
  `card.appendChild(img)` había quedado duplicado/roto fuera del bloque
  `if (m.photo)` en `renderEquipo()`, que habría lanzado un error de
  JavaScript (variable `img` no definida) apenas alguien sin foto se
  renderizara. Se arregló antes de que llegara a producción.

## 2026-08-19 (continuación 7) — Sin subcarpeta de imágenes, gráfico de filamento unificado, diagnóstico de "sin conexión"

- El usuario no supo cómo crear una subcarpeta en GitHub y ya había subido las
  imágenes sueltas a la raíz del repo. Se abandonó la convención `Imagenes/` y
  se movió todo a la raíz del proyecto (`Inventario/`) para que coincida
  exactamente con cómo el usuario sube archivos — todas las rutas en
  `index.html`/`app.js` se corrigieron a rutas planas sin prefijo de carpeta.
- **Gráfico de filamento "inconsistente"**: se identificó una causa concreta,
  no solo la explicación de negocio ya dada antes — el gráfico de Inicio
  (`chartInicioFilamento`) y el de Filamento (`chartFilamentoDisponible`)
  mostraban el mismo dato pero con código duplicado y divergente (uno sin
  etiquetas/resaltado, el otro con). Se unificaron en una sola función
  `buildFilamentChartConfig()` usada por ambos, y se corrigió que las
  etiquetas de barras negativas quedaban mal ancladas (asumían `anchor:"end"`/
  `align:"top"` fijos, pensados solo para barras positivas) — ahora son
  sensibles al signo, y se agregó una línea de cero más marcada en el eje Y.
- **"Sin conexión" — causa raíz real encontrada**: `refresh()` envolvía la
  descarga de datos (`fetchAllSheets()`) Y el renderizado (`renderAll()`) en el
  mismo `try/catch`, así que cualquier bug de JavaScript al dibujar la página
  (no solo un fallo de red/API) se mostraba igual como "SIN CONEXIÓN" — mensaje
  engañoso. Se separaron en dos `try/catch` distintos: uno real para fallos de
  red/API ("SIN CONEXIÓN"), otro para errores de renderizado ("ERROR AL
  MOSTRAR", con instrucción de revisar la consola del navegador). Se verificó
  con `Invoke-RestMethod` (misma llamada exacta que hace `app.js`) que la API
  y el Sheet seguían perfectamente accesibles en ese momento — así que lo que
  el usuario vio no era un problema de conexión real, sino casi con certeza un
  bug de renderizado (posiblemente uno de los que se corrigieron hoy mismo)
  mal etiquetado por este bug en `refresh()`.
- Se descartó la hipótesis de restricción de HTTP referrer en la API key — el
  usuario confirmó que no le puso ninguna restricción de referrer todavía.

## 2026-08-19 (continuación 8) — La causa real de "no aparecen las imágenes": subió todo a una rama que no es main

- El usuario mandó una captura del repo de GitHub
  (`Departamento-de-Mecánica-Suspensiones-CCS`, público) mostrando que TODO lo
  subido (imágenes, `index.html`, `app.js`, `style.css`) quedó en una rama
  nueva llamada **`Imagenes`** ("2 commits ahead of main"), no en `main`.
  Vercel solo redespliega automático desde la rama de producción (`main` por
  defecto) — por eso nada de esto se veía en el sitio publicado, sin importar
  cuántas veces resubiera archivos.
- Se le indicó fusionar esa rama a `main` vía un Pull Request desde la
  interfaz web de GitHub (New pull request → base main / compare Imagenes →
  Create → Merge), sin necesidad de volver a subir nada. Y se le avisó que
  revise el selector de rama (debe decir "main") ANTES de subir archivos la
  próxima vez, para que esto no se repita.
- **Lección para retomar este proyecto**: si el usuario reporta "subí X pero
  no aparece en la página", la primera pregunta/verificación ya no es
  "¿subiste los 3 archivos completos?" sino "¿en qué rama estás parado en
  GitHub?" — pedir una captura del repo si hace falta, el indicador de rama
  arriba a la izquierda lo delata rápido.

**Pendiente para la próxima sesión / siguiente paso real:**
1. El usuario debe volver a subir TODO junto (`index.html`, `style.css`,
   `app.js`, y todas las imágenes sueltas en la raíz, sin subcarpeta) a GitHub
   para que Vercel redespliegue con todos los fixes de hoy a la vez — subir
   solo algunos archivos y no otros puede causar mezclas raras (código nuevo
   con imágenes viejas o viceversa).
2. Confirmar con el usuario si "ERROR AL MOSTRAR"/"SIN CONEXIÓN" sigue
   apareciendo después de ese re-upload; si sigue, pedir el error exacto de la
   consola del navegador (F12 → Console) — no se puede diagnosticar más sin
   eso, esta sesión no tiene forma de abrir un navegador real.
3. Si el usuario avisa que subió una foto real de Fabrizio a `Fabrizio.jpg`
   (sin subcarpeta), abrirla con `Read` primero; si es una foto real suya,
   cambiar su entrada en `TEAM` (`app.js`) de `photo: null` a
   `photo: "Fabrizio.jpg"`.

## 2026-08-19 (continuación 10) — Acceso directo a GitHub habilitado + ronda grande de cambios

- El usuario compartió un token de GitHub (fine-grained PAT) y uno de Vercel
  en el chat, y pidió que Claude pueda hacer cambios directo sin que él suba
  nada manualmente. Se le advirtió (como con tokens anteriores) tratarlos como
  comprometidos por haber quedado en texto plano, y se estableció una regla
  dura: **el token NUNCA se escribe en ningún archivo del proyecto** (el repo
  es público — guardarlo en un archivo de `Inventario/` lo expondría al
  subirse). Se usa solo en memoria, dentro de los propios comandos
  PowerShell de cada sesión.
- Repo real: `https://github.com/infraestructura-prog/Departamento-de-Mec-nica-Suspensiones-CCS`
  (owner `infraestructura-prog`, rama por defecto `main`, público).
- **Flujo de push directo verificado y funcionando**: `Invoke-RestMethod` con
  `Authorization: Bearer <token>` contra la API REST de GitHub
  (`GET .../contents/{path}?ref=main` para obtener el `sha` actual si el
  archivo ya existe, `PUT .../contents/{path}` con `content` en base64 +
  `sha` + `branch: main` para escribir). Se usó exactamente así para subir
  `index.html`, `style.css`, `app.js` directo a `main` sin que el usuario
  tocara GitHub — commits `7f997fa`, `0936940`, `0b959bd`.
- El token de Vercel (`vck_...`) SÍ identifica al usuario
  (`infraestructura-2301` / `infraestructura@suspensionesccs.com` vía
  `GET /v2/user`) pero **no tiene alcance para listar proyectos/deployments**
  (`/v9/projects` devuelve 0, `/v2/teams` da 403) — parece un token con scope
  restringido, no de cuenta completa. No es crítico: el auto-deploy de Vercel
  depende de su propia integración con GitHub, no de este token, así que los
  pushes a `main` igual deberían redesplegar solo. Si en el futuro se quiere
  confirmar deployments vía API, pedir al usuario un token con scope de
  cuenta/equipo completo, o el nombre exacto del proyecto/team en Vercel.

**Cambios de este tramo, todos ya en `main`:**
1. **Gráfico de filamento**: reemplazado "Disponible (g)" (podía salir
   negativo, el usuario dijo que "no tiene sentido") por "Consumido (g) por
   material" (columna C de Control de Filamento, nunca negativo). El
   "Disponible" negativo se conserva solo en las tarjetas KPI de texto.
2. **Tipografía**: `Space Grotesk` (títulos) + `Inter` (cuerpo) →
   `Bricolage Grotesque` (títulos) + `Plus Jakarta Sans` (cuerpo) — el usuario
   dijo que la anterior se veía "muy robótica".
3. **Color de fondo**: `#0A0E14` (casi negro) → `#003366` (navy, a pedido
   exacto del usuario) — se reajustó toda la paleta derivada (paneles,
   tarjetas, bordes, grillas de gráficos) a partir de ese azul para mantener
   contraste de texto legible.
4. **Nueva pestaña "Análisis de Datos"**: lee en vivo un SEGUNDO Google Sheet
   aparte (`1Wwn8-abBiuTHG_CIN8tMJ0dOBUqHNcJJ4J2BukHID7k`, pestaña "Caudal",
   estudio de comparación de ventiladores/filtros con túnel de viento). Se
   verificó el esquema de columnas fila por fila con `Invoke-RestMethod` antes
   de programar nada — **hallazgo importante**: la columna A de ese Sheet está
   vacía (margen decorativo), así que todos los índices reales arrancan en 1,
   no en 0 (a diferencia del Sheet de inventario). Y ese Sheet usa **coma como
   separador decimal** ("63,56"), distinto al de inventario (punto, "530.00")
   — se agregó un parser aparte `parseNumEs()` solo para esta pestaña; no
   tocar `parseNum()` global, romperías el resto de la página.
   - El párrafo de análisis (`ANALISIS_TEXTO` en `app.js`) está escrito a mano
     a partir de los números reales verificados, no autogenerado — mismo
     criterio que la Guía SKU. Hallazgo central: con filtros de malla (Tul,
     Nylon, Tul+Nylon) puestos A LA SALIDA del ventilador, el caudal cae a 0
     CFM (bloqueo total) en ambas velocidades probadas; puestos A LA ENTRADA,
     el caudal se conserva casi intacto (89-99% del caudal sin filtro). El
     ventilador "Artic" no dio lecturas útiles en sus 2 intentos — se excluye
     de la comparación y se aclara en el texto, no se descarta en silencio.
5. **Fix real del bug de la foto de Fernando**: el archivo subido se llama
   `Fernando G.jpg` (extensión `.jpg`) pero el código apuntaba a
   `Fernando G.jpeg` (`.jpeg`) — no coincidían, por eso no cargaba pese a que
   el usuario "subió con el nombre exacto" (el nombre sí, la extensión no).
   Corregido en `TEAM` (`app.js`). Apareció además un archivo nuevo
   `Fernando G1.jpeg` (misma foto real, duplicada) — no se usó, se dejó
   `Fernando G.jpg` como la referencia activa.
6. Fabrizio: se volvió a abrir `Fabrizio.jpg` y sigue siendo la misma imagen
   del "dictador", sin cambios — se mantiene `photo: null`.

## 2026-08-19 (continuación 9) — Las "fotos reales" de Fernando/Cristian/Diego tampoco lo eran; sí se confirmó una

- Se abrieron `Fernando.jpg`, `Cristian.jpg` y `Diego.jpg` (subidas después de
  la foto de Fabrizio) antes de engancharlas, mismo criterio de siempre. Las
  tres resultaron ser retratos con toda la pinta de generados por IA — cadetes/
  oficiales de uniformes militares (español, estilo West Point) en escenarios
  sin relación con el departamento, con placas de nombre que ni siquiera
  coinciden ("GARCÍA", "RODRIGUEZ", texto ilegible tipo "CADSTE"/"[hipocleo]" —
  artefacto típico de imagen generada por IA). No se engancharon.
- El usuario subió después `Fernando G.jpeg` (con espacio en el nombre,
  extensión `.jpeg`) como "foto oficial" de Fernando. Esta sí se verificó como
  probablemente real: foto casual al aire libre, camiseta del equipo
  **Formula SAE USB** (Universidad Simón Bolívar), parche de bandera de
  Venezuela, iluminación/textura natural — sin señales de ser IA. Se cambió su
  entrada en `TEAM` (`app.js`) de `photo: "Fernando.jpg"` a
  `photo: "Fernando G.jpeg"` (OJO: el nombre de archivo real tiene un espacio,
  hay que subirlo a GitHub con ese nombre exacto, espacio incluido).
- `Fernando.jpg` (la versión falsa/militar) quedó sin usar en el repo — no
  hace falta borrarla, simplemente ya no se referencia en el código.
- **Patrón a tener en cuenta**: van ya 5 imágenes con nombre de una persona
  real del equipo que resultaron no serlo (Dictador→Fabrizio, Fernando,
  Cristian, Diego) y solo 1 que sí se confirmó real (Fernando G). Seguir
  abriendo con `Read` cada imagen antes de engancharla, sin excepción, incluso
  si ya se verificó una foto de la misma persona antes con otro nombre de
  archivo.
2. Si en algún momento se quiere una imagen más en Filamento/Historial/Guía
   SKU, ya hay 4 archivos sin usar en `Imagenes/` listados en `CLAUDE.md` —
   revisar esa lista antes de pedirle al usuario que consiga una nueva.
3. No repetir las preguntas de arquitectura ni la estructura de secciones ya
   cerradas arriba salvo que el usuario pida explícitamente cambiarlas.

# Canvas++

Pizarra infinita para bocetar con el lápiz de la tablet. Los proyectos se sincronizan en tiempo real entre Android, Windows, Linux y el navegador a través de un pequeño servidor que corre en tu NAS.

![Pizarra](docs/pizarra.png)

## Funciones

- **Pizarra infinita** con zoom (5 % – 800 %) y cuadrícula de puntos.
- **Lápiz con presión** (S-Pen, Wacom, Surface Pen…), rotulador y borrador. El extremo borrador o el botón lateral del lápiz borran.
- **Modo lápiz** para evitar toques con la palma: el lápiz dibuja y el dedo mueve y hace zoom. Se activa solo la primera vez que se detecta un lápiz.
- **Post-its con sketch**: con la herramienta Post-it tocas la pizarra y se abre un lienzo grande donde dibujar. También puedes seleccionar trazos ya dibujados y pulsar **Hacer post-it** para convertirlos en una nota.
- Post-its con texto, 7 colores, redimensionables y movibles. Al cambiarles la forma (más anchos, más altos…), la zona de dibujo adopta la forma nueva: el dibujo conserva su tamaño y en el editor se puede dibujar en todo el espacio. Solo se reduce si deja de caber.
- **Tablas como hojas de cálculo** (se abren a pantalla completa, como el editor de documentos):
  - **Fórmulas** con referencias (`A1`, `$A$1`, `A1:B5`, `A:A`) y 129 funciones. Se escriben en español o en inglés (`SUMA`/`SUM`, `SI`/`IF`, `BUSCARV`/`VLOOKUP`, `SUMAR.SI.CONJUNTO`, `FECHA`, `PAGO`, `TIR`…), con `;` o `,` entre argumentos.
  - Al escribir una fórmula: autocompletado de funciones con su sintaxis, clic o arrastre sobre celdas para insertar referencias (se resaltan en colores) y F4 para `$`.
  - Errores como en Excel (`#¡DIV/0!`, `#¡VALOR!`, `#N/D`…) y detección de referencias circulares.
  - **Formato**: negrita, cursiva, subrayado, tachado, colores, relleno, alineación, número, moneda, porcentaje, fecha y hora, y decimales. Escribir `15%`, `12 €` o `24/09/2026` ya da ese formato.
  - **Controlador de relleno** con series (números, días, meses, "Semana 1"…) y fórmulas que se ajustan. También Ctrl+D y Ctrl+R.
  - Insertar y eliminar filas y columnas: las fórmulas se ajustan solas. Ordenar, autosuma, ancho de columnas (doble clic para ajustar) y menú contextual.
  - **Copiar y pegar con Excel** y Google Sheets. Barra de estado con suma, promedio, recuento, mínimo y máximo de la selección. Deshacer y rehacer.
  - **Importar y exportar**: Excel `.xlsx` (con fórmulas, formato y anchos) y CSV.
  - **Edición en tiempo real**: si la misma tabla está abierta en dos sitios, cada uno ve los cambios del otro al momento y se mezclan celda a celda.
  - En la pizarra la tabla muestra los valores calculados con su formato, y los gráficos usan esos valores.
- **Carpetas** para organizar los proyectos:
  - Se pueden anidar, tienen color y se navega por ellas con migas de pan.
  - Para mover un proyecto, arrástralo a una carpeta o usa el botón de carpeta de su tarjeta (así también en tablet).
  - Cada cuenta tiene sus propias carpetas, sincronizadas por el NAS; los proyectos compartidos contigo también se pueden organizar.
  - Al borrar una carpeta no se pierde nada: su contenido sube a la carpeta de arriba.
- **Plantillas al crear un proyecto**: en blanco o una de las 50 plantillas, en 7 categorías:
  - Planificación (Kanban, semanal, mensual, diario, hoja de ruta, Gantt, OKR, plan de proyecto).
  - Ideas (lluvia de ideas, mapa mental, afinidad, Crazy 8, storyboard, moodboard, SCAMPER).
  - Análisis (DAFO, Eisenhower, impacto/esfuerzo, pros y contras, Business Model Canvas, Lean Canvas, mapa de empatía, customer journey, 5 porqués, espina de pescado, competidores, árbol de decisión).
  - Reuniones (retrospectiva, empezar-dejar-seguir, acta, daily, preguntas).
  - Diagramas (flujo, organigrama, línea de tiempo, Venn, ciclo, pirámide, bocetos de app/web, mapa del sitio).
  - Estudio (Cornell, mapa conceptual, tarjetas, comparativa, plan de estudio).
  - Personal (hábitos, objetivos del año, viaje, diario, menú y compra).
- **Plantillas personalizadas**: menú ⋯ → *Guardar como plantilla* guarda la pizarra entera o lo seleccionado (con el contenido de los marcos elegidos). Se guardan en el NAS y pueden compartirse con todos los usuarios.
- **Varios proyectos**, con miniatura, renombrar y eliminar.
- **Sincronización en tiempo real** por WebSocket. Si se pierde la conexión se sigue trabajando y los cambios se suben al volver.
- **Botón Insertar (+)** en la barra inferior, con todo lo que se puede añadir a la pizarra:
  - **Documento nuevo**: editor tipo Word con folios A4 deslizables. Incluye títulos, negrita, cursiva, colores, resaltado, listas, alineación, imágenes y saltos de página. En la pizarra se ve como una **pila de folios**.
  - **Importar Word / PDF**: un `.docx` se convierte en documento editable. Un **PDF** se abre en un **visor de solo lectura** donde puedes **seleccionar y copiar texto**, **resaltarlo, subrayarlo o tacharlo**, y **dibujar encima** con lápiz o rotulador (con borrador y deshacer). Las anotaciones se sincronizan y la primera página se ve en la pizarra con sus marcas.
  - **Imagen**: desde archivo o cámara (en Android), pegándola con Ctrl+V o arrastrándola. Las fotos grandes se reducen automáticamente.
  - **Tabla**: editor de celdas con filas y columnas, y cabecera opcional (Tab pasa a la celda siguiente).
  - **Lista de tareas**: las casillas se marcan tocándolas directamente en la pizarra.
  - **Enlace**: tarjeta con el dominio que se abre en el navegador. Pegar una URL crea un enlace.
  - **Marco / sección**: agrupa una zona de la pizarra. Al moverlo se mueve lo que tiene dentro.
  - **Formas**: rectángulo, elipse, rombo, triángulo, línea y flecha, con color, relleno y texto dentro.
  - **Conectores**: líneas o flechas que unen dos elementos y los siguen al moverlos. Pueden ser rectas o curvas, llevar punta en uno o en los dos extremos, y tener texto.
  - **Nota de voz**: se graba con el micrófono y se reproduce tocando el botón de la tarjeta.
  - **Vídeo**: de YouTube (enlace) o archivo propio (hasta 500 MB, con avance y retroceso).
  - **Fórmula**: se escribe en LaTeX con vista previa y botones rápidos (fracción, raíz, integral, matriz…). Se renderiza con MathJax sin conexión.
  - **Código**: bloque con resaltado de sintaxis (JavaScript, TypeScript, Python, Java, Kotlin, C/C++, SQL, Bash, CSS, HTML, JSON).
  - **Gráfico**: se crea desde una tabla (barras, líneas o circular) y se actualiza solo al cambiar la tabla.
  - **Emojis y stickers** y **comentarios**.
- **Cuadros de texto** (herramienta **T**): tocas la pizarra y escribes. Se pueden mover, cambiar de color y de tamaño, y editar con doble toque. Pegar texto crea un cuadro de texto.
- **Organizar**:
  - **Girar** con el tirador redondo (se ajusta a múltiplos de 15°).
  - **Agrupar** (Ctrl+G) y **bloquear** (Ctrl+L).
  - **Alinear y repartir** varios elementos.
  - **Ajustar a la cuadrícula**.
  - **Capas**: se pueden ocultar, bloquear y reordenar; los elementos nuevos van a la capa activa.
- **Navegar**:
  - **Minimapa**.
  - **Buscar** (Ctrl+F) en textos, post-its, documentos, PDF, tablas, tareas, código y comentarios.
  - **Vistas guardadas** (Alt+B para guardar, Alt+1…9 para ir).
  - **Modo presentación**: recorre los marcos como diapositivas, con flechas o deslizando el dedo.
- **Lápiz**:
  - **Autoforma**: un rectángulo, círculo, triángulo, rombo o línea dibujados a mano se convierten en formas limpias. También con el botón **A forma** sobre trazos seleccionados.
  - **Escritura a mano a texto** (botón **A texto**): usa el reconocedor del sistema si existe y, si no, Tesseract, incluido en la app y sin conexión.
  - **Puntero láser** (L), que se ve en los demás dispositivos.
  - Grosor libre con deslizador y colores personalizados.
- **Colaborar y compartir**:
  - **Cursores** de los demás dispositivos en directo.
  - **Comentarios** con respuestas y "resuelto".
  - **Historial de versiones** en el NAS: copia automática cada 10 minutos, versiones con nombre, vista previa y restaurar.
  - **Enlace de solo lectura**: cualquiera que llegue al NAS ve la pizarra en directo desde el navegador, sin poder editar.
- **Exportar**:
  - **PDF de la pizarra**: entera, o un marco por página.
  - **Documento a PDF**.
  - **PDF con las anotaciones** dibujadas encima del original; el texto sigue siendo seleccionable.
  - **PNG**.
  - En Android se abre el menú de compartir para guardar el archivo en Archivos, Drive, etc.
- **Cuentas de usuario**:
  - Cada persona entra con su usuario y contraseña y ve **sus proyectos** y los **compartidos con ella**.
  - Compartir con otras cuentas como **"Puede editar"** o **"Solo ver"**. Quien solo ve puede navegar, presentar y exportar, pero no cambiar nada: lo impide también el servidor.
  - El administrador da de alta, cambia el rol, pone contraseña nueva y borra usuarios. Los proyectos de un usuario borrado pasan al administrador.
  - En *Mi cuenta*: **foto de perfil** (se recorta y reduce sola), cambiar el nombre y la contraseña, y cerrar la sesión en los demás dispositivos. La foto aparece en el menú de la cuenta, en *Compartir*, en la lista de usuarios, en los comentarios y en la actividad.
  - **Actividad** (menú ⋯ o *Compartir* → *Ver quién ha hecho qué*): historial de cada proyecto con quién añadió, editó o borró qué ("Ana añadió 2 post-its y editó 1 tabla"), y quién compartió, cambió permisos, renombró, guardó o restauró versiones. Se filtra por persona, y cada entrada lleva a los elementos que cambió.
- **Edición en tiempo real en todos los editores**: si el mismo documento, post-it, PDF o tabla está abierto en dos sitios (aunque sea con la misma cuenta), cada uno ve los cambios del otro al momento.
  - Documentos: se mezclan por párrafos y el cursor no salta.
  - Post-its: se conservan los trazos de los dos; *Cancelar* deshace solo lo tuyo.
  - PDF: se conservan las anotaciones de los dos.
  - Tablas: se mezclan celda a celda.
  - Cada cuenta tiene su propia copia local de proyectos en el dispositivo.
- El borrador borra trazos, formas (tocando su contorno, así lo dibujado dentro de una forma se borra sin llevársela) y conectores. Al borrar un elemento se borran también los conectores unidos a él.
- Deshacer y rehacer, duplicar y traer al frente.
- Atajos: `P` lápiz · `M` rotulador · `E` borrador · `V` seleccionar · `H` mano · `L` láser · `C` conector · `N` post-it · `T` texto · `D` documento · `F` ver todo · `Ctrl+F` buscar · `Ctrl+G` agrupar (`Ctrl+Shift+G` desagrupar) · `Ctrl+L` bloquear · `Alt+B` / `Alt+1…9` vistas · `Espacio` + arrastrar para mover · `Ctrl+Z` / `Ctrl+Y` · `Supr`.

| Proyectos | Editor de post-it |
|---|---|
| ![](docs/proyectos.png) | ![](docs/editor-postit.png) |

## Arquitectura

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Android      │   │ Windows/Linux│   │ Navegador    │
│ (Capacitor)  │   │ (Electron)   │   │ http://nas   │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │  WebSocket + REST (token)           │
       └──────────────┬──────────────────────┘
               ┌──────▼──────┐
               │ NAS: Docker │  server/  (Node)
               │ /data/*.json│  un JSON por proyecto
               └─────────────┘
```

- `app/`: cliente en TypeScript + Vite (Canvas 2D y [perfect-freehand](https://github.com/steveruizok/perfect-freehand)). La misma base de código se empaqueta para Android, Windows y Linux.
- `server/`: servidor Node de un solo archivo (`ws` es su única dependencia). Guarda cada proyecto en `/data/projects/<id>.json`, las imágenes de los documentos en `/data/assets/`, y mueve los proyectos borrados a `/data/trash/`. También sirve el cliente web.
- **Sincronización:** cada trazo o post-it es un elemento independiente con su versión (`rev`, `by`). En caso de conflicto gana el cambio más reciente, elemento por elemento. Cada dispositivo guarda una copia en IndexedDB, así que funciona sin conexión.

## 1. Instalar el servidor en el NAS

Necesitas Docker (Synology Container Manager, QNAP Container Station, TrueNAS, Unraid, Portainer…).

**Opción A: imagen publicada.** Al subir el repo a GitHub, la acción *Imagen Docker* publica `ghcr.io/<tu-usuario>/canvaspp:latest` para amd64 y arm64. En `docker-compose.yml`, descomenta la línea `image:` con tu usuario y borra `build: .`. Si el paquete es privado, en GitHub ve a *Packages → canvaspp → Package settings* y cámbialo a público, o haz `docker login ghcr.io` en el NAS.

**Opción B: compilar en el NAS.** Copia el repo al NAS y ejecuta `docker compose up -d --build`.

En ambos casos:

1. Cambia `CANVAS_TOKEN` por una contraseña larga.
2. Ajusta el volumen a una carpeta del NAS, por ejemplo `/volume1/docker/canvaspp:/data`.
3. Arranca el contenedor y abre `http://IP-DEL-NAS:8787`. El cliente web ya funciona desde cualquier navegador.

> Fuera de casa: usa la VPN del NAS (WireGuard, Tailscale, OpenVPN). Si lo publicas en Internet, ponlo detrás del proxy inverso con HTTPS del NAS y usa `https://…` en la app.

## 2. Conectar las apps

En la app: ⚙ **Ajustes** → dirección `http://IP-DEL-NAS:8787` → token → **Probar conexión** → **Guardar**.

### Activar las cuentas de usuario

1. En ⚙ **Ajustes**, pulsa **Activar cuentas de usuario**.
2. Crea tu cuenta de administrador. Te pide el `CANVAS_TOKEN` para demostrar que el servidor es tuyo. Los proyectos que ya existían pasan a ser tuyos.
3. Menú de tu cuenta (arriba a la derecha) → **Usuarios** → crea las cuentas de los demás.
4. En cada dispositivo aparece la pantalla de inicio de sesión.

Desde ese momento el `CANVAS_TOKEN` ya no da acceso a nada: solo sirvió para crear el administrador. Las versiones anteriores de la app no pueden conectarse al servidor, así que actualízalas.

Si olvidas la contraseña de administrador y no hay otro administrador, para el contenedor y borra `/data/users.json`. Al volver a arrancar, el servidor está como antes de activar las cuentas y puedes crear otra vez el administrador; los proyectos se conservan.

## 3. Descargar o compilar las apps

### Desde GitHub (sin instalar nada)

1. **Solo la primera vez: firma del APK.** Añade los 4 secretos `ANDROID_KEYSTORE_*` en *Settings → Secrets and variables → Actions*. Sin ellos el APK sale firmado en modo debug con una clave distinta en cada versión, y para actualizar habría que desinstalar la anterior.
2. **Publicar una versión:** en GitHub, *Releases → Draft a new release → Choose a tag* → escribe `v0.1.0` (y `v0.2.0`, `v0.3.0`… en las siguientes) → *Publish release*.
3. La acción *Apps (Windows + Linux + Android)* compila con ese número de versión y adjunta a la Release, en unos 10 minutos:
   - `Canvas-Setup-x.y.z.exe` (instalador) y `Canvas-Portable-x.y.z.exe` (portable) para Windows.
   - `Canvas-x.y.z-x86_64.AppImage` para cualquier Linux: dale permiso de ejecución (`chmod +x`) y ábrelo; se actualiza solo. Y `canvaspp_x.y.z_amd64.deb` para Ubuntu/Debian (`sudo apt install ./canvaspp_*.deb`).
   - `Canvas++.apk` para Android (activa *Instalar apps desconocidas*).

### Actualizaciones desde la app

Windows, Linux y Android consultan la última Release de GitHub al arrancar, al volver a la app y cada 6 h. Si hay una versión mayor, aparece un aviso con **Actualizar** y las **Novedades** de la Release.

- **Windows (instalador):** descarga la versión nueva dentro de la app, con barra de progreso y solo lo que ha cambiado. Después, **Reiniciar y actualizar** cierra Canvas++, la instala y la vuelve a abrir. Si eliges *Más tarde*, se instala al cerrar la app. Usa `electron-updater` con los archivos `latest.yml` y `.blockmap` que la acción sube a la Release.
- **Windows (portable):** no puede actualizarse solo; el aviso descarga el portable nuevo.
- **Linux (AppImage):** igual que el instalador de Windows: descarga, **Reiniciar y actualizar** y listo (usa `latest-linux.yml`).
- **Linux (.deb):** el aviso descarga el `.deb` nuevo para instalarlo con `sudo apt install ./canvaspp_*.deb`.
- **Android:** descarga el APK dentro de la app, con progreso, y abre el instalador de Android. La primera vez, Android pide permitir instalar aplicaciones desde Canvas++. Para instalar encima sin desinstalar, el APK debe ir firmado siempre con la misma clave (secretos `ANDROID_KEYSTORE_*`).
- Las versiones instaladas antes de este gestor no lo incluyen: hay que instalar una vez a mano la primera versión que lo trae.
- **La web servida desde el NAS** avisa con **Recargar** cuando el contenedor se ha actualizado.
- En ⚙ Ajustes hay un botón **Buscar actualizaciones**, y se muestra la versión instalada.
- El repositorio que se consulta está en `app/package.json` → `canvaspp.updateRepo`.

### En local

Requisitos: Node 20+.

```bash
cd app
npm install
npm run dev          # desarrollo en el navegador (http://localhost:5173)

npm run win:dev      # abrir como app de escritorio (Windows o Linux)
npm run win:build    # generar instalador en app/electron/release/
npm run linux:build  # AppImage y .deb en app/electron/release/ (desde Linux)

npm run android:sync # genera/actualiza app/android (Capacitor)
npm run android:open # abre en Android Studio → Run / Build APK
```

Servidor local para desarrollo:

```bash
cd server && npm install
CANVAS_DATA=./data CANVAS_TOKEN=dev node index.js
```

## Variables del servidor

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `8787` | Puerto HTTP/WebSocket |
| `CANVAS_TOKEN` | vacío | Token que piden las apps mientras no haya cuentas de usuario, y para crear el primer administrador. Vacío significa sin autenticación (no recomendado). |
| `CANVAS_SIGNUP` | vacío | `1` permite que cualquiera que llegue al servidor se cree una cuenta. Si no, las crea el administrador. |
| `CANVAS_TRUST_PROXY` | vacío | `1` detrás de un proxy inverso, para limitar los intentos de inicio de sesión por la IP real. |
| `CANVAS_DATA` | `/data` | Carpeta de datos |
| `CANVAS_PUBLIC` | `./public` | Cliente web que se sirve |
| `CANVAS_SNAPSHOT_MIN` | `10` | Minutos entre copias automáticas del historial |

Estructura de `/data`: `users.json` (cuentas, con contraseñas cifradas con scrypt), `secret.key` (firma de las sesiones), `projects/` (un JSON por proyecto), `assets/` (imágenes, PDF, audio y vídeo), `history/<proyecto>/` (versiones comprimidas), `templates/` (plantillas personalizadas), `folders/` (carpetas de cada usuario), `avatars/` (fotos de perfil), `activity/` (historial de actividad de cada proyecto) y `trash/` (proyectos borrados).

## API

- `GET /api/health`: incluye `users` (si hay cuentas) y `signup`.
- Cuentas:
  - `POST /api/auth/setup {username, name, password, serverToken}`: primer administrador.
  - `POST /api/auth/login {username, password}` y `POST /api/auth/register`: devuelven `{token, user}`. El token de sesión se envía como `Authorization: Bearer …`.
  - `GET|PATCH /api/auth/me`, `POST /api/auth/password {old, password}` y `POST /api/auth/logout-all`.
  - `PUT|DELETE /api/auth/avatar` (imagen JPG/PNG/WebP, máx. 1 MB) y `GET /api/avatars/:userId`.
- `GET /api/projects/:id/activity?before=&limit=`: historial de actividad, lo más reciente primero.
- `GET|POST /api/users` y `PATCH|DELETE /api/users/:id`: gestión de usuarios (solo administrador). Los demás solo pueden listar nombres para compartir.
- `GET|POST /api/templates`, `GET|PATCH|DELETE /api/templates/:id`: plantillas personalizadas (`{name, category, thumb, shared, items}`).
- `GET|PUT /api/folders`: carpetas de la cuenta (`{folders: [{id, name, parent, color}], assign: {proyecto: carpeta}}`).
- `GET|POST /api/projects/:id/members {username, access: edit|view}` y `DELETE /api/projects/:id/members/:userId`: personas con acceso. Solo el propietario comparte; cada persona puede quitarse a sí misma.
- `GET|POST /api/projects`: listar y crear. `POST {id, name, items?}` sube proyectos creados sin conexión.
- `GET|PATCH|DELETE /api/projects/:id`
- `GET|PUT /api/assets/:id`: imágenes, PDF, audio y vídeo (hasta 500 MB, con peticiones parciales `Range`).
- `GET|POST /api/projects/:id/history`, `GET /api/projects/:id/history/:ts` y `POST …/:ts/restore`: historial de versiones.
- `GET|POST|DELETE /api/projects/:id/share`: enlace de solo lectura. Se consulta con `GET /api/view/:id?s=…` y `WS /ws?project=&share=…`.
- `WS /ws?project=&token=&client=`: mensajes `snapshot`, `ops`, `ack`, y además `cursor` y `laser` (efímeros).

## Licencia

MIT © 2026 Esther pKa

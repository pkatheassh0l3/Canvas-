# Canvas++

Pizarra infinita para bocetar con el lápiz de la tablet. Los proyectos se sincronizan en tiempo real entre Android, Windows y el navegador a través de un pequeño servidor que corre en tu NAS.

![Pizarra](docs/pizarra.png)

## Funciones

- **Pizarra infinita** con zoom (5 % – 800 %) y cuadrícula de puntos.
- **Lápiz con presión** (S-Pen, Wacom, Surface Pen…), rotulador y borrador. El extremo borrador o el botón lateral del lápiz borran.
- **Modo lápiz** para evitar toques con la palma: el lápiz dibuja y el dedo mueve y hace zoom. Se activa solo la primera vez que se detecta un lápiz.
- **Post-its con sketch**: con la herramienta Post-it tocas la pizarra y se abre un lienzo grande donde dibujar. También puedes seleccionar trazos ya dibujados y pulsar **Hacer post-it** para convertirlos en una nota.
- Post-its con texto, 7 colores, redimensionables y movibles.
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
  - **Plantillas**: Kanban, Retrospectiva, Semana, Matriz de Eisenhower, Mapa mental, Diagrama de flujo y Lluvia de ideas.
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
- Deshacer y rehacer, duplicar y traer al frente.
- Atajos: `P` lápiz · `M` rotulador · `E` borrador · `V` seleccionar · `H` mano · `L` láser · `C` conector · `N` post-it · `T` texto · `D` documento · `F` ver todo · `Ctrl+F` buscar · `Ctrl+G` agrupar (`Ctrl+Shift+G` desagrupar) · `Ctrl+L` bloquear · `Alt+B` / `Alt+1…9` vistas · `Espacio` + arrastrar para mover · `Ctrl+Z` / `Ctrl+Y` · `Supr`.

| Proyectos | Editor de post-it |
|---|---|
| ![](docs/proyectos.png) | ![](docs/editor-postit.png) |

## Arquitectura

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Android      │   │ Windows      │   │ Navegador    │
│ (Capacitor)  │   │ (Electron)   │   │ http://nas   │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │  WebSocket + REST (token)           │
       └──────────────┬──────────────────────┘
               ┌──────▼──────┐
               │ NAS: Docker │  server/  (Node)
               │ /data/*.json│  un JSON por proyecto
               └─────────────┘
```

- `app/`: cliente en TypeScript + Vite (Canvas 2D y [perfect-freehand](https://github.com/steveruizok/perfect-freehand)). La misma base de código se empaqueta para Android y Windows.
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

## 3. Descargar o compilar las apps

### Desde GitHub (sin instalar nada)

1. **Solo la primera vez: firma del APK.** Añade los 4 secretos `ANDROID_KEYSTORE_*` en *Settings → Secrets and variables → Actions*. Sin ellos el APK sale firmado en modo debug con una clave distinta en cada versión, y para actualizar habría que desinstalar la anterior.
2. **Publicar una versión:** en GitHub, *Releases → Draft a new release → Choose a tag* → escribe `v0.1.0` (y `v0.2.0`, `v0.3.0`… en las siguientes) → *Publish release*.
3. La acción *Apps (Windows + Android)* compila con ese número de versión y adjunta a la Release, en unos 10 minutos:
   - `Canvas++ Setup x.y.z.exe` (instalador) y `Canvas++ x.y.z.exe` (portable) para Windows.
   - `Canvas++.apk` para Android (activa *Instalar apps desconocidas*).

### Avisos de actualización

- **Windows y Android** consultan la última Release de GitHub al arrancar, al volver a la app y cada 6 h. Si hay una versión mayor, aparece un aviso con el botón **Descargar**, que abre directamente el `.exe` o el `.apk`.
- **La web servida desde el NAS** avisa con **Recargar** cuando el contenedor se ha actualizado.
- En ⚙ Ajustes hay un botón **Buscar actualizaciones**, y se muestra la versión instalada.
- El repositorio que se consulta está en `app/package.json` → `canvaspp.updateRepo`.

### En local

Requisitos: Node 20+.

```bash
cd app
npm install
npm run dev          # desarrollo en el navegador (http://localhost:5173)

npm run win:dev      # abrir como app de Windows
npm run win:build    # generar instalador en app/electron/release/

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
| `CANVAS_TOKEN` | vacío | Token que piden las apps. Vacío significa sin autenticación (no recomendado). |
| `CANVAS_DATA` | `/data` | Carpeta de datos |
| `CANVAS_PUBLIC` | `./public` | Cliente web que se sirve |
| `CANVAS_SNAPSHOT_MIN` | `10` | Minutos entre copias automáticas del historial |

Estructura de `/data`: `projects/` (un JSON por proyecto), `assets/` (imágenes, PDF, audio y vídeo), `history/<proyecto>/` (versiones comprimidas) y `trash/` (proyectos borrados).

## API

- `GET /api/health`
- `GET|POST /api/projects`: listar y crear. `POST {id, name, items?}` sube proyectos creados sin conexión.
- `GET|PATCH|DELETE /api/projects/:id`
- `GET|PUT /api/assets/:id`: imágenes, PDF, audio y vídeo (hasta 500 MB, con peticiones parciales `Range`).
- `GET|POST /api/projects/:id/history`, `GET /api/projects/:id/history/:ts` y `POST …/:ts/restore`: historial de versiones.
- `GET|POST|DELETE /api/projects/:id/share`: enlace de solo lectura. Se consulta con `GET /api/view/:id?s=…` y `WS /ws?project=&share=…`.
- `WS /ws?project=&token=&client=`: mensajes `snapshot`, `ops`, `ack`, y además `cursor` y `laser` (efímeros).

## Licencia

MIT © 2026 Esther pKa

# SPEC — MusicSync Desktop
### Aplicación de comparación y sincronización de librerías de audio local ↔ dispositivo portátil (DAC)

| | |
|---|---|
| **Autor** | Dahch (Daniel Armando Hernández) |
| **Rol del documento** | Spec de arquitectura — nivel Tech Lead / Arquitecto |
| **Versión** | 1.0 |
| **Fecha** | 2026-07-01 |
| **Estado** | Draft para revisión técnica |

---

## 1. Resumen Ejecutivo

MusicSync es una aplicación de escritorio multiplataforma (Windows, macOS, Linux) que permite comparar el contenido de dos carpetas — una **carpeta origen** (librería local) y una **carpeta destino** (habitualmente el almacenamiento montado de un DAC/reproductor portátil) — y seleccionar de forma granular qué archivos de audio copiar desde el origen hacia el destino para mantenerlos sincronizados.

No es un sincronizador bidireccional automático ni un gestor de metadatos/tags. Es una herramienta de **diffing + copia dirigida**, con control humano en el medio: el usuario siempre revisa el plan de copia antes de ejecutarlo.

**Prioridades explícitas del stakeholder (orden de importancia):**
1. Rendimiento en macOS (uso primario) — pero sin degradar Windows/Linux.
2. Interfaz moderna, no un formulario de los 2000.
3. Soporte robusto para `.mp3` y `.flac`; el resto de formatos de audio se soportan "gratis" porque la app no decodifica audio, solo compara metadatos de archivo.
4. Multiplataforma real (mismo binario, mismo comportamiento core).

---

## 2. Alcance

### 2.1 Dentro de alcance
- Selección de carpeta origen y destino (con soporte para rutas en discos extraíbles/montados).
- Escaneo recursivo de ambas carpetas filtrando por extensiones de audio configurables.
- Comparación determinista archivo-a-archivo con 3 estrategias de fidelidad (ver §6).
- Vista de diff categorizada: Nuevo / Modificado / Igual / Solo-en-destino (huérfano).
- Selección granular (checkboxes) + selección masiva por categoría/carpeta.
- Plan de copia con estimación de tamaño total y espacio disponible en destino.
- Ejecución de copia con progreso, pausa/cancelación, reintentos y verificación post-copia opcional (checksum).
- Preservación de la estructura de subcarpetas relativa origen→destino.
- Historial local de sincronizaciones (qué se copió, cuándo, resultado).
- Perfiles guardados (pares origen/destino recurrentes, ej. "Librería FLAC → FiiO M11").

### 2.2 Fuera de alcance (v1)
- Sincronización bidireccional automática (destino → origen).
- Edición o normalización de metadatos ID3/Vorbis (fuera de responsabilidad de esta herramienta).
- Transcodificación de formatos (ej. FLAC→MP3 al copiar). Puede ser un ADR futuro (§16, riesgos).
- Soporte MTP nativo (Android-like) sin punto de montaje de filesystem — ver ADR-006 y limitaciones §11.
- Sincronización en la nube / streaming.
- Multiusuario / backend remoto. Todo es 100% local, sin red.

---

## 3. Decisiones de Arquitectura (ADRs)

### ADR-001 — Stack tecnológico: Tauri v2 + Rust (core) + React/TypeScript (UI)

**Contexto:** Se requiere UI moderna, multiplataforma, con foco en performance en macOS, minimizando consumo de memoria y tiempo de arranque, y aprovechando el stack TS/React que ya domina el autor.

**Alternativas consideradas:**

| Opción | Pros | Contras |
|---|---|---|
| **Electron + React** | Ecosistema maduro, DX conocida | Bundle ~150-200MB, consumo RAM alto (Chromium embebido), en Mac corre sobre un Chromium propio en vez del WebKit del sistema → peor uso de energía/CPU en Apple Silicon |
| **Tauri v2 + Rust + React** | WebView nativo del sistema (WKWebView en macOS, WebView2 en Windows, WebKitGTK en Linux) → bundle ~5-15MB, arranque <1s, IPC eficiente, Rust para operaciones de I/O intensivo (hashing, escaneo) con paralelismo real (no bloquea el hilo de UI) | Curva de aprendizaje Rust para el core; ecosistema de plugins algo menor que Electron |
| **Nativo puro por plataforma** (Swift/AppKit + Kotlin/Compose Desktop + GTK) | Máximo rendimiento posible por plataforma | 3 bases de código distintas, 3x costo de mantenimiento, inviable para un proyecto de un solo desarrollador |
| **Flutter Desktop** | Un solo lenguaje (Dart), buen rendimiento | Fuera del stack conocido del autor, ecosistema de FS/IO nativo menos maduro que Rust para este caso de uso |

**Decisión:** **Tauri v2**, con:
- **Core / backend local:** Rust — responsable de escaneo de filesystem, hashing, diffing, cola de copia. Todo el trabajo pesado vive aquí, fuera del hilo de UI, aprovechando `tokio` (async I/O) y `rayon` (paralelismo de CPU para hashing).
- **UI:** React 18 + TypeScript + Vite, comunicándose con el core vía comandos Tauri (`invoke`) y eventos (`emit`/`listen`) para progreso en tiempo real.
- **Justificación de la prioridad Mac:** Tauri usa WKWebView nativo de macOS, lo que reduce consumo de energía y RAM comparado con Electron, y Rust compilado nativo para Apple Silicon (target `aarch64-apple-darwin`) da rendimiento de escaneo/hashing equivalente a una app nativa Swift.

**Consecuencias:** Se requiere toolchain de Rust en el entorno de build (CI multiplataforma). El autor deberá escribir lógica de dominio en Rust (nuevo, pero acotado: solo I/O + hashing + diffing, sin UI en Rust).

---

### ADR-002 — Estrategia de comparación de archivos: comparación en capas (fast-path + fingerprint opcional)

**Contexto:** Comparar archivos de audio puede hacerse por: (a) ruta+nombre, (b) tamaño+fecha de modificación, (c) hash criptográfico/no-criptográfico del contenido. Cada uno tiene trade-offs de velocidad vs. certeza.

**Decisión:** Comparación en **3 niveles configurables**, aplicados en cascada (cada nivel es un fast-path para evitar el más costoso):

1. **Nivel 1 — Identidad estructural (siempre activo, O(n)):** clave = ruta relativa normalizada (case-insensitive en Windows/Mac por defecto de FS, case-sensitive configurable para Linux) + nombre de archivo + extensión.
   - Si la clave no existe en destino → **Nuevo** (candidato a copiar).
   - Si la clave no existe en origen pero sí en destino → **Huérfano** (existe solo en destino).
2. **Nivel 2 — Metadata rápida (por defecto, O(n)):** si la clave existe en ambos lados, comparar `tamaño en bytes` + `mtime` (con tolerancia configurable, por defecto 2s, para absorber diferencias de sistemas de archivos FAT32/exFAT típicos de DACs que truncan precisión de timestamp).
   - Igual tamaño + mtime dentro de tolerancia → **Igual** (no se copia).
   - Distinto → **Diferente** (candidato a copiar/sobrescribir).
3. **Nivel 3 — Hash de contenido (opt-in, "Modo Estricto", O(n) pero costoso en I/O):** usa **BLAKE3** (no MD5/SHA1) por su velocidad multihilo muy superior en discos rápidos (SSD/NVMe) — relevante en macOS con Apple Silicon. Se activa cuando el usuario no confía en mtime (ej. tras copiar por otra herramienta que no preserva timestamps) o para detectar corrupción de copias previas.

**Justificación de no usar hash por defecto:** en librerías de decenas de miles de FLAC (potencialmente cientos de GB), hashear todo en cada comparación sería lento incluso en NVMe, y el caso de uso real (sincronizar cambios incrementales) no lo necesita la mayoría de las veces. Nivel 2 cubre >95% de los casos correctamente.

**Consecuencias:** Debe exponerse claramente en la UI qué nivel de comparación se está usando, para que el usuario entienda por qué un archivo se marca "Igual" sin haber sido leído byte a byte.

---

### ADR-003 — Escaneo y hashing concurrentes

**Decisión:** El escaneo de directorios se hace con `tokio::fs` (async, no bloqueante) para I/O, y el hashing (cuando se activa Nivel 3) se paraleliza con `rayon` sobre un thread pool dimensionado a `num_cpus - 1` para no saturar la máquina. El escaneo de origen y destino se ejecuta en paralelo (dos tareas async concurrentes), no secuencial.

**Consecuencias:** Necesita backpressure/límite de memoria: los resultados de escaneo se procesan en streaming (no se acumula el árbol completo en memoria antes de emitir progreso a la UI) — importante para librerías con 50k+ archivos.

---

### ADR-004 — Estrategia de copia de archivos

**Decisión:**
- Copia por streaming en chunks de 1MB (configurable), usando `tokio::fs::copy` como base pero con wrapper propio para poder reportar progreso por archivo y por lote.
- Cola de copia secuencial-por-disco-destino (no paralela hacia el mismo destino) para evitar saturar la velocidad de escritura de dispositivos USB/DAC lentos (que suelen ser el cuello de botella real, no la CPU). Paralelismo sí se permite en la fase de lectura/hashing del origen.
- Verificación post-copia opcional (checksum BLAKE3 origen vs destino) — desactivada por defecto por costo, recomendada activarla para transferencias grandes/críticas.
- Escritura atómica: se copia primero a `<destino>/<ruta>.musicsync.tmp` y se renombra (`rename` atómico del FS) al nombre final solo si la copia fue exitosa y (si aplica) la verificación pasó. Esto evita archivos corruptos/parciales visibles en el DAC si se desconecta a mitad de copia.
- Manejo de espacio insuficiente: cálculo de espacio requerido total del plan vs espacio libre en destino **antes** de iniciar, con bloqueo/advertencia si no cabe (no se descubre a mitad de la operación).

---

### ADR-005 — Gestión de estado en el frontend

**Decisión:** Zustand (no Redux) para estado de UI — es liviano, sin boilerplate, y el estado real "pesado" (árbol de comparación, resultados) vive en Rust y se consulta/pagina desde React, no se duplica completo en el store de JS. El store de Zustand solo mantiene: selección actual del usuario (checkboxes), filtros de vista, estado de progreso de la tarea activa.

**Justificación:** Con árboles de 50k+ archivos, mantener todo el estado en JS/React causaría re-renders costosos. La UI pide vistas paginadas/virtualizadas (`@tanstack/react-virtual`) al core Rust vía comandos Tauri.

---

### ADR-006 — Límite explícito sobre dispositivos MTP (Android-style)

**Contexto:** Algunos DACs/reproductores exponen su almacenamiento como MTP (Media Transfer Protocol) en vez de montarse como un volumen de filesystem estándar, especialmente en Linux/Windows con ciertos dispositivos Android-based.

**Decisión:** V1 **solo soporta destinos que se montan como filesystem estándar** (volumen con letra de unidad en Windows, punto de montaje en macOS/Linux — que es el comportamiento típico de DACs USB-DAC/USB-MSC como iBasso, FiiO, Astell&Kern, Sony Walkman en modo "USB DAC/MSC", discos externos, tarjetas SD). MTP queda documentado como limitación conocida (§11) y posible extensión futura vía `libmtp` (solo Linux/Windows; macOS no tiene soporte nativo maduro de MTP).

---

## 4. Arquitectura de Alto Nivel

```
┌──────────────────────────────────────────────────────────────┐
│                      UI Layer (React/TS)                      │
│  Pantallas: Selección carpetas · Vista Diff · Plan de copia   │
│  Progreso · Historial · Configuración                         │
│  State: Zustand (selección/filtros) + queries a core vía IPC  │
└───────────────────────────┬────────────────────────────────────┘
                            │ Tauri IPC (invoke / emit-listen)
┌───────────────────────────┴────────────────────────────────────┐
│                    Core Layer (Rust)                            │
│  ┌────────────┐  ┌──────────────┐  ┌────────────┐  ┌─────────┐ │
│  │  Scanner   │  │  Comparator  │  │ CopyEngine │  │ History │ │
│  │ (tokio fs) │→ │ (diff logic) │→ │  (queue)   │  │ (sqlite)│ │
│  └────────────┘  └──────────────┘  └────────────┘  └─────────┘ │
│         │                │                │                     │
│         └────────────────┴────────────────┴── Domain Model ────┘│
└───────────────────────────┬────────────────────────────────────┘
                            │ std::fs / tokio::fs
┌───────────────────────────┴────────────────────────────────────┐
│         Filesystem (local + volúmenes montados: DAC/USB)       │
└──────────────────────────────────────────────────────────────┘
```

**Persistencia local:** SQLite embebido (vía `rusqlite`) para: historial de sincronizaciones, perfiles guardados (pares origen/destino), configuración de usuario. Vive en el directorio de datos de app estándar por plataforma (`~/Library/Application Support/MusicSync` en macOS, `%APPDATA%/MusicSync` en Windows, `~/.local/share/musicsync` en Linux — vía crate `directories`).

---

## 5. Modelo de Dominio

```rust
struct MusicFile {
    relative_path: PathBuf,      // ruta relativa a la raíz escaneada
    absolute_path: PathBuf,
    size_bytes: u64,
    modified_at: SystemTime,
    extension: String,
    content_hash: Option<Blake3Hash>, // solo si Nivel 3 activo
}

enum DiffStatus {
    New,                 // existe en origen, no en destino
    Orphan,              // existe en destino, no en origen
    Identical,           // igual según nivel de comparación activo
    Different,           // mismo path, contenido/metadata distinta
}

struct ComparisonEntry {
    relative_path: PathBuf,
    status: DiffStatus,
    source: Option<MusicFile>,
    destination: Option<MusicFile>,
    selected: bool,       // marcado por el usuario para copiar
}

struct ComparisonResult {
    entries: Vec<ComparisonEntry>,
    scanned_at: SystemTime,
    source_root: PathBuf,
    destination_root: PathBuf,
    comparison_level: ComparisonLevel, // Fast | Metadata | Strict
    stats: ComparisonStats, // totales por categoría, tamaño total nuevo/diferente
}

struct CopyTask {
    entry: ComparisonEntry,
    status: CopyStatus, // Pending | InProgress | Verifying | Done | Failed(reason) | Skipped
    bytes_copied: u64,
    retries: u8,
}

struct SyncProfile {
    id: Uuid,
    name: String,             // ej. "Librería FLAC → FiiO M11"
    source_root: PathBuf,
    destination_root: PathBuf,
    default_comparison_level: ComparisonLevel,
    last_synced_at: Option<SystemTime>,
}
```

---

## 6. Algoritmo de Comparación — flujo detallado

1. **Validación previa:** verificar que ambas rutas existen, son directorios legibles, y que destino tiene permisos de escritura. Si destino es un volumen removible, verificar que sigue montado antes de cada operación larga (polling ligero o watch de eventos de montaje por plataforma).
2. **Escaneo paralelo:** dos tareas async recorren origen y destino recursivamente, filtrando por extensiones configuradas (`.mp3`, `.flac` por defecto; lista extensible: `.wav`, `.aac`, `.m4a`, `.ogg`, `.opus`, `.aiff`, `.alac`, `.dsf`). Se emiten eventos de progreso incrementales a la UI (`scan:progress` con conteo de archivos encontrados) para dar feedback en librerías grandes sin esperar a que termine todo el escaneo.
3. **Indexación:** cada árbol se indexa en un `HashMap<PathBuf, MusicFile>` con clave = ruta relativa normalizada.
4. **Diffing:** merge de ambos mapas por clave, aplicando ADR-002 en cascada, produciendo `Vec<ComparisonEntry>`.
5. **Agregación de estadísticas:** conteo y tamaño total por categoría (`New`, `Orphan`, `Different`, `Identical`) para mostrar resumen antes de que el usuario decida.
6. **Entrega a UI:** resultado paginado/virtualizado; UI puede filtrar por categoría, buscar por nombre, y ordenar por tamaño/carpeta.

---

## 7. Requisitos Funcionales

| ID | Requisito |
|---|---|
| RF-01 | El usuario puede seleccionar carpeta origen y destino mediante diálogo nativo del sistema operativo. |
| RF-02 | El usuario puede guardar el par origen/destino como "Perfil" con nombre personalizado, para reutilizar sin re-seleccionar rutas. |
| RF-03 | El sistema escanea recursivamente ambas carpetas y filtra por extensiones de audio configurables (default: mp3, flac). |
| RF-04 | El sistema muestra progreso de escaneo en tiempo real (archivos encontrados / carpetas recorridas). |
| RF-05 | El sistema clasifica cada archivo en una de 4 categorías: Nuevo, Huérfano, Diferente, Igual. |
| RF-06 | El usuario puede elegir el nivel de comparación (Rápido / Metadata / Estricto con hash) antes o después del escaneo, re-computando el diff sin re-escanear el filesystem si no hace falta. |
| RF-07 | El usuario puede filtrar la vista de resultados por categoría, por subcarpeta, o buscar por nombre. |
| RF-08 | El usuario puede seleccionar/deseleccionar archivos individualmente o por lote (ej. "seleccionar todos los Nuevos", "seleccionar todos los Diferentes de esta carpeta"). |
| RF-09 | El sistema calcula y muestra el tamaño total a copiar según la selección actual, y el espacio libre disponible en destino, alertando si no cabe. |
| RF-10 | El usuario puede iniciar la copia del plan seleccionado, con barra de progreso global y por archivo. |
| RF-11 | El usuario puede pausar, reanudar o cancelar una copia en curso. Los archivos ya completados no se re-copian al reanudar. |
| RF-12 | El sistema preserva la estructura de subcarpetas relativa del origen al copiar al destino. |
| RF-13 | El sistema ofrece verificación post-copia opcional (checksum) por transferencia. |
| RF-14 | Ante fallo de copia de un archivo individual (error de I/O, dispositivo desconectado, permisos), el sistema reintenta N veces (configurable, default 2) y luego marca el archivo como Fallido sin detener el resto de la cola. |
| RF-15 | El sistema mantiene un historial local de sincronizaciones (fecha, perfil usado, cantidad de archivos copiados, tamaño total, errores) consultable desde la UI. |
| RF-16 | El usuario puede exportar el resultado de una comparación (no la copia) a CSV/JSON para revisión externa. |
| RF-17 | El sistema detecta si el volumen destino se desmonta durante una operación en curso y detiene la cola de forma segura, marcando claramente qué se completó y qué no. |
| RF-18 | El usuario puede configurar extensiones de audio adicionales a considerar en el escaneo. |
| RF-19 | El sistema permite "modo simulación" (dry-run): mostrar qué se copiaría sin ejecutar ninguna escritura real. |

---

## 8. Requisitos No Funcionales

| ID | Categoría | Requisito |
|---|---|---|
| RNF-01 | Rendimiento | Escaneo de 20,000 archivos de audio en una carpeta local SSD debe completarse en <5s en Apple Silicon (M1 o superior). |
| RNF-02 | Rendimiento | El hilo de UI nunca debe bloquearse durante escaneo/hashing/copia — toda operación de I/O pesada vive en el core Rust, comunicada por eventos async. |
| RNF-03 | Memoria | Consumo de RAM en reposo <150MB; durante escaneo de librerías de 50k+ archivos, uso de streaming para no cargar el árbol completo antes de poder mostrar progreso. |
| RNF-04 | Tamaño de binario | Instalador <20MB por plataforma (ventaja directa de Tauri vs Electron). |
| RNF-05 | Portabilidad | Comportamiento funcional idéntico en Windows 10+, macOS 12+ (Intel y Apple Silicon, universal binary o builds separados), y distribuciones Linux principales (Ubuntu 22.04+, Fedora reciente) vía AppImage/deb/rpm. |
| RNF-06 | Resiliencia | Ninguna operación de copia debe dejar archivos corruptos/parciales visibles en destino ante interrupción (ADR-004, escritura atómica). |
| RNF-07 | Usabilidad | Toda operación potencialmente destructiva (sobrescribir "Diferentes") requiere confirmación explícita antes de ejecutarse. |
| RNF-08 | Observabilidad | Logs locales estructurados (rotación por tamaño/fecha) accesibles desde la UI ("Ver logs") para diagnóstico sin herramientas externas. |
| RNF-09 | Accesibilidad | Navegación completa por teclado en las vistas de diff y plan de copia; contraste conforme a WCAG AA en el tema por defecto. |
| RNF-10 | Seguridad | La app no requiere ni almacena credenciales; no realiza llamadas de red (excepto verificación de actualizaciones, opt-in). Firma de código y notarización en macOS (ver §13) para evitar advertencias de Gatekeeper. |
| RNF-11 | Mantenibilidad | Cobertura de tests unitarios ≥80% en el core Rust (scanner, comparator, copy engine — la lógica de negocio crítica). |

---

## 9. UI/UX — Especificación de pantallas

**Lenguaje visual:** minimalista, oscuro por defecto con tema claro alternativo, tipografía sans-serif del sistema (SF Pro en macOS vía fuente nativa, Segoe UI en Windows, system-ui en Linux — sin cargar fuentes web pesadas). Iconografía tipo Lucide (coherente con proyectos previos del autor).

1. **Pantalla de inicio / Selección de perfil:** lista de perfiles guardados (tarjetas con nombre, últimas rutas, última sincronización) + botón "Nueva comparación" (selección manual de carpetas sin guardar perfil).
2. **Pantalla de comparación (core de la app):**
   - Panel superior: resumen (X nuevos, Y diferentes, Z huérfanos, W idénticos — con tamaños), selector de nivel de comparación, barra de búsqueda/filtro.
   - Lista virtualizada tipo árbol de carpetas colapsable, cada fila con: checkbox, ícono de estado (color por categoría), nombre, tamaño, y para "Diferente" un indicador visual de qué cambió (tamaño/fecha).
   - Panel lateral/inferior: resumen de selección actual (tamaño total, espacio disponible en destino con barra visual) y botón "Revisar plan de copia".
3. **Pantalla de plan de copia (confirmación):** lista final de lo que se va a copiar/sobrescribir, con advertencia explícita en los que sobrescriben, checkbox de "verificar con checksum al finalizar", botón "Iniciar copia".
4. **Pantalla de progreso de copia:** barra global + lista de archivos en curso/completados/fallidos en tiempo real, botones pausar/cancelar.
5. **Pantalla de historial:** tabla de sincronizaciones pasadas con detalle expandible por fila.
6. **Configuración:** extensiones soportadas, tolerancia de mtime, reintentos, tema, tamaño de chunk de copia (avanzado).

---

## 10. Matriz de Manejo de Errores

| Escenario | Detección | Comportamiento |
|---|---|---|
| Carpeta origen/destino no existe o fue borrada tras seleccionarla | Validación al iniciar escaneo/copia | Mensaje claro, no crashea; vuelve a pantalla de selección |
| Volumen destino desmontado durante escaneo | Error de I/O capturado en la tarea async | Detiene escaneo, notifica, conserva resultados parciales descartados (no se muestra un diff incompleto engañoso) |
| Volumen destino desmontado durante copia | Error de I/O en la tarea de copia activa | Detiene la cola tras el archivo en curso (marcado Fallido/parcial descartado por escritura atómica), preserva estado de lo ya completado, permite reanudar tras reconectar |
| Espacio insuficiente en destino | Cálculo previo (RF-09) + validación en tiempo real durante copia | Bloquea inicio si se detecta previo; si cambia a mitad (otro proceso escribió), pausa y notifica |
| Permisos insuficientes (lectura origen o escritura destino) | Error de I/O al abrir archivo | Marca archivo específico como Fallido con motivo, continúa con el resto |
| Archivo bloqueado/en uso (ej. reproduciéndose en el DAC) | Error de I/O específico de plataforma | Reintenta con backoff (configurable), luego marca Fallido |
| Nombres de archivo con caracteres no válidos en FS destino (ej. `:` en FAT32 desde macOS) | Validación pre-copia por reglas de FS destino | Advertencia previa en plan de copia, opción de omitir esos archivos |
| Ruta demasiado larga (Windows, límite histórico 260 caracteres) | Validación pre-copia | Uso de prefijos de ruta extendida (`\\?\`) cuando el FS lo soporte; si no, advertencia y omisión |
| Colisión de nombres con distinto casing (macOS/Windows case-insensitive vs Linux case-sensitive) | Detección en indexación (Nivel 1) | Tratar como el mismo archivo en FS case-insensitive; advertir si origen tiene duplicados que colisionarían en destino case-insensitive |
| Interrupción de la app (crash/cierre forzado) durante copia | N/A (recuperación al reiniciar) | Al reabrir, historial muestra sincronización "incompleta"; archivos parciales (`.musicsync.tmp`) se limpian automáticamente al iniciar |

---

## 11. Consideraciones específicas por plataforma

**macOS (prioridad):**
- Distribución vía `.dmg` firmado + **notarización** de Apple (obligatorio desde macOS 10.15+ para evitar bloqueo de Gatekeeper). Requiere Apple Developer ID.
- Diálogo de selección de carpeta usa `NSOpenPanel` nativo vía plugin `tauri-plugin-dialog`.
- Detección de montaje/desmontaje de volúmenes vía `DiskArbitration` (a través de crate Rust correspondiente o polling de `/Volumes`).
- Build universal (`x86_64-apple-darwin` + `aarch64-apple-darwin`) o binarios separados — recomendado universal para simplificar distribución, aunque aumenta tamaño del instalador.
- Permisos de sandboxing: si se distribuye fuera del Mac App Store (recomendado para esta app, dado que necesita acceso amplio a filesystem/volúmenes externos que el sandbox de la App Store restringe fuertemente), no aplica sandbox — pero sí puede requerir permiso de "Acceso completo al disco" en Privacidad y Seguridad si se accede a ciertas carpetas protegidas.

**Windows:**
- Distribución vía instalador `.msi` o `.exe` (NSIS, soportado por Tauri bundler).
- Manejo de letras de unidad dinámicas para el DAC (puede montarse en `D:`, `E:`, etc. — la app debe re-resolver la ruta si cambia entre sesiones, no asumir persistencia de letra).
- Límite de longitud de ruta (260 caracteres) — mitigado con prefijo `\\?\` en llamadas de FS cuando sea necesario.
- Code signing con certificado (recomendado para evitar advertencias de SmartScreen).

**Linux:**
- Distribución vía `.AppImage` (portable, prioridad por simplicidad) y opcionalmente `.deb`/`.rpm`.
- Puntos de montaje típicos en `/media/<user>/<device>` o `/run/media/<user>/<device>` (udisks2) — la app no debe asumir una ruta fija, siempre parte de la selección explícita del usuario.
- WebKitGTK como dependencia del sistema (requisito de Tauri en Linux) — documentar en instrucciones de instalación.

**Limitación transversal — MTP (ADR-006):** dispositivos que solo exponen MTP (no se montan como volumen de filesystem estándar) no son compatibles en v1. Se recomienda al usuario configurar su DAC en modo "USB Mass Storage" o "USB DAC" si tiene esa opción (la mayoría de DACs audiófilos serios la tienen, a diferencia de teléfonos Android genéricos).

---

## 12. Observabilidad

- Logging estructurado con crate `tracing` en el core Rust, niveles `INFO`/`WARN`/`ERROR`, con contexto (operación, archivo, perfil).
- Rotación de logs por tamaño (ej. 5MB) y retención limitada (ej. últimos 5 archivos), ubicados en el directorio de datos de app.
- Botón "Abrir carpeta de logs" y "Exportar diagnóstico" (zip con logs + config, sin datos de audio) en la pantalla de Configuración, para soporte/debug sin herramientas externas.

---

## 13. Estrategia de Testing

| Nivel | Alcance | Herramientas |
|---|---|---|
| Unitario (Rust) | Scanner, Comparator (todas las combinaciones de DiffStatus), CopyEngine (incluyendo simulación de fallos de I/O), lógica de tolerancia de mtime | `cargo test`, mocks de filesystem con `tempfile` |
| Integración (Rust) | Flujo completo escaneo→diff→copia sobre filesystems temporales reales, incluyendo casos de FS case-insensitive simulado | `cargo test` con fixtures de directorios reales |
| Componentes UI (React) | Renderizado de listas virtualizadas, lógica de selección/filtrado, formularios | Vitest + React Testing Library |
| E2E | Flujos críticos: seleccionar carpetas → ver diff → ejecutar copia → verificar historial, en al menos macOS y Windows en CI | `tauri-driver` (WebDriver) |
| Manual/exploratorio | Comportamiento real con DAC físico conectado (USB-MSC), desmontaje en caliente, librerías FLAC grandes reales | Checklist manual antes de cada release |

---

## 14. Empaquetado y Distribución

- **Build system:** Tauri CLI (`tauri build`) por plataforma, orquestado en CI (GitHub Actions con runners `macos-latest`, `windows-latest`, `ubuntu-latest`).
- **Firma de código:** certificado Apple Developer ID (macOS) + notarización automatizada en pipeline de CI; certificado de firma para Windows (opcional pero recomendado, reduce fricción de SmartScreen).
- **Auto-actualización:** plugin oficial `tauri-plugin-updater`, opt-in explícito del usuario (respeta RNF-10 de "sin llamadas de red no solicitadas"), verificación de firma de las actualizaciones.
- **Versionado:** SemVer, changelog generado a partir de commits convencionales (coherente con el flujo de trabajo ya establecido del autor con `commit-all`/`doc-sync`).

---

## 15. Plan de Entrega por Fases

**Fase 0 — Fundacional (infra + esqueleto)**
- Setup Tauri v2 + React + TS + Vite, CI multiplataforma básico (build en las 3 plataformas, sin firma aún).
- Módulo `scanner` en Rust con tests unitarios (sin UI todavía, validado por CLI de debug).

**Fase 1 — MVP funcional**
- Comparación Nivel 1 y 2 (RF-03 a RF-07) end-to-end con UI real.
- Selección manual, plan de copia, ejecución de copia simple (sin pausa/reanudación aún), historial básico.
- Cubre RF-01, 02(parcial: sin perfiles guardados aún puede ir en esta fase o la siguiente), 03–10, 12.

**Fase 2 — Robustez**
- Pausa/reanudación/cancelación (RF-11), verificación checksum (RF-13), manejo completo de la matriz de errores (§10), escritura atómica (ADR-004), detección de desmontaje (RF-17).
- Perfiles guardados (RF-02), dry-run (RF-19).

**Fase 3 — Pulido y distribución**
- Nivel 3 de comparación (hash estricto, RF-06 completo), exportación CSV/JSON (RF-16), configuración avanzada (RF-18, tolerancias).
- Firma/notarización, empaquetado final por plataforma, auto-actualización.
- Accesibilidad (RNF-09), pulido visual final.

**Fase 4 — Extensiones futuras (fuera de v1, backlog)**
- Soporte MTP vía `libmtp` (Windows/Linux).
- Transcodificación opcional al copiar (ej. FLAC→MP3 para DACs con poco espacio).
- Sincronización bidireccional / modo "mirror" con eliminación de huérfanos (requiere UX de confirmación mucho más cuidadosa por ser destructivo).

---

## 16. Riesgos y Mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Curva de aprendizaje de Rust ralentiza Fase 0-1 | Retraso de cronograma | Acotar el core Rust a I/O + hashing + diffing puro (sin lógica de UI), que es el subconjunto más simple y bien documentado del lenguaje; usar crates maduros (`tokio`, `rayon`, `blake3`, `rusqlite`) en vez de reinventar |
| Comportamiento inconsistente de mtime entre FAT32/exFAT (DAC) y APFS/NTFS/ext4 (origen) | Falsos positivos/negativos en el diff | Tolerancia configurable de mtime (ADR-002) + posibilidad de forzar Nivel 3 (hash) cuando el usuario detecte inconsistencias |
| Usuario conecta un DAC en modo MTP sin saberlo y la app no ve nada útil | Confusión, percepción de bug | Detección explícita: si la ruta seleccionada no es un punto de montaje de filesystem válido, mostrar mensaje educativo sugiriendo cambiar el modo USB del dispositivo |
| Notarización de macOS y firma de Windows tienen costo (cuenta de desarrollador) y fricción de setup | Bloquea distribución pulida | Para uso personal/portfolio, se puede distribuir sin firma inicialmente (con instrucciones de "abrir igualmente" para el usuario), y añadir firma cuando se decida distribuir más ampliamente |
| Librerías extremadamente grandes (100k+ archivos, ej. FLAC sin comprimir) | Problemas de memoria/rendimiento no cubiertos por RNF-01/03 | Diseño desde el inicio con streaming y paginación (ADR-003, RNF-03) en vez de optimizar después; probar con dataset sintético grande en Fase 1 |

---

## 17. Glosario

- **DAC:** Digital-to-Analog Converter; en este contexto, dispositivo portátil de audio que también actúa como reproductor con almacenamiento propio.
- **MTP:** Media Transfer Protocol, protocolo alternativo al montaje de filesystem estándar, común en algunos dispositivos Android.
- **USB-MSC:** USB Mass Storage Class, modo en el que un dispositivo se monta como un volumen de disco estándar.
- **BLAKE3:** función de hash criptográfico moderna, optimizada para paralelismo y velocidad, usada aquí para verificación de integridad, no para seguridad criptográfica.
- **Nivel de comparación:** configuración que determina cuán exhaustiva es la detección de diferencias entre archivos (§6, ADR-002).

# SPEC — Nerdearla Live Subs

### Arquitectura
```
[Laptop de la sala] ──mic/mixer──▶ Página "Consola" (AudioWorklet → PCM 16kHz)
        │  token efímero (Convex action)
        ▼
   Gemini Live API ──▶ transcripción original + traducción ES (streaming)
        │
        ▼  mutations (segmentos parciales/finales + métricas)
     Convex (sessions, segments, glossary, heartbeats)
        │  queries reactivas
        ├──▶ /s/[sessionId]            Vista audiencia (elige sesión + idioma)
        ├──▶ /overlay/[id]?lang=es     Overlay transparente para OBS (Browser Source)
        ├──▶ /admin                    Panel de monitoreo (estado, latencia, errores)
        └──▶ /api/export/[id].srt|vtt|txt
```

### 1. Objetivo y propósito
Reemplazar las herramientas comerciales y los operadores humanos de subtitulado en conferencias por una solución open source, barata y replicable. Toma el audio de cada sala y publica subtítulos en vivo en el idioma original y traducidos, para la audiencia presencial, el stream y el archivo posterior.

**Usuarios:**
- **Operador de sala:** conecta la laptop al audio y controla la sesión.
- **Producción:** monitorea todas las salas.
- **Asistente:** lee los subtítulos en su celular.
- **Streamer:** quema los subtítulos en OBS.

### 2. Comportamiento esperado

**Producción (panel `/admin`)**
- Crea un evento y sus sesiones: título, sala, orador, idioma de origen (es/en/pt) e idiomas de salida.
- Carga el glosario del evento, con términos técnicos y nombres propios.
- Ve una grilla con todas las sesiones y, en cada una: estado (inactiva / en vivo / reconectando / error), latencia promedio, último segmento, cantidad de espectadores y errores recientes.

**Operador (`/console/[sessionId]`)**
- Elige el dispositivo de entrada, ve un vúmetro y aprieta "Iniciar".
- Ve los subtítulos a medida que salen. Puede pausar/reanudar y terminar la sesión.
- Si se cae la conexión con Gemini, el sistema reconecta solo y muestra "Reconectando…" sin perder la sesión.

**Asistente (`/` y `/s/[sessionId]`)**
- Ve las sesiones en vivo, elige una y elige el idioma (original / ES / EN / PT).
- Los subtítulos aparecen en streaming: los parciales en gris y los finales en blanco. Hay scroll automático, tamaño de letra ajustable y modo alto contraste.
- Al terminar la charla, puede descargar la transcripción.

**Streamer (`/overlay/[sessionId]?lang=es`)**
- Página con fondo transparente, dos líneas grandes y estilo configurable por query params. Se pega en OBS o vMix como Browser Source.

**Exportación**
- `/api/export/[sessionId]?lang=es&format=srt|vtt|txt` devuelve la transcripción completa con timestamps.

### 3. Reglas de negocio y restricciones
- La API key de Gemini **nunca** llega al cliente. El cliente solo recibe tokens efímeros.
- Una sesión tiene como máximo una consola activa. Si se abre una segunda, se rechaza o toma el control con confirmación.
- Cada segmento guarda: `sessionId`, `lang`, `text`, `isFinal`, `startMs`, `endMs` y `createdAt`. Los parciales se reemplazan y los finales son inmutables.
- El glosario se inyecta en las instrucciones del modelo y en las traducciones secundarias.
- La latencia objetivo, del audio al texto visible, es **< 3 s** para el original y **< 5 s** para la traducción. Se mide y se muestra.
- Soporta **al menos 3 sesiones simultáneas** en la demo, y la arquitectura no tiene límite propio: 1 conexión Gemini por sala.
- Solo producción edita. Para la demo alcanza con una contraseña de admin por variable de entorno, sin sistema de usuarios.
- Open source: licencia MIT, README en inglés, `.env.example` y `docker-compose.yml`.
- Costo: se documenta el costo estimado por hora de charla.

### 4. Criterios de aceptación
**Núcleo (obligatorio):**
- [ ] Una charla en inglés hablada al mic produce subtítulos en EN y ES visibles en `/s/[id]` en menos de 5 s.
- [ ] Una charla en español produce subtítulos en ES y, si se activa, en EN.
- [ ] 3 sesiones en paralelo, en 3 pestañas o 3 laptops, funcionan a la vez sin mezclarse.
- [ ] Una sesión de 30 min corre sin cortes visibles, con reconexión automática probada forzando una desconexión.
- [ ] El README permite que alguien desde cero lo levante siguiendo los pasos (probado en carpeta limpia).

**Opcionales priorizados:**
- [ ] Overlay OBS funcionando en OBS real.
- [ ] Export SRT/VTT válido: abre en VLC sobre un video.
- [ ] Panel `/admin` con estado, latencia y errores de cada sesión.
- [ ] Glosario: un término mal transcripto sin glosario sale bien con glosario (ej.: "Nerdearla", "Kubernetes").
- [ ] Portugués como idioma de salida.

**Entrega:**
- [ ] Repo público, licencia MIT, `SPEC.md`, README con arquitectura y screenshots.
- [ ] Demo desplegada en URL pública.
- [ ] Video de 2-3 min: el problema, la demo con 2 salas en paralelo, OBS, export y el panel.

---

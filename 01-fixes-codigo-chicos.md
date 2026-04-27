# Fixes chiquitos al código

Cambios de bajo riesgo, mayormente cosméticos o de consistencia, que alinean el código con la tesis sin tocar la semántica ni romper reproducibilidad. Ninguno requiere migración de datos ni rompe tests existentes (salvo renombrar strings literales, que es find-and-replace trivial).

Contexto: **modelo híbrido**. La tesis se mantiene con las definiciones aspiracionales; el código se mantiene en su operacionalización v1 declarada; los gaps conceptuales grandes quedan registrados como agenda confirmatoria. Este documento solo toca los detalles chicos.

---

## F1 — Alinear nombres de `event_type` entre código y tesis

**Problema:** los contracts Pydantic en `packages/contracts/src/platform_contracts/ctr/events.py` declaran event_types en PascalCase (`"EpisodioAbierto"`, `"PromptEnviado"`...) pero el tutor-service emite strings en snake_case (`"episodio_abierto"`, `"prompt_enviado"`...). Los contracts son "schemas fantasma" — nada los valida en runtime. Si alguien intentara validar un evento real contra el contract, fallaría el `Literal`.

**Fix:** elegir UNO de los dos formatos y alinear. Recomendación: **snake_case en todos lados**, porque es lo que ya corre en producción del piloto y cambiar strings en runtime obliga a migrar seeds, tests, dashboards, y potencialmente CTRs ya persistidos.

**Archivo afectado:** `packages/contracts/src/platform_contracts/ctr/events.py`

**Cambios:**
```python
# ANTES
class EpisodioAbierto(CTRBaseEvent):
    event_type: Literal["EpisodioAbierto"] = "EpisodioAbierto"

# DESPUÉS
class EpisodioAbierto(CTRBaseEvent):
    event_type: Literal["episodio_abierto"] = "episodio_abierto"
```

Aplicar a los 9 tipos del archivo: `EpisodioAbierto, EpisodioCerrado, EpisodioAbandonado, PromptEnviado, RespuestaRecibida, LecturaEnunciado, NotaPersonal, EdicionCodigo, TestsEjecutados`.

**Impacto:** ninguno en runtime (los contracts no se usan para validar hoy). Pero a futuro permite enchufar la validación Pydantic en el ctr-service antes del persist sin trabajo adicional.

**Test:** agregar `tests/unit/test_event_contracts_match_runtime.py` con un assert simple: la lista de `Literal` values en los contracts == la lista de strings literales en `tutor_core.py::_build_event(event_type=...)`. Un test de ~15 líneas bloquea regresiones futuras.

---

## F2 — Unificar nombres `RespuestaRecibida` ↔ `tutor_respondio`

**Problema:** la tesis (Tabla 7.1) y el contract Pydantic llaman `RespuestaRecibida`; el código real emite `tutor_respondio`. Son el mismo evento, nombres distintos.

**Fix:** elegir uno. Recomendación **`tutor_respondio`** (consistente con F1) — semánticamente más preciso además: "quién emitió" es más informativo que "dirección del flujo".

**Archivos afectados:**
- `packages/contracts/src/platform_contracts/ctr/events.py`:
  - Renombrar clase `RespuestaRecibida` → `TutorRespondio`.
  - Renombrar `RespuestaRecibidaPayload` → `TutorRespondioPayload`.
  - `event_type: Literal["tutor_respondio"] = "tutor_respondio"`.
- `packages/contracts/src/ctr/index.ts`: idem en TypeScript.

**Acción paralela en la tesis:** ver `03-cambios-tesis.md` → T2 (renombrar en Tabla 7.1 y en el cuerpo del texto).

---

## F3 — Unificar nombres `NotaPersonal` ↔ `anotacion_creada`

**Problema:** idéntico a F2. La tesis dice `NotaPersonal`; el código emite `anotacion_creada`. El contract Pydantic tiene `NotaPersonal`.

**Fix:** recomendación **`anotacion_creada`** en código y contracts; mantener "Anotación personal" como denominación de la tesis (la palabra "anotación" es más neutra que "nota" y transmite mejor la idea de marca reflexiva). En el contract:

```python
class AnotacionCreadaPayload(BaseModel):
    content: str
    words: int = Field(ge=0)

class AnotacionCreada(CTRBaseEvent):
    event_type: Literal["anotacion_creada"] = "anotacion_creada"
    payload: AnotacionCreadaPayload
```

**Acción paralela en la tesis:** ver `03-cambios-tesis.md` → T3.

---

## F4 — Unificar `TestsEjecutados` ↔ `codigo_ejecutado`

**Problema:** la tesis llama `TestsEjecutados` al evento de ejecución; el tutor real emite `codigo_ejecutado`. No son sinónimos: `TestsEjecutados` sugiere específicamente la ejecución de tests unitarios (con `passed/failed/total`); `codigo_ejecutado` es más amplio (ejecución genérica de Pyodide, con o sin tests). El `TestsEjecutadosPayload` del contract Pydantic nunca se emite.

**Fix recomendado:** el código es correcto — `codigo_ejecutado` captura mejor lo que efectivamente sucede en el IDE (el estudiante puede correr código suelto sin tests). Alinear la tesis al código, no al revés.

**Archivos afectados (código):**
- `packages/contracts/src/platform_contracts/ctr/events.py`:
  - Renombrar `TestsEjecutados` → `CodigoEjecutado`.
  - Renombrar `TestsEjecutadosPayload` → `CodigoEjecutadoPayload`.
  - Ampliar el payload para que `passed/failed/total` sean opcionales (pueden no aplicar si no hay tests):
    ```python
    class CodigoEjecutadoPayload(BaseModel):
        code: str
        stdout: str | None = None
        stderr: str | None = None
        duration_ms: int = Field(ge=0)
        runtime: str  # "pyodide", "python", etc.
        # Opcionales: solo presentes si se ejecutaron tests
        passed: int | None = Field(default=None, ge=0)
        failed: int | None = Field(default=None, ge=0)
        total: int | None = Field(default=None, ge=0)
        failed_test_names: list[str] = Field(default_factory=list)
    ```

**Acción paralela en la tesis:** ver `03-cambios-tesis.md` → T4.

---

## F5 — Agregar evento `lectura_enunciado` al frontend web-student

**Problema:** la tesis declara `LecturaEnunciado` como observable canónico de N1 (Sección 4.3, Tabla 4.1: "Tiempo de permanencia en la pestaña del enunciado"). El contract Pydantic lo declara. Pero **nadie lo emite**. Sin este evento, N1 Comprensión queda casi sin señal observable en el CTR.

**Fix:** instrumentar el panel de enunciado en `apps/web-student/src/pages/EpisodePage.tsx`. Agregar:
1. Un `useEffect` que mida tiempo de visibilidad del panel del enunciado usando `IntersectionObserver` + `visibilitychange` (tab focus).
2. Emitir `lectura_enunciado` con `{duration_seconds: <acumulado>}` cada 30s de tiempo real de lectura, O al cerrar el panel/episodio.
3. Un endpoint en `tutor-service` análogo a `record_anotacion_creada` — bautizarlo `record_lectura_enunciado` — que publique el evento como el estudiante autenticado (no como service account).

**Chico en tamaño:** ~40 líneas frontend + ~25 líneas backend + 3-4 tests. No toca hashing, no toca clasificador (por ahora — el CCD/CT no consumen `lectura_enunciado` todavía, pero ya queda registrado en el CTR para análisis posterior).

**No requiere migración:** es un evento append-only nuevo, no modifica eventos existentes.

---

## F6 — Agregar evento `codigo_ejecutado` con flag `origen`

**Problema:** la tesis en la Tabla 7.1 declara un tipo `CodigoAceptado` con payload `{fragmento_aceptado, origen (tutor/propio)}`. Este evento es **central para el clasificador**: permite distinguir "copiaste del tutor" de "escribiste vos". Sin él, la distinción delegación/apropiación depende enteramente de inferencia temporal (CCD), que es frágil.

**Fix mínimo:** agregar un campo opcional `origin: Literal["student_typed", "copied_from_tutor", "pasted_external"] | None = None` al payload de `edicion_codigo`. En el frontend, `CodeEditor.tsx` ya sabe si el cambio vino de:
- Typing directo en Monaco (`student_typed`).
- Click en un botón "Insertar código" si se agrega al chat del tutor (`copied_from_tutor`).
- Paste desde clipboard (`pasted_external`, detectable via event handler).

**Archivos afectados:**
- `packages/contracts/src/platform_contracts/ctr/events.py` → ampliar `EdicionCodigoPayload` con `origin`.
- `apps/web-student/src/components/CodeEditor.tsx` → agregar tracking del origen del cambio.
- `apps/tutor-service/src/tutor_service/services/tutor_core.py::record_edicion_codigo` → aceptar el parámetro `origin`.

**No rompe nada existente:** campo opcional, eventos viejos quedan con `origin=None`.

**Diferencia con `CodigoAceptado` de la tesis:** la tesis usa un evento separado; acá lo unificamos como metadato de `edicion_codigo`. Evita duplicar lógica de snapshot. Si querés preservar el nombre, ver T5 en los cambios de tesis.

---

## F7 — Documentar en `hashing.py` que `prompt_system_hash` entra vía payload

**Problema:** la Sección 7.3 de la tesis escribe literalmente `hash_evento_n = SHA-256(contenido_evento_n || hash_evento_n-1 || hash_prompt_sistema)`, sugiriendo una concatenación explícita de tres bloques. El código hace dos pasos: `self_hash = SHA-256(canonicalize(evento))` + `chain_hash = SHA-256(self_hash || prev_chain_hash)`. El `prompt_system_hash` entra como **campo del evento**, no como tercer bloque concatenado.

La propiedad criptográfica que la tesis quiere (si cambia el prompt, se detecta en la cadena) **sí se cumple**, pero la fórmula de la tesis no describe lo implementado.

**Fix de código:** agregar un docstring largo en `apps/ctr-service/src/ctr_service/services/hashing.py` explicando el mapping entre la fórmula de la tesis y la implementación real. Algo así:

```python
def compute_self_hash(event: dict[str, Any]) -> str:
    """SHA-256 del evento serializado canónicamente.

    Relación con la Sección 7.3 de la tesis
    ----------------------------------------
    La tesis enuncia:
        hash_evento_n = SHA-256(contenido_n || hash_evento_{n-1} || hash_prompt_sistema)

    La implementación separa en dos pasos equivalentes en propiedad:
        self_hash_n  = SHA-256(canonicalize(evento_n))
        chain_hash_n = SHA-256(self_hash_n || chain_hash_{n-1})

    El `prompt_system_hash` no se concatena como tercer bloque literal: entra como
    campo del `evento_n` (ver Event.prompt_system_hash en models/event.py).
    Como canonicalize() incluye todos los campos del evento salvo metadatos de cadena
    (self_hash, chain_hash, prev_chain_hash, persisted_at, id), el hash del prompt vigente
    queda incorporado a self_hash y por ende a chain_hash. La propiedad auditada por la
    tesis — "si cambia el prompt entre dos eventos, se detecta en la cadena" — se
    preserva bit a bit.

    También se incluye `classifier_config_hash` en cada evento (no mencionado en 7.3 pero
    requerido por el principio de reproducibilidad 7.1.4: permite reclasificar con otro
    profile y producir cadena distinguible).

    Excluye los campos self_hash, chain_hash, prev_chain_hash, persisted_at e id.
    """
```

**Acción paralela en la tesis:** ver `03-cambios-tesis.md` → T7 (reformular Sección 7.3 con la fórmula exacta implementada, o agregar nota al pie que remita a este docstring).

**Chico:** ~30 líneas de documentación, cero cambio semántico, sirve como pointer bidireccional entre tesis y código.

---

## F8 — Sacar del contract `socratic_compliance` y `violations` (o implementarlos)

**Problema:** el `RespuestaRecibidaPayload` del contract Pydantic declara:

```python
socratic_compliance: float = Field(ge=0.0, le=1.0)
violations: list[str] = Field(default_factory=list)
```

Pero **nadie los calcula ni los emite**. Son aspiraciones que nunca se cablearon. Si alguien validara un evento real contra el schema, fallaría porque el campo es obligatorio (sin `default`) y el tutor nunca lo pone.

**Fix minimo:** volverlos opcionales hasta que se implemente el postprocesamiento real:
```python
class TutorRespondioPayload(BaseModel):  # renombrado per F2
    content: str
    model_used: str
    chunks_used_hash: str | None = None
    # TODO: implementar en F8/piloto. Por ahora, siempre None.
    socratic_compliance: float | None = Field(default=None, ge=0.0, le=1.0)
    violations: list[str] = Field(default_factory=list)
```

**Acción paralela:** el postprocesamiento real (detección de jailbreak, cálculo de compliance) es un cambio grande — ver `02-cambios-codigo-grandes.md` → G3.

---

## F9 — Documentar en el prompt v1.0.0 el mapping a GP1–GP5

**Problema:** la tesis formaliza 5 guardarraíles pedagógicos (GP1–GP5) + 5 de contenido (GC1–GC5) en el Capítulo 8. El prompt real en `ai-native-prompts/prompts/tutor/v1.0.0/system.md` tiene 5 principios numerados + una sección "Lo que NO hace el tutor" con 4 puntos. **No hay mapping explícito entre ambos conjuntos**. Un lector que venga de la tesis al prompt no puede verificar cuál principio implementa GP1.

**Fix:** agregar al final del `system.md` una sección invisible al modelo pero auditable por humanos — sea como bloque de comentario Markdown (`<!-- ... -->`) o en un archivo separado `v1.0.0/mapping-gp-gc.md`. Formato:

```markdown
<!--
Mapping a los guardarraíles formales de la tesis (Capítulo 8):

GP1 (no entregar solución) ← Principio 1 + Lo-que-NO-hace punto 1
GP2 (preguntas con preguntas) ← Principio 2
GP3 (descomponer ante incomprensión) ← Principio 3 (dejar equivocarse)
GP4 (estimular verificación ejecutiva) ← Principio 3 (guialo a descubrir el bug)
GP5 (reconocer alcance excedido) ← SIN COBERTURA EXPLÍCITA EN v1.0.0 — agregar en v1.1.0

GC1 (no info falsa) ← SIN COBERTURA EXPLÍCITA — agregar
GC2 (no preferencias comerciales) ← SIN COBERTURA EXPLÍCITA — agregar
GC3 (no contenido ofensivo) ← delegado a la alineación base del LLM
GC4 (privacidad) ← SIN COBERTURA EXPLÍCITA — agregar
GC5 (redirigir temas sensibles) ← SIN COBERTURA EXPLÍCITA — agregar
-->
```

**Chico:** ~25 líneas de comentario. **Hallazgo honesto:** el prompt actual solo cubre 4 de los 10 guardarraíles formales de la tesis. Esto NO es necesariamente un bug si la tesis lo reconoce (el "Cap 8 es aspiracional, v1.0.0 es intencionalmente minimalista"), pero es un fact que merece estar documentado en ambos lados.

**Acción paralela en la tesis:** ver `03-cambios-tesis.md` → T8 (agregar a la Sección 8.2 que v1.0.0 cubre explícitamente solo GP1–GP4; los demás están en v1.1.0 pendiente, o delegados a alineación base del LLM).

---

## F10 — Fijar el string literal de comisión demo en un solo lugar

**Problema:** `DEMO_COMISION_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"` está hardcoded en `apps/web-student/src/pages/EpisodePage.tsx` línea 37. Otros lugares (seeds, tests) también lo usan. Un cambio de UUID demo obliga a tocar N archivos.

**Fix:** mover a `packages/contracts/src/demo/constants.ts` (y variante Python en `packages/contracts/src/platform_contracts/demo/constants.py`). Importar desde ahí.

**Tamaño:** ~10 LOC, un `git grep` + replace.

---

## F11 — Reparar el typo en `.env.example`: `GOVERNANCE_REPO_PATH` → `PROMPTS_REPO_PATH`

**Problema:** documentado en `CLAUDE.md` líneas 169–175 y líneas 239–243 como "deuda del template". El `.env.example` declara `GOVERNANCE_REPO_PATH` pero el código lee `PROMPTS_REPO_PATH`. Consecuencia: `make init` limpio en Windows/Linux deja el governance-service sin saber dónde buscar prompts, el tutor-service no puede abrir episodios, web-student falla con un 500 silencioso.

**Fix:** corregir el `.env.example`. Una línea.

**Tamaño:** 1 LOC.

---

## F12 — Pinear versiones de imágenes Docker en `docker-compose.dev.yml`

**Problema:** documentado en `CLAUDE.md` línea 181 como gap conocido. `otel/opentelemetry-collector-contrib` y `grafana/loki` están en `:latest`. Un breaking change upstream rompe `make dev-bootstrap`.

**Fix:** pinearlas en las versiones verificadas (`0.150.1` / `3.7.1` según el propio CLAUDE.md).

**Tamaño:** 2 LOC.

---

## F13 — `MarkdownRenderer.tsx` duplicado entre `web-teacher` y `web-student`

**Problema:** documentado en `CLAUDE.md` línea 192. El componente está copipasteado en dos apps en lugar de vivir en `packages/ui`.

**Fix:** mover a `packages/ui/src/components/MarkdownRenderer.tsx` (ya es el home natural de componentes React compartidos). Borrar los duplicados, actualizar imports.

**Tamaño:** ~100 LOC movidos, sin cambio semántico. Cuidado: verificar que los dos duplicados tengan exactamente el mismo contenido antes de unificar (si hay divergencia, la diferencia se va a perder si se elige uno).

---

## Resumen

| ID | Descripción | Tamaño | Riesgo | Precondición |
|---|---|---|---|---|
| F1 | Unificar PascalCase vs snake_case en contracts | ~20 LOC | Bajo | — |
| F2 | `RespuestaRecibida` → `TutorRespondio` | ~15 LOC | Bajo | F1 |
| F3 | `NotaPersonal` → `AnotacionCreada` | ~15 LOC | Bajo | F1 |
| F4 | `TestsEjecutados` → `CodigoEjecutado` + payload flexible | ~25 LOC | Bajo | F1 |
| F5 | Emitir `lectura_enunciado` desde web-student | ~65 LOC + tests | Bajo | — |
| F6 | Agregar `origin` opcional a `edicion_codigo` | ~40 LOC | Bajo | — |
| F7 | Docstring en `hashing.py` explicando mapping a tesis 7.3 | ~30 LOC | Nulo | — |
| F8 | Hacer opcionales `socratic_compliance`/`violations` en contract | ~5 LOC | Nulo | — |
| F9 | Comentario de mapping GP/GC en `system.md` | ~25 LOC | Nulo | — |
| F10 | Mover `DEMO_COMISION_ID` a contracts | ~10 LOC | Nulo | — |
| F11 | Corregir typo `GOVERNANCE_REPO_PATH` en `.env.example` | 1 LOC | Nulo | — |
| F12 | Pinear imágenes Docker en dev compose | 2 LOC | Nulo | — |
| F13 | Des-duplicar `MarkdownRenderer.tsx` | ~100 LOC movidos | Nulo | — |

**Orden sugerido de ejecución:** F11 → F12 (unblockers de onboarding) → F1 → F2 → F3 → F4 → F8 (armonización de contracts, todos juntos en un PR) → F7 → F9 → F10 (doc y dedup) → F5 → F6 → F13 (features chicas).

Todos se pueden hacer en un único sprint de una semana sin coordinación con nadie. Ninguno rompe reproducibilidad bit-a-bit de CTRs existentes (F1–F4 tocan nombres de clases y payloads nuevos, no valores persistidos). F5 y F6 agregan eventos nuevos, son backward-compatible.

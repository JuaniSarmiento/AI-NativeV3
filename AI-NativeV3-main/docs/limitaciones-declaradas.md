# Limitaciones declaradas del sistema AI-Native N4

> **Documento canónico** de las fronteras del sistema y su agenda de continuidad.
> Citable desde el paper, la tesis (Sección 13), el README y `CLAUDE.md`.
> Última actualización: 2026-05-09 (post cierre de Mejora 5 del plan, ADR-043).

## Encuadre

La explicitación de las limitaciones del sistema protege la interpretación del trabajo contra atribuciones que el código no soporta y declara la agenda de continuidad del proyecto. La práctica de declaración honesta de limitaciones es coherente con las recomendaciones contemporáneas sobre integridad académica en presencia de IA generativa [10], que sugieren que la transparencia sobre el alcance del sistema es preferible a la pretensión de completitud.

El documento enumera cinco limitaciones explícitas y, para cada una, declara el estado vigente en código, el ADR que la respalda, y la condición cuantificable de revisita. Cuatro de las cinco siguen vigentes; la quinta fue parcialmente cerrada por ADR-043 (2026-05-09) y se documenta su estado actualizado.

## Las cinco limitaciones

### 1. Detección forense de IA externa al perímetro instrumentado

El sistema **no realiza** detección forense de uso de IA externa al perímetro instrumentado. Si el estudiante utiliza un asistente conversacional general en otra ventana del navegador o un copiloto integrado en su editor local, el CTR no captura esa interacción. La frontera del sistema es explícita: opera sobre el uso de la herramienta dentro del perímetro instrumentado, y la cobertura de los usos fuera del perímetro requiere instrumentos complementarios.

- **Compensación parcial**: instrumento ex-post sobre repositorios sin CTR (paper CACIC 2026, vive en proyecto separado del contexto TUPAD-UTN).
- **ADR de respaldo**: limitación estructural sin ADR específico — emerge de la decisión arquitectónica fundacional del CTR como instrumento dentro de perímetro.
- **Plan post-piloto-1**: agenda de revisita en piloto-2.

### 2. Alertas predictivas con baseline individual del estudiante

El sistema **no produce** alertas predictivas con baseline individual del estudiante; las alertas vigentes son contra cohorte mediante z-score y son explícitamente pedagógicas, no clínicas. La migración hacia alertas predictivas individuales requiere disponibilidad de un dataset etiquetado con al menos doscientos estudiantes con trayectos de al menos diez episodios cerrados completos, treinta intervenciones docentes etiquetadas, y validación cruzada con AUC mínimo de 0,75 sobre split por estudiante.

- **Vigente**: tres alertas estadísticas clásicas (`regresion_vs_cohorte`, `bottom_quartile`, `slope_negativo_significativo`) en `packages/platform-ops/src/platform_ops/cii_alerts.py`. Privacy gate `MIN_STUDENTS_FOR_QUARTILES = 5` (k-anonymity).
- **ADR de respaldo**: ADR-032 (alertas predictivas con ML sobre baseline individual, diferida a piloto-2).
- **Regla de negocio**: RN-131.
- **Plan post-piloto-1**: Mejora 2.

### 3. Clasificación semántica del contenido textual de las anotaciones

> **Nota de estado (2026-05-09)**: la sub-mejora **G8b léxica** del plan post-piloto-1 quedó **parcialmente cerrada** por el ADR-045 — el esqueleto técnico del override por contenido textual vive en código pero la activación está bloqueada por feature flag OFF hasta que la validación intercoder con docentes esté disponible. La sub-mejora **G8c semántica** sigue siendo Eje B post-defensa sin esqueleto, fuera del scope de ADR-045 porque requiere arquitectura nueva (endpoint en `ai-gateway`, embeddings, integración con BYOK budget). El texto siguiente refleja el estado real post-ADR-045.

El sistema **tiene implementado el esqueleto técnico** del override léxico de `anotacion_creada` sobre contenido textual (sub-componente G8b del plan), pero **NO lo ejecuta en runtime**: ocho patrones regex distribuidos en dos categorías N1 (lectura inicial: "estoy leyendo", "el enunciado pide", "no entiendo todavía", "me piden") y N4 (apropiación post-tutor: "ahora entiendo", "tras la respuesta", "siguiendo el consejo", "el tutor me dijo") están listos en `apps/classifier-service/src/classifier_service/services/event_labeler_lexical.py` con tests deterministas y golden hash anti-regresión. La activación está bloqueada por la feature flag `lexical_anotacion_override_enabled = False` en el config del classifier-service. Mientras esté OFF, `event_labeler.label_event()` produce exactamente las mismas etiquetas que la heurística temporal v1.1.0 (ADR-023) — reproducibilidad bit-a-bit del `classifier_config_hash` sobre todas las classifications históricas del piloto-1 intacta.

La sub-mejora **G8c (clasificación semántica vía embeddings)** sigue siendo agenda Eje B post-defensa sin esqueleto técnico. Su implementación requiere endpoint nuevo en `ai-gateway`, integración con embeddings, decisiones de modelo y budget tracking — fuera del patrón esqueleto-OFF que asume "función pura + flag flip + golden hash". Documentada como tal en ADR-023 sección "G8c — semántico vía embeddings" y reafirmada en ADR-045.

La activación del flag léxico requiere las condiciones aplicables del ADR-023 más decisiones nuevas del ADR-045: validación kappa específica con docentes sobre un mínimo de cincuenta anotaciones reales del piloto etiquetadas por dos etiquetadores independientes con target κ ≥ 0,6 sobre las dos categorías N1 y N4, acuerdo académico sobre el corpus final post-calibración, decisión sobre la precedencia léxico vs temporal (la del esqueleto v1.0.0 es léxico > temporal), y bump del `LABELER_VERSION` a `"2.0.0"` con re-clasificación de classifications históricas del piloto.

- **Vigente en runtime**: heurística temporal posicional sobre ventanas 120s/60s en `apps/classifier-service/src/classifier_service/services/event_labeler.py` (`LABELER_VERSION = "1.2.0"`). Sensibilidad documentada en `docs/adr/023-sensitivity-analysis.md`. El override léxico existe pero NO se ejecuta.
- **Esqueleto disponible (flag OFF)**: `apps/classifier-service/src/classifier_service/services/event_labeler_lexical.py` con función pura `lexical_label(content)`, hash determinista `LEXICAL_CORPUS_HASH`, versión `LEXICAL_CORPUS_VERSION = "1.0.0"`. Tests deterministas en `apps/classifier-service/tests/unit/test_event_labeler_lexical.py` con golden hash anti-regresión.
- **ADR de respaldo**: ADR-023 (decisión vigente sobre temporal v1.1.0 + agenda G8b/G8c) + ADR-045 (cierre parcial técnico de G8b 2026-05-09 — esqueleto listo, activación bloqueada por flag).
- **Plan post-piloto-1**: Mejora 3 — **componente técnico G8b cerrado, componente humano G8b pendiente, componente G8c sin esqueleto**.

### 4. Postprocesamiento de respuestas del tutor (cumplimiento socrático)

> **Nota de estado (2026-05-09)**: la Mejora 4 del plan post-piloto-1 quedó **parcialmente cerrada** por el ADR-044 — el esqueleto técnico de la Fase B vive en código pero la activación está bloqueada por feature flag OFF hasta que la validación intercoder con docentes esté disponible. La cláusula del ADR-027 (`socratic_compliance` permanece `None` en runtime) se respeta literalmente. El texto siguiente refleja el estado real post-ADR-044.

El sistema **tiene implementado el esqueleto técnico** del postprocesamiento de respuestas del tutor mediante cálculo de scores de cumplimiento del modo socrático, pero **NO lo ejecuta en runtime**: el detector regex de tres categorías de violación (bloque de código completo, ausencia de pregunta, respuesta directa imperativa), el cálculo determinista del score `socratic_compliance` en `[0, 1]`, y el hash canónico del corpus están listos en `apps/tutor-service/src/tutor_service/services/postprocess_socratic.py` con tests deterministas. La activación está bloqueada por la feature flag `socratic_compliance_enabled = False` en el config del tutor-service. Mientras esté OFF, los campos `TutorRespondioPayload.socratic_compliance` y `violations` siguen persistiendo como `None` y lista vacía en cada evento del CTR, preservando literalmente la garantía documentada en el ADR-027 de que el campo queda como `None` hasta que la calibración con docentes valide el cálculo.

La activación del flag requiere las tres condiciones acumuladas declaradas en el ADR-027 y reafirmadas en el ADR-044: validación kappa específica con docentes sobre un mínimo de cincuenta respuestas etiquetadas por dos etiquetadores independientes con target κ ≥ 0,6, acuerdo académico sobre la fórmula final del score que puede o no requerir bump del `SOCRATIC_CORPUS_VERSION` post-calibración, y consenso de no afectar el árbol de clasificación pre-validación. La justificación operativa de mantener el flag OFF es la misma que el ADR-027 declaró en su momento: un score mal calculado es peor pedagógicamente que ningún score.

- **Vigente en runtime**: Fase A de guardrails (preprocesamiento de prompts por regex con cinco categorías + reinforcement system message si severidad ≥ 3 + categoría `overuse` por sliding window cross-prompt) en `apps/tutor-service/src/tutor_service/services/guardrails.py`. El postprocesador de Fase B existe pero NO se ejecuta.
- **Esqueleto disponible (flag OFF)**: `apps/tutor-service/src/tutor_service/services/postprocess_socratic.py` con función pura `postprocess(response_content)`, dataclass `Violation`, dataclass `PostprocessResult`, hash determinista `SOCRATIC_CORPUS_HASH`, versión `SOCRATIC_CORPUS_VERSION = "1.0.0"`. Tests deterministas en `apps/tutor-service/tests/unit/test_postprocess_socratic.py` con golden hash anti-regresión.
- **ADR de respaldo**: ADR-027 (decisión doctoral de DIFERIR la activación, vigente) + ADR-044 (cierre parcial técnico 2026-05-09 — esqueleto listo, activación bloqueada por flag).
- **Regla de negocio**: RN-129 (formato del corpus hash) cubre la Fase A y se extiende al postprocess cuando el flag se prenda.
- **Plan post-piloto-1**: Mejora 4 — **componente técnico cerrado, componente humano pendiente**.

### 5. Detección de sobreuso intencional cross-prompt

> **Nota de estado (2026-05-09)**: la formulación previa de esta limitación —"el sistema no detecta sobreuso intencional del tutor mediante ventana temporal cross-prompt"— quedó **parcialmente superseded** por ADR-043, implementado en la misma sesión 2026-05-09 como cierre de la Mejora 5 del plan post-piloto-1. El texto siguiente refleja el estado real post-ADR-043.

El sistema **detecta sobreuso intencional cross-prompt** como categoría informativa del régimen de guardarraíles, mediante un mecanismo de sliding window por episodio en Redis con dos heurísticas complementarias. La detección es informativa (severidad ordinal 1) y se materializa como evento side-channel `intento_adverso_detectado` con `category="overuse"`, sin bloquear el turno del estudiante ni modificar el prompt que llega al modelo.

Las dos heurísticas operan sobre los siguientes umbrales:

- **Burst**: cantidad de `prompt_enviado` dentro de los últimos 300 segundos sobre el mismo episodio igual o superior a 6 (ráfagas compulsivas).
- **Proportion**: fracción `prompts / total_eventos_cognitivos` dentro de los últimos 600 segundos igual o superior a 0,7, con piso anti-falso-positivo de 5 eventos totales (inicios de episodio donde el estudiante prompea sin leer ni pensar).

Lo que sigue diferido como agenda piloto-2 es la **integración predictiva accionable** del sobreuso detectado: alertas docente sobre patrones de sobreuso a nivel cohorte y intervención pedagógica calibrada sobre el estudiante con sobreuso sostenido. Esto requiere validación intercoder específica con docentes sobre la utilidad pedagógica de la señal.

- **Vigente**: `OveruseDetector` en `apps/tutor-service/src/tutor_service/services/guardrails.py`, hooks en `tutor_core.py::interact()`. `GUARDRAILS_CORPUS_VERSION = "1.2.0"` con thresholds incluidos en el JSON canónico del `guardrails_corpus_hash`.
- **ADR de respaldo**: ADR-043 (cierra la Mejora 5; supersede parcial de ADR-019 que declaraba `overuse` como agenda futura). El ADR-019 sigue vigente sobre las cinco categorías regex de la Fase A.
- **Regla de negocio**: RN-129.

## Plan post-piloto-1 (síntesis)

El plan original (`mejoras.docx`) propone una mejora por cada limitación, ordenadas de menor a mayor complejidad técnica:

| Mejora | Limitación | Estado | ADR |
|---|---|---|---|
| 1 | Detección forense IA externa | Pendiente, agenda piloto-2 | — |
| 2 | Alertas baseline individual | Pendiente | ADR-032 |
| 3 | Clasificación semántica anotaciones | **G8b esqueleto cerrado 2026-05-09 (flag OFF)**, activación G8b pendiente; G8c (semántico) Eje B sin esqueleto | ADR-023 + ADR-045 |
| 4 | Postprocesamiento socratic_compliance | **Esqueleto cerrado 2026-05-09 (flag OFF)**, activación pendiente de validación intercoder | ADR-027 + ADR-044 |
| 5 | Sobreuso cross-prompt | **Cerrada 2026-05-09** | ADR-043 |

La Mejora 5 se ejecutó primero por ser self-contained en `guardrails.py` y no requerir validación intercoder con docentes — sirvió como calentamiento del patrón antes de las Mejoras 4 y 3 que comparten dominio pero son más grandes.

## Referencias verificables

| Lim. | Código vigente | ADR | RN | Otros artefactos |
|---|---|---|---|---|
| 1 | (compensación externa: paper CACIC) | — | — | Proyecto separado del repo |
| 2 | `packages/platform-ops/src/platform_ops/cii_alerts.py` | ADR-032 | RN-131 | `analytics-service` GET `/student/{id}/alerts` |
| 3 | `apps/classifier-service/src/classifier_service/services/event_labeler.py` (temporal v1.1.0 vigente) + `event_labeler_lexical.py` (esqueleto G8b, flag OFF) | ADR-023 (vigente), ADR-045 (cierre técnico parcial G8b) | — | `docs/adr/023-sensitivity-analysis.md`, `scripts/g8a-sensitivity-analysis.py`, `apps/classifier-service/tests/unit/test_event_labeler_lexical.py` |
| 4 | `apps/tutor-service/src/tutor_service/services/guardrails.py` (Fase A vigente) + `postprocess_socratic.py` (esqueleto Fase B, flag OFF) | ADR-027 (diferir), ADR-044 (cierre técnico parcial) | RN-129 | `TutorRespondioPayload.socratic_compliance`/`violations` (`None`/`[]` mientras flag OFF); `apps/tutor-service/tests/unit/test_postprocess_socratic.py` |
| 5 | `apps/tutor-service/src/tutor_service/services/guardrails.py` (`OveruseDetector`), `tutor_core.py::interact()` | ADR-043 (cierra), ADR-019 (super. parcial) | RN-129 | `apps/tutor-service/tests/unit/test_overuse_detector.py` |

## Versionado del documento

| Fecha | Cambio |
|---|---|
| 2026-05-09 | Versión inicial. Refleja cierre de Mejora 5 (ADR-043). Limitación 5 reformulada de "no detecta" a "detecta informativamente; integración predictiva accionable diferida". Las otras cuatro limitaciones permanecen vigentes con sus criterios cuantificables de revisita. |
| 2026-05-09 (sesión vespertina) | Cierre parcial de Mejora 4 (ADR-044). Limitación 4 reformulada de "no realiza" a "tiene esqueleto técnico listo, activación bloqueada por feature flag hasta validación intercoder". Componente humano (50+ respuestas etiquetadas, κ ≥ 0,6) sigue siendo el gate operativo para flippear `socratic_compliance_enabled = True`. Las tres condiciones del ADR-027 se preservan literalmente. |
| 2026-05-09 (sesión vespertina, continuación) | Cierre parcial de Mejora 3 sub-componente G8b (ADR-045). Limitación 3 reformulada distinguiendo G8b (léxico, esqueleto cerrado, flag OFF) de G8c (semántico, sin esqueleto, Eje B). Componente humano G8b (50+ anotaciones reales etiquetadas, κ ≥ 0,6 sobre N1/N4) sigue siendo el gate para flippear `lexical_anotacion_override_enabled = True`. Activación obliga a bumpear `LABELER_VERSION` a `"2.0.0"` y re-clasificar classifications históricas del piloto. |
| 2026-05-10 | **ADR-046: kappa intercoder bumpeado de κ ≥ 0,6 a κ ≥ 0,70** (alineación con paper Cortez & Garis `ppcona.docx` Sec 7) + **adopción de protocolo dual**: Protocolo A (200 eventos estratificados, 50 por nivel cognitivo N1-N4, valida el etiquetador) + Protocolo B (50 episodios distribuidos en las 3 categorías de apropiación, valida el árbol de decisión). Supersede parcial sobre ADRs 027 (Validación κ), 032 (Ground truth docente), 044 (Validación κ con docentes), 045 (Validación κ con docentes) en lo concerniente al umbral y al protocolo muestral. Las demás condiciones de cada ADR se preservan literalmente. Justificación metodológica: 0,70 es el umbral estándar de la literatura educativa cualitativa rigurosa (Mislevy/Steinberg/Almond 2003, AERA/APA/NCME 2014) y es el umbral con que el paper dialoga públicamente; bajar el código mantiene incoherencia paper↔implementación que la defensa doctoral expondría. Costo operacional: 2 docentes × (200 + 50) = 500 actos de etiquetado totales + ~20 episodios de calibración previa. |

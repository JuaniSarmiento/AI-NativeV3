# Capabilities cerradas y en curso

## Capabilities cerradas en epic `ai-native-completion-and-byok`

5 capabilities backend con ADRs 033-040 (los detalles operativos viven en los invariantes y constantes de `CLAUDE.md` — las constantes hash, `LABELER_VERSION=1.2.0`, `BYOK_MASTER_KEY`, `_EXCLUDED_FROM_FEATURES` ya están documentadas):

- **Reflexión metacognitiva post-cierre** (ADR-035, RN-133): `POST /episodes/{id}/reflection` emite `reflexion_completada` excluido del classifier. Export académico redacta textuales por default; flag `--include-reflections` con audit log.
- **Sandbox client-side + test_cases** (ADR-033, ADR-034, RN-134): JSONB en `tareas_practicas[_templates]`, filter por rol en GET, `POST /run-tests` solo conteos (no código). Pyodide diferido al piloto-2.
- **TP-gen IA** (ADR-036): `POST /tareas-practicas/generate` en academic-service → governance (prompt `tp_generator/v1.0.0`) → ai-gateway con `materia_id` para BYOK. Audit log structlog `tp_generated_by_ai`. Schema `TareaPracticaCreate.created_via_ai: bool`. Wizard UI deferido.
- **Governance UI admin** (ADR-037): `/cohort/{id}/adversarial-events` + `/governance/events` cross-cohort en analytics-service. `GovernanceEventsPage.tsx` en web-admin con cascade filters + CSV cp1252-safe.
- **BYOK multi-provider** (ADR-038/039/040, RN-132): AES-256-GCM con `BYOK_MASTER_KEY`, resolver jerárquico **materia → tenant → env_fallback**, 5 endpoints CRUD. Casbin `byok_key:CRUD` para superadmin/docente_admin. `materia_id` cacheado en `SessionState` (no re-resuelve por turno). Métricas OTLP `byok_key_resolution_total{resolved_scope}` (SLO p99 < 50ms). Mistral adapter implementado (Gemini diferido, UI BYOK page diferida, cache Redis diferido).

**Anti-regresión crítica del epic**: el classifier consumía TODOS los eventos del CTR sin filtro. `reflexion_completada` post-cierre cambiaba `ct_summary` (0.54 → 0.56). Fix en `_EXCLUDED_FROM_FEATURES` + test `test_reflexion_completada_no_afecta_clasificacion_ni_features` en `apps/classifier-service/tests/unit/test_pipeline_reproducibility.py`. **NO romper este test** al agregar event types nuevos.

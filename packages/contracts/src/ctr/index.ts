/**
 * Schemas de eventos del CTR — lado TypeScript.
 *
 * Los contratos deben mantenerse alineados con los de Python.
 * Cambios coordinados entre ambas fuentes.
 */
import { z } from "zod"

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const Uuid = z.string().uuid()

export const PromptKind = z.enum([
  "solicitud_directa",
  "comparativa",
  "epistemologica",
  "validacion",
  "aclaracion_enunciado",
])
export type PromptKind = z.infer<typeof PromptKind>

// Base de todo evento del CTR
const CTRBase = z.object({
  event_uuid: Uuid,
  episode_id: Uuid,
  tenant_id: Uuid,
  seq: z.number().int().nonnegative(),
  ts: z.string().datetime(),
  prompt_system_hash: Sha256,
  prompt_system_version: z.string(),
  classifier_config_hash: Sha256,
})

export const EpisodioAbierto = CTRBase.extend({
  event_type: z.literal("EpisodioAbierto"),
  payload: z.object({
    student_pseudonym: Uuid,
    problema_id: Uuid,
    comision_id: Uuid,
    curso_config_hash: Sha256,
  }),
})
export type EpisodioAbierto = z.infer<typeof EpisodioAbierto>

export const EpisodioCerrado = CTRBase.extend({
  event_type: z.literal("EpisodioCerrado"),
  payload: z.object({
    final_chain_hash: Sha256,
    total_events: z.number().int().positive(),
    duration_seconds: z.number().nonnegative(),
  }),
})
export type EpisodioCerrado = z.infer<typeof EpisodioCerrado>

export const PromptEnviado = CTRBase.extend({
  event_type: z.literal("PromptEnviado"),
  payload: z.object({
    content: z.string(),
    prompt_kind: PromptKind,
    chunks_used_hash: Sha256.nullable(),
  }),
})
export type PromptEnviado = z.infer<typeof PromptEnviado>

export const RespuestaRecibida = CTRBase.extend({
  event_type: z.literal("RespuestaRecibida"),
  payload: z.object({
    content: z.string(),
    model_used: z.string(),
    socratic_compliance: z.number().min(0).max(1),
    violations: z.array(z.string()),
  }),
})
export type RespuestaRecibida = z.infer<typeof RespuestaRecibida>

export const EdicionCodigo = CTRBase.extend({
  event_type: z.literal("EdicionCodigo"),
  payload: z.object({
    snapshot: z.string(),
    diff_chars: z.number().int().nonnegative(),
    language: z.string(),
  }),
})
export type EdicionCodigo = z.infer<typeof EdicionCodigo>

export const TestsEjecutados = CTRBase.extend({
  event_type: z.literal("TestsEjecutados"),
  payload: z.object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    stdout: z.string().nullable(),
    failed_test_names: z.array(z.string()),
  }),
})
export type TestsEjecutados = z.infer<typeof TestsEjecutados>

export const LecturaEnunciado = CTRBase.extend({
  event_type: z.literal("LecturaEnunciado"),
  payload: z.object({
    duration_seconds: z.number().nonnegative(),
  }),
})
export type LecturaEnunciado = z.infer<typeof LecturaEnunciado>

export const NotaPersonal = CTRBase.extend({
  event_type: z.literal("NotaPersonal"),
  payload: z.object({
    content: z.string(),
    words: z.number().int().nonnegative(),
  }),
})
export type NotaPersonal = z.infer<typeof NotaPersonal>

// Union de todos los eventos CTR
export const CTREvent = z.discriminatedUnion("event_type", [
  EpisodioAbierto,
  EpisodioCerrado,
  PromptEnviado,
  RespuestaRecibida,
  EdicionCodigo,
  TestsEjecutados,
  LecturaEnunciado,
  NotaPersonal,
])
export type CTREvent = z.infer<typeof CTREvent>

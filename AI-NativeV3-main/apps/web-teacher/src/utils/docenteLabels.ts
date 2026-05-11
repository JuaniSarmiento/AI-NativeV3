export const APPROPRIATION_DOCENTE: Record<string, string> = {
  delegacion_pasiva: "Depende de la IA",
  apropiacion_superficial: "Uso superficial",
  apropiacion_reflexiva: "Trabaja de forma autonoma",
}

export const APPROPRIATION_INVESTIGADOR: Record<string, string> = {
  delegacion_pasiva: "Delegacion pasiva",
  apropiacion_superficial: "Apropiacion superficial",
  apropiacion_reflexiva: "Apropiacion reflexiva",
}

export const PROGRESSION_DOCENTE: Record<string, string> = {
  mejorando: "Mejorando",
  estable: "Estable",
  empeorando: "En riesgo",
  insuficiente: "Sin datos suficientes",
}

export const NLEVEL_DOCENTE: Record<string, string> = {
  N1: "Leyendo el problema",
  N2: "Tomando notas y planificando",
  N3: "Escribiendo y probando codigo",
  N4: "Usando el tutor IA",
  meta: "Abriendo/cerrando la sesion",
}

export const NLEVEL_INVESTIGADOR: Record<string, string> = {
  N1: "N1 - Comprension/planificacion",
  N2: "N2 - Elaboracion estrategica",
  N3: "N3 - Validacion",
  N4: "N4 - Interaccion con IA",
  meta: "meta - Apertura/cierre",
}

export const ADVERSARIAL_DOCENTE: Record<string, string> = {
  jailbreak_indirect: "Intento de manipulacion indirecta",
  jailbreak_substitution: "Intento de manipulacion por sustitucion",
  jailbreak_fiction: "Intento de manipulacion por ficcion",
  persuasion_urgency: "Intento de persuasion por urgencia",
  prompt_injection: "Intento de inyeccion de instrucciones",
}

export const SEVERITY_DOCENTE: Record<string, string> = {
  "1": "Muy bajo",
  "2": "Bajo",
  "3": "Moderado",
  "4": "Alto",
  "5": "Critico",
}

export function slopeToDocente(slope: number | null): {
  label: string
  emoji: string
  color: string
  action: string | null
} {
  if (slope === null) {
    return {
      label: "Sin datos suficientes",
      emoji: "?",
      color: "text-muted",
      action: "Necesita completar mas trabajos para tener una tendencia.",
    }
  }
  if (slope > 0.1) {
    return {
      label: "Mejorando",
      emoji: "↑",
      color: "text-[var(--color-success)]",
      action: null,
    }
  }
  if (slope < -0.1) {
    return {
      label: "En riesgo",
      emoji: "↓",
      color: "text-[var(--color-danger)]",
      action: "Considerá revisar sus ultimos trabajos y hablar con el/ella.",
    }
  }
  return {
    label: "Estable",
    emoji: "→",
    color: "text-muted",
    action: null,
  }
}

export function kappaToDocente(kappa: number): {
  label: string
  description: string
  color: string
} {
  if (kappa >= 0.81) {
    return {
      label: "Excelente acuerdo",
      description:
        "Tu criterio y el del clasificador automatico coinciden casi siempre. La evaluacion es muy consistente.",
      color: "text-green-700 bg-green-50",
    }
  }
  if (kappa >= 0.61) {
    return {
      label: "Buen acuerdo",
      description:
        "Tu criterio y el del clasificador coinciden en la mayoria de los casos. La evaluacion es confiable.",
      color: "text-green-700 bg-green-50",
    }
  }
  if (kappa >= 0.41) {
    return {
      label: "Acuerdo moderado",
      description:
        "Hay diferencias entre tu criterio y el del clasificador. Conviene revisar los casos donde no coinciden.",
      color: "text-warning/85 bg-warning-soft",
    }
  }
  return {
    label: "Acuerdo bajo",
    description:
      "Tu criterio y el del clasificador difieren bastante. Revisá los criterios de evaluacion y re-calibrá.",
    color: "text-danger bg-danger-soft",
  }
}

export function studentShortLabel(pseudonym: string): string {
  return `Est. ${pseudonym.slice(0, 6)}`
}

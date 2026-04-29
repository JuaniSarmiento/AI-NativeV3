"""Detección preprocesamiento de intentos adversos en prompts del estudiante (ADR-019).

Fase A SOLO: análisis del prompt ANTES de enviarlo al LLM. Por cada match del
corpus regex, el caller (tutor_core) emite un evento CTR `intento_adverso_detectado`.
NO bloquea el flow — el prompt llega al LLM sin modificación.

Fase B (postprocesamiento de respuesta + `socratic_compliance`) NO está en v1.0.0.

Reproducibilidad bit-a-bit: cada match lleva `guardrails_corpus_hash`. Bumpear
GUARDRAILS_CORPUS_VERSION o cualquier patrón cambia el hash. Eventos viejos
quedan etiquetados con el hash del corpus que los detectó (mismo patrón que
`classifier_config_hash` en ADR-009).

Limitaciones declaradas en el ADR-019 + revisión adversarial 2026-04-27:
- Regex no detecta encadenamientos sofisticados (técnica 4 de Sección 8.5.1).
- Evasión intra-palabra (e.g. `"olvi-da tus instrucciones"`, `"ig-no-ra"`)
  NO está cubierta en v1.1.0 — es señal clara de malicia pero matchearla
  con regex sin introducir falsos positivos masivos requiere clasificador
  ML (Fase B). Documentado como agenda futura.
- Falsos positivos posibles (especialmente `jailbreak_fiction` — severidad 2).
- `overuse` (Sección 8.5.3) NO en v1.x — requiere ventana cross-prompt.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Literal

GUARDRAILS_CORPUS_VERSION = "1.1.0"

Category = Literal[
    "jailbreak_indirect",
    "jailbreak_substitution",
    "jailbreak_fiction",
    "persuasion_urgency",
    "prompt_injection",
]


@dataclass(frozen=True)
class Match:
    """Match de un patrón adverso. Devuelto por `detect()`."""

    pattern_id: str
    category: Category
    severity: int
    matched_text: str


# Severidad por categoria (ADR-019 tabla):
# - jailbreak_indirect: 3 (intento explicito de cambio de rol)
# - jailbreak_substitution: 4 (override directo)
# - jailbreak_fiction: 2 (ambiguo — puede ser legitimo)
# - persuasion_urgency: 2 (manipulacion emocional informativa)
# - prompt_injection: 5 (markup injection — riesgo alto)
_SEVERITY: dict[Category, int] = {
    "jailbreak_indirect": 3,
    "jailbreak_substitution": 4,
    "jailbreak_fiction": 2,
    "persuasion_urgency": 2,
    "prompt_injection": 5,
}


# Patrones por categoria. Cada string es una regex case-insensitive.
# Convenciones:
# - Separar palabras con `[\s\-_.]+` (no solo `\s+`) para tolerar guiones/puntos/
#   underscores como evasion ("olvi-da tus instrucciones" debe matchear).
# - Tildes en mayusculas: `re.IGNORECASE` solo cubre ASCII; las variantes con
#   tildes se incluyen explicitamente como `(o|ó)` o `(O|Ó)`.
# - Mezclar ES + EN: estudiantes pueden tipear en ambos idiomas.
# - v1.1.0: corpus ampliado tras revision adversarial — cobertura mejorada
#   contra variantes triviales evitables (verbos `ignora`/`descarta`/`borra`,
#   palabras `prompt`/`reglas`/`directivas` ademas de `instrucciones`).
_PATTERNS: dict[Category, list[str]] = {
    "jailbreak_indirect": [
        # "imagina(te)? que (sos|eres|seas|fueras) un tutor sin restriccion(es)?"
        # Tolera separadores variados (guiones/puntos en evasion)
        r"imagin(a|ate|emos|á|ate)[\s\-_.]+que[\s\-_.]+(sos|eres|seas|fueras)[\s\-_.]+(un[\s\-_.]+)?(tutor|asistente|ai)[\s\-_.]+sin[\s\-_.]+restricci",
        # "pretend you (are|were|will be) a tutor without/with no restrictions"
        r"pretend\s+you\s+(are|were|will\s+be)\s+(an?\s+)?(tutor|assistant|ai)\s+(without|with\s+no)",
        # "act(u|ú)a como (si no )?(tuvieras|tuvieses|tendrias) restricciones"
        r"act(u|ú)a[\s\-_.]+como[\s\-_.]+(si[\s\-_.]+no[\s\-_.]+)?(tuvieras|tuvieses|tendrias|tendrías)[\s\-_.]+restricci",
        # "roleplay as ... without/with no filter/limit/restriction"
        r"role[\s\-_]?play\s+as\s+.{1,40}\s+(without|with\s+no)\s+(filter|limit|restrict)",
    ],
    "jailbreak_substitution": [
        # Verbos: olvida/ignora/descarta/borra (con tildes ESP) + tildes mayuscula:
        #   olvida/olvidá/olvidate, ignora, descarta, borra
        # Separadores tolerantes: guiones, puntos, underscores ("olvi-da")
        # Objetos: tus/las/todas mis/tus + instrucciones/reglas/directivas/prompt/orden
        r"(olvid|ignor|descart|borr|olv(i|í)d)[aá](te)?[\s\-_.]+(tus|las|tod[oa]s\s+(tus|las|mis|los))?[\s\-_.]*(instrucci|regl|prompt|directiv|orden|comando)",
        # Variante mas ancha en EN: "ignore" + opcional all/your/previous + objeto
        r"ignore[\s\-_]+(all\s+|your\s+|the\s+|previous\s+)*(instruction|prompt|message|rule|directive|command)",
        # "new/nuevo system prompt" / "nuevo prompt del sistema"
        r"new[\s\-_]+system[\s\-_]+(prompt|message|instruction|rule)",
        r"nuevo[\s\-_]+(system\s+)?prompt[\s\-_]+(del?\s+)?sistema",
        # "disregard (the|your)? (rules|guidelines|instructions|directives)"
        r"disregard\s+(the\s+|your\s+|all\s+)?(rule|guideline|instruction|directive|prompt)",
        # "olvida/borra/descarta lo (de) (antes|previo|anterior)" — variante elidida
        r"(olvid|borr|descart)[aá](te)?[\s\-_.]+(todo[\s\-_.]+)?lo[\s\-_.]+(de[\s\-_.]+)?(antes|previo|anterior)",
        # "override (your|the) (system|prompt|instructions)"
        r"override\s+(your\s+|the\s+)?(system|prompt|instruction|rule)",
    ],
    "jailbreak_fiction": [
        # "en una novela/historia/ficcion donde ..."
        r"en\s+una\s+(novela|historia|ficci(o|ó)n)\s+donde",
        # "in a fictional scenario/world/setting"
        r"in\s+an?\s+fictional\s+(scenario|world|setting)",
        # "escribi(endo)? un cuento/relato/historia donde"
        r"escrib(i|í|iendo)\s+(un\s+)?(cuento|relato|historia)\s+donde",
    ],
    "persuasion_urgency": [
        # Familia enfermo/muriendo (manipulacion emocional clara)
        r"mi\s+(abuel[ao]|madre|padre|herman[ao]|familiar|t(i|í)[ao])\s+(est[aá])\s+(muriendo|enferm|grave)",
        # "tengo examen (mañana|manana|hoy|esta noche/tarde|en N)"
        # Match solo cuando hay temporalidad inminente — NO matchea "estudie para el examen"
        r"tengo\s+(un\s+)?(examen|parcial|final)\s+(ma(ñ|n)ana|hoy|esta\s+(noche|tarde)|en\s+\d)",
        # "i have an exam (tomorrow|today|in N hours)"
        r"i\s+have\s+(an?\s+)?(exam|test|final)\s+(tomorrow|today|in\s+\d)",
        # "es (super)? urgente" SOLO si va con imperativo — restriccion v1.1.0:
        # el patron viejo `r"es\s+...urgente\s+(por favor)?"` matcheaba prompts
        # legitimos como "es urgente que entienda esto antes del examen".
        # Nuevo: requiere verbo imperativo cercano (dame/escribime/respondeme/etc.)
        r"(es|sea)\s+(super\s+|muy\s+)?urgente\s*[,!.;]?\s*(por\s+favor\s+)?(dame|dale|escrib(e|ime|ímelo|í)|respond(e|eme|émelo|é)|necesito\s+(la|el|que)|ayudame|hace(lo|melo))",
    ],
    "prompt_injection": [
        # Markup tags de sistema
        r"</?\s*system\s*>",
        # "system:" al inicio de linea o despues de newline
        r"(^|\n)\s*system\s*:",
        # "[INST]" / "[/INST]" — markup de instruct models
        r"\[\s*/?\s*INST\s*\]",
        # "<|im_start|>" / "<|im_end|>" — markup OpenAI/ChatML
        r"<\|im_(start|end)\|>",
        # "<|endoftext|>" / EOS markup (ChatGPT-style)
        r"<\|(endoftext|eos|bos)\|>",
    ],
}


def _compile_patterns(
    raw: dict[Category, list[str]],
) -> dict[Category, list[tuple[str, re.Pattern[str]]]]:
    """Compila cada regex con flags case-insensitive + multilinea (donde aplica).

    Devuelve `{category: [(pattern_id, compiled_regex), ...]}`. El `pattern_id`
    es estable (`{category}_v{version}_p{idx}`) y se incluye en el evento CTR
    para análisis empírico (qué patrón específico hizo match).
    """
    compiled: dict[Category, list[tuple[str, re.Pattern[str]]]] = {}
    flags = re.IGNORECASE | re.MULTILINE
    for category, patterns in raw.items():
        compiled[category] = [
            (
                f"{category}_v{GUARDRAILS_CORPUS_VERSION.replace('.', '_')}_p{idx}",
                re.compile(pat, flags),
            )
            for idx, pat in enumerate(patterns)
        ]
    return compiled


_COMPILED = _compile_patterns(_PATTERNS)


def compute_guardrails_corpus_hash() -> str:
    """SHA-256 determinista del corpus de patrones + versión.

    Bumpear GUARDRAILS_CORPUS_VERSION o cualquier string en `_PATTERNS` cambia
    el hash. Mismo patrón canónico que `classifier_config_hash` (ADR-009):
    `sort_keys=True`, `ensure_ascii=False`, `separators=(",", ":")`. Encoding
    UTF-8.
    """
    canonical = json.dumps(
        {"corpus_version": GUARDRAILS_CORPUS_VERSION, "patterns": _PATTERNS},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


GUARDRAILS_CORPUS_HASH = compute_guardrails_corpus_hash()


# Length cap para `matched_text`. Si una regex matchea un fragmento gigante,
# truncamos para no inflar el evento CTR. Mantiene el inicio (donde suele
# estar la senal mas clara).
_MAX_MATCHED_TEXT = 200


def detect(content: str) -> list[Match]:
    """Devuelve TODOS los matches del corpus para el prompt dado.

    Lista vacia si nada matchea. Multiples matches del mismo patron en el
    mismo prompt cuentan UNA sola vez (re.search, no re.findall) — un evento
    CTR por (patron, prompt). Multiples patrones distintos que matcheen
    generan multiples eventos.

    Funcion pura, idempotente, sin side-effects. Latencia <1ms para prompts
    de hasta ~10k chars (validado en tests).
    """
    if not content:
        return []

    matches: list[Match] = []
    for category, items in _COMPILED.items():
        severity = _SEVERITY[category]
        for pattern_id, regex in items:
            m = regex.search(content)
            if m is None:
                continue
            matched = m.group(0)
            if len(matched) > _MAX_MATCHED_TEXT:
                matched = matched[:_MAX_MATCHED_TEXT] + "..."
            matches.append(
                Match(
                    pattern_id=pattern_id,
                    category=category,
                    severity=severity,
                    matched_text=matched,
                )
            )
    return matches

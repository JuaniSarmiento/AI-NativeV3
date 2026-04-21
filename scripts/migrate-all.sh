#!/bin/bash
# Orquesta alembic upgrade head de los 4 servicios con DB.
#
# Uso:
#   ./scripts/migrate-all.sh [--dry-run]
#
# Variables de entorno requeridas:
#   CTR_STORE_URL         — postgresql://user:pass@host/ctr_store
#   ACADEMIC_DB_URL       — postgresql://user:pass@host/academic_main
#   CLASSIFIER_DB_URL     — postgresql://user:pass@host/classifier
#   CONTENT_DB_URL        — postgresql://user:pass@host/content
#
# Orden:
#   1. academic-service (tiene users/comisiones — referenciado por los otros)
#   2. ctr-service (episodes + events criptográficos)
#   3. classifier-service (classifications)
#   4. content-service (materials + chunks RAG)
#
# Con --dry-run muestra los comandos sin ejecutar. Usar primero en
# staging para detectar problemas de config antes de prod.

set -euo pipefail

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) echo "Opción desconocida: $arg" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

_require_env() {
  local var="$1"
  if [ -z "${!var:-}" ]; then
    echo "ERROR: variable $var no seteada" >&2
    exit 3
  fi
}

_require_env CTR_STORE_URL
_require_env ACADEMIC_DB_URL
_require_env CLASSIFIER_DB_URL
_require_env CONTENT_DB_URL

run_migration() {
  local service="$1"
  local db_url="$2"

  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "▶ $service"
  echo "═══════════════════════════════════════════════════════════"

  local app_dir="apps/$service"
  if [ ! -f "$app_dir/alembic.ini" ]; then
    echo "SKIP: $app_dir/alembic.ini no existe"
    return 0
  fi

  if $DRY_RUN; then
    echo "[dry-run] cd $app_dir && DATABASE_URL='$db_url' alembic upgrade head"
  else
    pushd "$app_dir" > /dev/null
    DATABASE_URL="$db_url" alembic current
    DATABASE_URL="$db_url" alembic upgrade head
    DATABASE_URL="$db_url" alembic current
    popd > /dev/null
  fi
}

echo "Platform migrations runner"
echo "Dry run: $DRY_RUN"

# Orden importa: academic primero (otros referencian users/comisiones por UUID
# pero no FK, así que técnicamente no hay dep; pero por convención operacional).
run_migration "academic-service" "$ACADEMIC_DB_URL"
run_migration "ctr-service" "$CTR_STORE_URL"
run_migration "classifier-service" "$CLASSIFIER_DB_URL"
run_migration "content-service" "$CONTENT_DB_URL"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✓ Migraciones completadas"
echo "═══════════════════════════════════════════════════════════"

#!/usr/bin/env bash
# Chequea que todos los servicios respondan a /health.
# Uso: ./scripts/check-health.sh

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

declare -A SERVICES=(
    ["api-gateway"]=8000
    ["identity-service"]=8001
    ["academic-service"]=8002
    ["enrollment-service"]=8003
    ["evaluation-service"]=8004
    ["analytics-service"]=8005
    ["tutor-service"]=8006
    ["ctr-service"]=8007
    ["classifier-service"]=8008
    ["content-service"]=8009
    ["governance-service"]=8010
    ["ai-gateway"]=8011
)

declare -A FRONTENDS=(
    ["web-admin"]=5173
    ["web-teacher"]=5174
    ["web-student"]=5175
)

echo "──── Backend services ────"
failed=0
for svc in "${!SERVICES[@]}"; do
    port="${SERVICES[$svc]}"
    if curl -fsS -m 3 "http://127.0.0.1:${port}/health" > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} ${svc} (:${port})"
    else
        echo -e "  ${RED}✗${NC} ${svc} (:${port}) — no responde"
        failed=$((failed + 1))
    fi
done

echo ""
echo "──── Frontends ────"
for app in "${!FRONTENDS[@]}"; do
    port="${FRONTENDS[$app]}"
    if curl -fsS -m 3 "http://127.0.0.1:${port}" > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} ${app} (:${port})"
    else
        echo -e "  ${YELLOW}○${NC} ${app} (:${port}) — no corriendo (OK si no hicieron pnpm dev)"
    fi
done

echo ""
if [ "$failed" -gt 0 ]; then
    echo -e "${RED}Total: ${failed} backend(s) no responden${NC}"
    exit 1
else
    echo -e "${GREEN}Todos los backends OK${NC}"
fi

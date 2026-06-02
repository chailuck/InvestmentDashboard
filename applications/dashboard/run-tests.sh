#!/bin/bash
# ============================================================
# InvestmentDashboard — Master Test Runner
# Usage:
#   ./run-tests.sh            # run all tests
#   ./run-tests.sh backend    # backend only
#   ./run-tests.sh frontend   # frontend only
# ============================================================
set -e

PASS=0; FAIL=0

run_backend() {
  echo ""
  echo "╔══════════════════════════════════════╗"
  echo "║   BACKEND TESTS (pytest)             ║"
  echo "╚══════════════════════════════════════╝"
  echo ""
  if docker ps --format '{{.Names}}' | grep -q inv_backend; then
    docker exec inv_backend bash -c "cd /app && pytest --tb=short -v" && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
  else
    echo "⚠  inv_backend container not running — starting local pytest..."
    (cd backend && pytest --tb=short -v) && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
  fi
}

run_frontend() {
  echo ""
  echo "╔══════════════════════════════════════╗"
  echo "║   FRONTEND TESTS (vitest)            ║"
  echo "╚══════════════════════════════════════╝"
  echo ""
  (cd frontend && npx vitest run --reporter=verbose) && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
}

case "${1:-all}" in
  backend)  run_backend ;;
  frontend) run_frontend ;;
  *)        run_backend; run_frontend ;;
esac

echo ""
echo "══════════════════════════════════════════"
if [ $FAIL -eq 0 ]; then
  echo "  ✅  All test suites passed"
else
  echo "  ❌  $FAIL suite(s) failed"
  exit 1
fi
echo "══════════════════════════════════════════"

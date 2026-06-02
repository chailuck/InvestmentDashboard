#!/bin/bash
set -e
echo "=== InvestmentDashboard Frontend Tests ==="
npx vitest run --reporter=verbose
echo "=== Done ==="

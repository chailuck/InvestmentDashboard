#!/bin/bash
set -e

echo "=== InvestmentDashboard Backend Tests ==="
echo ""

# Verify we are in the backend directory
if [ ! -f "pytest.ini" ]; then
    echo "ERROR: pytest.ini not found. Run this script from the backend/ directory."
    exit 1
fi

# Ensure the test database exists (creates it if missing — requires psql access)
if command -v psql &>/dev/null; then
    PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" psql \
        -h "${POSTGRES_HOST:-localhost}" \
        -U "${POSTGRES_USER:-postgres}" \
        -tc "SELECT 1 FROM pg_database WHERE datname = 'investment_test_db'" \
        | grep -q 1 || \
    PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" psql \
        -h "${POSTGRES_HOST:-localhost}" \
        -U "${POSTGRES_USER:-postgres}" \
        -c "CREATE DATABASE investment_test_db;"
    echo "Test database ready."
else
    echo "psql not found — skipping auto-create of investment_test_db."
    echo "Ensure the database exists before running tests."
fi

echo ""
echo "Running pytest with coverage..."
pytest --tb=short -v

echo ""
echo "=== Done ==="

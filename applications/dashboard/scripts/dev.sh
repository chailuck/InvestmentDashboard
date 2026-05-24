#!/usr/bin/env bash
# Quick local dev startup
set -e

echo "🚀 Starting Investment Dashboard (dev mode)"

# Start infra
docker compose up -d postgres redis

echo "⏳ Waiting for Postgres..."
until docker compose exec postgres pg_isready -U postgres -q; do sleep 1; done

echo "⏳ Waiting for Redis..."
until docker compose exec redis redis-cli ping | grep -q PONG; do sleep 1; done

# Backend
cd backend
cp -n .env.example .env 2>/dev/null || true
pip install -r requirements.txt -q
uvicorn main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Frontend
cd ../frontend
cp -n .env.example .env.local 2>/dev/null || true
npm install -q
npm run dev &
FRONTEND_PID=$!

echo ""
echo "✅ Platform running:"
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:8000"
echo "   API docs: http://localhost:8000/api/docs"
echo ""
echo "Press Ctrl+C to stop all services"

trap "kill $BACKEND_PID $FRONTEND_PID; docker compose stop postgres redis" EXIT
wait

#!/bin/bash
set -e
cd /opt/certifast-crm
git pull origin main
export $(grep -v '^#' .env | xargs)
docker build --no-cache \
  --build-arg "VITE_SUPABASE_URL=$VITE_SUPABASE_URL" \
  --build-arg "VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY:-$VITE_SUPABASE_ANON_KEY}" \
  -t certifastcrm:latest .
docker stack rm certifastcrm 2>/dev/null || true
sleep 20
docker stack deploy -c docker-compose.yml certifastcrm

# deploy triggered

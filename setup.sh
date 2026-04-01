#!/usr/bin/env bash
# HiveRunr — first-time setup
# Run once after cloning the repo to generate a .env with a unique SECRET_KEY.
#
# Usage:
#   bash setup.sh
#   # edit .env as needed (API_KEY, SMTP, integrations…)
#   docker compose up -d --build

set -e

# Make sure we're in the repo root (docker-compose.yml should be here)
if [ ! -f "docker-compose.yml" ]; then
  echo "✗ docker-compose.yml not found."
  echo "  Run this script from the root of the HiveRunr repo."
  echo "  If you just cloned, try: git pull && bash setup.sh"
  exit 1
fi

if [ -f ".env" ]; then
  echo "ℹ  .env already exists — skipping generation."
  echo "   Delete it and re-run if you want a fresh setup: rm .env && bash setup.sh"
  exit 0
fi

cp .env.example .env

# Generate a unique Fernet-compatible SECRET_KEY (32 random bytes, URL-safe base64).
SECRET_KEY=$(python3 -c "import base64,os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())" 2>/dev/null \
  || openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')

if [ -z "$SECRET_KEY" ]; then
  echo "⚠  Could not generate a SECRET_KEY automatically."
  echo "   Set it manually in .env before storing credentials:"
  echo '   python3 -c "import base64,os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"'
else
  # Replace the blank SECRET_KEY= line in .env with the generated value
  sed -i.bak "s|^SECRET_KEY=$|SECRET_KEY=$SECRET_KEY|" .env && rm -f .env.bak
  echo "✓ Generated SECRET_KEY"
fi

echo ""
echo "✓ .env created. Next steps:"
echo "  1. Edit .env — set API_KEY and any integration keys you need"
echo "  2. docker compose up -d --build"
echo "  3. Open http://localhost and create your owner account"

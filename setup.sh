#!/usr/bin/env bash
# HiveRunr — interactive first-time setup
# Generates a .env, walks you through optional integrations, then offers to
# start the stack with docker compose.
#
# Usage:
#   bash setup.sh

set -e

# ── Colours ──────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD=$'\033[1m'; RESET=$'\033[0m'
  GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RED=$'\033[31m'; DIM=$'\033[2m'
else
  BOLD=""; RESET=""; GREEN=""; YELLOW=""; CYAN=""; RED=""; DIM=""
fi

banner() { echo -e "\n${CYAN}${BOLD}$*${RESET}"; }
ok()     { echo -e "${GREEN}✓${RESET} $*"; }
warn()   { echo -e "${YELLOW}⚠${RESET}  $*"; }
info()   { echo -e "${DIM}  $*${RESET}"; }
err()    { echo -e "${RED}✗${RESET} $*" >&2; }

# ── Helpers ──────────────────────────────────────────────────────────────────

# ask_yn "Question?" [default: y|n]
# Returns 0 for yes, 1 for no.
ask_yn() {
  local prompt="$1" default="${2:-y}"
  local hint
  [ "$default" = "y" ] && hint="[Y/n]" || hint="[y/N]"
  while true; do
    printf "%s" "${BOLD}${prompt} ${hint}${RESET} "
    read -r reply </dev/tty
    reply="${reply:-$default}"
    case "$reply" in
      [Yy]*) return 0 ;;
      [Nn]*) return 1 ;;
      *)     echo "  Please answer y or n." ;;
    esac
  done
}

# ask_val "Label" "current_value" — prints the updated value
ask_val() {
  local label="$1" current="$2"
  if [ -n "$current" ]; then
    printf "  %s [%s]: " "$label" "$current"
  else
    printf "  %s: " "$label"
  fi
  read -r val </dev/tty
  echo "${val:-$current}"
}

# set_env KEY VALUE — replaces the line in .env (in-place)
set_env() {
  local key="$1" value="$2"
  # Escape forward-slashes and ampersands in the value for sed
  local escaped
  escaped=$(printf '%s' "$value" | sed 's/[\/&]/\\&/g')
  sed -i.bak "s|^${key}=.*|${key}=${escaped}|" .env && rm -f .env.bak
}

# ── Guard: repo root ──────────────────────────────────────────────────────────
if [ ! -f "docker-compose.yml" ]; then
  err "docker-compose.yml not found."
  info "Run this script from the root of the HiveRunr repo."
  exit 1
fi

echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║      HiveRunr — First-time setup     ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════╝${RESET}"

# ── .env creation ─────────────────────────────────────────────────────────────
banner "Step 1 — Environment file"

if [ -f ".env" ]; then
  warn ".env already exists."
  if ! ask_yn "Re-run setup anyway (existing values will be preserved)?" n; then
    info "Nothing changed. To start the stack: docker compose up -d --build"
    exit 0
  fi
else
  cp .env.example .env
  ok "Created .env from .env.example"
fi

# Generate SECRET_KEY if blank
current_key=$(grep '^SECRET_KEY=' .env | cut -d'=' -f2-)
if [ -z "$current_key" ]; then
  SECRET_KEY=$(python3 -c "import base64,os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())" 2>/dev/null \
    || openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')
  if [ -n "$SECRET_KEY" ]; then
    set_env "SECRET_KEY" "$SECRET_KEY"
    ok "Generated SECRET_KEY"
  else
    warn "Could not generate SECRET_KEY automatically — set it manually in .env"
  fi
else
  ok "SECRET_KEY already set"
fi

# API_KEY
banner "Step 2 — API key"
info "API_KEY protects all inbound /webhook/* endpoints."
current_api=$(grep '^API_KEY=' .env | cut -d'=' -f2-)
if [ "$current_api" = "change-me-before-deployment" ] || [ -z "$current_api" ]; then
  # Generate a random default so the placeholder is never left in place
  default_api=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))" 2>/dev/null \
    || openssl rand -base64 18 | tr -d '=\n+/')
  new_api=$(ask_val "API_KEY (leave blank to auto-generate)" "")
  if [ -n "$new_api" ]; then
    set_env "API_KEY" "$new_api"
    ok "API_KEY saved"
  else
    set_env "API_KEY" "$default_api"
    ok "API_KEY auto-generated: ${BOLD}${default_api}${RESET}"
    info "Copy this somewhere safe — you'll need it to call /webhook/* endpoints."
  fi
else
  ok "API_KEY already configured"
fi

# ── Optional integrations ─────────────────────────────────────────────────────
banner "Step 3 — Optional integrations"
info "Select which services you want to configure now."
info "You can always edit .env manually later and restart the stack."
echo ""

# ── AgentMail.to (email alerts + password reset) ──────────────────────────────
if ask_yn "Configure email alerts via AgentMail.to?" n; then
  info "Sign up at https://agentmail.to and create an inbox to get your API key."
  echo ""

  current_key=$(grep '^AGENTMAIL_API_KEY=' .env | cut -d'=' -f2-)
  new_key=$(ask_val "AGENTMAIL_API_KEY" "$current_key")
  [ -n "$new_key" ] && set_env "AGENTMAIL_API_KEY" "$new_key"

  current_from=$(grep '^AGENTMAIL_FROM=' .env | cut -d'=' -f2-)
  new_from=$(ask_val "AGENTMAIL_FROM (e.g. alerts@agentmail.to)" "$current_from")
  [ -n "$new_from" ] && set_env "AGENTMAIL_FROM" "$new_from"

  current_owner=$(grep '^OWNER_EMAIL=' .env | cut -d'=' -f2-)
  new_owner=$(ask_val "OWNER_EMAIL (your email — gets all failure alerts + forgot-password)" "$current_owner")
  [ -n "$new_owner" ] && set_env "OWNER_EMAIL" "$new_owner"

  ok "AgentMail.to configured"
  info "Per-flow alert recipients can be set inside the app via ⋯ → 🔔 Alerts on each flow."
fi

# ── App URL ───────────────────────────────────────────────────────────────────
echo ""
current_url=$(grep '^APP_URL=' .env | cut -d'=' -f2-)
if [ "$current_url" = "http://localhost" ]; then
  new_url=$(ask_val "APP_URL (public URL used in email links — press Enter to keep localhost)" "http://localhost")
  [ "$new_url" != "http://localhost" ] && [ -n "$new_url" ] && set_env "APP_URL" "$new_url" && ok "APP_URL saved"
fi

# ── Default timezone ──────────────────────────────────────────────────────────
echo ""
# Auto-detect system timezone as a sensible default
detected_tz=$(cat /etc/timezone 2>/dev/null || timedatectl show --property=Timezone --value 2>/dev/null || echo "UTC")
current_tz=$(grep '^APP_TIMEZONE=' .env 2>/dev/null | cut -d'=' -f2-)
current_tz="${current_tz:-$detected_tz}"
new_tz=$(ask_val "APP_TIMEZONE (IANA timezone for the scheduler UI, e.g. Europe/London)" "$current_tz")
[ -n "$new_tz" ] && set_env "APP_TIMEZONE" "$new_tz" && ok "APP_TIMEZONE set to $new_tz"

# ── Run Script node ───────────────────────────────────────────────────────────
echo ""
if ask_yn "Enable the 'Run Python Script' node? ${RED}(security risk — read the warning below)${RESET}" n; then
  warn "Run Python Script executes arbitrary code with access to env vars and the filesystem."
  warn "Only enable this if every user who can edit flows is fully trusted."
  if ask_yn "  Are you sure you want to enable it?" n; then
    set_env "ENABLE_RUN_SCRIPT" "true"
    ok "Run Python Script node enabled"
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
banner "Step 4 — Review"
echo ""
echo -e "  ${BOLD}Your .env is ready.${RESET} Key values:"
echo ""
printf "  %-22s %s\n" "API_KEY:"           "$(grep '^API_KEY=' .env | cut -d'=' -f2-)"
printf "  %-22s %s\n" "AGENTMAIL_FROM:"    "$(grep '^AGENTMAIL_FROM=' .env | cut -d'=' -f2-)"
printf "  %-22s %s\n" "OWNER_EMAIL:"       "$(grep '^OWNER_EMAIL=' .env | cut -d'=' -f2-)"
printf "  %-22s %s\n" "APP_URL:"           "$(grep '^APP_URL=' .env | cut -d'=' -f2-)"
printf "  %-22s %s\n" "APP_TIMEZONE:"      "$(grep '^APP_TIMEZONE=' .env | cut -d'=' -f2-);"
printf "  %-22s %s\n" "RUN_SCRIPT:"        "$(grep '^ENABLE_RUN_SCRIPT=' .env | cut -d'=' -f2-)"
echo ""
info "Edit .env at any time to add OpenAI, Slack, Telegram, and other integration keys."

# ── Docker ────────────────────────────────────────────────────────────────────
banner "Step 5 — Start the stack"
echo ""

# Prefer the COMPOSE env var set by install.sh, fall back to detecting it
COMPOSE_CMD="${COMPOSE:-}"
if [ -z "$COMPOSE_CMD" ]; then
  if docker compose version &>/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
  else
    COMPOSE_CMD="docker compose"   # let it fail with a clear error
  fi
fi

if ask_yn "Start HiveRunr now? ($COMPOSE_CMD up -d --build)" y; then
  echo ""
  info "Running: $COMPOSE_CMD up -d --build"
  echo ""
  $COMPOSE_CMD up -d --build
  echo ""

  # Wait for the API to be ready (up to 60 s)
  info "Waiting for HiveRunr to be ready…"
  for i in $(seq 1 30); do
    if $COMPOSE_CMD exec -T api python3 -c \
        "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=2)" \
        &>/dev/null 2>&1; then
      break
    fi
    sleep 2
  done

  ok "Stack started."
  echo ""
  echo -e "  ${BOLD}Open HiveRunr:${RESET}  http://localhost"
  echo -e "  ${BOLD}View logs:${RESET}       ${COMPOSE_CMD} logs -f api"
  echo -e "  ${BOLD}Stop:${RESET}            ${COMPOSE_CMD} down"
  echo ""
  ok "Create your owner account at ${BOLD}http://localhost/setup${RESET}"
else
  echo ""
  info "When you're ready, start the stack with:"
  echo -e "  ${BOLD}${COMPOSE_CMD} up -d --build${RESET}"
  echo ""
  ok "Setup complete. Open http://localhost after starting the stack."
fi

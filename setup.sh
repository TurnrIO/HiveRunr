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

# ── Failure notifications e-mail ──────────────────────────────────────────────
if ask_yn "Send run-failure alerts to an email address?" n; then
  addr=$(ask_val "NOTIFY_EMAIL" "$(grep '^NOTIFY_EMAIL=' .env | cut -d'=' -f2-)")
  [ -n "$addr" ] && set_env "NOTIFY_EMAIL" "$addr" && ok "Failure email saved"
fi

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
echo -e "  ${BOLD}Your .env is ready.${RESET} Here are the values that matter most:"
echo ""
printf "  %-20s %s\n" "API_KEY:"      "$(grep '^API_KEY=' .env | cut -d'=' -f2-)"
printf "  %-20s %s\n" "NOTIFY_EMAIL:" "$(grep '^NOTIFY_EMAIL=' .env | cut -d'=' -f2-)"
printf "  %-20s %s\n" "RUN_SCRIPT:"   "$(grep '^ENABLE_RUN_SCRIPT=' .env | cut -d'=' -f2-)"
echo ""
info "Add integration keys (SMTP, OpenAI, Slack, Telegram…) to .env at any time and restart."

# ── Docker ────────────────────────────────────────────────────────────────────
banner "Step 5 — Start the stack"
echo ""
if ask_yn "Start HiveRunr now with docker compose up -d --build?" y; then
  echo ""
  info "Running: docker compose up -d --build"
  echo ""
  docker compose up -d --build
  echo ""
  ok "Stack started."
  echo ""
  echo -e "  ${BOLD}Open HiveRunr:${RESET}  http://localhost"
  echo -e "  ${BOLD}View logs:${RESET}       docker compose logs -f api"
  echo -e "  ${BOLD}Stop:${RESET}            docker compose down"
  echo ""
  ok "First-time setup complete. Create your owner account at http://localhost/setup"
else
  echo ""
  info "When you're ready, start the stack with:"
  echo -e "  ${BOLD}docker compose up -d --build${RESET}"
  echo ""
  ok "Setup complete. Open http://localhost after starting the stack."
fi

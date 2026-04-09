#!/usr/bin/env bash
# HiveRunr — one-line installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/TurnrIO/HiveRunr/main/install.sh | bash
#
# What it does:
#   1. Checks prerequisites (git, docker, docker compose)
#   2. Clones the repo into a directory of your choice (default: ~/hiverunr)
#   3. Runs the interactive setup.sh inside the repo

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
if [ -t 1 ] || [ -t 0 ]; then
  BOLD=$'\033[1m'; RESET=$'\033[0m'
  GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RED=$'\033[31m'; DIM=$'\033[2m'
else
  BOLD=""; RESET=""; GREEN=""; YELLOW=""; CYAN=""; RED=""; DIM=""
fi

banner() { printf "\n%s%s%s\n" "${CYAN}${BOLD}" "$*" "${RESET}"; }
ok()     { printf "%s✓%s %s\n" "${GREEN}" "${RESET}" "$*"; }
warn()   { printf "%s⚠%s  %s\n" "${YELLOW}" "${RESET}" "$*"; }
info()   { printf "%s  %s%s\n" "${DIM}" "$*" "${RESET}"; }
die()    { printf "\n%s✗ %s%s\n\n" "${RED}" "$*" "${RESET}" >&2; exit 1; }

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔═════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║        HiveRunr — Installer             ║${RESET}"
echo -e "${BOLD}╚═════════════════════════════════════════╝${RESET}"
echo ""

# ── Prerequisite checks ───────────────────────────────────────────────────────
banner "Checking prerequisites…"

check_cmd() {
  if command -v "$1" &>/dev/null; then
    ok "$1 found ($(command -v "$1"))"
  else
    die "$1 is required but not installed. $2"
  fi
}

check_cmd git  "Install git: https://git-scm.com/downloads"
check_cmd docker "Install Docker Desktop: https://docs.docker.com/get-docker/"

# docker compose (v2 plugin) or docker-compose (v1 standalone)
if docker compose version &>/dev/null 2>&1; then
  COMPOSE="docker compose"
  ok "docker compose (v2) found"
elif command -v docker-compose &>/dev/null; then
  COMPOSE="docker-compose"
  ok "docker-compose (v1) found"
else
  die "Docker Compose not found. Install Docker Desktop or 'docker compose' plugin."
fi

# ── Choose install directory ──────────────────────────────────────────────────
banner "Install location"

DEFAULT_DIR="$HOME/hiverunr"
printf "  %sInstall directory%s [%s]: " "${BOLD}" "${RESET}" "$DEFAULT_DIR"
read -r INSTALL_DIR </dev/tty
INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_DIR}"
INSTALL_DIR="${INSTALL_DIR/#\~/$HOME}"   # expand leading ~

if [ -d "$INSTALL_DIR/.git" ]; then
  warn "Directory exists and appears to be a git repo."
  printf "  %sPull latest changes instead of cloning? [Y/n]:%s " "${BOLD}" "${RESET}"
  read -r reply </dev/tty
  reply="${reply:-y}"
  if [[ "$reply" =~ ^[Yy] ]]; then
    git -C "$INSTALL_DIR" pull --ff-only
    ok "Repository updated"
  else
    ok "Using existing directory"
  fi
elif [ -d "$INSTALL_DIR" ] && [ "$(ls -A "$INSTALL_DIR")" ]; then
  die "Directory '$INSTALL_DIR' already exists and is not empty."
else
  info "Cloning into: $INSTALL_DIR"
  git clone https://github.com/TurnrIO/HiveRunr.git "$INSTALL_DIR"
  ok "Repository cloned"
fi

# ── Hand off to setup.sh ──────────────────────────────────────────────────────
banner "Running setup…"

cd "$INSTALL_DIR"

if [ ! -f "setup.sh" ]; then
  die "setup.sh not found in $INSTALL_DIR — the clone may be incomplete."
fi

chmod +x setup.sh

# Export compose command so setup.sh can use it if needed
export COMPOSE

bash setup.sh

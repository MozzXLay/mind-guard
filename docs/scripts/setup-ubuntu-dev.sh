#!/usr/bin/env bash
# MindGuard M0 development prerequisites for Ubuntu 24.04.
# Run without arguments to inspect; run with --install to install missing tools.
set -euo pipefail

mode=check
with_sqlcipher=false
with_release_tools=false

usage() {
  cat <<'EOF'
Usage: bash docs/scripts/setup-ubuntu-dev.sh [--check | --install] [--with-sqlcipher] [--with-release-tools]

  --check               Print missing prerequisites (default; changes nothing)
  --install             Install missing M0 prerequisites with apt and rustup
  --with-sqlcipher      Also install SQLCipher headers/tools if selected for storage
  --with-release-tools  Also install patchelf for later AppImage packaging

The script checks Node.js/npm but does not replace an existing Node installation.
This machine already has Node.js 24 via nvm. If Node is missing elsewhere,
install a supported Node.js LTS version before running this script.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --check) mode=check ;;
    --install) mode=install ;;
    --with-sqlcipher) with_sqlcipher=true ;;
    --with-release-tools) with_release_tools=true ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$arg" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ ! -r /etc/os-release ]]; then
  printf 'Cannot identify this Linux distribution.\n' >&2
  exit 1
fi
. /etc/os-release
if [[ "${ID:-}" != ubuntu || "${VERSION_ID:-}" != 24.04 ]]; then
  printf 'This script supports Ubuntu 24.04; found %s %s.\n' "${ID:-unknown}" "${VERSION_ID:-unknown}" >&2
  exit 1
fi

# Desktop task shells may not load ~/.profile even after rustup updates it.
cargo_bin="${CARGO_HOME:-$HOME/.cargo}/bin"
if [[ -x "$cargo_bin/rustup" ]]; then
  export PATH="$cargo_bin:$PATH"
fi

packages=(
  libwebkit2gtk-4.1-dev
  build-essential
  curl
  wget
  file
  libxdo-dev
  libssl-dev
  libayatana-appindicator3-dev
  librsvg2-dev
)
if [[ "$with_sqlcipher" == true ]]; then
  packages+=(libsqlcipher-dev sqlcipher)
fi
if [[ "$with_release_tools" == true ]]; then
  packages+=(patchelf)
fi

missing=()
for package in "${packages[@]}"; do
  if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -qx 'install ok installed'; then
    missing+=("$package")
  fi
done

printf 'Ubuntu: %s; architecture: %s\n' "$VERSION_ID" "$(uname -m)"
printf 'Missing apt packages: %s\n' "${missing[*]:-none}"
for command_name in node npm rustc cargo rustup; do
  if command -v "$command_name" >/dev/null 2>&1; then
    printf '%s: %s\n' "$command_name" "$(command -v "$command_name")"
  else
    printf '%s: missing\n' "$command_name"
  fi
done

if [[ "$mode" == check ]]; then
  exit 0
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf 'Node.js and npm are required. Install a supported Node.js LTS first.\n' >&2
  exit 1
fi

if ((${#missing[@]})); then
  if [[ "$(id -u)" == 0 ]]; then
    apt-get update
    apt-get install --no-install-recommends "${missing[@]}"
  else
    sudo apt-get update
    sudo apt-get install --no-install-recommends "${missing[@]}"
  fi
fi

if ! command -v rustc >/dev/null 2>&1 || ! command -v cargo >/dev/null 2>&1 || ! command -v rustup >/dev/null 2>&1; then
  if [[ "$(id -u)" == 0 ]]; then
    printf 'Run this script as your regular user so rustup installs into your own account.\n' >&2
    exit 1
  fi
  rustup_script=$(mktemp)
  trap 'rm -f "$rustup_script"' EXIT
  curl --proto '=https' --tlsv1.2 --fail --show-error --silent https://sh.rustup.rs -o "$rustup_script"
  sh "$rustup_script" -y --profile minimal
  # rustup updates shell startup files, but this process needs the path immediately.
  export PATH="$cargo_bin:$PATH"
fi

printf '\nInstalled versions:\n'
node --version
npm --version
rustc --version
cargo --version
pkg-config --modversion webkit2gtk-4.1
printf 'MindGuard M0 development prerequisites are ready.\n'

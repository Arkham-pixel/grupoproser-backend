#!/bin/bash
# Mueve uploads/ (raiz del repo, legacy PM2) -> backend/uploads/ sin sobrescribir.
# Uso: bash backend/scripts/sync-legacy-uploads.sh

set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/uploads"
DST="$ROOT/backend/uploads"

if [ ! -d "$SRC" ]; then
  echo "No hay carpeta legacy: $SRC"
  exit 0
fi

mkdir -p "$DST"
moved=0
skipped=0

merge_tree() {
  local src_dir="$1"
  local dst_dir="$2"
  mkdir -p "$dst_dir"
  shopt -s nullglob
  for item in "$src_dir"/*; do
    [ -e "$item" ] || continue
    local base
    base="$(basename "$item")"
    if [ -d "$item" ]; then
      merge_tree "$item" "$dst_dir/$base"
    elif [ -f "$item" ]; then
      if [ -f "$dst_dir/$base" ]; then
        echo "omitido (ya existe): $base"
        skipped=$((skipped + 1))
      else
        mv "$item" "$dst_dir/$base"
        echo "movido: $base"
        moved=$((moved + 1))
      fi
    fi
  done
}

merge_tree "$SRC" "$DST"
echo "Listo. Movidos: $moved, omitidos: $skipped"

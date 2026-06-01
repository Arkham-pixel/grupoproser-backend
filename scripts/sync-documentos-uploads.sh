#!/bin/bash
# Mueve archivos de uploads/documentos (cwd raíz) a backend/uploads/documentos.
# Uso en servidor: bash backend/scripts/sync-documentos-uploads.sh

set -eROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/uploads/documentos"
DST="$ROOT/backend/uploads/documentos"

if [ ! -d "$SRC" ]; then
  echo "No hay carpeta legacy: $SRC"
  exit 0
fi

mkdir -p "$DST"
moved=0
skipped=0

for f in "$SRC"/*; do
  [ -e "$f" ] || continue
  [ -f "$f" ] || continue
  base=$(basename "$f")
  if [ -f "$DST/$base" ]; then
    echo "Omitido (ya existe en destino): $base"
    skipped=$((skipped + 1))
  else
    mv "$f" "$DST/$base"
    echo "Movido: $base"
    moved=$((moved + 1))
  fi
done

echo "Listo. Movidos: $moved, omitidos: $skipped"
echo "Origen restante:" && ls -la "$SRC" 2>/dev/null | head -5
echo "Destino (últimos):" && ls -lt "$DST" 2>/dev/null | head -5

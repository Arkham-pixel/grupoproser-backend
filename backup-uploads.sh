#!/bin/bash

# Script de backup automático para el directorio uploads
# Este script crea una copia comprimida del directorio uploads
# y mantiene solo los últimos N backups

# Configuración
SOURCE_DIR="$(dirname "$(readlink -f "$0")")/uploads"
BACKUP_DIR="$HOME/backups/uploads"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="uploads_backup_${DATE}.tar.gz"
KEEP_BACKUPS=2  # Mantener los últimos 2 backups (~1.2 GB en disco de 14 GB)

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Función para logging
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" >&2
}

warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"
}

# Verificar que existe el directorio fuente
if [ ! -d "$SOURCE_DIR" ]; then
    error "El directorio fuente no existe: $SOURCE_DIR"
    exit 1
fi

# Crear directorio de backups si no existe
mkdir -p "$BACKUP_DIR"
if [ $? -ne 0 ]; then
    error "No se pudo crear el directorio de backups: $BACKUP_DIR"
    exit 1
fi

# Verificar si el directorio fuente está vacío
if [ -z "$(ls -A $SOURCE_DIR 2>/dev/null)" ]; then
    warning "El directorio uploads está vacío, creando backup vacío..."
fi

# Crear el backup
log "Iniciando backup de $SOURCE_DIR..."
log "Guardando en: $BACKUP_DIR/$BACKUP_NAME"

cd "$(dirname "$SOURCE_DIR")" || exit 1

tar -czf "$BACKUP_DIR/$BACKUP_NAME" uploads/ 2>/dev/null

if [ $? -eq 0 ]; then
    # Obtener el tamaño del backup
    BACKUP_SIZE=$(du -h "$BACKUP_DIR/$BACKUP_NAME" | cut -f1)
    log "✅ Backup creado exitosamente: $BACKUP_NAME (Tamaño: $BACKUP_SIZE)"
else
    error "Falló la creación del backup"
    exit 1
fi

# Limpiar backups antiguos (mantener solo los últimos KEEP_BACKUPS)
log "Limpiando backups antiguos (manteniendo los últimos $KEEP_BACKUPS)..."
cd "$BACKUP_DIR" || exit 1

# Contar backups existentes
BACKUP_COUNT=$(ls -1 uploads_backup_*.tar.gz 2>/dev/null | wc -l)

if [ "$BACKUP_COUNT" -gt "$KEEP_BACKUPS" ]; then
    # Eliminar los más antiguos
    TO_DELETE=$((BACKUP_COUNT - KEEP_BACKUPS))
    ls -1t uploads_backup_*.tar.gz 2>/dev/null | tail -n "$TO_DELETE" | while read -r old_backup; do
        log "Eliminando backup antiguo: $old_backup"
        rm -f "$old_backup"
    done
    log "✅ Limpieza completada"
else
    log "No se requiere limpieza ($BACKUP_COUNT backups existentes, máximo: $KEEP_BACKUPS)"
fi

# Mostrar resumen
log "═══════════════════════════════════════"
log "📊 RESUMEN DEL BACKUP"
log "═══════════════════════════════════════"
log "Ubicación: $BACKUP_DIR"
log "Backups guardados: $(ls -1 uploads_backup_*.tar.gz 2>/dev/null | wc -l)"
log "Espacio usado: $(du -sh "$BACKUP_DIR" | cut -f1)"
log "═══════════════════════════════════════"

exit 0


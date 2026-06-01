#!/bin/bash

# Script para instalar el cron job de backup automático
# Este script configura un cron job para ejecutar el backup diariamente

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup-uploads.sh"
CRON_TIME="0 2"  # 2:00 AM todos los días

# Verificar que el script de backup existe
if [ ! -f "$BACKUP_SCRIPT" ]; then
    echo "❌ Error: No se encontró el script de backup: $BACKUP_SCRIPT"
    exit 1
fi

# Hacer el script ejecutable
chmod +x "$BACKUP_SCRIPT"

# Crear el directorio de backups
mkdir -p "$HOME/backups/uploads"

# Crear la línea del cron job
CRON_LINE="$CRON_TIME * * * $BACKUP_SCRIPT >> $HOME/backups/uploads/backup.log 2>&1"

# Verificar si ya existe el cron job
if crontab -l 2>/dev/null | grep -q "$BACKUP_SCRIPT"; then
    echo "⚠️  El cron job de backup ya existe"
    echo "📋 Cron jobs actuales relacionados con backup:"
    crontab -l 2>/dev/null | grep "$BACKUP_SCRIPT"
    echo ""
    read -p "¿Deseas reemplazarlo? (s/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[SsYy]$ ]]; then
        echo "❌ Operación cancelada"
        exit 0
    fi
    # Eliminar el cron job existente
    crontab -l 2>/dev/null | grep -v "$BACKUP_SCRIPT" | crontab -
fi

# Agregar el nuevo cron job
(crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -

if [ $? -eq 0 ]; then
    echo "✅ Cron job de backup instalado exitosamente"
    echo "📅 El backup se ejecutará diariamente a las 2:00 AM"
    echo "📁 Backups guardados en: $HOME/backups/uploads"
    echo "📋 Logs guardados en: $HOME/backups/uploads/backup.log"
    echo ""
    echo "Para ver los cron jobs actuales, ejecuta: crontab -l"
    echo "Para ver los logs del backup, ejecuta: tail -f $HOME/backups/uploads/backup.log"
else
    echo "❌ Error al instalar el cron job"
    exit 1
fi


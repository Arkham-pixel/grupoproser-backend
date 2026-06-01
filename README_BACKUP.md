# 📦 Sistema de Backup Automático de Uploads

Este documento explica el sistema de backup automático implementado para el directorio `uploads`.

## 🎯 Descripción

El sistema realiza backups automáticos del directorio `backend/uploads` que contiene todos los archivos subidos por los usuarios (imágenes, documentos, PDFs, etc.).

## 📁 Archivos del Sistema

- **`backup-uploads.sh`**: Script principal que realiza el backup
- **`install-backup-cron.sh`**: Script para instalar el cron job automático
- **Directorio de backups**: `~/backups/uploads/`

## 🚀 Instalación

### Opción 1: Instalación Automática (Recomendada)

```bash
cd ~/grupoproser/grupoproser/backend
chmod +x install-backup-cron.sh
./install-backup-cron.sh
```

### Opción 2: Instalación Manual del Cron Job

```bash
# Hacer el script ejecutable
chmod +x backup-uploads.sh

# Agregar al crontab (ejecutar a las 2:00 AM diariamente)
crontab -e

# Agregar esta línea:
0 2 * * * /home/ubuntu/grupoproser/grupoproser/backend/backup-uploads.sh >> /home/ubuntu/backups/uploads/backup.log 2>&1
```

## ⚙️ Configuración

El script `backup-uploads.sh` tiene las siguientes configuraciones:

- **`SOURCE_DIR`**: Directorio fuente (por defecto: `backend/uploads`)
- **`BACKUP_DIR`**: Directorio donde se guardan los backups (por defecto: `~/backups/uploads`)
- **`KEEP_BACKUPS`**: Número de backups a mantener (por defecto: 7)

Puedes modificar estas variables en el script según tus necesidades.

## 📅 Programación

- **Frecuencia**: Diaria
- **Hora**: 2:00 AM (configurable en `install-backup-cron.sh`)
- **Formato de archivo**: `uploads_backup_YYYYMMDD_HHMMSS.tar.gz`

## 🔍 Uso Manual

Puedes ejecutar el backup manualmente en cualquier momento:

```bash
cd ~/grupoproser/grupoproser/backend
./backup-uploads.sh
```

## 📊 Verificar Backups

### Ver lista de backups disponibles:
```bash
ls -lh ~/backups/uploads/
```

### Ver logs del backup:
```bash
tail -f ~/backups/uploads/backup.log
```

### Ver cron jobs instalados:
```bash
crontab -l
```

## 🔄 Restaurar un Backup

Para restaurar un backup:

```bash
# 1. Navegar al directorio de backups
cd ~/backups/uploads

# 2. Listar backups disponibles
ls -lh uploads_backup_*.tar.gz

# 3. Extraer el backup deseado
tar -xzf uploads_backup_YYYYMMDD_HHMMSS.tar.gz -C ~/grupoproser/grupoproser/backend/

# 4. Verificar que los archivos se restauraron
ls -la ~/grupoproser/grupoproser/backend/uploads/
```

## 🗑️ Limpieza Automática

El script automáticamente elimina backups antiguos, manteniendo solo los últimos 7 backups (configurable con `KEEP_BACKUPS`).

## 📈 Monitoreo

### Verificar espacio usado por los backups:
```bash
du -sh ~/backups/uploads/
```

### Ver el tamaño de cada backup:
```bash
ls -lh ~/backups/uploads/
```

## ⚠️ Consideraciones Importantes

1. **Espacio en disco**: Asegúrate de tener suficiente espacio para los backups
2. **Ubicación del backup**: Los backups se guardan en `~/backups/uploads/` por defecto
3. **Frecuencia**: Los backups son diarios. Si necesitas más frecuencia, modifica el cron job
4. **Backups externos**: Para mayor seguridad, considera hacer backups adicionales a S3 u otro servicio en la nube

## 🔒 Seguridad

- Los backups contienen archivos sensibles de usuarios
- Asegúrate de que los permisos del directorio de backups sean adecuados:
  ```bash
  chmod 700 ~/backups/uploads/
  ```

## 🆘 Solución de Problemas

### El backup no se ejecuta:
1. Verificar que el cron job está instalado: `crontab -l`
2. Verificar los logs: `tail -f ~/backups/uploads/backup.log`
3. Ejecutar manualmente para ver errores: `./backup-uploads.sh`

### No hay espacio para backups:
1. Verificar espacio disponible: `df -h`
2. Reducir el número de backups a mantener (modificar `KEEP_BACKUPS`)
3. Eliminar backups antiguos manualmente si es necesario

### El script no tiene permisos:
```bash
chmod +x backup-uploads.sh
chmod +x install-backup-cron.sh
```

## 📝 Notas Adicionales

- Los backups se comprimen con `tar.gz` para ahorrar espacio
- El formato de fecha/hora en el nombre permite ordenar fácilmente los backups
- Se recomienda probar la restauración periódicamente para asegurar que funciona correctamente


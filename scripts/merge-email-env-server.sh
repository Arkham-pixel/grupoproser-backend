#!/bin/bash
set -e
ENV_FILE=/home/ubuntu/grupoproser/grupoproser/backend/.env
PATCH=/tmp/email-patch.env
cp "$ENV_FILE" "${ENV_FILE}.bak.email"
grep -v -E '^(EMAIL_|SMTP_)' "$ENV_FILE" > "${ENV_FILE}.tmp"
echo "" >> "${ENV_FILE}.tmp"
cat "$PATCH" >> "${ENV_FILE}.tmp"
mv "${ENV_FILE}.tmp" "$ENV_FILE"
echo "=== Correo configurado ==="
grep -E '^EMAIL_' "$ENV_FILE" | sed 's/EMAIL_PASS=.*/EMAIL_PASS=***/'

#!/bin/bash

echo "🔄 Reiniciando backend..."

# Detener el proceso actual
pm2 stop backend

# Esperar un momento
sleep 2

# Iniciar el backend
pm2 start server.js --name backend

# Esperar a que inicie
sleep 3

# Verificar estado
echo "📊 Estado del backend:"
pm2 status

# Verificar logs
echo "📋 Últimos logs:"
pm2 logs backend --lines 10

# Probar las rutas
echo "🧪 Probando rutas..."
echo "GET /api/riesgos:"
curl -s http://localhost:3000/api/riesgos | head -c 200

echo -e "\nGET /api/casos:"
curl -s http://localhost:3000/api/casos | head -c 200

echo -e "\nGET /api/estados/estados-riesgos:"
curl -s http://localhost:3000/api/estados/estados-riesgos | head -c 200

echo -e "\nGET /api/responsables:"
curl -s http://localhost:3000/api/responsables | head -c 200

echo -e "\n✅ Reinicio completado" 
//backend/backend/backend/routes/clientes.js
import express from 'express';
import Cliente from '../models/Cliente.js';
import mongoose from 'mongoose';
import { 
  obtenerClientes, 
  obtenerClientePorId, 
  crearCliente, 
  actualizarCliente, 
  eliminarCliente 
} from '../controllers/clienteController.js';
import { verificarAdminSoporte } from '../middleware/verificarAdminSoporte.js';

const router = express.Router();

console.log('RUTA CLIENTES CARGADA');

// GET /api/clientes - Obtener todos los clientes (público para lectura)
router.get('/', async (req, res) => {
  try {
    const clientes = await Cliente.find({}).sort({ rzonSocial: 1 });
    res.json(clientes);
  } catch (err) {
    console.error('❌ Error al obtener clientes:', err);
    res.status(500).json({ error: 'Error al obtener clientes', details: err.message });
  }
});

// Rutas de prueba y debug (mantener para desarrollo - deben ir antes de /:id)
router.get('/prueba', (req, res) => {
  res.send('Funciona clientes!');
});

router.get('/test-db', async (req, res) => {
  try {
    console.log('🔍 Probando conexión a la base de datos...');
    console.log('📊 Conexión activa:', mongoose.connection.readyState === 1 ? 'SÍ' : 'NO');
    console.log('📊 Nombre de la base de datos:', mongoose.connection.name);
    console.log('📊 Host:', mongoose.connection.host);
    console.log('📊 Puerto:', mongoose.connection.port);
    
    // Listar todas las colecciones
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('📊 Colecciones disponibles:', collections.map(c => c.name));
    
    res.json({
      connected: mongoose.connection.readyState === 1,
      dbName: mongoose.connection.name,
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      collections: collections.map(c => c.name)
    });
  } catch (error) {
    console.error('❌ Error al probar la base de datos:', error);
    res.status(500).json({ error: 'Error al probar la base de datos', details: error.message });
  }
});

router.get('/raw', async (req, res) => {
  try {
    console.log('🔍 Intentando obtener clientes raw...');
    const docs = await mongoose.connection.db.collection('gsk3cAppcliente').find({}).toArray();
    console.log('✅ Clientes raw encontrados:', docs.length);
    console.log('📋 Primer cliente raw:', docs[0]);
    console.log('📋 Campos del primer cliente raw:', Object.keys(docs[0] || {}));
    res.json(docs);
  } catch (error) {
    console.error('❌ Error al obtener clientes raw:', error);
    res.status(500).json({ error: 'Error al obtener clientes raw', details: error.message });
  }
});

// Rutas protegidas para admin/soporte
// POST /api/clientes - Crear nuevo cliente
router.post('/', verificarAdminSoporte, crearCliente);

// GET /api/clientes/:id - Obtener un cliente por ID (público para lectura)
router.get('/:id', obtenerClientePorId);

// PUT /api/clientes/:id - Actualizar cliente
router.put('/:id', verificarAdminSoporte, actualizarCliente);

// DELETE /api/clientes/:id - Eliminar cliente
router.delete('/:id', verificarAdminSoporte, eliminarCliente);

console.log('Base de datos activa:', Cliente.db.name);

export default router;

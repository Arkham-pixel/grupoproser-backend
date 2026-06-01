import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const MONGO_URI = process.env.MONGO_URI;

// Modelo de prueba mínimo
const ComplexSchema = new mongoose.Schema({
  numero_siniestro: String,
  codigo_workflow: String
});
const Complex = mongoose.model('Complex', ComplexSchema);

// Ruta de prueba
app.post('/api/complex', async (req, res) => {
  try {
    const nuevo = new Complex(req.body);
    await nuevo.save();
    res.status(201).json(nuevo);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅ Conectado a MongoDB');
    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ Error al conectar MongoDB:', err);
  });

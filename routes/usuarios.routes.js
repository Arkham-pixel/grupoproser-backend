import express from 'express';
const router = express.Router();

// Simulación de ranking de usuarios
router.get('/ranking', async (req, res) => {
  // Aquí deberías consultar tu base de datos real
  const ranking = [
    { nombre: 'Juan Pérez', puntos: 120, avatar: '' },
    { nombre: 'Ana Gómez', puntos: 110, avatar: '' },
    { nombre: 'Carlos Ruiz', puntos: 90, avatar: '' }
  ];
  res.json(ranking);
});

export default router; 
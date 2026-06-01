import express from 'express';
import Comunicado from '../models/Comunicado.js';
// import { verificarToken } from '../middleware/auth.js'; // Descomenta si tienes auth

const router = express.Router();

// Listar comunicados
router.get('/', /*verificarToken,*/ async (req, res) => {
  const comunicados = await Comunicado.find();
  res.json(comunicados);
});

// Crear comunicado
router.post('/', /*verificarToken,*/ async (req, res) => {
  const { titulo, mensaje, fecha, fechaFin, duracion } = req.body;
  if (!titulo || !mensaje || !fecha || !fechaFin || !duracion) return res.status(400).json({ mensaje: 'Faltan campos' });
  const comunicado = new Comunicado({ titulo, mensaje, fecha, fechaFin, duracion });
  await comunicado.save();
  res.status(201).json(comunicado);
});

// Editar comunicado
router.put('/:id', /*verificarToken,*/ async (req, res) => {
  const { titulo, mensaje } = req.body;
  const comunicado = await Comunicado.findByIdAndUpdate(req.params.id, { titulo, mensaje }, { new: true });
  if (!comunicado) return res.status(404).json({ mensaje: 'No encontrado' });
  res.json(comunicado);
});

// Eliminar comunicado
router.delete('/:id', /*verificarToken,*/ async (req, res) => {
  const comunicado = await Comunicado.findByIdAndDelete(req.params.id);
  if (!comunicado) return res.status(404).json({ mensaje: 'No encontrado' });
  res.json({ mensaje: 'Eliminado' });
});

export default router; 
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';
import { crearCatalogoCatastroficoCrud } from './catalogoCatastroficoCrud.js';

const crud = crearCatalogoCatastroficoCrud(InspectorCatastrofico, 'inspector catastrófico');

export const listarInspectoresCatastrofico = crud.listar;
export const obtenerInspectorCatastroficoPorId = crud.obtenerPorId;
export const crearInspectorCatastrofico = crud.crear;
export const actualizarInspectorCatastrofico = crud.actualizar;
export const eliminarInspectorCatastrofico = crud.eliminar;

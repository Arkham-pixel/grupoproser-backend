import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import { crearCatalogoCatastroficoCrud } from './catalogoCatastroficoCrud.js';

const crud = crearCatalogoCatastroficoCrud(AjustadorCatastrofico, 'ajustador catastrófico');

export const listarAjustadoresCatastrofico = crud.listar;
export const obtenerAjustadorCatastroficoPorId = crud.obtenerPorId;
export const crearAjustadorCatastrofico = crud.crear;
export const actualizarAjustadorCatastrofico = crud.actualizar;
export const eliminarAjustadorCatastrofico = crud.eliminar;

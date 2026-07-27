import {
  obtenerAlertasCasoExpress,
  obtenerProtocoloExpress,
  obtenerResumenAlertasExpress,
  obtenerTodasAlertasExpress,
  enviarAlertasEmailExpress,
  enviarAlertasTodosExpress,
} from '../services/alertasExpressService.js';

export const getAlertasExpressTodas = async (_req, res) => {
  try {
    const data = await obtenerTodasAlertasExpress();
    return res.json(data);
  } catch (error) {
    console.error('Error alertas Express (todas):', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const getAlertasExpressResumen = async (_req, res) => {
  try {
    const data = await obtenerResumenAlertasExpress();
    return res.json(data);
  } catch (error) {
    console.error('Error resumen alertas Express:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const getAlertasExpressCaso = async (req, res) => {
  try {
    const data = await obtenerAlertasCasoExpress(req.params.id);
    if (!data.success) {
      return res.status(404).json(data);
    }
    return res.json(data);
  } catch (error) {
    console.error('Error alertas Express (caso):', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const getProtocoloExpress = async (_req, res) => {
  try {
    return res.json({ success: true, data: obtenerProtocoloExpress() });
  } catch (error) {
    console.error('Error protocolo Express:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const postEnviarAlertasExpressTodas = async (req, res) => {
  try {
    const forzar = req.query.forzar === 'true' || req.body?.forzar === true;
    const data = await enviarAlertasTodosExpress({ forzar });
    return res.json(data);
  } catch (error) {
    console.error('Error enviando alertas Express (todas):', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export const postEnviarAlertasExpressResponsable = async (req, res) => {
  try {
    const { codigoResponsable } = req.params;
    if (!codigoResponsable) {
      return res.status(400).json({ success: false, error: 'Código de responsable requerido' });
    }
    const forzar = req.query.forzar === 'true' || req.body?.forzar === true;
    const data = await enviarAlertasEmailExpress(codigoResponsable, { forzar });
    return res.json(data);
  } catch (error) {
    console.error('Error enviando alertas Express (responsable):', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

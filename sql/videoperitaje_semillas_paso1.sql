-- =============================================================================
-- Compañías + auditor (SIN suscripción automática)
-- Activar plan solo tras pago: INSERT en compania_suscripciones estado='activa'
-- =============================================================================

INSERT INTO videoperitaje.companias (codigo, nombre)
VALUES
  ('previsora', 'Previsora'),
  ('alfa', 'Seguros Alfa'),
  ('grupoproser', 'Grupo Proser')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO videoperitaje.auditores (
  compania_id, login_arnald, nombre, activo
)
SELECT c.id, '1065012991', 'Auditor Videoperitaje', TRUE
FROM videoperitaje.companias c
WHERE c.codigo = 'grupoproser'
ON CONFLICT (login_arnald) DO UPDATE SET
  activo = TRUE,
  updated_at = NOW();

-- NO insertar suscripciones aquí.
-- Ejemplo de activación manual tras pago:
-- INSERT INTO videoperitaje.compania_suscripciones (compania_id, plan_id, estado)
-- SELECT c.id, p.id, 'activa'
-- FROM videoperitaje.companias c, videoperitaje.planes p
-- WHERE c.codigo = 'bbva' AND p.codigo = 'pro';

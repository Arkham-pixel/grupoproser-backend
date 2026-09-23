-- =============================================================================
-- QA / Grupo Proser · compañía Arnald + fecha/hora programada de videollamada
-- Ejecutar en Postgres VideoPeritaje (Coolify)
-- =============================================================================

-- 1) Compañía Grupo Proser (Arnald)
INSERT INTO videoperitaje.companias (codigo, nombre, nit, activa)
VALUES ('grupoproser', 'Grupo Proser', NULL, TRUE)
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  activa = TRUE,
  updated_at = NOW();

-- Alias interno → mismo tenant (si existe 'interna', la dejamos; el código mapea a grupoproser)
INSERT INTO videoperitaje.companias (codigo, nombre, activa)
VALUES ('interna', 'Grupo Proser (interno)', TRUE)
ON CONFLICT (codigo) DO UPDATE SET activa = TRUE, updated_at = NOW();

-- Plan Pro si no hay suscripción activa
INSERT INTO videoperitaje.compania_suscripciones (compania_id, plan_id, estado)
SELECT c.id, p.id, 'activa'
FROM videoperitaje.companias c
CROSS JOIN videoperitaje.planes p
WHERE c.codigo IN ('grupoproser', 'interna')
  AND p.codigo = 'pro'
  AND NOT EXISTS (
    SELECT 1 FROM videoperitaje.compania_suscripciones s
    WHERE s.compania_id = c.id AND s.estado = 'activa'
  );

-- Auditor Arnald (login de prueba)
INSERT INTO videoperitaje.auditores (compania_id, login_arnald, nombre, activo)
SELECT c.id, '1065012991', 'Auditor Arnald / Grupo Proser', TRUE
FROM videoperitaje.companias c
WHERE c.codigo = 'grupoproser'
ON CONFLICT (login_arnald) DO UPDATE SET
  compania_id = EXCLUDED.compania_id,
  nombre = EXCLUDED.nombre,
  activo = TRUE,
  updated_at = NOW();

-- 2) Fecha/hora programada de la videollamada + ventana de ingreso
ALTER TABLE videoperitaje.sesiones
  ADD COLUMN IF NOT EXISTS programada_at TIMESTAMPTZ;

ALTER TABLE videoperitaje.sesiones
  ADD COLUMN IF NOT EXISTS ventana_antes_min INT NOT NULL DEFAULT 15
    CHECK (ventana_antes_min >= 0);

ALTER TABLE videoperitaje.sesiones
  ADD COLUMN IF NOT EXISTS ventana_despues_min INT NOT NULL DEFAULT 60
    CHECK (ventana_despues_min >= 0);

CREATE INDEX IF NOT EXISTS idx_sesiones_programada
  ON videoperitaje.sesiones (programada_at)
  WHERE programada_at IS NOT NULL;

-- 3) ¿Se puede iniciar la llamada ahora? (hora/fecha + cupo concurrente implícito vía estado)
CREATE OR REPLACE FUNCTION videoperitaje.puede_iniciar_llamada(p_mongo_sesion_id TEXT)
RETURNS TABLE (
  permitido BOOLEAN,
  motivo TEXT,
  programada_at TIMESTAMPTZ,
  ventana_inicio TIMESTAMPTZ,
  ventana_fin TIMESTAMPTZ,
  ahora TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $func$
  SELECT
    CASE
      WHEN s.id IS NULL THEN FALSE
      WHEN s.estado IN ('finalizada', 'cancelada', 'timeout') THEN FALSE
      WHEN s.programada_at IS NULL THEN TRUE
      WHEN NOW() < (s.programada_at - make_interval(mins => s.ventana_antes_min)) THEN FALSE
      WHEN NOW() > (s.programada_at + make_interval(mins => s.ventana_despues_min)) THEN FALSE
      ELSE TRUE
    END AS permitido,
    CASE
      WHEN s.id IS NULL THEN 'sesion_no_encontrada'
      WHEN s.estado IN ('finalizada', 'cancelada', 'timeout') THEN 'sesion_cerrada'
      WHEN s.programada_at IS NULL THEN 'ok_sin_programacion'
      WHEN NOW() < (s.programada_at - make_interval(mins => s.ventana_antes_min)) THEN 'muy_temprano'
      WHEN NOW() > (s.programada_at + make_interval(mins => s.ventana_despues_min)) THEN 'ventana_vencida'
      ELSE 'ok'
    END AS motivo,
    s.programada_at,
    CASE WHEN s.programada_at IS NULL THEN NULL
         ELSE s.programada_at - make_interval(mins => s.ventana_antes_min) END,
    CASE WHEN s.programada_at IS NULL THEN NULL
         ELSE s.programada_at + make_interval(mins => s.ventana_despues_min) END,
    NOW()
  FROM (SELECT p_mongo_sesion_id AS mid) x
  LEFT JOIN videoperitaje.sesiones s ON s.mongo_sesion_id = x.mid;
$func$;

-- Verificación
SELECT codigo, nombre, activa FROM videoperitaje.companias WHERE codigo IN ('grupoproser', 'interna');
SELECT login_arnald, nombre FROM videoperitaje.auditores WHERE login_arnald = '1065012991';

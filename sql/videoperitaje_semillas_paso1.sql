-- =============================================================================
-- Paso 1: semillas de suscripción + auditor interno (Arnald)
-- Ejecutar DESPUÉS de videoperitaje_postgrest.sql
-- =============================================================================

-- Compañías extra usadas por el módulo Arnald
INSERT INTO videoperitaje.companias (codigo, nombre)
VALUES
  ('previsora', 'Previsora'),
  ('alfa', 'Seguros Alfa')
ON CONFLICT (codigo) DO NOTHING;

-- Suscripción activa: plan Pro para todas las compañías activas sin suscripción
INSERT INTO videoperitaje.compania_suscripciones (compania_id, plan_id, estado)
SELECT c.id, p.id, 'activa'
FROM videoperitaje.companias c
CROSS JOIN videoperitaje.planes p
WHERE p.codigo = 'pro'
  AND c.activa = TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM videoperitaje.compania_suscripciones s
    WHERE s.compania_id = c.id
      AND s.estado = 'activa'
  );

-- Auditor de prueba (login Arnald / LOGINS_VIDEOPERITAJE)
INSERT INTO videoperitaje.auditores (
  compania_id, login_arnald, nombre, activo
)
SELECT c.id, '1065012991', 'Auditor Videoperitaje', TRUE
FROM videoperitaje.companias c
WHERE c.codigo = 'interna'
ON CONFLICT (login_arnald) DO UPDATE SET
  activo = TRUE,
  updated_at = NOW();

-- Verificación
SELECT
  c.codigo,
  c.nombre,
  p.codigo AS plan,
  s.estado,
  COALESCE(s.sesiones_por_semana_override, p.sesiones_por_semana) AS cupo_semana,
  COALESCE(s.sesiones_concurrentes_override, p.sesiones_concurrentes_max) AS concurrentes
FROM videoperitaje.companias c
JOIN videoperitaje.compania_suscripciones s ON s.compania_id = c.id AND s.estado = 'activa'
JOIN videoperitaje.planes p ON p.id = s.plan_id
ORDER BY c.codigo;

SELECT login_arnald, nombre, activo
FROM videoperitaje.auditores;

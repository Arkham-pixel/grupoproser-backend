-- =============================================================================
-- Videoperitaje · esquema Postgres / PostgREST
-- Ejecutar TODO el archivo de una vez (psql o pgAdmin: Execute script / F5).
-- No ejecutar solo la linea del VIEW.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS videoperitaje;

-- -----------------------------------------------------------------------------
-- 1) Companias
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS videoperitaje.companias (
  id              BIGSERIAL PRIMARY KEY,
  codigo          TEXT NOT NULL UNIQUE,
  nombre          TEXT NOT NULL,
  nit             TEXT,
  activa          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2) Planes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS videoperitaje.planes (
  id                         BIGSERIAL PRIMARY KEY,
  codigo                     TEXT NOT NULL UNIQUE,
  nombre                     TEXT NOT NULL,
  sesiones_por_semana        INT NOT NULL DEFAULT 20
    CHECK (sesiones_por_semana >= 0),
  sesiones_concurrentes_max  INT NOT NULL DEFAULT 2
    CHECK (sesiones_concurrentes_max >= 1),
  duracion_max_minutos       INT NOT NULL DEFAULT 60
    CHECK (duracion_max_minutos BETWEEN 1 AND 240),
  activa                     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 3) Suscripciones
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS videoperitaje.compania_suscripciones (
  id                              BIGSERIAL PRIMARY KEY,
  compania_id                     BIGINT NOT NULL
    REFERENCES videoperitaje.companias(id) ON DELETE RESTRICT,
  plan_id                         BIGINT NOT NULL
    REFERENCES videoperitaje.planes(id) ON DELETE RESTRICT,
  estado                          TEXT NOT NULL DEFAULT 'activa'
    CHECK (estado IN ('activa', 'suspendida', 'vencida')),
  fecha_inicio                    DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin                       DATE,
  sesiones_por_semana_override    INT
    CHECK (sesiones_por_semana_override IS NULL OR sesiones_por_semana_override >= 0),
  sesiones_concurrentes_override  INT
    CHECK (sesiones_concurrentes_override IS NULL OR sesiones_concurrentes_override >= 1),
  duracion_max_minutos_override   INT
    CHECK (
      duracion_max_minutos_override IS NULL
      OR duracion_max_minutos_override BETWEEN 1 AND 240
    ),
  notas                           TEXT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_suscripcion_activa_por_compania
  ON videoperitaje.compania_suscripciones (compania_id)
  WHERE (estado = 'activa');

CREATE INDEX IF NOT EXISTS idx_suscripciones_compania
  ON videoperitaje.compania_suscripciones (compania_id, estado);

-- -----------------------------------------------------------------------------
-- 4) Auditores (Arnald)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS videoperitaje.auditores (
  id                BIGSERIAL PRIMARY KEY,
  compania_id       BIGINT NOT NULL
    REFERENCES videoperitaje.companias(id) ON DELETE RESTRICT,
  user_id_arnald    TEXT,
  login_arnald      TEXT NOT NULL,
  nombre            TEXT NOT NULL DEFAULT '',
  email             TEXT,
  telefono          TEXT,
  activo            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_auditor_login UNIQUE (login_arnald)
);

CREATE INDEX IF NOT EXISTS idx_auditores_compania
  ON videoperitaje.auditores (compania_id)
  WHERE (activo = TRUE);

-- -----------------------------------------------------------------------------
-- 5) Sesiones
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS videoperitaje.sesiones (
  id                        BIGSERIAL PRIMARY KEY,
  uuid                      UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  mongo_sesion_id           TEXT UNIQUE,
  modulo                    TEXT NOT NULL DEFAULT '',
  caso_id                   TEXT,
  expediente                TEXT,
  siniestro                 TEXT,
  livekit_room              TEXT,
  origen                    TEXT NOT NULL DEFAULT 'arnald'
    CHECK (origen IN ('arnald', 'synergy', 'otro')),
  compania_id               BIGINT NOT NULL
    REFERENCES videoperitaje.companias(id) ON DELETE RESTRICT,
  auditor_id                BIGINT
    REFERENCES videoperitaje.auditores(id) ON DELETE SET NULL,
  identificacion_asegurado  TEXT,
  nombre_asegurado          TEXT NOT NULL DEFAULT '',
  telefono                  TEXT,
  correo                    TEXT,
  estado                    TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN (
      'pendiente', 'en_proceso', 'finalizada', 'cancelada', 'timeout'
    )),
  iniciada_at               TIMESTAMPTZ,
  finalizada_at             TIMESTAMPTZ,
  duracion_segundos         INT NOT NULL DEFAULT 0
    CHECK (duracion_segundos >= 0),
  duracion_max_minutos      INT NOT NULL DEFAULT 60,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notas                     TEXT,
  -- Semana ISO: 2026-W38 (se calcula en trigger; GENERATED no admite to_char/timestamptz)
  semana_iso                TEXT NOT NULL DEFAULT ''
);

-- Zona fija Colombia: EXTRACT sobre timestamptz no es IMMUTABLE (depende de TimeZone)
CREATE OR REPLACE FUNCTION videoperitaje.fn_semana_iso(p_ts TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $func$
  SELECT
    to_char((p_ts AT TIME ZONE 'America/Bogota'), 'IYYY')
    || '-W'
    || to_char((p_ts AT TIME ZONE 'America/Bogota'), 'IW');
$func$;

CREATE OR REPLACE FUNCTION videoperitaje.tg_sesiones_semana_iso()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
BEGIN
  NEW.semana_iso := videoperitaje.fn_semana_iso(COALESCE(NEW.iniciada_at, NEW.created_at, NOW()));
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_sesiones_semana_iso ON videoperitaje.sesiones;
CREATE TRIGGER trg_sesiones_semana_iso
  BEFORE INSERT OR UPDATE OF iniciada_at, created_at
  ON videoperitaje.sesiones
  FOR EACH ROW
  EXECUTE PROCEDURE videoperitaje.tg_sesiones_semana_iso();

CREATE INDEX IF NOT EXISTS idx_sesiones_compania_semana
  ON videoperitaje.sesiones (compania_id, semana_iso);

CREATE INDEX IF NOT EXISTS idx_sesiones_compania_estado
  ON videoperitaje.sesiones (compania_id, estado);

CREATE INDEX IF NOT EXISTS idx_sesiones_auditor
  ON videoperitaje.sesiones (auditor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sesiones_mongo
  ON videoperitaje.sesiones (mongo_sesion_id)
  WHERE (mongo_sesion_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_sesiones_modulo_caso
  ON videoperitaje.sesiones (modulo, caso_id);

-- -----------------------------------------------------------------------------
-- 6) Eventos / logs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS videoperitaje.sesion_eventos (
  id              BIGSERIAL PRIMARY KEY,
  sesion_id       BIGINT NOT NULL
    REFERENCES videoperitaje.sesiones(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL
    CHECK (tipo IN (
      'connect', 'disconnect', 'rejoin', 'timeout',
      'force_end', 'invite_sent', 'room_created', 'room_closed'
    )),
  rol             TEXT
    CHECK (rol IS NULL OR rol IN ('auditor', 'asegurado', 'sistema')),
  actor_login     TEXT,
  at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_eventos_sesion_at
  ON videoperitaje.sesion_eventos (sesion_id, at);

CREATE INDEX IF NOT EXISTS idx_eventos_tipo_at
  ON videoperitaje.sesion_eventos (tipo, at DESC);

-- -----------------------------------------------------------------------------
-- 7) Vista de cupo (sin subqueries correlacionadas en el SELECT)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW videoperitaje.v_cupo_compania AS
SELECT
  c.id AS compania_id,
  c.codigo AS compania_codigo,
  c.nombre AS compania_nombre,
  s.id AS suscripcion_id,
  s.estado AS suscripcion_estado,
  p.codigo AS plan_codigo,
  COALESCE(s.sesiones_por_semana_override, p.sesiones_por_semana) AS sesiones_por_semana,
  COALESCE(s.sesiones_concurrentes_override, p.sesiones_concurrentes_max) AS sesiones_concurrentes_max,
  COALESCE(s.duracion_max_minutos_override, p.duracion_max_minutos) AS duracion_max_minutos,
  (videoperitaje.fn_semana_iso(NOW())) AS semana_iso_actual,
  COALESCE(uso.sesiones_usadas_semana, 0) AS sesiones_usadas_semana,
  COALESCE(conc.sesiones_concurrentes_ahora, 0) AS sesiones_concurrentes_ahora
FROM videoperitaje.companias c
INNER JOIN videoperitaje.compania_suscripciones s
  ON s.compania_id = c.id
 AND s.estado = 'activa'
INNER JOIN videoperitaje.planes p
  ON p.id = s.plan_id
LEFT JOIN (
  SELECT
    se.compania_id,
    COUNT(*)::INT AS sesiones_usadas_semana
  FROM videoperitaje.sesiones se
  WHERE se.semana_iso = videoperitaje.fn_semana_iso(NOW())
    AND se.estado <> 'cancelada'
  GROUP BY se.compania_id
) uso ON uso.compania_id = c.id
LEFT JOIN (
  SELECT
    se.compania_id,
    COUNT(*)::INT AS sesiones_concurrentes_ahora
  FROM videoperitaje.sesiones se
  WHERE se.estado = 'en_proceso'
  GROUP BY se.compania_id
) conc ON conc.compania_id = c.id
WHERE c.activa = TRUE;

-- -----------------------------------------------------------------------------
-- 8) Funcion: puede iniciar sesion?
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION videoperitaje.puede_iniciar_sesion(p_compania_id BIGINT)
RETURNS TABLE (
  permitido BOOLEAN,
  motivo TEXT,
  sesiones_por_semana INT,
  sesiones_usadas_semana INT,
  sesiones_concurrentes_max INT,
  sesiones_concurrentes_ahora INT,
  duracion_max_minutos INT
)
LANGUAGE sql
STABLE
AS $func$
  SELECT
    CASE
      WHEN v.compania_id IS NULL THEN FALSE
      WHEN v.sesiones_usadas_semana >= v.sesiones_por_semana THEN FALSE
      WHEN v.sesiones_concurrentes_ahora >= v.sesiones_concurrentes_max THEN FALSE
      ELSE TRUE
    END AS permitido,
    CASE
      WHEN v.compania_id IS NULL THEN 'sin_suscripcion_activa'
      WHEN v.sesiones_usadas_semana >= v.sesiones_por_semana THEN 'cupo_semanal_agotado'
      WHEN v.sesiones_concurrentes_ahora >= v.sesiones_concurrentes_max THEN 'max_concurrentes'
      ELSE 'ok'
    END AS motivo,
    COALESCE(v.sesiones_por_semana, 0),
    COALESCE(v.sesiones_usadas_semana, 0),
    COALESCE(v.sesiones_concurrentes_max, 0),
    COALESCE(v.sesiones_concurrentes_ahora, 0),
    COALESCE(v.duracion_max_minutos, 60)
  FROM (SELECT p_compania_id AS id) x
  LEFT JOIN videoperitaje.v_cupo_compania v ON v.compania_id = x.id;
$func$;

-- -----------------------------------------------------------------------------
-- 9) Semillas
-- -----------------------------------------------------------------------------
INSERT INTO videoperitaje.planes (codigo, nombre, sesiones_por_semana, sesiones_concurrentes_max, duracion_max_minutos)
VALUES
  ('basico', 'Basico', 20, 2, 60),
  ('pro', 'Pro', 50, 5, 60),
  ('enterprise', 'Enterprise', 200, 15, 60)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO videoperitaje.companias (codigo, nombre)
VALUES
  ('bbva', 'BBVA'),
  ('zurich', 'Zurich'),
  ('equidad', 'La Equidad'),
  ('allianz', 'Allianz'),
  ('sura', 'SURA'),
  ('interna', 'Grupo Proser (interno)')
ON CONFLICT (codigo) DO NOTHING;

-- Ejemplo suscripcion BBVA plan Pro (descomentar si aplica):
-- INSERT INTO videoperitaje.compania_suscripciones (compania_id, plan_id, estado)
-- SELECT c.id, p.id, 'activa'
-- FROM videoperitaje.companias c
-- CROSS JOIN videoperitaje.planes p
-- WHERE c.codigo = 'bbva' AND p.codigo = 'pro';

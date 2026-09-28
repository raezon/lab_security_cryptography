-- =============================================================================
-- TP2 — Étape 3 : Row Level Security (un manager ne voit que son département)
-- Exécution : /lab/scripts/pg-admin.sh -f /lab/scripts/sql/tp2/<fichier>
-- =============================================================================
\set ON_ERROR_STOP on

-- -----------------------------------------------------------------------------
-- 2. Row Level Security sur rh.employes
-- -----------------------------------------------------------------------------
CREATE TABLE rh.habilitations (
    login        text NOT NULL,
    departement  text NOT NULL,
    PRIMARY KEY (login, departement)
);
GRANT SELECT ON rh.habilitations TO r_rh_manager;

INSERT INTO rh.habilitations VALUES ('nadia', 'Finance');   -- Nadia gère le département Finance

ALTER TABLE rh.employes ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_rh_manager_departement ON rh.employes
  FOR SELECT TO r_rh_manager
  USING (departement IN (SELECT h.departement FROM rh.habilitations h WHERE h.login = current_user));

CREATE POLICY p_lecture_complete ON rh.employes
  FOR SELECT TO r_data_engineer, analytics_owner
  USING (true);


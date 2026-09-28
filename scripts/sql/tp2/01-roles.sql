-- =============================================================================
-- TP2 — Étape 1 : rôles fonctionnels (ce que l'on fait)
-- Exécution : /lab/scripts/pg-admin.sh -f /lab/scripts/sql/tp2/<fichier>
-- =============================================================================
\set ON_ERROR_STOP on

-- -----------------------------------------------------------------------------
-- 1. Rôles fonctionnels (groupes, NOLOGIN) = ce que l'on fait
-- -----------------------------------------------------------------------------
CREATE ROLE r_data_engineer NOLOGIN;
CREATE ROLE r_data_analyst  NOLOGIN;
CREATE ROLE r_dpo           NOLOGIN;
CREATE ROLE r_rh_manager    NOLOGIN;
CREATE ROLE r_sysadmin      NOLOGIN;
CREATE ROLE r_secops        NOLOGIN;
CREATE ROLE analytics_owner NOLOGIN;   -- propriétaire technique des vues (personne ne s'y connecte)

GRANT CONNECT ON DATABASE datacorp
  TO r_data_engineer, r_data_analyst, r_dpo, r_rh_manager, r_sysadmin, r_secops;

-- Data Engineer : finance en lecture/écriture, RH SANS les colonnes RESTREINT
GRANT USAGE ON SCHEMA finance, rh, analytics TO r_data_engineer;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA finance TO r_data_engineer;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA finance TO r_data_engineer;
GRANT SELECT (id, matricule, departement, poste, date_embauche, manager_id)
  ON rh.employes TO r_data_engineer;                       -- privilèges par COLONNE

-- Analyste : uniquement le schéma analytics (les vues seront publiées après validation DPO)
GRANT USAGE ON SCHEMA analytics TO r_data_analyst;

-- DPO : pilote la gouvernance, consulte les vues pour les valider, jamais les données brutes
GRANT USAGE ON SCHEMA gouvernance, analytics TO r_dpo;
GRANT SELECT, UPDATE ON gouvernance.registre_traitements, gouvernance.classification_donnees TO r_dpo;
GRANT SELECT, INSERT ON gouvernance.validations_dpo TO r_dpo;
GRANT USAGE ON SEQUENCE gouvernance.validations_dpo_id_seq TO r_dpo;
GRANT SELECT ON gouvernance.validations_dpo TO r_data_engineer, analytics_owner;
GRANT USAGE ON SCHEMA gouvernance TO r_data_engineer, analytics_owner;

-- Manager RH : lit les fiches de SON département uniquement (RLS plus bas)
GRANT USAGE ON SCHEMA rh TO r_rh_manager;
GRANT SELECT (id, matricule, nom, prenom, email, telephone, departement, poste,
              date_embauche, salaire_brut_annuel, manager_id)
  ON rh.employes TO r_rh_manager;                          -- ni NIR ni IBAN

-- SysAdmin : exploite l'instance, ne lit AUCUNE donnée métier
GRANT pg_monitor, pg_signal_backend TO r_sysadmin;

-- SecOps : lit la configuration de sécurité et la gouvernance
GRANT pg_read_all_settings TO r_secops;
GRANT USAGE ON SCHEMA gouvernance TO r_secops;
GRANT SELECT ON ALL TABLES IN SCHEMA gouvernance TO r_secops;


-- =============================================================================
--  TP3 — Étape 1 : activation de l'audit PostgreSQL (pgAudit)
--  /lab/scripts/pg-admin.sh -f /lab/scripts/sql/tp3/01-audit.sql
-- =============================================================================
\set ON_ERROR_STOP on

-- 1. Audit de SESSION : classes d'événements journalisées pour tout le monde
--    ddl  = CREATE/ALTER/DROP      role = GRANT/REVOKE/CREATE ROLE
--    (read/write ne sont PAS activés globalement : trop de volume, trop de données perso)
ALTER SYSTEM SET pgaudit.log = 'ddl, role';
ALTER SYSTEM SET pgaudit.log_catalog = off;       -- ignorer le bruit des requêtes sur pg_catalog
ALTER SYSTEM SET pgaudit.log_parameter = off;     -- ne pas recopier les valeurs (données perso) dans les logs
ALTER SYSTEM SET pgaudit.log_rows = on;           -- nombre de lignes lues/écrites : clé pour détecter une exfiltration

-- 2. Audit OBJET : on journalise uniquement les accès aux tables RESTREINT
--    Principe pgAudit : toute action pour laquelle le rôle "auditeur" possède
--    le privilège est journalisée, quel que soit l'utilisateur qui l'exécute.
CREATE ROLE auditeur NOLOGIN;
ALTER SYSTEM SET pgaudit.role = 'auditeur';
GRANT SELECT, UPDATE, DELETE ON rh.employes TO auditeur;
GRANT SELECT (iban), UPDATE, DELETE ON finance.clients TO auditeur;
GRANT SELECT, UPDATE, DELETE ON securite.cles TO auditeur;
GRANT UPDATE, DELETE ON finance.transactions TO auditeur;

-- 3. Connexions / déconnexions (détection brute force, comptes dormants)
ALTER SYSTEM SET log_connections = on;
ALTER SYSTEM SET log_disconnections = on;

SELECT pg_reload_conf();

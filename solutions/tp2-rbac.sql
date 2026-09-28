-- =============================================================================
--  TP2 — CORRIGÉ FORMATEUR : RBAC, RLS, vues pseudonymisées, validation DPO
--
--  Exécution (depuis le poste hôte) :
--    docker compose exec -T -u postgres postgres psql -d datacorp \
--        -v pw_alice="$(openssl rand -base64 18)" -v pw_bruno=... \
--        -f /lab/solutions/tp2-rbac.sql
--  ou via scripts/tp2-create-users.sh qui génère les mots de passe et les
--  range dans Vault.
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

-- -----------------------------------------------------------------------------
-- 2. Row Level Security sur rh.employes
-- -----------------------------------------------------------------------------
CREATE TABLE rh.habilitations (
    login        text NOT NULL,
    departement  text NOT NULL,
    PRIMARY KEY (login, departement)
);
GRANT SELECT ON rh.habilitations TO r_rh_manager;

ALTER TABLE rh.employes ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_rh_manager_departement ON rh.employes
  FOR SELECT TO r_rh_manager
  USING (departement IN (SELECT h.departement FROM rh.habilitations h WHERE h.login = current_user));

CREATE POLICY p_lecture_complete ON rh.employes
  FOR SELECT TO r_data_engineer, analytics_owner
  USING (true);

-- -----------------------------------------------------------------------------
-- 3. Clé de pseudonymisation (jamais visible des analystes)
-- -----------------------------------------------------------------------------
CREATE SCHEMA securite;
REVOKE ALL ON SCHEMA securite FROM PUBLIC;
CREATE TABLE securite.cles (nom text PRIMARY KEY, valeur bytea NOT NULL, creee_le timestamptz DEFAULT now());
INSERT INTO securite.cles (nom, valeur) VALUES ('pseudonymisation', gen_random_bytes(32));
GRANT USAGE ON SCHEMA securite TO analytics_owner;
GRANT SELECT ON securite.cles TO analytics_owner;

-- -----------------------------------------------------------------------------
-- 4. Vues anonymisées / pseudonymisées (propriété d'analytics_owner)
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA rh, finance TO analytics_owner;
GRANT SELECT ON rh.employes, finance.transactions, finance.clients TO analytics_owner;
GRANT CREATE, USAGE ON SCHEMA analytics TO analytics_owner;
GRANT USAGE ON SCHEMA public TO analytics_owner;               -- fonctions pgcrypto (hmac)

SET ROLE analytics_owner;

CREATE FUNCTION analytics.masquer_email(e text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT left(e, 1) || '***@' || split_part(e, '@', 2)
$$;

CREATE FUNCTION analytics.masquer_iban(i text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN i LIKE 'vault:%' THEN '[chiffré]'
              ELSE left(i, 4) || ' **** **** **** **** ***' || right(i, 4) END
$$;

-- Pseudonyme stable (HMAC-SHA256 avec clé secrète) : permet les jointures
-- entre vues sans révéler l'identité, et n'est pas réversible par force brute
-- sans la clé (contrairement à un simple sha256(matricule)).
CREATE VIEW analytics.v_employes WITH (security_barrier = true) AS
SELECT left(encode(public.hmac(convert_to(e.matricule, 'UTF8'), k.valeur, 'sha256'), 'hex'), 16)      AS id_pseudo,
       analytics.masquer_email(e.email)                                     AS email_masque,
       e.departement,
       e.poste,
       (10 * floor(date_part('year', age(e.date_naissance)) / 10))::int
         || '-' || (10 * floor(date_part('year', age(e.date_naissance)) / 10) + 9)::int
                                                                            AS tranche_age,
       date_part('year', e.date_embauche)::int                              AS annee_embauche,
       (10 * floor(e.salaire_brut_annuel / 10000))::int || '-'
         || (10 * floor(e.salaire_brut_annuel / 10000) + 10)::int || ' k€'  AS tranche_salaire
FROM rh.employes e
CROSS JOIN (SELECT valeur FROM securite.cles WHERE nom = 'pseudonymisation') k;

CREATE VIEW analytics.v_transactions WITH (security_barrier = true) AS
SELECT t.reference,
       date_trunc('day', t.date_operation)::date                            AS date_operation,
       c.raison_sociale                                                     AS client,
       c.pays,
       left(encode(public.hmac(convert_to(e.matricule, 'UTF8'), k.valeur, 'sha256'), 'hex'), 16)       AS gestionnaire_pseudo,
       analytics.masquer_iban(t.iban_contrepartie)                          AS iban_masque,
       t.montant, t.devise, t.categorie, t.statut, t.source
FROM finance.transactions t
JOIN finance.clients c ON c.id = t.client_id
LEFT JOIN rh.employes e ON e.id = t.employe_id
CROSS JOIN (SELECT valeur FROM securite.cles WHERE nom = 'pseudonymisation') k;

-- Agrégat avec seuil de k-anonymat : aucun groupe de moins de 5 personnes
CREATE VIEW analytics.v_salaires_par_departement AS
SELECT departement, poste, count(*) AS effectif,
       round(avg(salaire_brut_annuel), -2) AS salaire_moyen,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY salaire_brut_annuel)::numeric, -2) AS salaire_median
FROM rh.employes
GROUP BY departement, poste
HAVING count(*) >= 5;

-- Publication contrôlée : une vue n'est accessible aux analystes que si le DPO
-- l'a APPROUVÉE (contrôle "4 yeux" : le Data Engineer ne peut pas s'auto-valider)
CREATE FUNCTION analytics.publier_vue(p_vue text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_decision text;
BEGIN
  SELECT decision INTO v_decision
  FROM gouvernance.validations_dpo
  WHERE objet = p_vue
  ORDER BY valide_le DESC, id DESC LIMIT 1;

  IF v_decision IS DISTINCT FROM 'APPROUVE' THEN
    RAISE EXCEPTION 'Publication refusée : % n''a pas été approuvée par le DPO (dernière décision : %)',
                    p_vue, coalesce(v_decision, 'aucune');
  END IF;

  EXECUTE format('GRANT SELECT ON %s TO r_data_analyst, r_dpo, r_data_engineer', p_vue::regclass);
  RETURN format('%s publiée pour r_data_analyst (validation DPO : APPROUVE)', p_vue);
END $$;

RESET ROLE;

REVOKE ALL ON FUNCTION analytics.publier_vue(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics.publier_vue(text) TO r_data_engineer;
-- Le DPO doit pouvoir consulter les vues AVANT de les valider
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO r_dpo;

-- -----------------------------------------------------------------------------
-- 5. Comptes nominatifs (LOGIN) = qui l'on est
-- -----------------------------------------------------------------------------
CREATE ROLE alice  LOGIN PASSWORD :'pw_alice'  IN ROLE r_data_engineer;  -- Data Engineer
CREATE ROLE bruno  LOGIN PASSWORD :'pw_bruno'  IN ROLE r_data_analyst;   -- Data Analyst
CREATE ROLE claire LOGIN PASSWORD :'pw_claire' IN ROLE r_dpo;            -- DPO
CREATE ROLE david  LOGIN PASSWORD :'pw_david'  IN ROLE r_sysadmin;       -- SysAdmin
CREATE ROLE samira LOGIN PASSWORD :'pw_samira' IN ROLE r_secops;         -- Data Security Engineer
CREATE ROLE nadia  LOGIN PASSWORD :'pw_nadia'  IN ROLE r_rh_manager;     -- Manager RH (Finance)

INSERT INTO rh.habilitations VALUES ('nadia', 'Finance');

-- Comptes à durée de vie limitée (fin de mission / stage)
ALTER ROLE bruno VALID UNTIL '2027-06-30';

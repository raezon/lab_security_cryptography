-- =============================================================================
--  DataCorp Secure — Projet fil rouge "Sécurité de la chaîne de valeur Data"
--  01-datacorp-schema.sql : schémas, tables et jeu de données FICTIF
--
--  Exécuté automatiquement au premier démarrage du conteneur PostgreSQL
--  (répertoire /docker-entrypoint-initdb.d), dans la base "datacorp".
--
--  ⚠ Toutes les données sont générées aléatoirement (noms, NIR, IBAN...).
--    Elles ressemblent volontairement à des données réelles pour rendre les
--    exercices de classification / masquage réalistes, mais ne correspondent
--    à aucune personne existante.
-- =============================================================================

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgaudit;

-- Durcissement de base : personne n'a de droit implicite sur la base
REVOKE ALL ON DATABASE datacorp FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- Schémas métier
-- -----------------------------------------------------------------------------
CREATE SCHEMA rh;           -- Données RH (très sensibles : NIR, salaires, IBAN)
CREATE SCHEMA finance;      -- Données financières (transactions, clients)
CREATE SCHEMA analytics;    -- Vues masquées / pseudonymisées pour les analystes (TP2)
CREATE SCHEMA gouvernance;  -- Registre RGPD, classification, validations DPO

COMMENT ON SCHEMA rh          IS 'Données RH - classification RESTREINT';
COMMENT ON SCHEMA finance     IS 'Données financières - classification CONFIDENTIEL';
COMMENT ON SCHEMA analytics   IS 'Données pseudonymisées pour l''analyse - classification INTERNE';
COMMENT ON SCHEMA gouvernance IS 'Pilotage GRC / RGPD - classification INTERNE';

-- -----------------------------------------------------------------------------
-- rh.employes
-- -----------------------------------------------------------------------------
CREATE TABLE rh.employes (
    id                  serial PRIMARY KEY,
    matricule           text UNIQUE NOT NULL,
    nom                 text NOT NULL,
    prenom              text NOT NULL,
    email               text NOT NULL,
    telephone           text,
    nir                 char(15) NOT NULL,       -- n° de sécurité sociale (fictif)
    iban                text NOT NULL,           -- en clair : c'est le problème traité au TP1
    date_naissance      date NOT NULL,
    date_embauche       date NOT NULL,
    departement         text NOT NULL,
    poste               text NOT NULL,
    salaire_brut_annuel numeric(10,2) NOT NULL,
    manager_id          int REFERENCES rh.employes(id)
);

-- -----------------------------------------------------------------------------
-- finance.clients / finance.transactions
-- -----------------------------------------------------------------------------
CREATE TABLE finance.clients (
    id              serial PRIMARY KEY,
    raison_sociale  text NOT NULL,
    siren           char(9) NOT NULL,
    contact_nom     text NOT NULL,
    contact_email   text NOT NULL,
    iban            text NOT NULL,
    pays            char(2) NOT NULL DEFAULT 'FR',
    cree_le         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.transactions (
    id                bigserial PRIMARY KEY,
    reference         text UNIQUE NOT NULL,
    date_operation    timestamptz NOT NULL,
    client_id         int REFERENCES finance.clients(id),
    employe_id        int REFERENCES rh.employes(id),   -- gestionnaire du dossier
    iban_contrepartie text NOT NULL,                   -- clair (historique) ou "vault:vN:..." (pipeline)
    montant           numeric(12,2) NOT NULL,
    devise            char(3) NOT NULL DEFAULT 'EUR',
    categorie         text NOT NULL,
    statut            text NOT NULL DEFAULT 'VALIDEE',
    source            text NOT NULL DEFAULT 'historique',  -- 'historique' | 'pipeline'
    ingere_par        text NOT NULL DEFAULT current_user,  -- traçabilité : quel compte a inséré
    ingere_le         timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Gouvernance / RGPD
-- -----------------------------------------------------------------------------
CREATE TABLE gouvernance.registre_traitements (      -- RGPD art. 30
    id                 serial PRIMARY KEY,
    nom_traitement     text NOT NULL,
    finalite           text NOT NULL,
    base_legale        text NOT NULL,
    categories_donnees text NOT NULL,
    personnes_concernees text NOT NULL,
    destinataires      text NOT NULL,
    duree_conservation text NOT NULL,
    mesures_securite   text NOT NULL,
    responsable        text NOT NULL
);

CREATE TABLE gouvernance.classification_donnees (
    schema_name        text NOT NULL,
    table_name         text NOT NULL,
    column_name        text NOT NULL,
    niveau             text NOT NULL CHECK (niveau IN ('PUBLIC','INTERNE','CONFIDENTIEL','RESTREINT')),
    donnee_personnelle boolean NOT NULL,
    categorie_rgpd     text,           -- identification, financière, NIR (art. 87 / décret CNIL)...
    traitement_requis  text NOT NULL CHECK (traitement_requis IN ('AUCUN','MASQUER','PSEUDONYMISER','GENERALISER','CHIFFRER','SUPPRIMER')),
    PRIMARY KEY (schema_name, table_name, column_name)
);

CREATE TABLE gouvernance.validations_dpo (
    id          serial PRIMARY KEY,
    objet       text NOT NULL,           -- ex: 'analytics.v_employes'
    decision    text NOT NULL CHECK (decision IN ('APPROUVE','REFUSE','A_REVOIR')),
    commentaire text,
    valide_par  text NOT NULL DEFAULT current_user,
    valide_le   timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- Génération du jeu de données (déterministe grâce à setseed)
-- =============================================================================
SELECT setseed(0.2026) \g /dev/null

-- Fonctions utilitaires de génération (supprimées en fin de script)
CREATE FUNCTION pg_temp.chiffres(n int) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg((floor(random()*10))::int::text, '') FROM generate_series(1, n)
$$;

-- IBAN français fictif (format FR76 + 23 chiffres, clé non contrôlée)
CREATE FUNCTION pg_temp.iban_fictif() RETURNS text LANGUAGE sql AS $$
  SELECT 'FR76' || pg_temp.chiffres(23)
$$;

-- NIR fictif : sexe(1) + AA(2) + MM(2) + dept(2) + commune(3) + ordre(3) + clé(2)
CREATE FUNCTION pg_temp.nir_fictif(sexe int, naissance date) RETURNS text LANGUAGE sql AS $$
  WITH base AS (
    SELECT sexe::text
        || to_char(naissance, 'YY') || to_char(naissance, 'MM')
        || lpad((1 + floor(random()*95))::int::text, 2, '0')
        || pg_temp.chiffres(6) AS b
  )
  SELECT b || lpad((97 - (b::numeric % 97))::int::text, 2, '0') FROM base
$$;

WITH
prenoms AS (SELECT ARRAY['Camille','Lucas','Léa','Hugo','Chloé','Nathan','Manon','Yanis','Inès','Louis',
                         'Sarah','Adam','Emma','Rayan','Jade','Mehdi','Lina','Thomas','Amira','Paul',
                         'Nora','Karim','Julie','Antoine','Salomé','Bilal','Clara','Mathis','Yasmine','Enzo'] AS a),
noms AS    (SELECT ARRAY['Martin','Bernard','Dubois','Thomas','Robert','Richard','Petit','Durand','Leroy','Moreau',
                         'Simon','Laurent','Lefebvre','Michel','Garcia','David','Bertrand','Roux','Vincent','Fournier',
                         'Benali','Nguyen','Haddad','Rossi','Da Silva','Mercier','Boyer','Blanc','Guerin','Chevalier'] AS a),
depts AS   (SELECT ARRAY['Finance','RH','IT','Data','Commercial','Juridique','Support'] AS a),
postes AS  (SELECT ARRAY['Analyste','Chargé(e) de mission','Ingénieur(e)','Responsable','Consultant(e)','Assistant(e)'] AS a),
gen AS (
  SELECT g AS n,
         p.a[1 + floor(random()*30)::int]            AS prenom,
         nm.a[1 + floor(random()*30)::int]           AS nom,
         d.a[1 + floor(random()*7)::int]             AS departement,
         po.a[1 + floor(random()*6)::int]            AS poste,
         date '1965-01-01' + (random() * 13000)::int AS date_naissance,
         1 + floor(random()*2)::int                  AS sexe
  FROM generate_series(1, 200) g
  CROSS JOIN prenoms p CROSS JOIN noms nm CROSS JOIN depts d CROSS JOIN postes po
)
INSERT INTO rh.employes (matricule, nom, prenom, email, telephone, nir, iban,
                         date_naissance, date_embauche, departement, poste, salaire_brut_annuel)
SELECT 'DC' || lpad(n::text, 5, '0'),
       upper(nom), prenom,
       lower(translate(prenom, 'éèëÉ', 'eeeE')) || '.' || lower(replace(nom, ' ', '')) || n || '@datacorp-secure.example',
       '06' || pg_temp.chiffres(8),
       pg_temp.nir_fictif(sexe, date_naissance),
       pg_temp.iban_fictif(),
       date_naissance,
       date '2012-01-01' + (random() * 5000)::int,
       departement, poste,
       round((32000 + random() * 68000)::numeric, -2)
FROM gen;

-- Hiérarchie : chaque employé est rattaché à un "Responsable" de son département
UPDATE rh.employes e
SET    manager_id = m.id
FROM  (SELECT DISTINCT ON (departement) id, departement
       FROM rh.employes WHERE poste = 'Responsable' ORDER BY departement, id) m
WHERE  e.departement = m.departement AND e.id <> m.id;

-- Clients (sociétés fictives)
INSERT INTO finance.clients (raison_sociale, siren, contact_nom, contact_email, iban, pays)
SELECT (ARRAY['Alpha','Nova','Horizon','Atlas','Orion','Vega','Delta','Nexus','Zenith','Aurora'])[1 + floor(random()*10)::int]
       || ' ' || (ARRAY['Conseil','Industrie','Logistique','Santé','Retail','Energie','Services','Immobilier'])[1 + floor(random()*8)::int]
       || ' ' || g,
       pg_temp.chiffres(9),
       (ARRAY['M. Petit','Mme Garnier','M. Faure','Mme Rousseau','M. Colin'])[1 + floor(random()*5)::int],
       'contact' || g || '@client-' || g || '.example',
       pg_temp.iban_fictif(),
       (ARRAY['FR','FR','FR','BE','DE','ES'])[1 + floor(random()*6)::int]
FROM generate_series(1, 60) g;

-- Transactions historiques (2 000 lignes sur 12 mois)
INSERT INTO finance.transactions (reference, date_operation, client_id, employe_id,
                                  iban_contrepartie, montant, categorie, statut, source, ingere_par)
SELECT 'TX-2026-' || lpad(g::text, 6, '0'),
       timestamptz '2025-09-01 08:00+02' + (random() * 365) * interval '1 day',
       c.id,
       1 + floor(random()*200)::int,
       c.iban,
       round((50 + random() * 49950)::numeric, 2),
       (ARRAY['FACTURE','AVOIR','VIREMENT','PRELEVEMENT','REMBOURSEMENT'])[1 + floor(random()*5)::int],
       (ARRAY['VALIDEE','VALIDEE','VALIDEE','EN_ATTENTE','REJETEE'])[1 + floor(random()*5)::int],
       'historique',
       'legacy_etl'
FROM generate_series(1, 2000) g
JOIN LATERAL (SELECT id, iban FROM finance.clients ORDER BY random() + g * 0 LIMIT 1) c ON true;

-- =============================================================================
-- Registre RGPD & classification (point de départ pour le DPO)
-- =============================================================================
INSERT INTO gouvernance.registre_traitements
 (nom_traitement, finalite, base_legale, categories_donnees, personnes_concernees, destinataires, duree_conservation, mesures_securite, responsable)
VALUES
 ('Gestion administrative du personnel', 'Paie, gestion des carrières, obligations sociales',
  'Obligation légale (art. 6.1.c) + exécution du contrat (art. 6.1.b)',
  'Identité, NIR, coordonnées bancaires, rémunération', 'Salariés',
  'Service RH, service paie, organismes sociaux', '5 ans après départ du salarié',
  'A COMPLETER (TP1/TP2)', 'DRH DataCorp Secure'),
 ('Traitement des opérations financières clients', 'Exécution et suivi des transactions',
  'Exécution du contrat (art. 6.1.b)', 'Identité contact, IBAN, montants', 'Contacts clients',
  'Service finance, commissaires aux comptes', '10 ans (Code de commerce L123-22)',
  'A COMPLETER (TP1/TP2)', 'DAF DataCorp Secure'),
 ('Analyse statistique RH & finance', 'Pilotage, tableaux de bord',
  'Intérêt légitime (art. 6.1.f)', 'Données pseudonymisées ou agrégées uniquement', 'Salariés, contacts clients',
  'Équipe Data Analytics', '3 ans', 'A COMPLETER (TP2)', 'CDO DataCorp Secure');

INSERT INTO gouvernance.classification_donnees VALUES
 ('rh','employes','matricule','INTERNE',true,'identification','PSEUDONYMISER'),
 ('rh','employes','nom','CONFIDENTIEL',true,'identification','MASQUER'),
 ('rh','employes','prenom','CONFIDENTIEL',true,'identification','MASQUER'),
 ('rh','employes','email','CONFIDENTIEL',true,'coordonnées','MASQUER'),
 ('rh','employes','telephone','CONFIDENTIEL',true,'coordonnées','SUPPRIMER'),
 ('rh','employes','nir','RESTREINT',true,'NIR (encadrement spécifique CNIL)','SUPPRIMER'),
 ('rh','employes','iban','RESTREINT',true,'financière','CHIFFRER'),
 ('rh','employes','date_naissance','CONFIDENTIEL',true,'identification','GENERALISER'),
 ('rh','employes','date_embauche','INTERNE',true,'vie professionnelle','GENERALISER'),
 ('rh','employes','departement','INTERNE',false,NULL,'AUCUN'),
 ('rh','employes','poste','INTERNE',false,NULL,'AUCUN'),
 ('rh','employes','salaire_brut_annuel','RESTREINT',true,'financière','GENERALISER'),
 ('finance','clients','contact_nom','CONFIDENTIEL',true,'identification','MASQUER'),
 ('finance','clients','contact_email','CONFIDENTIEL',true,'coordonnées','MASQUER'),
 ('finance','clients','iban','RESTREINT',true,'financière','CHIFFRER'),
 ('finance','transactions','iban_contrepartie','RESTREINT',true,'financière','CHIFFRER'),
 ('finance','transactions','montant','CONFIDENTIEL',false,NULL,'AUCUN');

ANALYZE;

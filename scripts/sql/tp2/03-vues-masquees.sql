-- =============================================================================
-- TP2 — Étape 4 : clé de pseudonymisation et vues masquées
-- Exécution : /lab/scripts/pg-admin.sh -f /lab/scripts/sql/tp2/<fichier>
-- =============================================================================
\set ON_ERROR_STOP on

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

RESET ROLE;
-- La DPO doit pouvoir consulter les vues AVANT de les valider
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO r_dpo;

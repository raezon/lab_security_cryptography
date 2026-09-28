-- =============================================================================
-- TP2 — Étape 5 : publication contrôlée par la DPO (contrôle « 4 yeux »)
-- Exécution : /lab/scripts/pg-admin.sh -f /lab/scripts/sql/tp2/<fichier>
-- =============================================================================
\set ON_ERROR_STOP on

SET ROLE analytics_owner;

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


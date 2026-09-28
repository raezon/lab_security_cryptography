#!/bin/bash
# =============================================================================
#  ingest_legacy.sh — script d'export RH / ingestion finance
#  Auteur : prestataire (2019). "Ça marche, on n'y touche pas."
#  Lancé chaque nuit par cron sur le serveur ETL.
#
#  ⚠ FICHIER VOLONTAIREMENT MAL SÉCURISÉ — support de l'exercice TP1 §4.1
#     Ne JAMAIS reproduire ces pratiques.
# =============================================================================

# --- Base de données -----------------------------------------------------------
DB_HOST=postgres
DB_NAME=datacorp
DB_USER=legacy_etl
DB_PASS="DataCorp2019!"

# --- Stockage objet ------------------------------------------------------------
S3_ENDPOINT=https://minio:9000
S3_ACCESS_KEY=minio-root
S3_SECRET_KEY="M1n10-R00t-2019"

# --- Broker ----------------------------------------------------------------------
AMQP_URL="amqps://rmq-admin:Rabbit2019@rabbitmq:5671/datacorp"

# --- Export RH pour le cabinet de paie ---------------------------------------------
EXPORT=/tmp/export_rh_$(date +%Y%m%d).csv

echo "[legacy] connexion à ${DB_HOST} avec ${DB_USER}/${DB_PASS}"
PGPASSWORD=$DB_PASS psql "host=$DB_HOST dbname=$DB_NAME user=$DB_USER sslmode=require" \
  -c "\copy (SELECT matricule, nom, prenom, nir, iban, salaire_brut_annuel FROM rh.employes) TO '$EXPORT' CSV HEADER"
chmod 644 "$EXPORT"

echo "[legacy] $(wc -l < "$EXPORT") lignes exportées dans $EXPORT"

# Envoi au stockage objet (certificat non vérifié "parce que ça plantait")
# curl -k -u "$S3_ACCESS_KEY:$S3_SECRET_KEY" -T "$EXPORT" "$S3_ENDPOINT/exports/"

echo "[legacy] terminé"

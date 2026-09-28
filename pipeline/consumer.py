#!/usr/bin/env python3
"""
consumer.py — pipeline d'ingestion DataCorp Secure

  RabbitMQ (AMQPS) ──▶ chiffrement IBAN (Vault transit) ──▶ PostgreSQL (TLS)
                                                        └─▶ MinIO raw-data (HTTPS, SSE-S3)

Aucun secret dans ce fichier : tout est injecté par with-vault-creds.sh
  - RABBITMQ_USER / RABBITMQ_PASSWORD : identifiants RabbitMQ éphémères
  - PGUSER / PGPASSWORD               : identifiants PostgreSQL éphémères (rôle app_ingest)
  - VAULT_TOKEN                       : jeton AppRole (droit transit/encrypt uniquement)
  - MC_HOST_dcingest                  : compte de service MinIO

Usage : with-vault-creds.sh python3 /lab/pipeline/consumer.py [max_messages]
"""
import base64
import json
import os
import ssl
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

import pika
import psycopg2
import requests

QUEUE = "ingest.transactions"
VAULT = os.environ["VAULT_ADDR"].rstrip("/")
CA = os.environ.get("CA_FILE", "/certs/ca.crt")


def vault_encrypt(values):
    """Chiffre une liste de chaînes avec transit/datacorp-pii (un seul appel batch)."""
    r = requests.post(f"{VAULT}/v1/transit/encrypt/datacorp-pii",
                      json={"batch_input": [{"plaintext": base64.b64encode(v.encode()).decode()} for v in values]},
                      headers={"X-Vault-Token": os.environ["VAULT_TOKEN"]}, verify=CA, timeout=15)
    r.raise_for_status()
    return [x["ciphertext"] for x in r.json()["data"]["batch_results"]]


def rabbit():
    host = os.environ.get("RABBITMQ_HOST", "rabbitmq")
    ctx = ssl.create_default_context(cafile=CA)
    return pika.BlockingConnection(pika.ConnectionParameters(
        host=host, port=5671, virtual_host=os.environ.get("RABBITMQ_VHOST", "datacorp"),
        credentials=pika.PlainCredentials(os.environ["RABBITMQ_USER"], os.environ["RABBITMQ_PASSWORD"]),
        ssl_options=pika.SSLOptions(ctx, server_hostname=host)))


def main():
    max_msg = int(sys.argv[1]) if len(sys.argv) > 1 else 500
    conn = rabbit()
    ch = conn.channel()
    ch.queue_declare(queue=QUEUE, durable=True)

    batch, last_tag = [], None
    for method, _props, body in ch.consume(QUEUE, inactivity_timeout=3):
        if method is None:          # file vide depuis 3 s
            break
        batch.append(json.loads(body))
        last_tag = method.delivery_tag
        if len(batch) >= max_msg:
            break
    ch.cancel()

    if not batch:
        print("[consommateur] aucune transaction en attente")
        conn.close()
        return

    # 1. Chiffrement applicatif : l'IBAN en clair ne quitte jamais ce processus
    for tx, cipher in zip(batch, vault_encrypt([t["iban_contrepartie"] for t in batch])):
        tx["iban_contrepartie"] = cipher

    # 2. Insertion PostgreSQL (TLS verify-full via PGSSLMODE / PGSSLROOTCERT)
    pg = psycopg2.connect("")
    with pg, pg.cursor() as cur:
        cur.executemany(
            """INSERT INTO finance.transactions
                 (reference, date_operation, client_id, iban_contrepartie, montant, devise, categorie, statut, source)
               VALUES (%(reference)s, %(date_operation)s, %(client_id)s, %(iban_contrepartie)s,
                       %(montant)s, %(devise)s, %(categorie)s, 'EN_ATTENTE', 'pipeline')""",
            batch)
    pg.close()

    # 3. Archivage du lot brut (IBAN déjà chiffrés) dans MinIO raw-data
    now = datetime.now(timezone.utc)
    key = f"raw-data/transactions/{now:%Y/%m/%d}/lot-{now:%H%M%S}.json"
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(batch, f, ensure_ascii=False, indent=1)
        tmp = f.name
    try:
        subprocess.run(["mc", "cp", "--quiet", tmp, f"dcingest/{key}"], check=True)
    finally:
        os.unlink(tmp)

    # 4. Acquittement APRÈS écriture durable : sémantique "au moins une fois"
    ch.basic_ack(delivery_tag=last_tag, multiple=True)
    conn.close()
    print(f"[consommateur] {len(batch)} transactions ingérées -> PostgreSQL + minio/{key}")


if __name__ == "__main__":
    main()

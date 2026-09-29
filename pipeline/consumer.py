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

Usage : with-vault-creds.sh python3 /lab/pipeline/consumer.py [max_messages] [délai_s] [taille_lot]
  délai_s    : temps de « traitement » simulé par message (mode lent). 0 par défaut.
  taille_lot : nombre de messages écrits puis acquittés ensemble. Par défaut tout
               d'un coup ; en mode lent, des petits lots rendent visibles Ready,
               Unacked, Deliver et Consumer ack dans RabbitMQ Management.
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


def ingest(batch, seq):
    """Chiffre, insère en base puis archive un lot ; renvoie la clé MinIO."""
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
    key = f"raw-data/transactions/{now:%Y/%m/%d}/lot-{now:%H%M%S}" + (f"-{seq:02d}" if seq else "") + ".json"
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(batch, f, ensure_ascii=False, indent=1)
        tmp = f.name
    try:
        subprocess.run(["mc", "cp", "--quiet", tmp, f"dcingest/{key}"], check=True, stdout=subprocess.DEVNULL)
    finally:
        os.unlink(tmp)
    return key


def main():
    max_msg = int(sys.argv[1]) if len(sys.argv) > 1 else 500
    delay = float(sys.argv[2]) if len(sys.argv) > 2 else 0
    lot = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    conn = rabbit()
    ch = conn.channel()
    ch.queue_declare(queue=QUEUE, durable=True)
    if lot:
        # Le broker ne remet pas plus de `lot` messages non acquittés : le reste attend en Ready.
        ch.basic_qos(prefetch_count=lot)

    batch, last_tag, total, seq, key = [], None, 0, 0, None
    for method, _props, body in ch.consume(QUEUE, inactivity_timeout=3):
        if method is None:          # file vide depuis 3 s
            break
        batch.append(json.loads(body))
        last_tag = method.delivery_tag
        total += 1
        if delay:
            conn.sleep(delay)       # « traitement » lent : le message reste Unacked
        if lot and len(batch) >= lot:
            seq += 1
            key = ingest(batch, seq)
            # 4. Acquittement APRÈS écriture durable : sémantique "au moins une fois"
            ch.basic_ack(delivery_tag=last_tag, multiple=True)
            print(f"[consommateur] lot {seq} : {len(batch)} transactions ingérées et acquittées (ack)", flush=True)
            batch = []
        if total >= max_msg:
            break
    ch.cancel()

    if batch:
        key = ingest(batch, seq + 1 if lot else 0)
        # 4. Acquittement APRÈS écriture durable : sémantique "au moins une fois"
        ch.basic_ack(delivery_tag=last_tag, multiple=True)
    conn.close()
    if not total:
        print("[consommateur] aucune transaction en attente")
        return
    print(f"[consommateur] {total} transactions ingérées -> PostgreSQL + minio/{key}", flush=True)


if __name__ == "__main__":
    main()

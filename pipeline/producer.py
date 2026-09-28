#!/usr/bin/env python3
"""
producer.py — simule le système amont (plateforme de paiement) qui publie des
transactions dans la file RabbitMQ "ingest.transactions".

Identifiants : RABBITMQ_USER / RABBITMQ_PASSWORD (fournis dynamiquement par
Vault via /lab/scripts/with-vault-creds.sh). Connexion AMQPS (TLS) uniquement.

Usage : with-vault-creds.sh python3 /lab/pipeline/producer.py [nombre]
"""
import json
import os
import random
import ssl
import sys
from datetime import datetime, timezone

import pika

QUEUE = "ingest.transactions"


def connect():
    ctx = ssl.create_default_context(cafile=os.environ.get("CA_FILE", "/certs/ca.crt"))
    host = os.environ.get("RABBITMQ_HOST", "rabbitmq")
    params = pika.ConnectionParameters(
        host=host, port=5671, virtual_host=os.environ.get("RABBITMQ_VHOST", "datacorp"),
        credentials=pika.PlainCredentials(os.environ["RABBITMQ_USER"], os.environ["RABBITMQ_PASSWORD"]),
        ssl_options=pika.SSLOptions(ctx, server_hostname=host))
    return pika.BlockingConnection(params)


def fake_transaction(i, run_id):
    return {
        "reference": f"TX-PIPE-{run_id}-{i:04d}",
        "date_operation": datetime.now(timezone.utc).isoformat(),
        "client_id": random.randint(1, 60),
        "iban_contrepartie": "FR76" + "".join(random.choices("0123456789", k=23)),  # fictif
        "montant": round(random.uniform(20, 25000), 2),
        "devise": "EUR",
        "categorie": random.choice(["FACTURE", "VIREMENT", "PRELEVEMENT", "AVOIR"]),
    }


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 50
    run_id = datetime.now().strftime("%Y%m%d%H%M%S")
    conn = connect()
    ch = conn.channel()
    ch.queue_declare(queue=QUEUE, durable=True)
    for i in range(1, n + 1):
        ch.basic_publish(exchange="", routing_key=QUEUE,
                         body=json.dumps(fake_transaction(i, run_id)),
                         properties=pika.BasicProperties(delivery_mode=2, content_type="application/json"))
    conn.close()
    print(f"[producteur] {n} transactions publiées dans '{QUEUE}' (lot {run_id})")


if __name__ == "__main__":
    main()

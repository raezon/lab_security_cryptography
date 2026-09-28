#!/usr/bin/env python3
"""
encrypt-existing-ibans.py — TP1 §4.5
Chiffre les IBAN historiques stockés EN CLAIR dans rh.employes et
finance.clients avec la clé Vault transit "datacorp-pii".

Prérequis (variables d'environnement) :
  VAULT_ADDR, VAULT_TOKEN, VAULT_CACERT   -> jeton autorisé sur transit/encrypt/datacorp-pii
  PGUSER, PGPASSWORD (+ PGHOST...)        -> identifiants éphémères du rôle Vault "migration-pii"

La colonne n'est modifiée que pour les lignes encore en clair (idempotent).
"""
import base64
import os
import sys

import psycopg2
import requests

VAULT = os.environ["VAULT_ADDR"].rstrip("/")
TOKEN = os.environ["VAULT_TOKEN"]
CA = os.environ.get("VAULT_CACERT", True)
KEY = os.environ.get("TRANSIT_KEY", "datacorp-pii")
TABLES = [("rh.employes", "iban"), ("finance.clients", "iban"), ("finance.transactions", "iban_contrepartie")]
BATCH = 100


def encrypt_batch(values):
    payload = {"batch_input": [{"plaintext": base64.b64encode(v.encode()).decode()} for v in values]}
    r = requests.post(f"{VAULT}/v1/transit/encrypt/{KEY}", json=payload,
                      headers={"X-Vault-Token": TOKEN}, verify=CA, timeout=15)
    r.raise_for_status()
    results = r.json()["data"]["batch_results"]
    errors = [x["error"] for x in results if x.get("error")]
    if errors:
        raise RuntimeError(f"Vault a refusé une partie du lot : {errors[:3]}")
    return [x["ciphertext"] for x in results]


def main():
    conn = psycopg2.connect("")  # utilise PGHOST, PGUSER, PGPASSWORD, PGSSLMODE... de l'environnement
    total = 0
    with conn:
        with conn.cursor() as cur:
            for table, col in TABLES:
                cur.execute(f"SELECT id, {col} FROM {table} WHERE {col} NOT LIKE 'vault:%%' ORDER BY id")
                rows = cur.fetchall()
                for i in range(0, len(rows), BATCH):
                    chunk = rows[i:i + BATCH]
                    ciphers = encrypt_batch([r[1] for r in chunk])
                    cur.executemany(f"UPDATE {table} SET {col} = %s WHERE id = %s",
                                    [(c, r[0]) for c, r in zip(ciphers, chunk)])
                print(f"[migration] {table}.{col} : {len(rows)} valeur(s) chiffrée(s)")
                total += len(rows)
    print(f"[migration] terminé — {total} IBAN chiffrés avec transit/{KEY}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # message clair pour les apprenants
        print(f"[migration] ÉCHEC : {exc}", file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""
detect.py — mini moteur de détection (SIEM simulé) du TP3

Corrèle trois sources de journaux :
  - PostgreSQL (jsonlog + pgAudit)  : /logs/postgres/postgresql.json
  - Vault (audit device "file")      : /logs/vault/audit.log
  - MinIO (webhook d'audit)          : /logs/minio/audit.jsonl

et produit des alertes classées par sévérité, affichées à l'écran et
exportées en JSON (preuve pour le rapport d'audit GRC).

Usage : python3 /lab/scripts/detect.py [--seuil-lignes 50] [--out /lab/work/alertes.json]

Les règles R1 à R8 sont fournies. La règle R9 (accès hors heures ouvrées)
est à écrire par les apprenants (TP3 §4.6).
"""
import argparse
import csv
import io
import json
import os
from collections import Counter, defaultdict
from datetime import datetime

TABLES_RESTREINT = {"rh.employes", "finance.clients", "securite.cles"}
alertes = []


def alerte(regle, severite, titre, details, preuves):
    alertes.append({"regle": regle, "severite": severite, "titre": titre,
                    "details": details, "nb_preuves": len(preuves), "preuves": preuves[:5]})


def lire_jsonl(path):
    if not os.path.exists(path):
        print(f"  (source absente : {path})")
        return []
    out = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return out


def acces_direct(a):
    """pgAudit journalise aussi les tables lues À TRAVERS une vue (ex : un analyste qui
    interroge analytics.v_employes génère une ligne sur rh.employes). On ne retient
    ici que les accès où la table apparaît explicitement dans la requête."""
    return a["objet"].split(".")[-1].lower() in a["requete"].lower()


def parse_pgaudit(message):
    """'AUDIT: OBJECT,1,1,READ,SELECT,TABLE,rh.employes,"select ...",<not logged>,200' -> dict"""
    if not message.startswith("AUDIT: "):
        return None
    champs = next(csv.reader(io.StringIO(message[len("AUDIT: "):])))
    cles = ["type", "stmt_id", "substmt_id", "classe", "commande", "type_objet", "objet", "requete", "parametres", "lignes"]
    d = dict(zip(cles, champs))
    try:
        d["lignes"] = int(d.get("lignes", "") or -1)
    except ValueError:
        d["lignes"] = -1
    return d


# --------------------------------------------------------------------------- PostgreSQL
def regles_postgres(events, seuil_lignes):
    echecs_auth = defaultdict(list)
    refus = defaultdict(list)
    habilitations = defaultdict(list)
    for e in events:
        user, msg, etat = e.get("user"), e.get("message", ""), e.get("state_code")
        ts, ip = e.get("timestamp"), e.get("remote_host")

        # R1 — échecs d'authentification (brute force / credential stuffing)
        if etat == "28P01":
            echecs_auth[user].append(f"{ts} {ip} {msg}")

        # R2 — compte désactivé ou historique qui tente de se connecter
        if user == "legacy_etl" and (etat in ("28000", "28P01") or msg.startswith("connection authorized")):
            alerte("R2", "HAUTE", "Utilisation du compte historique legacy_etl",
                   "Le compte décommissionné au TP1 est encore utilisé : secret en dur non purgé ?",
                   [f"{ts} {ip} {msg}"])

        # R4 — accès refusés (tentative de contournement du RBAC)
        if etat == "42501":
            refus[user].append(f"{ts} {e.get('statement', '')[:120]} -> {msg}")

        a = parse_pgaudit(msg)
        if not a:
            continue
        # R3 — lecture massive d'une table RESTREINT (exfiltration)
        if (a["classe"] == "READ" and a["objet"] in TABLES_RESTREINT
                and a["lignes"] >= seuil_lignes and acces_direct(a)):
            alerte("R3", "CRITIQUE", f"Lecture massive de {a['objet']} par {user}",
                   f"{a['lignes']} lignes lues en une requête (seuil {seuil_lignes})",
                   [f"{ts} {user} {a['requete'][:160]}"])
        # R5 — modification des habilitations (escalade de privilèges)
        if a["classe"] == "ROLE":
            habilitations[user].append(f"{ts} {a['requete'][:160]}")
        # R6 — accès au schéma des clés de pseudonymisation
        if a["objet"] == "securite.cles" and acces_direct(a):
            alerte("R6", "CRITIQUE", f"Accès à la clé de pseudonymisation par {user}",
                   "La clé HMAC permet de ré-identifier les données des analystes.",
                   [f"{ts} {user} {a['requete'][:160]}"])

    for user, preuves in echecs_auth.items():
        if len(preuves) >= 5:
            alerte("R1", "HAUTE", f"Brute force probable sur le compte {user}",
                   f"{len(preuves)} échecs d'authentification", preuves)
    for user, preuves in refus.items():
        if len(preuves) >= 3:
            alerte("R4", "MOYENNE", f"Accès refusés répétés pour {user}",
                   f"{len(preuves)} tentatives hors périmètre RBAC", preuves)
    for user, preuves in habilitations.items():
        if user == "vault_admin":   # comportement attendu : Vault crée/supprime ses comptes éphémères
            alerte("R5", "BASSE", "Comptes éphémères gérés par Vault (attendu)",
                   f"{len(preuves)} opérations CREATE/DROP ROLE par vault_admin — vérifier qu'elles portent sur des rôles v-*", preuves)
        else:
            alerte("R5", "HAUTE", f"Modification d'habilitations par {user}",
                   f"{len(preuves)} GRANT/REVOKE/CREATE ROLE — rapprocher des tickets de changement", preuves)


# --------------------------------------------------------------------------- MinIO
def regles_minio(events):
    refus = defaultdict(list)
    for e in events:
        api = e.get("api", {}) or {}
        who = e.get("accessKey") or (e.get("requestClaims") or {}).get("accessKey") or "?"
        code = int(api.get("statusCode", 0) or 0)
        ligne = f"{e.get('time')} {who} {api.get('name')} {api.get('bucket')}/{api.get('object', '')} -> {code}"
        if code == 403:
            refus[who].append(ligne)
        # R7 — tentative de suppression dans le coffre de journaux WORM
        if api.get("bucket") == "audit-logs" and str(api.get("name", "")).startswith("Delete"):
            alerte("R7", "CRITIQUE", f"Tentative de suppression de journaux d'audit par {who}",
                   "Effacement de traces : indicateur classique de compromission.", [ligne])
    for who, preuves in refus.items():
        if len(preuves) >= 3:
            alerte("R4", "MOYENNE", f"Accès S3 refusés répétés pour {who}",
                   f"{len(preuves)} requêtes 403 sur MinIO", preuves)


# --------------------------------------------------------------------------- Vault
def regles_vault(events):
    refus = defaultdict(list)
    root = []
    for e in events:
        if e.get("type") != "response":
            continue
        auth, req = e.get("auth", {}) or {}, e.get("request", {}) or {}
        qui = auth.get("display_name", "?")
        ligne = f"{e.get('time')} {qui} {req.get('operation')} {req.get('path')} ({req.get('remote_address')})"
        if "permission denied" in str(e.get("error", "")):
            refus[qui].append(ligne)
        # R8 — utilisation du jeton root (doit être exceptionnelle et justifiée)
        if "root" in (auth.get("policies") or []):
            root.append(ligne)
    for qui, preuves in refus.items():
        sev = "HAUTE" if any("transit/decrypt" in p for p in preuves) else "MOYENNE"
        alerte("R4", sev, f"Accès Vault refusés pour {qui}", f"{len(preuves)} refus", preuves)
    if root:
        alerte("R8", "MOYENNE", "Utilisation du jeton root Vault",
               f"{len(root)} requêtes avec la politique root — à révoquer après l'initialisation", root)


# --------------------------------------------------------------------------- R9 (apprenants)
def regle_hors_heures(pg_events):
    """TODO TP3 §4.6 : lever une alerte R9 pour toute connexion réussie
    ('connection authorized') en dehors de 08:00-19:00 ou le week-end.
    Indice : datetime.strptime(e['timestamp'][:19], '%Y-%m-%d %H:%M:%S')"""
    pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pg", default="/logs/postgres/postgresql.json")
    ap.add_argument("--minio", default="/logs/minio/audit.jsonl")
    ap.add_argument("--vault", default="/logs/vault/audit.log")
    ap.add_argument("--seuil-lignes", type=int, default=50)
    ap.add_argument("--out", default="/lab/work/alertes.json")
    args = ap.parse_args()

    print("== Chargement des journaux ==")
    pg, mn, vt = lire_jsonl(args.pg), lire_jsonl(args.minio), lire_jsonl(args.vault)
    print(f"  PostgreSQL : {len(pg)} événements | MinIO : {len(mn)} | Vault : {len(vt)}")

    regles_postgres(pg, args.seuil_lignes)
    regles_minio(mn)
    regles_vault(vt)
    regle_hors_heures(pg)

    ordre = {"CRITIQUE": 0, "HAUTE": 1, "MOYENNE": 2, "BASSE": 3}
    alertes.sort(key=lambda a: (ordre.get(a["severite"], 9), a["regle"]))
    print(f"\n== {len(alertes)} alerte(s) ==")
    for a in alertes:
        print(f"[{a['severite']:<8}] {a['regle']} {a['titre']} — {a['details']}")
        for p in a["preuves"][:2]:
            print(f"             ↳ {p}")
    print("\nRépartition :", dict(Counter(a["severite"] for a in alertes)))

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"genere_le": datetime.now().isoformat(timespec="seconds"), "alertes": alertes},
                  f, ensure_ascii=False, indent=2)
    print(f"Export : {args.out}")


if __name__ == "__main__":
    main()

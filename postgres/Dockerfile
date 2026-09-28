FROM postgres:16-bookworm

# pgAudit : journalisation d'audit détaillée (TP3)
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-pgaudit \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/log/postgresql \
 && chown postgres:postgres /var/log/postgresql \
 && chmod 750 /var/log/postgresql

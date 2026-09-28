# =============================================================================
#  Toolbox DataCorp Secure : poste de travail des apprenants (client de test)
#  Contient : psql, vault, mc (MinIO client), jq, openssl, python3 (+pika,
#  psycopg2, requests), tcpdump, curl.
#  Réutilisée aussi pour : génération de la PKI (certs-init) et collecteur
#  d'audit MinIO (audit-sink).
# =============================================================================
FROM hashicorp/vault:1.17 AS vault
# minio/mc n'est plus publié sur Docker Hub : même build (commit b00526b) via bitnamilegacy
FROM bitnamilegacy/minio-client:2025.4.16 AS mc

FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl jq openssl less vim-tiny nano procps \
      postgresql-client python3 python3-psycopg2 python3-pika python3-requests \
      tcpdump netcat-openbsd dnsutils iputils-ping bash-completion \
 && rm -rf /var/lib/apt/lists/*

COPY --from=vault /bin/vault /usr/local/bin/vault
COPY --from=mc    /opt/bitnami/minio-client/bin/mc /usr/local/bin/mc
COPY toolbox-entrypoint.sh /usr/local/bin/toolbox-entrypoint.sh
RUN chmod +x /usr/local/bin/toolbox-entrypoint.sh

WORKDIR /lab
ENTRYPOINT ["/usr/local/bin/toolbox-entrypoint.sh"]
CMD ["sleep", "infinity"]

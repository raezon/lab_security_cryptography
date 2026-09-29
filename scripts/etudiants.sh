#!/usr/bin/env bash
# =============================================================================
#  etudiants.sh — une stack DataCorp ISOLÉE par étudiant (à lancer sur l'hôte)
#
#  Chaque étudiant etuNN a :
#    - sa propre copie du lab ($ROOT/etuNN) : son Vault, sa base, son MinIO…
#      (projet compose datacorp-etuNN, conteneurs etuNN-*, réseaux séparés) ;
#    - sa console web      https://etuNN.<domaine>        (login etuNN + mot de passe)
#    - son Vault UI        https://vault-etuNN.<domaine>  (même login)
#  Personne ne voit ni ne modifie la stack d'un autre. Les corrigés sont masqués.
#
#  Usage :
#    ./scripts/etudiants.sh creer 10          crée etu01 … etu10 (garde ceux qui existent)
#    ./scripts/etudiants.sh liste             logins, mots de passe, URL (+ comptes.csv)
#    ./scripts/etudiants.sh reset etu03       remet la stack d'etu03 à zéro (garde son mot de passe)
#    ./scripts/etudiants.sh maj               recopie le code du lab dans toutes les stacks
#    ./scripts/etudiants.sh supprimer etu03   (ou « tous ») : arrête et efface
#
#  Mémoire : ~450 Mo par étudiant.
# =============================================================================
set -euo pipefail
LAB=$(cd "$(dirname "$0")/.." && pwd)
ROOT=${ROOT:-$HOME/etudiants}
DOMAIN=${DOMAIN:-158-178-196-145.sslip.io}
CADDYFILE=${CADDYFILE:-$HOME/zero-trust-ot-lab/Caddyfile}
CADDY=${CADDY:-zt-ot-lab-caddy-1}

mkdir -p "$ROOT"

num()  { echo $((10#${1#etu})); }
name() { printf 'etu%02d' "$1"; }
students() { find "$ROOT" -maxdepth 1 -type d -name 'etu[0-9][0-9]' -printf '%f\n' | sort; }
compose() { (cd "$ROOT/$1" && docker compose "${@:2}"); }

sync_code() {  # copie du lab, sans secrets, corrigés, état ni historique
  rsync -a --delete --exclude .git --exclude .env --exclude 'work/*' --exclude docx --exclude solutions \
    --exclude .caddy --exclude docker-compose.etudiant.yml "$LAB/" "$ROOT/$1/"
}

net_override() {  # sous-réseaux /24 fixes : évite d'épuiser les plages par défaut de Docker (/16)
  local s=$1 i; i=$(num "$1")
  cat > "$ROOT/$s/docker-compose.etudiant.yml" <<EOF
# généré par etudiants.sh
networks:
  net-data:
    ipam:
      config: [{subnet: 10.210.$i.0/24}]
  net-broker:
    ipam:
      config: [{subnet: 10.211.$i.0/24}]
EOF
  grep -q '^COMPOSE_FILE=' "$ROOT/$s/.env" || echo "COMPOSE_FILE=docker-compose.yml:docker-compose.etudiant.yml" >> "$ROOT/$s/.env"
}

make_env() {
  local s=$1 i; i=$(num "$1")
  (cd "$ROOT/$s" && ./scripts/generate-env.sh >/dev/null)
  sed -i "s|^COMPOSE_PROJECT_NAME=.*|COMPOSE_PROJECT_NAME=datacorp-$s|" "$ROOT/$s/.env"
  cat >> "$ROOT/$s/.env" <<EOF

# ------------------------------------------------------------------ Stack étudiant (etudiants.sh)
STACK=$s
STUDENT_MODE=1
STUDENT_NAME=$s
VAULT_PUBLIC_URL=https://vault-$s.$DOMAIN
CONSOLE_PORT=$((18100 + i))
VAULT_PORT=$((18200 + i))
MINIO_API_PORT=$((18300 + i))
MINIO_CONSOLE_PORT=$((18400 + i))
RABBITMQ_MGMT_PORT=$((18500 + i))
EOF
}

make_login() {  # mot de passe lisible + empreinte bcrypt pour Caddy
  local s=$1 pw
  pw=$(openssl rand -base64 48 | tr -dc 'abcdefghjkmnpqrstuvwxyz23456789' | cut -c1-10)
  mkdir -p "$ROOT/$s/.caddy"
  echo "$pw" > "$ROOT/$s/.caddy/password"
  docker exec "$CADDY" caddy hash-password --plaintext "$pw" > "$ROOT/$s/.caddy/hash"
  chmod 600 "$ROOT/$s/.caddy/"*
}

caddy_sync() {  # réécrit le bloc « etudiants » du Caddyfile puis recharge Caddy
  local blk; blk=$(mktemp)
  echo "# >>> etudiants (généré par etudiants.sh — ne pas modifier à la main)" > "$blk"
  for s in $(students); do
    local i h; i=$(num "$s"); h=$(cat "$ROOT/$s/.caddy/hash")
    cat >> "$blk" <<EOF
$s.$DOMAIN {
	basic_auth {
		$s $h
	}
	reverse_proxy 127.0.0.1:$((18100 + i))
}

vault-$s.$DOMAIN {
	basic_auth {
		$s $h
	}
	reverse_proxy https://127.0.0.1:$((18200 + i)) {
		header_up -Authorization
		transport http {
			tls_insecure_skip_verify
		}
	}
}

EOF
  done
  echo "# <<< etudiants" >> "$blk"
  local new; new=$(mktemp)
  sed '/^# >>> etudiants/,/^# <<< etudiants/d' "$CADDYFILE" > "$new"
  cat "$blk" >> "$new"
  cp "$CADDYFILE" "$CADDYFILE.bak.etudiants"
  cat "$new" | sudo tee "$CADDYFILE" >/dev/null     # tee garde l'inode (fichier monté dans le conteneur)
  if ! docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>/tmp/caddy-reload.log; then
    cat "$CADDYFILE.bak.etudiants" | sudo tee "$CADDYFILE" >/dev/null
    echo "[erreur] rechargement Caddy refusé, Caddyfile restauré :" >&2; cat /tmp/caddy-reload.log >&2; exit 1
  fi
  rm -f "$blk" "$new"
  echo "[caddy] $(students | wc -l) étudiant(s) publié(s)"
}

up() { net_override "$1"; echo "[$1] démarrage…"; compose "$1" up -d --quiet-pull 2>&1 | grep -iE "error|fail" || true; }

liste() {
  local csv="$ROOT/comptes.csv"
  echo "etudiant;mot_de_passe;console;vault_ui" > "$csv"
  printf '%-7s %-12s %s\n' LOGIN "MOT DE PASSE" "CONSOLE  /  VAULT UI"
  for s in $(students); do
    local pw; pw=$(cat "$ROOT/$s/.caddy/password")
    printf '%-7s %-12s https://%s.%s  /  https://vault-%s.%s\n' "$s" "$pw" "$s" "$DOMAIN" "$s" "$DOMAIN"
    echo "$s;$pw;https://$s.$DOMAIN;https://vault-$s.$DOMAIN" >> "$csv"
  done
  chmod 600 "$csv"; echo; echo "(copie : $csv)"
}

case "${1:-}" in
  creer)
    n=${2:?nombre d étudiants}
    for i in $(seq 1 "$n"); do
      s=$(name "$i")
      if [ -f "$ROOT/$s/.env" ]; then echo "[$s] existe déjà"; continue; fi
      mkdir -p "$ROOT/$s"; sync_code "$s"; make_env "$s"; make_login "$s"
    done
    caddy_sync
    for s in $(students); do up "$s"; done
    liste ;;
  liste) liste ;;
  reset)
    s=${2:?etuNN}; [ -d "$ROOT/$s" ] || { echo "$s inconnu" >&2; exit 1; }
    compose "$s" down -v --remove-orphans
    docker run --rm -v "$ROOT/$s/work:/w" alpine sh -c "rm -rf /w/* && touch /w/.gitkeep"   # fichiers créés par root
    up "$s"; echo "[$s] remis à zéro" ;;
  maj)
    for s in $(students); do sync_code "$s"; up "$s"; done ;;
  supprimer)
    t=${2:?etuNN ou tous}; [ "$t" = tous ] && t=$(students)
    for s in $t; do
      compose "$s" down -v --remove-orphans || true
      docker run --rm -v "$ROOT:/r" alpine rm -rf "/r/$s"   # work/ contient des fichiers créés par root
      echo "[$s] supprimé"
    done
    caddy_sync ;;
  *) sed -n '3,19p' "$0" | sed 's/^#  \{0,1\}//'; exit 2 ;;
esac

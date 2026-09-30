"use strict";
// Console DataCorp Secure — compléments de cours : « comment mener le TP »
// (toutes les commandes, dans l'ordre), alternative à la souris (interfaces
// web) et cours détaillé sur les ACL Vault. Chargé après cours.js.

// Un bloc de commande avec « ▶ Essayer » (lecture seule) : la sortie
// s'affiche dans le terminal du bloc .trybox le plus proche.
function tryCmd(cmd, note, run = true) {
  return `<div class="trycmd"><pre class="code mini"><button class="button is-small copy" data-copy>Copier</button>${esc(cmd)}</pre>
    <div class="row" style="gap:8px">${run ? `<button class="button is-small is-primary" data-try="${esc(cmd)}">▶ Essayer</button>` : `<span class="tag">à taper vous-même dans le <a href="#/terminal">Terminal</a></span>`}
    ${note ? `<span class="small muted">${note}</span>` : ""}</div></div>`;
}
function tryBox(inner) { return `<div class="trybox">${inner}<div class="term" data-tryterm hidden></div></div>`; }
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-try]"); if (!b || BUSY) return;
  const box = b.closest(".trybox"), term = box && $("[data-tryterm]", box); if (!term) return;
  term.hidden = false; b.disabled = true;
  await streamTo("/api/exec", { cmd: b.dataset.try }, term).catch(() => {});
  b.disabled = false;
});
const guiLink = (tool, label) => {
  const url = { vault: INFO.vault_url, minio: INFO.minio_url, rabbitmq: INFO.rabbitmq_url }[tool];
  return url ? `<a class="button is-small" href="${esc(url)}" target="_blank" rel="noopener">${label} ↗</a>` : "";
};

// ---------------------------------------------------------------- guides par cours
function coursGuide(id) {
  if (id === "projet") return `
  <h2>🧭 Comment mener les TP</h2>
  <div class="box">
    <ol class="somm">
      <li>Lisez les cours <a href="#/cours/vault">🏦 Vault</a>, <a href="#/cours/minio">🪣 MinIO</a> et <a href="#/cours/rabbitmq">📮 RabbitMQ</a> : chacun se termine par la liste des commandes utiles.</li>
      <li>Faites les TP dans l'ordre : <a href="#/tp/tp1">TP1</a> → <a href="#/tp/tp2">TP2</a> → <a href="#/tp/tp3">TP3</a>.</li>
      <li><b>Mode 🎓 facile</b> : lisez les commandes, tapez-les dans le <a href="#/terminal">💻 Terminal</a> ou cliquez « ▶ Exécuter l'étape ».</li>
      <li><b>Mode 🕵️ expert</b> : chaque étape est découpée en petites commandes. Tapez-les une par une ; les 💡 indices donnent des morceaux de commande à essayer.</li>
    </ol>
  </div>
  <h3>Les commandes du lab à connaître</h3>
  <div class="tablewrap"><table class="table is-fullwidth acc"><thead><tr><th>Commande</th><th>À quoi elle sert</th><th>Exemple</th></tr></thead><tbody>
    <tr><td><code>vault</code></td><td>parler au coffre-fort (secrets, chiffrement, droits)</td><td><code>vault status</code></td></tr>
    <tr><td><code>vault-cles</code></td><td>afficher les 5 clés d'ouverture et le jeton root</td><td><code>vault-cles</code></td></tr>
    <tr><td><code>sql</code></td><td>requête PostgreSQL en administrateur (mot de passe lu dans Vault)</td><td><code>sql "SELECT current_user"</code></td></tr>
    <tr><td><code>sql-as</code></td><td>requête en tant qu'une personne (alice, bruno…)</td><td><code>sql-as bruno "SELECT 1"</code></td></tr>
    <tr><td><code>mc</code></td><td>client MinIO (lister, copier des fichiers)</td><td><code>mc ls dc/</code></td></tr>
    <tr><td><code>logs</code></td><td>lire les journaux d'audit (TP3)</td><td><code>logs audit</code></td></tr>
  </tbody></table></div>
  <h3>🖱️ Vous préférez la souris ?</h3>
  <div class="box">
    <p class="small" style="margin-top:0">Une partie du travail peut se faire dans les interfaces web. Dans chaque étape concernée, ouvrez le cadre <b>« 🖱️ Faire dans l'interface graphique »</b> : il donne les clics à faire. En mode expert, le bouton « Fait dans l'interface » passe directement à la commande de vérification (ces commandes comptent pour moitié).</p>
    <div class="tablewrap"><table class="table is-fullwidth acc"><thead><tr><th>Étape</th><th>Interface</th><th>Ce qui se fait à la souris</th></tr></thead><tbody>
      <tr><td>TP1 · 2</td><td>Vault UI</td><td>desceller (3 clés), se connecter — pas l'initialisation ni l'audit</td></tr>
      <tr><td>TP1 · 3</td><td>Vault UI</td><td>activer kv, ranger les 3 mots de passe, les relire</td></tr>
      <tr><td>TP1 · 4</td><td>Vault UI</td><td>générer le compte temporaire</td></tr>
      <tr><td>TP1 · 5</td><td>Vault UI</td><td>activer transit, créer la clé, chiffrer un IBAN, rotation</td></tr>
      <tr><td>TP1 · 6</td><td>RabbitMQ</td><td>observer la file et les connexions TLS</td></tr>
      <tr><td>TP2 · 7</td><td>MinIO Console</td><td>tester les droits de bruno et d'alice</td></tr>
      <tr><td>TP3 · 2</td><td>MinIO Console</td><td>voir le verrou WORM, essayer d'effacer</td></tr>
      <tr><td>TP2, TP3 (SQL)</td><td>—</td><td>pas d'interface : terminal, ou mode facile « ▶ Exécuter l'étape »</td></tr>
    </tbody></table></div>
    <div class="buttons">${guiLink("vault", "Vault UI")}${guiLink("minio", "MinIO Console")}${guiLink("rabbitmq", "RabbitMQ")}<a class="button is-small" href="#/access">🔑 Comptes et accès</a></div>
  </div>`;

  if (id === "vault") return aclCours() + `
  <h2>🧭 Toutes les commandes Vault du TP1, dans l'ordre</h2>
  ${tryBox(`<div class="box">
    <h3>Étape 2 — Ouvrir le coffre</h3>
    ${tryCmd("vault status", "état : Initialized ? Sealed ?")}
    ${tryCmd("vault operator init -format=json > /lab/work/vault-init.json", "une seule fois pour tout le lab (déjà fait ? la console restaure le fichier)", false)}
    ${tryCmd("vault-cles", "les 5 clés + le jeton root")}
    ${tryCmd("vault operator unseal <clé 1>   # puis clé 2, puis clé 3", "", false)}
    ${tryCmd("vault login <jeton root>", "", false)}
    ${tryCmd("vault audit enable file file_path=/vault/logs/audit.log", "", false)}
    <h3>Étape 3 — Ranger les mots de passe</h3>
    ${tryCmd("vault secrets list", "les moteurs actifs")}
    ${tryCmd("vault secrets enable -path=kv kv-v2", "", false)}
    ${tryCmd("vault kv put kv/datacorp/break-glass/postgres username=postgres password=\"$POSTGRES_PASSWORD\"", "", false)}
    ${tryCmd("vault kv list kv/datacorp/break-glass", "ce qui est rangé")}
    <h3>Étape 4 — Comptes temporaires</h3>
    ${tryCmd("vault list database/roles", "les rôles que Vault sait créer")}
    ${tryCmd("vault read database/creds/app-ingest", "un compte neuf, valable 1 h", false)}
    ${tryCmd("vault lease revoke <lease_id>", "", false)}
    <h3>Étape 5 — Chiffrer</h3>
    ${tryCmd("vault read transit/keys/datacorp-pii", "la fiche de la clé (jamais la clé elle-même)")}
    ${tryCmd("vault write transit/encrypt/datacorp-pii plaintext=$(echo -n FR7630001007941234567890185 | base64)", "chiffrer : le résultat change à chaque fois")}
    ${tryCmd("vault write -f transit/keys/datacorp-pii/rotate", "", false)}
  </div>`)}`;

  if (id === "minio") return `
  <h2>🧭 Toutes les commandes MinIO des TP</h2>
  <div class="box small">
    <p style="margin-top:0">Le client s'appelle <code>mc</code>. Un « alias » désigne un serveur + un compte : <code>dc</code> = l'administrateur, <code>alice</code> et <code>bruno</code> = les personnes (créés au TP2 · 7).</p>
  </div>
  ${tryBox(`<div class="box">
    ${tryCmd("mc ls dc/", "lister les buckets (compte admin)")}
    ${tryCmd("mc ls dc/raw-data/", "entrer dans un bucket")}
    ${tryCmd("mc encrypt info dc/curated", "le bucket est-il chiffré au repos ? (SSE-S3)")}
    ${tryCmd("mc admin user list dc", "les comptes MinIO")}
    ${tryCmd("mc admin policy list dc", "les politiques d'accès")}
    ${tryCmd("cat /lab/minio-policies/data-analyst.json", "une politique = du JSON : Effect, Action, Resource")}
    ${tryCmd("mc ls bruno/raw-data/", "TP2 · 7 : bruno est refusé (après tp2-minio.sh)")}
    ${tryCmd("mc cp /etc/hostname bruno/curated/test.txt", "bruno ne peut pas écrire", false)}
    ${tryCmd("mc retention info dc/audit-logs --default", "TP3 · 2 : la rétention WORM du coffre à preuves")}
  </div>`)}
  <h3>Les droits MinIO en 3 lignes</h3>
  <div class="box small">
    <p style="margin-top:0">Une politique MinIO suit le format des politiques AWS S3 : <code>"Effect": "Allow"</code> (ou <code>Deny</code>), une liste d'<code>Action</code> (<code>s3:GetObject</code> = lire, <code>s3:PutObject</code> = écrire, <code>s3:ListBucket</code> = lister) et une liste de <code>Resource</code> (<code>arn:aws:s3:::curated/*</code>).</p>
    <p>On l'attache à un compte : <code>mc admin policy attach dc data-analyst --user bruno</code>. Tout ce qui n'est pas autorisé est refusé.</p>
    <p style="margin-bottom:0">🖱️ Dans la MinIO Console : <b>Identity → Users</b> (les comptes et leurs politiques), <b>Policies</b> (le JSON), <b>Buckets</b> (chiffrement, Object Lock), <b>Object Browser</b> (les fichiers).</p>
  </div>`;

  if (id === "rabbitmq") return `
  <h2>🧭 Toutes les commandes RabbitMQ des TP</h2>
  ${tryBox(`<div class="box">
    ${tryCmd("vault read rabbitmq/creds/pipeline", "un compte RabbitMQ temporaire fabriqué par Vault (TP1 · 6)", false)}
    ${tryCmd("/lab/scripts/setup/tp1-pipeline.sh", "branche tout le pipeline sur Vault", false)}
    ${tryCmd("ls /lab/pipeline", "producer.py (envoie) et consumer.py (reçoit, chiffre, range)")}
    ${tryCmd("sql \"SELECT ingere_par, count(*) FROM finance.transactions GROUP BY 1\"", "qui a écrit les transactions ?")}
  </div>`)}
  <h3>Les droits RabbitMQ en 3 lignes</h3>
  <div class="box small">
    <p style="margin-top:0">Dans RabbitMQ, un compte reçoit 3 droits par <b>vhost</b> (ici <code>datacorp</code>), chacun étant une expression régulière sur le nom des files : <b>configure</b> (créer / supprimer), <b>write</b> (publier), <b>read</b> (consommer).</p>
    <p>Exemple : le producteur a <code>write = ^ingest\\..*</code> mais <code>read = ^$</code> (rien) : il envoie, il ne lit pas.</p>
    <p style="margin-bottom:0">🖱️ Dans RabbitMQ Management : <b>Admin → Users</b> (comptes, dont les <code>v-…</code> créés par Vault), <b>Queues</b> (files et messages), <b>Connections</b> (colonne TLS). ${guiLink("rabbitmq", "Ouvrir RabbitMQ")}</p>
  </div>`;
  return "";
}

// ---------------------------------------------------------------- ACL Vault
function aclCours() {
  return `
  <h2>🛂 Les ACL de Vault : qui a le droit de faire quoi ?</h2>
  ${storyBox("🛂", "L'idée", `Dans Vault, <b>tout est un chemin</b> (comme une adresse web) : <code>kv/data/datacorp/…</code>, <code>transit/encrypt/datacorp-pii</code>, <code>database/creds/app-ingest</code>…
    Par défaut, <b>tout est interdit</b>. Une <b>politique</b> (policy) est une liste de chemins avec ce qu'on a le droit d'y faire.
    On attache des politiques à un <b>utilisateur</b> (ou à une application) : quand il se connecte, il reçoit un <b>jeton</b> qui porte ces politiques.`)}
  <div class="box aclflow">
    <div class="aclchain">
      <div class="aclnode"><b>👩‍💻 alice</b><span class="small muted">se connecte</span></div><span class="aclarrow">→</span>
      <div class="aclnode"><b>🔐 méthode d'auth</b><span class="small muted">userpass (humains), approle (applis)</span></div><span class="aclarrow">→</span>
      <div class="aclnode"><b>🎫 jeton</b><span class="small muted">policies : data-engineer + default</span></div><span class="aclarrow">→</span>
      <div class="aclnode"><b>📜 chemins autorisés</b><span class="small muted">le reste : 403 permission denied</span></div>
    </div>
  </div>

  <h3>1. Les capacités (ce qu'on a le droit de faire sur un chemin)</h3>
  <div class="tablewrap"><table class="table is-fullwidth acc"><thead><tr><th>Capacité</th><th>Veut dire</th><th>Exemple de commande concernée</th></tr></thead><tbody>
    <tr><td><code>read</code></td><td>lire</td><td><code>vault kv get</code>, <code>vault read database/creds/…</code></td></tr>
    <tr><td><code>create</code></td><td>créer quelque chose qui n'existe pas</td><td><code>vault kv put</code> (nouveau secret)</td></tr>
    <tr><td><code>update</code></td><td>modifier / « exécuter » une action</td><td><code>vault kv put</code> (secret existant), <code>transit/encrypt</code></td></tr>
    <tr><td><code>patch</code></td><td>modifier une partie seulement</td><td><code>vault kv patch</code></td></tr>
    <tr><td><code>delete</code></td><td>supprimer</td><td><code>vault kv delete</code></td></tr>
    <tr><td><code>list</code></td><td>voir les NOMS (pas les valeurs)</td><td><code>vault kv list</code>, navigation dans l'interface</td></tr>
    <tr><td><code>sudo</code></td><td>chemins réservés à l'administration</td><td><code>sys/…</code> (audit, politiques)</td></tr>
    <tr><td><code>deny</code></td><td><b>interdit, et gagne toujours</b></td><td>même si une autre politique autorise</td></tr>
  </tbody></table></div>

  <h3>2. Écrire une politique (langage HCL)</h3>
  <div class="lgrid g2">
    <div>${codeBlock(`# lecture seule des secrets de l'équipe data
path "kv/data/datacorp/data-team/*" {
  capabilities = ["read", "list"]
}
# pouvoir chiffrer les IBAN…
path "transit/encrypt/datacorp-pii" {
  capabilities = ["update"]
}
# …mais JAMAIS les déchiffrer
path "transit/decrypt/*" {
  capabilities = ["deny"]
}`)}</div>
    <div class="small">
      <p style="margin-top:0"><b>Les jokers</b></p>
      <ul>
        <li><code>*</code> à la fin = « tout ce qui commence par » : <code>kv/data/datacorp/*</code></li>
        <li><code>+</code> = « un seul morceau de chemin » : <code>kv/data/+/config</code></li>
      </ul>
      <p><b>Qui gagne ?</b> Le chemin le plus précis. Et <code>deny</code> l'emporte toujours.</p>
      <p><b>⚠️ Le piège KV version 2.</b> La commande <code>vault kv get kv/datacorp/x</code> lit en réalité le chemin <code>kv/<b>data</b>/datacorp/x</code>. Lister utilise <code>kv/<b>metadata</b>/…</code>. La politique doit donc parler de <code>kv/data/…</code> et <code>kv/metadata/…</code>, jamais de <code>kv/datacorp/…</code>.</p>
      <p style="margin-bottom:0"><b>Pour l'interface web</b>, l'utilisateur doit aussi pouvoir <code>list</code> les dossiers parents (<code>kv/metadata/</code>, <code>kv/metadata/datacorp/</code>…), sinon il voit « Not authorized » partout.</p>
    </div>
  </div>

  <h3>3. Observer les politiques du lab</h3>
  ${tryBox(`<div class="box">
    ${tryCmd("vault policy list", "toutes les politiques")}
    ${tryCmd("vault policy read data-engineer", "celle d'Alice : lisez chaque bloc path")}
    ${tryCmd("vault list auth/userpass/users", "les personnes qui ont un compte Vault")}
    ${tryCmd("vault read auth/userpass/users/alice", "regardez token_policies : c'est là que la politique est attachée")}
    ${tryCmd(`T=$(vault login -token-only -no-store -method=userpass username=alice password="$(vault kv get -field=password kv/datacorp/users/vault/alice)")
for p in transit/encrypt/datacorp-pii transit/decrypt/datacorp-pii kv/data/datacorp/break-glass/postgres kv/data/datacorp/data-team/pipeline; do
  printf '%-45s %s\\n' "$p" "$(vault token capabilities "$T" "$p")"
done`, "ce qu'alice a VRAIMENT le droit de faire, chemin par chemin (sans changer la session du lab)")}
  </div>`)}

  <h3>4. Créer une politique et l'attribuer à un utilisateur (terminal)</h3>
  <div class="box small" style="border-left:3px solid var(--warn)">⚠️ La toolbox est <b>partagée par la classe</b> : ne tapez jamais <code>vault login</code> avec un autre compte que root (vous déconnecteriez tout le monde). Pour agir en tant qu'un utilisateur, utilisez <code>-no-store -token-only</code> et la variable <code>VAULT_TOKEN</code>, comme ci-dessous. Remplacez <code>demo-prenom</code> par votre prénom.</div>
  ${tryBox(`<div class="box">
    <p class="small" style="margin-top:0"><b>a) Écrire la politique</b> (le texte entre les deux EOF est envoyé à Vault) :</p>
    ${tryCmd(`vault policy write lecture-demo-prenom - <<'EOF'
path "kv/data/datacorp/demo/*" {
  capabilities = ["read"]
}
path "kv/metadata/datacorp/demo/*" {
  capabilities = ["list"]
}
EOF`, "", false)}
    <p class="small"><b>b) Ranger un secret à lire</b> :</p>
    ${tryCmd(`vault kv put kv/datacorp/demo/message texte="bonjour"`, "", false)}
    <p class="small"><b>c) Créer l'utilisateur et lui attacher la politique</b> (<code>token_policies</code>) :</p>
    ${tryCmd(`vault write auth/userpass/users/demo-prenom password="Demo-2026!" token_policies=lecture-demo-prenom token_ttl=1h`, "", false)}
    <p class="small"><b>d) Se connecter en tant que lui, sans toucher à la session du lab</b> :</p>
    ${tryCmd(`T=$(vault login -token-only -no-store -method=userpass username=demo-prenom password="Demo-2026!")
VAULT_TOKEN=$T vault kv get kv/datacorp/demo/message            # autorisé : read
VAULT_TOKEN=$T vault kv put kv/datacorp/demo/message texte=pirate  # refusé : 403
VAULT_TOKEN=$T vault kv get kv/datacorp/break-glass/postgres      # refusé : hors de son chemin`, "", false)}
    <p class="small"><b>e) Vérifier sans essayer</b> : quelles capacités sur un chemin ?</p>
    ${tryCmd(`vault token capabilities "$T" kv/data/datacorp/demo/message`, "", false)}
    <p class="small"><b>f) Changer ses droits</b> : on réécrit la politique (<code>vault policy write</code>) ou la liste <code>token_policies</code>. Les nouveaux jetons en tiennent compte ; un jeton déjà émis garde ses politiques jusqu'à expiration ou <code>vault token revoke</code>.</p>
    <p class="small"><b>g) Nettoyer</b> :</p>
    ${tryCmd(`vault delete auth/userpass/users/demo-prenom
vault policy delete lecture-demo-prenom
vault kv metadata delete kv/datacorp/demo/message`, "", false)}
  </div>`)}

  <h3>5. La même chose à la souris (Vault UI)</h3>
  <div class="box">
    <ol class="somm small">
      <li>Connectez-vous avec le jeton root (Method = Token).</li>
      <li><b>Policies → « Create ACL policy + »</b> : Name = <code>lecture-demo-prenom</code>, collez le texte HCL de l'étape a), <b>Create policy</b>.</li>
      <li><b>Access → Authentication Methods → userpass/ → « Create user + »</b> : Username, Password, puis dans la partie <b>Tokens</b> → <b>Generated Token's Policies</b> : ajoutez <code>lecture-demo-prenom</code>. <b>Save</b>.</li>
      <li>Déconnectez-vous (menu en haut à droite), puis reconnectez-vous avec <b>Method = Username</b> et le compte créé.</li>
      <li>Ouvrez <code>kv/</code> : vous ne voyez que ce que la politique autorise. Ailleurs : « Not authorized ». Ajoutez <code>list</code> sur <code>kv/metadata/</code> et <code>kv/metadata/datacorp/</code> pour pouvoir naviguer jusqu'au dossier.</li>
    </ol>
    <div class="buttons">${guiLink("vault", "Ouvrir Vault UI")}</div>
  </div>

  <h3>6. Aller plus loin</h3>
  <div class="lgrid g3">
    <div class="box concept"><b>🤖 AppRole (applications)</b><p class="small">Le pipeline n'est pas un humain : il se connecte avec un <code>role_id</code> + <code>secret_id</code>. La politique est attachée au rôle : <code>vault write auth/approle/role/ingest-pipeline token_policies=ingest-pipeline</code>.</p></div>
    <div class="box concept"><b>👥 Groupes</b><p class="small">Plutôt que d'attacher la politique à chaque personne, on crée un groupe : <code>vault write identity/group name=equipe-data policies=data-engineer</code>, puis on y ajoute les personnes.</p></div>
    <div class="box concept"><b>🧾 Le registre</b><p class="small">Chaque refus (403) est écrit dans le journal d'audit : au TP3, <code>logs vault</code> montre qui a essayé quoi.</p></div>
  </div>`;
}

// ---------------------------------------------------------------- branchement
// Insère le guide à la fin de chaque cours (avant le quiz ou la navigation).
{
  const base = coursView;
  // eslint-disable-next-line no-global-assign
  coursView = function (view, id) {
    base(view, id);
    const g = coursGuide(id); if (!g) return;
    const wrap = document.createElement("div"); wrap.className = "coursguide"; wrap.innerHTML = g;
    const quizH = [...view.querySelectorAll("h2")].find((h) => /Quiz/.test(h.textContent));
    const anchor = quizH || view.querySelector(".coursnav");
    if (anchor) anchor.before(wrap); else view.append(wrap);
  };
}

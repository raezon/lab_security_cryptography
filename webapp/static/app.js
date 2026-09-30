"use strict";
// Console DataCorp Secure — client (sans dépendance)

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let CATALOG = [], STATUS = { steps: {} }, BUSY = false, INFO = {}, ME = null, PENDING_SCROLL = null;
let MODE = "facile";           // "facile" (boutons) ou "expert" (on tape les commandes, noté)
let SCORE = {};                // { stepId: { points, max, method } } — personnel, en localStorage
const STEP_MAX = 10, PTS = { typed: 10, prefill: 4, solution: 2 };
const HINT = {};               // { stepId: niveau d'aide déjà utilisé } (mémoire de session)
const SHOWN = {};              // { stepId: nombre d'indices déjà affichés }
const METHOD_LABEL = { typed: "tapé sans aide", prefill: "pré-rempli", solution: "solution", guided: "pas à pas, sans solution", "guided-sol": "pas à pas, avec solution(s)" };
function loadScore() { try { SCORE = JSON.parse(localStorage.getItem("score") || "{}"); } catch { SCORE = {}; } }
function saveScore() { try { localStorage.setItem("score", JSON.stringify(SCORE)); } catch {} }
function award(id, method) {
  const pts = PTS[method] ?? 0, cur = SCORE[id]?.points ?? -1;
  if (pts > cur) { SCORE[id] = { points: pts, max: STEP_MAX, method }; saveScore(); pushScore("step", id, pts, STEP_MAX, method); }
}
// Nom de l'étudiant, envoyé à chaque appel : la console note qui a lancé quoi (lab partagé).
const fullName = () => (ME ? `${ME.prenom} ${ME.nom}` : "");
const hdrs = () => ({ "Content-Type": "application/json", "X-Etudiant": encodeURIComponent(fullName()), "X-Session": ME?.token || "" });

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: hdrs(), ...opts });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || (j && j.error)) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body || {}) });

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg; document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------------------------------------------------------------- ANSI -> HTML
const ANSI = { 1: "a-bold", 31: "a-red", 32: "a-green", 33: "a-yellow", 34: "a-blue", 35: "a-mag", 36: "a-cyan", 91: "a-red", 92: "a-green", 93: "a-yellow", 96: "a-cyan" };
function ansiHTML(s) {
  s = s.replace(/\r(?!\n)/g, "\n").replace(/\x1b\[[0-9;]*[A-HJKST]/g, "");
  let out = "", open = 0, last = 0;
  const re = /\x1b\[([0-9;]*)m/g; let m;
  while ((m = re.exec(s))) {
    out += esc(s.slice(last, m.index)); last = re.lastIndex;
    const codes = m[1].split(";").map(Number);
    if (codes.includes(0) || m[1] === "") { out += "</span>".repeat(open); open = 0; }
    const cls = codes.map((c) => ANSI[c]).filter(Boolean);
    if (cls.length) { out += `<span class="${cls.join(" ")}">`; open++; }
  }
  return out + esc(s.slice(last)) + "</span>".repeat(open);
}

// Lance une requête qui renvoie du NDJSON et affiche la sortie en direct.
async function streamTo(url, body, term) {
  term.innerHTML = ""; let raw = "", end = null;
  const r = await fetch(url, { method: "POST", headers: hdrs(), body: JSON.stringify(body || {}) });
  if (!r.ok) { term.innerHTML = `<span class="a-red">${esc(await r.text())}</span>`; return { status: "ko", code: -1 }; }
  const reader = r.body.getReader(), dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.t === "out") {
        raw += ev.d;
        const stick = term.scrollTop + term.clientHeight >= term.scrollHeight - 30;
        term.innerHTML = ansiHTML(raw);
        if (stick) term.scrollTop = term.scrollHeight;
      } else if (ev.t === "end") end = ev;
    }
  }
  return end || { status: "ko", code: -1 };
}

// ---------------------------------------------------------------- statut (sonde)
let LAST_STATUS = "";
async function refreshStatus() {
  let txt;
  try { const r = await fetch("/api/status"); txt = await r.text(); STATUS = JSON.parse(txt); } catch (e) { return; }
  if (txt === LAST_STATUS) return;   // rien n'a changé : pas de re-rendu
  LAST_STATUS = txt;
  const v = STATUS.vault || {}, b = $("#vaultBadge");
  if (v.error) { b.className = "vbadge ko"; b.textContent = "Vault injoignable"; }
  else if (!v.initialized) { b.className = "vbadge ko"; b.textContent = "Vault à initialiser (TP1 · 2)"; }
  else if (v.sealed) { b.className = "vbadge ko"; b.textContent = `Vault fermé (${v.progress}/${v.t} clés)`; }
  else { b.className = "vbadge ok"; b.textContent = "Vault ouvert"; }
  for (const tp of CATALOG) {
    const done = tp.steps.filter((s) => STATUS.steps[s.id]?.status === "ok").length;
    $(`#prog-${tp.id}`).textContent = `${done}/${tp.steps.length}`;
  }
  if (location.hash === "" || location.hash === "#/") renderHomeLive();
  if (location.hash.startsWith("#/tp/")) renderStepNav();
}


// ---------------------------------------------------------------- sommaire
function sommaireView(view) {
  const L = (href, ic, t, d) => `<li><a href="${href}"><b>${ic} ${t}</b></a><br><span class="muted small">${d}</span></li>`;
  view.innerHTML = `<div class="page">
    <h1>🧭 Sommaire</h1>
    <p class="sub">Comment se déplacer dans le lab. Le menu de gauche (bouton ☰ sur téléphone) donne accès à tout, à tout moment.</p>
    <div class="box"><h3>👣 Par où commencer</h3><ol class="somm">
      <li>Lire le <a href="#/cours/projet">🏢 cours du projet DataCorp</a> pour comprendre le contexte.</li>
      <li>Faire les TP <b>dans l'ordre</b> : <a href="#/tp/tp1">TP1</a> → <a href="#/tp/tp2">TP2</a> → <a href="#/tp/tp3">TP3</a>. Chaque TP s'appuie sur le précédent.</li>
      <li>En mode 🎓 facile, cliquez <b>▶ Exécuter l'étape</b> ; en mode 🕵️ expert, tapez la commande puis <b>▶ Valider</b>.</li>
      <li>L'accueil 🏠 affiche le bouton <b>Reprendre →</b> vers la prochaine étape à faire.</li>
    </ol></div>
    <div class="lgrid g2">
      <div class="box"><h3>🧪 Travaux pratiques</h3><ul class="somm">
        ${L("#/tp/tp1","1️⃣","Secrets et chiffrement","Vault, chiffrement applicatif, rotation des mots de passe.")}
        ${L("#/tp/tp2","2️⃣","Droits et anonymisation","Rôles (alice, samira, claire), moindre privilège, pseudonymisation.")}
        ${L("#/tp/tp3","3️⃣","Audit et preuves","Journaux d'audit, traçabilité, conformité.")}
      </ul></div>
      <div class="box"><h3>📚 Cours</h3><ul class="somm">
        ${L("#/cours/projet","🏢","Le projet DataCorp","L'entreprise, la chaîne de données, les risques.")}
        ${L("#/cours/vault","🏦","Vault","Le coffre-fort à secrets et le moteur transit.")}
        ${L("#/cours/minio","🪣","MinIO","Le stockage objet (compatible S3).")}
        ${L("#/cours/rabbitmq","📮","RabbitMQ","La file de messages du pipeline.")}
      </ul></div>
      <div class="box"><h3>🔐 Voir le chiffrement</h3><ul class="somm">
        ${L("#/crypto/transit","🌐","Sur le réseau","TLS entre les services, en direct.")}
        ${L("#/crypto/app","🧩","Dans l'application","Chiffrement des champs par Vault transit.")}
        ${L("#/crypto/rest","💾","Sur le disque","Ce qui est réellement stocké.")}
      </ul></div>
      <div class="box"><h3>🧰 Outils</h3><ul class="somm">
        ${L("#/terminal","💻","Terminal","Taper les commandes dans la toolbox.")}
        ${L("#/access","🔑","Comptes et accès","Liens vers Vault, MinIO, RabbitMQ et leurs comptes.")}
        ${L("#/score","🏆","Mon score","Vos points en mode expert.")}
      </ul></div>
    </div>
    <div class="box"><h3>💡 Astuces</h3><ul class="somm">
      <li>🔑 <b>Identifiants</b> (en haut à droite) : tous les mots de passe du lab.</li>
      <li>Changer de mode (facile / expert) : en haut à droite, à côté de votre nom.</li>
      <li>🌓 Thème clair / sombre : en bas du menu de gauche.</li>
      <li>Le lab est <b>partagé par toute la classe</b> : votre nom s'affiche à côté des étapes que vous validez.</li>
    </ul></div>
  </div>`;
}

// ---------------------------------------------------------------- routeur
const routes = {
  "": home, "#/": home,
  "#/crypto/transit": transitView, "#/crypto/app": appView, "#/crypto/rest": restView, "#/terminal": (v) => terminalView(v), "#/access": accessView, "#/score": scoreView, "#/sommaire": sommaireView,
  "#/coffre": (v) => coffreView(v), "#/classement": (v) => classementView(v, true), "#/feedback": (v) => feedbackView(v), "#/formateur": (v) => formateurView(v),
};
function route() {
  const h = location.hash;
  const view = $("#view");
  let key = "home";
  if (h.startsWith("#/tp/")) { key = h.slice(5); tpView(view, key); }
  else if (h.startsWith("#/cours/")) { key = "cours-" + h.slice(8); coursView(view, h.slice(8)); }
  else { (routes[h] || home)(view); key = { "#/crypto/transit": "transit", "#/crypto/app": "app", "#/crypto/rest": "rest", "#/terminal": "terminal", "#/access": "access", "#/score": "score", "#/sommaire": "sommaire", "#/coffre": "coffre", "#/classement": "classement", "#/feedback": "feedback", "#/formateur": "formateur" }[h] || "home"; }
  if (!h.startsWith("#/tp/")) unmountDock();
  $("#logs")?.close();
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("is-active", a.dataset.view === key));
  document.body.classList.remove("navopen");
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- tableau de bord
const ARCHI = `
<svg class="archi" viewBox="0 0 1000 470" role="img" aria-label="Architecture du lab et chiffrement de chaque flux">
  <defs>
    <marker id="ar-t" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#38bdf8"/></marker>
    <marker id="ar-w" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#ef4444"/></marker>
  </defs>
  <rect class="zone" x="10" y="10" width="360" height="200" rx="12"/><text class="lbl" x="22" y="30">net-broker (ingestion)</text>
  <rect class="zone" x="390" y="10" width="600" height="450" rx="12"/><text class="lbl" x="402" y="30">net-data (données) — RabbitMQ n'a aucune route ici</text>

  <path class="edge et" d="M140 95 L218 95" marker-end="url(#ar-t)"/><text class="lbl" x="150" y="85">AMQPS</text>
  <path class="edge et" d="M300 120 C 300 250, 250 290, 205 300" marker-end="url(#ar-t)"/><text class="lbl" x="298" y="215">AMQPS :5671</text>
  <path class="edge et" d="M200 318 C 380 318, 420 110, 520 100" marker-end="url(#ar-t)"/><text class="lbl" x="360" y="190">HTTPS · transit/encrypt</text>
  <path class="edge et" d="M200 330 L 520 330" marker-end="url(#ar-t)"/><text class="lbl" x="275" y="322">TLS 1.3 verify-full · creds 1 h</text>
  <path class="edge et" d="M200 345 C 330 400, 420 420, 520 420" marker-end="url(#ar-t)"/><text class="lbl" x="290" y="425">HTTPS (S3)</text>
  <path class="edge et" d="M600 125 L 600 300" marker-end="url(#ar-t)"/><text class="lbl" x="606" y="215">TLS · rotate-root</text>
  <path class="edge et" d="M520 88 C 420 60, 360 70, 340 80" marker-end="url(#ar-t)"/><text class="lbl" x="400" y="58">HTTPS :15671 (creds RMQ)</text>
  <path class="edge ew" d="M680 420 L 800 420" marker-end="url(#ar-w)"/><text class="lbl" x="690" y="410">HTTP + jeton</text>
  <path class="edge ea" d="M680 330 L 800 330"/><text class="lbl" x="690" y="320">pgAudit (jsonlog)</text>

  <g class="node" data-go="#/terminal"><rect x="30" y="70" width="110" height="50" rx="9"/><text x="45" y="92">Producteur</text><text class="lbl" x="45" y="109">producer.py</text></g>
  <g class="node" data-go="#/crypto/transit"><rect x="220" y="62" width="130" height="62" rx="9"/><text x="235" y="86">RabbitMQ</text><text class="lbl" x="235" y="103">file ingest.transactions</text><text class="lbl" x="235" y="117" fill="#f59e0b">repos : non chiffré</text></g>
  <g class="node" data-go="#/tp/tp1"><rect x="40" y="295" width="160" height="62" rx="9"/><text x="55" y="319">Consommateur</text><text class="lbl" x="55" y="336">consumer.py · AppRole</text><text class="lbl" x="55" y="350">with-vault-creds.sh</text></g>
  <g class="node" data-go="#/crypto/app"><rect x="520" y="62" width="160" height="62" rx="9"/><text x="535" y="86">Vault 1.17</text><text class="lbl" x="535" y="103">transit · KV · database</text><text class="lbl" x="535" y="117" fill="#a78bfa">barrière AES-256-GCM</text></g>
  <g class="node" data-go="#/crypto/rest"><rect x="520" y="300" width="160" height="62" rx="9"/><text x="535" y="324">PostgreSQL 16</text><text class="lbl" x="535" y="341">IBAN = vault:v2:…</text><text class="lbl" x="535" y="355" fill="#f59e0b">disque : NIR en clair</text></g>
  <g class="node" data-go="#/crypto/rest"><rect x="520" y="390" width="160" height="62" rx="9"/><text x="535" y="414">MinIO (S3)</text><text class="lbl" x="535" y="431">raw-data · curated</text><text class="lbl" x="535" y="445" fill="#f59e0b">repos : SSE-S3 AES-256</text></g>
  <g class="node" data-go="#/tp/tp3"><rect x="800" y="390" width="170" height="62" rx="9"/><text x="815" y="414">audit-sink</text><text class="lbl" x="815" y="431">SIEM simulé</text><text class="lbl" x="815" y="445">→ WORM audit-logs</text></g>
  <g class="node" data-go="#/tp/tp3"><rect x="800" y="300" width="170" height="62" rx="9"/><text x="815" y="324">Journaux</text><text class="lbl" x="815" y="341">SHA-256 chaîné</text><text class="lbl" x="815" y="355">Object Lock 30 j</text></g>
  <g class="node" data-go="#/crypto/transit"><rect x="800" y="62" width="170" height="62" rx="9"/><text x="815" y="86">PKI du lab</text><text class="lbl" x="815" y="103">CA RSA 4096</text><text class="lbl" x="815" y="117">certs serveurs RSA 2048</text></g>
</svg>`;

// Prochaine étape à faire : la première non validée, TP par TP.
function nextStep() {
  for (const tp of CATALOG) for (const s of tp.steps) if (STATUS.steps[s.id]?.status !== "ok") return { tp, s };
  return null;
}

function home(view) {
  view.innerHTML = `
    <h1>Bonjour ${esc(ME?.prenom || "")}</h1>
    <p class="sub">Trois TP pour sécuriser la chaîne de données de DataCorp : protéger les secrets, limiter les droits, garder des preuves. Suivez-les dans l'ordre : chaque TP s'appuie sur le précédent.</p>
    <div id="resume"></div>
    <h2>Les travaux pratiques</h2>
    <div class="lgrid g3" id="tpcards"></div>
    <h2>Les interfaces du lab</h2>
    <div class="lgrid g3">
      <div class="box"><h3>Vault</h3><p class="muted small">Le coffre-fort à secrets. Connexion avec le jeton root (après TP1 · étape 2) ou avec un compte alice / samira / claire.</p>
        <div class="buttons" style="margin-top:10px"><a class="button is-small is-primary" href="${esc(INFO.vault_url)}" target="_blank" rel="noopener">Ouvrir Vault ↗</a><button class="button is-small" data-creds>🔑 Identifiants</button></div></div>
      <div class="box"><h3>MinIO</h3><p class="muted small">Le stockage des fichiers (buckets raw-data, curated, audit-logs).</p>
        <div class="buttons" style="margin-top:10px"><a class="button is-small is-primary" href="${esc(INFO.minio_url)}" target="_blank" rel="noopener">Ouvrir MinIO ↗</a><button class="button is-small" data-creds>🔑 Identifiants</button></div></div>
      <div class="box"><h3>RabbitMQ</h3><p class="muted small">La file de messages qui transporte les transactions du pipeline.</p>
        <div class="buttons" style="margin-top:10px"><a class="button is-small is-primary" href="${esc(INFO.rabbitmq_url)}" target="_blank" rel="noopener">Ouvrir RabbitMQ ↗</a><button class="button is-small" data-creds>🔑 Identifiants</button></div></div>
    </div>
    <details class="fold"><summary>Schéma de l'architecture <span class="muted small">cliquez un composant pour ouvrir la démonstration</span></summary>
      <div class="foldbody">${ARCHI}
        <div class="legend" style="margin-top:8px">
          <span style="--c:var(--transit)">chiffré sur le réseau (TLS)</span>
          <span style="--c:var(--ko)">en clair sur le réseau</span>
          <span style="--c:var(--app)">journalisation</span>
        </div></div></details>
    <details class="fold"><summary>État des conteneurs <span class="muted small" id="ctSummary"></span></summary>
      <div class="foldbody"><div class="lgrid g4" id="containers"></div>
        <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="button is-small is-text" id="resetProg">Remettre les coches de progression à zéro</button></div></div></details>`;
  view.querySelectorAll(".node").forEach((n) => n.addEventListener("click", () => (location.hash = n.dataset.go)));
  $("#resetProg").onclick = async () => {
    if (!window.confirm("Effacer VOS coches de progression ? (les autres étudiants et l'état du lab ne sont pas modifiés)")) return;
    await post("/api/reset"); await refreshStatus(); toast("Progression remise à zéro");
  };
  renderHomeLive();
}

function renderHomeLive() {
  const cards = $("#tpcards"); if (!cards) return;
  const nx = nextStep();
  $("#resume").innerHTML = nx ? `<div class="box resume">
      <div style="flex:1;min-width:240px"><div class="kicker">👉 Prochaine étape</div>
        <h3>${esc(nx.tp.title.split("—")[0].trim())} · Étape ${nx.s.num} — ${esc(nx.s.title)}</h3>
        <p class="muted small" style="margin:0">${esc(nx.s.why)}</p></div>
      <a class="button is-primary" href="#/tp/${nx.tp.id}" data-goto="${nx.s.id}">Reprendre →</a></div>`
    : `<div class="box resume"><div><div class="kicker">Bravo</div><h3>Toutes les étapes sont validées.</h3><p class="muted small" style="margin:0">Il reste les questions de compréhension et le volet GRC en bas de chaque TP.</p></div></div>`;
  const go = $("[data-goto]"); if (go) go.onclick = () => { PENDING_SCROLL = go.dataset.goto; };
  cards.innerHTML = CATALOG.map((tp) => {
    const done = tp.steps.filter((s) => STATUS.steps[s.id]?.status === "ok").length;
    return `<a class="box tpcard" href="#/tp/${tp.id}">
      <div class="row"><span class="tpnum">${tp.id.slice(2)}</span><b>${esc(tp.title.split("—")[1] || tp.title)}</b></div>
      <p class="muted small">${esc(tp.tools)}</p>
      <div class="pbar"><i style="width:${(100 * done) / tp.steps.length}%"></i></div>
      <div class="small muted">${done} / ${tp.steps.length} étapes validées</div></a>`;
  }).join("");
  const list = STATUS.containers || [];
  const up = list.filter((x) => x.state === "running").length;
  const sum = $("#ctSummary"); if (sum) sum.textContent = list.length ? `${up} / ${list.length} en marche` : "";
  $("#containers").innerHTML = list.sort((a, b) => a.name.localeCompare(b.name)).map((x) => `
    <div class="box flat svc"><span class="led ${x.state === "running" ? "on" : x.service === "certs-init" ? "" : "off"}"></span>
      <div style="min-width:0"><b>${esc(x.service)}</b><div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.status)}</div></div></div>`).join("");
}

// ---------------------------------------------------------------- TP
function codeBlock(src) {
  const html = esc(src).split("\n").map((l) => {
    const i = l.search(/\s#\s/);
    return i >= 0 ? l.slice(0, i) + `<span class="cm">${l.slice(i)}</span>` : l;
  }).join("\n");
  return `<pre class="code"><button class="button is-small copy" data-copy>Copier</button>${html}</pre>`;
}

function stepHead(s, st, cls, right) {
  return `<div class="stephead">
      <div class="stepnum">${s.num}</div>
      <div style="flex:1;min-width:0">
        <div class="row"><h3 style="margin:0">${esc(s.title)}</h3><span class="spacer"></span>
          <span class="tag ${cls}" data-badge title="${st?.by ? "par " + esc(st.by) : ""}">${st ? (st.status === "ok" ? "✅ validée" : "✗ pas encore réussie") + (st.by ? " · " + esc(st.by) : "") : "à faire"}</span>
          ${right}</div>
        <div class="row" style="margin-top:6px;gap:6px"><span class="tag role">${esc(s.role)}</span>${s.crypto ? `<span class="tag crypto">${esc(s.crypto)}</span>` : ""}</div>
      </div>
    </div>`;
}

// Indices progressifs : un bouton, un indice de plus à chaque clic (gratuit).
function hintsHTML(s) {
  const h = s.hints || []; if (!h.length) return "";
  const n = SHOWN[s.id] || 0;
  return `<div class="hintzone" data-hints="${s.id}">
    <button class="button is-small" data-hintnext ${n >= h.length ? "disabled" : ""}>${n === 0 ? "Besoin d'un indice ?" : n >= h.length ? "Plus d'indice" : "Indice suivant"} <span class="muted">&nbsp;${n}/${h.length}</span></button>
    <ol class="hintlist">${h.slice(0, n).map(hintItem).join("")}</ol></div>`;
}
function wireHints(s, card) {
  const z = $("[data-hints]", card); if (!z) return;
  $("[data-hintnext]", z).onclick = () => {
    SHOWN[s.id] = Math.min((SHOWN[s.id] || 0) + 1, s.hints.length);
    z.outerHTML = hintsHTML(s);
    wireHints(s, card);
  };
}

function stepCard(s) {
  const st = STATUS.steps[s.id];
  const cls = st ? st.status : "";
  if (MODE === "expert") return stepCardExpert(s, st, cls);
  return `<section class="step ${cls}" id="step-${s.id}">
    ${stepHead(s, st, cls, "")}
    <div class="stepbody">
      <p class="why">🎯 ${esc(s.why)}</p>
      ${codeBlock(s.doc)}
      ${guiHTML(s)}
      ${hintsHTML(s)}
      ${s.figure ? `<div class="figure"><img src="/img/${s.figure}" alt="" loading="lazy"></div>` : ""}
      <div class="verify">✅ <b>Résultat attendu :</b> ${esc(s.verify)}</div>
      <div class="steprun"><button class="button is-primary" data-run="${s.id}">▶ Exécuter l'étape</button>
        <span class="muted small">ou tapez-les vous-même dans le terminal en bas ⬇️ (validé aussi)</span></div>
      <details class="runcode"><summary>Commandes exactes lancées par « Exécuter »</summary>${codeBlock(s.run.join("\n"))}</details>
      <div class="checks" data-checks>${st ? checksHTML(st.checks) : ""}</div>
      <div class="term" data-term></div>
      ${logFold(s)}
    </div></section>`;
}



// Un indice = « texte :: morceau de commande ». Le morceau s'essaie (▶) s'il
// est complet, ou se recopie dans le cadre pour être complété (___ ou <…>).
function hintItem(txt, i) {
  const [t, frag] = String(txt).split(" :: ");
  if (!frag) return `<li><b>Indice ${i + 1}.</b>${esc(t)}</li>`;
  const holes = /_{2,}|<[^>]+>/.test(frag);
  return `<li><b>Indice ${i + 1}.</b>${esc(t)}
    <div class="frag"><code>${esc(frag)}</code>
      <span class="fragbtns">${holes ? "" : `<button class="button is-small" data-fragtry="${esc(frag)}" title="Lance cette commande dans le terminal">▶ Essayer</button>`}
      <button class="button is-small" data-fragcopy="${esc(frag)}" title="Écrit dans le terminal, sans lancer : complétez puis Entrée">⌨️ Dans le terminal</button></span></div></li>`;
}
document.addEventListener("click", async (e) => {
  const tb = e.target.closest("[data-fragtry]"), cb = e.target.closest("[data-fragcopy]");
  if (!tb && !cb) return;
  const card = (tb || cb).closest(".step");
  if (typeof getTerm === "function" && $("#dock") && !$("#dock").hidden) {
    if (card) { const s = stepById(card.id.slice(5)); if (s) targetStep(s); }
    if (document.body.classList.contains("dockmin")) $("[data-dockmin]")?.click();
    if (tb) getTerm().run(tb.dataset.fragtry); else getTerm().type(cb.dataset.fragcopy);
    return;
  }
  if (!card) return;
  if (cb) {
    const ta = $("[data-tcmd]", card) || $("[data-cmd]", card);
    if (!ta) { navigator.clipboard?.writeText(cb.dataset.fragcopy); toast("Copié : collez-le dans le Terminal"); return; }
    ta.value = cb.dataset.fragcopy; ta.dispatchEvent(new Event("input")); ta.focus();
    const m = ta.value.search(/_{2,}|<[^>]+>/); if (m >= 0) ta.setSelectionRange(m, m + (ta.value.slice(m).match(/^(_+|<[^>]+>)/)?.[0].length || 0));
    return;
  }
  if (BUSY) return;
  const term = $("[data-term]", card); tb.disabled = true;
  await streamTo("/api/exec", { cmd: tb.dataset.fragtry }, term).catch(() => {});
  tb.disabled = false;
});

// Alternative à la souris (gui.go) : les clics à faire dans l'interface web.
function guiHTML(s) {
  const g = s.gui; if (!g) return "";
  const url = { vault: INFO.vault_url, minio: INFO.minio_url, rabbitmq: INFO.rabbitmq_url }[g.tool];
  const name = { vault: "Vault UI", minio: "MinIO Console", rabbitmq: "RabbitMQ Management" }[g.tool];
  let skip = "";
  if (MODE === "expert" && s.tasks?.length && g.skip > 0) {
    const p = tprog(s.id);
    if (p.i >= g.from && p.i < g.skip) skip = `<button class="button is-small is-primary" data-guiskip>✅ Fait dans l'interface → passer à la commande ${g.skip + 1}</button>
      <span class="small muted">les commandes ${g.from + 1} à ${g.skip} comptent pour moitié</span>`;
  }
  return `<details class="fold guifold"><summary>🖱️ Faire dans l'interface graphique <span class="muted small">${name}, sans terminal</span></summary>
    <div class="foldbody"><ol class="somm small">${g.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
      <div class="buttons" style="margin-top:8px">${url ? `<a class="button is-small" href="${esc(url)}" target="_blank" rel="noopener">Ouvrir ${name} ↗</a>` : ""}
        <button class="button is-small" data-creds>🔑 Identifiants</button>${skip}</div></div></details>`;
}

// ---- mode expert pas à pas : une sous-commande à la fois (tasks.go)
// TPROG[stepId] = { i: sous-commande en cours, shown: {k: indices vus}, sol: {k: true}, cmds: {k: commande tapée} }
let TPROG = {};
function loadTprog() { try { TPROG = JSON.parse(localStorage.getItem("tprog") || "{}"); } catch { TPROG = {}; } }
function saveTprog() { try { localStorage.setItem("tprog", JSON.stringify(TPROG)); } catch {} }
const tprog = (id) => (TPROG[id] ||= { i: 0, shown: {}, sol: {}, cmds: {} });
const SOL_RATIO = 0.25;   // une sous-commande faite avec la solution rapporte 25 % de sa part
function taskPoints(s) {
  const p = tprog(s.id), n = s.tasks.length, part = STEP_MAX / n;
  let pts = 0; for (let k = 0; k < Math.min(p.i, n); k++) pts += p.sol[k] ? part * SOL_RATIO : p.gui?.[k] ? part * 0.5 : part;
  return Math.round(pts);
}

function tasksHTML(s) {
  const p = tprog(s.id), n = s.tasks.length;
  const rows = s.tasks.map((t, k) => {
    if (k < p.i) return `<div class="task done"><div class="taskhead">${p.gui?.[k] ? "🖱️" : "✅"} <b>Commande ${k + 1}</b>${p.gui?.[k] ? `<span class="tag" style="margin-left:6px">faite dans l'interface</span>` : ""}<span class="muted small">&nbsp;· ${esc(t.goal)}</span></div>
        ${p.cmds[k] ? `<pre class="code mini">${esc(p.cmds[k])}</pre>` : ""}
        ${t.learn ? `<div class="learn">💡 ${esc(t.learn)}</div>` : ""}</div>`;
    if (k > p.i) return `<div class="task locked"><div class="taskhead">🔒 Commande ${k + 1} <span class="muted small">se débloque quand la précédente est réussie</span></div></div>`;
    const shown = p.shown[k] || 0, h = t.hints || [];
    return `<div class="task cur" data-task="${k}">
      <div class="taskhead">👉 <b>Commande ${k + 1} / ${n}</b>${p.sol[k] ? `<span class="tag" style="margin-left:8px">solution vue</span>` : ""}</div>
      <p class="goal">${esc(t.goal)}</p>
      <ol class="hintlist">${h.slice(0, shown).map(hintItem).join("")}</ol>
      ${p.sol[k] ? `<div class="solbox small">🔓 Une solution possible : <code>${esc(t.cmd)}</code> <button class="button is-small" data-fragcopy="${esc(t.cmd)}">⌨️ Dans le terminal</button>${/<\w+>/.test(t.cmd) ? `<br><span class="muted">Remplacez les &lt;valeurs&gt; par celles affichées plus haut.</span>` : ""}</div>` : ""}
      <div class="termhint small">⌨️ Tapez dans le <b>terminal en bas</b>. Plusieurs chemins sont possibles : explorez (<code>ls</code>, <code>cat</code>, <code>--help</code>…), toute commande qui produit le bon résultat valide l'objectif.</div>
      <div class="buttons" style="margin-top:8px">
        <button class="button is-small is-primary" data-tfocus>⌨️ Aller au terminal</button>
        <button class="button is-small" data-thint ${shown >= h.length ? "disabled" : ""}>💡 ${shown === 0 ? "Un indice" : shown >= h.length ? "Plus d'indice" : "Indice suivant"} <span class="muted">&nbsp;${shown}/${h.length}</span></button>
        ${p.sol[k] ? "" : `<button class="button is-small" data-tsol ${shown < h.length ? `disabled title="Ouvrez d'abord tous les indices"` : ""}>🔓 Voir la commande <span class="muted">&nbsp;−75 % sur cette commande</span></button>`}
      </div>
      <div class="checks" data-tchecks></div></div>`;
  }).join("");
  const fin = p.i >= n ? `<div class="task fin">🎉 <b>Étape terminée</b> · ${taskPoints(s)} / ${STEP_MAX} pts
      <button class="button is-small is-text" data-treset>Refaire cette étape</button></div>` : "";
  return `<div class="tprog small muted">${Math.min(p.i, n)} / ${n} commandes réussies</div>${rows}${fin}`;
}

function wireTasks(s, card) {
  const zone = $("[data-tasks]", card), p = tprog(s.id), k = p.i, t = s.tasks[k];
  const redraw = () => { zone.innerHTML = tasksHTML(s); wireTasks(s, card); };
  const gz = $("[data-gui]", card);
  if (gz) {
    const open = $("details", gz)?.open;
    gz.innerHTML = guiHTML(s); if (open) $("details", gz).open = true;
    const gs = $("[data-guiskip]", gz);
    if (gs) gs.onclick = () => {
      p.gui ||= {}; for (let j = p.i; j < s.gui.skip; j++) p.gui[j] = true;
      p.i = s.gui.skip; saveTprog(); redraw();
      toast(`Vérification : commande ${s.gui.skip + 1}`);
    };
  }
  const tr = $("[data-treset]", zone);
  if (tr) tr.onclick = async () => { if (!confirm("Recommencer cette étape (vos points sont gardés) ?")) return; TPROG[s.id] = { i: 0, shown: {}, sol: {}, cmds: {} }; saveTprog();
    if (s.id === "tp1-1") { await post("/api/legacy").catch(() => {}); toast("Nouveau mot de passe legacy personnel créé (~/legacy/ingest_legacy.sh)"); }
    redraw(); };
  if (!t) return;
  targetStep(s);
  $("[data-thint]", zone).onclick = () => { p.shown[k] = Math.min((p.shown[k] || 0) + 1, t.hints.length); saveTprog(); redraw(); };
  const sb = $("[data-tsol]", zone);
  if (sb) sb.onclick = () => { p.sol[k] = true; saveTprog(); redraw(); };
  $("[data-tfocus]", zone).onclick = () => { targetStep(s); if (document.body.classList.contains("dockmin")) $("[data-dockmin]")?.click(); getTerm().term?.focus(); };
}

async function checkTask(s, card) {
  if (BUSY) return;
  const p = tprog(s.id), k = p.i, zone = $("[data-tasks]", card);
  const ta = $("[data-tcmd]", zone), cmd = ta.value.trim();
  if (!cmd) { toast("Tapez d'abord une commande"); return; }
  BUSY = true; $$("[data-tcheck]").forEach((b) => (b.disabled = true));
  const term = $("[data-term]", card);
  const end = await streamTo(`/api/check/${s.id}?task=${k}`, { cmd }, term).catch(() => ({ status: "ko", checks: [] }));
  BUSY = false; $$("[data-tcheck]").forEach((b) => (b.disabled = false));
  if (end.status !== "ok") {
    const c = $("[data-tchecks]", zone);
    if (c) c.innerHTML = `<span class="tag ko">✗ Pas encore</span> <span class="small muted">${end.code === -1 ? "Cette commande ne correspond pas à l'objectif." : "Lisez la sortie ci-dessous, corrigez, puis réessayez. Un indice peut aider."}</span>`;
    return;
  }
  p.cmds[k] = cmd; delete p.cmds["cur" + k]; p.i = k + 1; saveTprog();
  zone.innerHTML = tasksHTML(s); wireTasks(s, card);
  if (p.i >= s.tasks.length) {
    const pts = taskPoints(s), method = Object.keys(p.sol).length ? "guided-sol" : "guided";
    if (pts > (SCORE[s.id]?.points ?? -1)) { SCORE[s.id] = { points: pts, max: STEP_MAX, method }; saveScore(); pushScore("step", s.id, pts, STEP_MAX, method); }
    const sc = SCORE[s.id];
    $("[data-pts]", card).className = "tag ok"; $("[data-pts]", card).textContent = `🏆 ${sc.points}/${STEP_MAX} pts`;
    const badge = $("[data-badge]", card); badge.className = "tag ok"; badge.textContent = "✅ validée";
    card.classList.add("ok");
    toast(`Étape ${s.num} terminée · ${pts} pts`);
    updateScoreBadge(); refreshStatus();
  } else {
    toast(`✅ Commande ${k + 1} réussie`);
    $("[data-tcmd]", zone)?.focus();
  }
}

// Mode expert : l'étudiant tape la commande. Indices gratuits, puis aides payantes.
function stepCardExpert(s, st, cls) {
  const sc = SCORE[s.id];
  const badge = sc ? `<span class="tag ok" data-pts>🏆 ${sc.points}/${STEP_MAX} pts</span>` : `<span class="tag" data-pts>${STEP_MAX} pts à gagner</span>`;
  if (s.tasks?.length) return `<section class="step ${cls}" id="step-${s.id}">
    ${stepHead(s, st, cls, badge)}
    <div class="stepbody">
      <p class="why">🎯 ${esc(s.why)}</p>
      <div class="verify">✅ <b>Objectif :</b> ${esc(s.verify)}</div>
      ${s.figure ? `<div class="figure"><img src="/img/${s.figure}" alt="" loading="lazy"></div>` : ""}
      <div data-gui>${guiHTML(s)}</div>
      <div class="tasks" data-tasks>${tasksHTML(s)}</div>
      ${logFold(s)}
      <div class="term" data-term></div>
    </div></section>`;
  return `<section class="step ${cls}" id="step-${s.id}">
    ${stepHead(s, st, cls, badge)}
    <div class="stepbody">
      <p class="why">🎯 ${esc(s.why)}</p>
      <div class="verify">✅ <b>Objectif :</b> ${esc(s.verify)}</div>
      ${s.figure ? `<div class="figure"><img src="/img/${s.figure}" alt="" loading="lazy"></div>` : ""}
      ${hintsHTML(s)}
      <div class="hints">
        <button class="button is-small" data-hint="doc">📖 Documentation</button>
        <button class="button is-small" data-hint="fill">⬇️ Pré-remplir <span class="muted">&nbsp;${PTS.prefill} pts max</span></button>
        <button class="button is-small" data-hint="sol">🔓 Solution <span class="muted">&nbsp;${PTS.solution} pts max</span></button>
      </div>
      <div class="hintbox" data-hintbox hidden></div>
      <textarea class="cmd" data-cmd rows="3" placeholder="Tapez votre ou vos commandes ici, puis Valider (Ctrl+Entrée)" spellcheck="false"></textarea>
      <div class="row"><button class="button is-primary" data-check="${s.id}">▶ Valider ma commande</button>
        <span class="muted small">Sans aide : ${PTS.typed} pts · indices et documentation gratuits</span></div>
      <div class="checks" data-checks>${st ? checksHTML(st.checks) : ""}</div>
      <div class="term" data-term></div>
    </div></section>`;
}
const checksHTML = (cs) => (cs || []).map((c) => `<span class="tag ${c.ok ? "ok" : "ko"}" title="expression attendue dans la sortie">${c.ok ? "✓" : "✗"} <code>${esc(c.pattern)}</code></span>`).join("");

async function runStep(id) {
  const card = $(`#step-${id}`); if (!card || BUSY) return;
  BUSY = true;
  document.querySelectorAll("[data-run],[data-runall]").forEach((b) => (b.disabled = true));
  const badge = $("[data-badge]", card), term = $("[data-term]", card);
  badge.className = "tag run"; badge.textContent = "⏳ en cours…";
  card.classList.remove("ok", "ko");
  const end = await streamTo(`/api/run/${id}`, {}, term).catch((e) => ({ status: "ko", code: -1, checks: [], err: e }));
  card.classList.add(end.status);
  badge.className = `tag ${end.status}`;
  badge.textContent = end.status === "ok" ? "✅ validée" : "✗ pas encore réussie";
  $("[data-checks]", card).innerHTML = checksHTML(end.checks);
  BUSY = false;
  document.querySelectorAll("[data-run],[data-runall]").forEach((b) => (b.disabled = false));
  refreshStatus();
  return end.status;
}

// ---- mode expert : indices, pré-remplissage, validation notée
function wireExpertStep(s, card) {
  const box = $("[data-hintbox]", card), ta = $("[data-cmd]", card);
  const show = (html) => { box.hidden = false; box.innerHTML = html; };
  $$("[data-hint]", card).forEach((b) => (b.onclick = () => {
    if (b.dataset.hint === "doc") return show(`<div class="small muted" style="margin-bottom:6px">Commandes de référence de l'énoncé — à vous de les taper et d'adapter les <code>&lt;valeurs&gt;</code> :</div>${codeBlock(s.doc)}`);
    if (b.dataset.hint === "fill") {
      HINT[s.id] = HINT[s.id] === "solution" ? "solution" : "prefill";
      ta.value = s.doc; ta.focus();
      show(`<div class="small">Énoncé recopié. Adaptez les <code>&lt;valeurs&gt;</code> puis validez — validation ainsi : <b>${PTS.prefill} pts</b>.</div>`);
    }
    if (b.dataset.hint === "sol") {
      HINT[s.id] = "solution";
      ta.value = s.run.join("\n"); ta.focus();
      show(`<div class="small">Commande exacte insérée. Validation ainsi : <b>${PTS.solution} pts</b> (l'important reste de comprendre pourquoi).</div>`);
    }
  }));
  $("[data-check]", card).onclick = () => checkStep(s.id);
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) checkStep(s.id); });
}

async function checkStep(id) {
  const card = $(`#step-${id}`); if (!card || BUSY) return;
  const ta = $("[data-cmd]", card), cmd = ta.value.trim();
  if (!cmd) { toast("Tapez d'abord une commande"); return; }
  BUSY = true;
  $$("[data-check]").forEach((b) => (b.disabled = true));
  const badge = $("[data-badge]", card), term = $("[data-term]", card);
  badge.className = "tag run"; badge.textContent = "⏳ en cours…";
  card.classList.remove("ok", "ko");
  const end = await streamTo(`/api/check/${id}`, { cmd }, term).catch((e) => ({ status: "ko", code: -1, checks: [], err: e }));
  card.classList.add(end.status);
  badge.className = `tag ${end.status}`;
  badge.textContent = end.status === "ok" ? "✅ validée" : "✗ pas encore réussie";
  $("[data-checks]", card).innerHTML = checksHTML(end.checks);
  if (end.status === "ok") {
    const method = HINT[id] || "typed";
    award(id, method);
    const sc = SCORE[id];
    $("[data-pts]", card).className = "tag ok"; $("[data-pts]", card).textContent = `🏆 ${sc.points}/${STEP_MAX} pts`;
    toast(`Étape validée · +${sc.points} pts (${METHOD_LABEL[method]})`);
    updateScoreBadge();
  }
  BUSY = false;
  $$("[data-check]").forEach((b) => (b.disabled = false));
  refreshStatus();
  return end.status;
}

// Sommaire des étapes (colonne de gauche d'un TP) : état + étape visible.
function stepNavHTML(tp) {
  const done = tp.steps.filter((s) => STATUS.steps[s.id]?.status === "ok").length;
  return `<div class="small muted">${done} / ${tp.steps.length} étapes</div>
    <div class="pbar"><i style="width:${(100 * done) / tp.steps.length}%"></i></div>
    <ol>${tp.steps.map((s) => `<li><a href="#step-${s.id}" data-jump="${s.id}" class="${STATUS.steps[s.id]?.status === "ok" ? "ok" : ""}"><b>${s.num}</b><span>${esc(s.title)}</span></a></li>`).join("")}</ol>
    <p class="small" style="margin-top:14px"><a href="#qs">Questions</a> · <a href="#grc">Volet GRC</a></p>`;
}
let STEP_OBS = null;
function renderStepNav() {
  const nav = $("#stepnav"); if (!nav) return;
  const tp = CATALOG.find((t) => t.id === nav.dataset.tp); if (!tp) return;
  const cur = $("a.current", nav)?.dataset.jump;
  nav.innerHTML = stepNavHTML(tp);
  if (cur) $(`[data-jump="${cur}"]`, nav)?.classList.add("current");
}
function wireStepNav(view) {
  view.addEventListener("click", (e) => {
    const a = e.target.closest("[data-jump], a[href='#qs'], a[href='#grc']"); if (!a) return;
    e.preventDefault();
    const id = a.dataset.jump ? `step-${a.dataset.jump}` : a.getAttribute("href").slice(1);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  STEP_OBS?.disconnect();
  STEP_OBS = new IntersectionObserver((ents) => {
    for (const en of ents) if (en.isIntersecting) {
      const id = en.target.id.slice(5);
      $$("#stepnav a[data-jump]").forEach((x) => x.classList.toggle("current", x.dataset.jump === id));
      targetStep(stepById(id));
    }
  }, { rootMargin: "-80px 0px -65% 0px" });
  $$(".step", view).forEach((el) => STEP_OBS.observe(el));
  mountDock(view);
  if (PENDING_SCROLL) { const el = document.getElementById(`step-${PENDING_SCROLL}`); PENDING_SCROLL = null; if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 50); }
}

// En-tête commun (contexte, cours, figures, aide-mémoire repliés)
function tpIntro(tp) {
  return `
    <div class="tphead"><div style="flex:1;min-width:260px"><div class="kicker">${esc(tp.subtitle)}</div><h1>${esc(tp.title)}</h1></div>
      ${MODE === "expert" ? `<span class="tag crypto">Mode expert · noté</span>` : ""}</div>
    <div class="box howto"><p><b>La mission.</b> ${esc(tp.context)}</p>
      <p class="small">Outils : ${esc(tp.tools)}. Mots de passe : bouton <a href="#" data-creds>Identifiants</a> en haut à droite.</p></div>
    <details class="fold"><summary>Le cours en bref <span class="muted small">${tp.course.length} idées à retenir</span></summary>
      <div class="foldbody"><ul class="course" style="margin:0">${tp.course.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        ${tp.figures.length ? `<div class="figs" style="margin-top:14px">${tp.figures.map((f) => `<div class="figure"><img src="/img/${f}" alt="" loading="lazy"></div>`).join("")}</div>` : ""}</div></details>
    <details class="fold"><summary>Aide-mémoire des commandes</summary><div class="foldbody">${CHEAT}</div></details>`;
}
function tpOutro(tp) {
  return `
    <h2 id="qs">Questions de compréhension</h2>
    <div class="box"><ol class="qs" style="margin:0">${tp.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol></div>
    <h2 id="grc">Volet GRC — ${esc(tp.grcTitle)}</h2>
    <div class="box"><img src="/img/fig_grc_methode.png" alt="" style="max-width:520px;width:100%;background:#fff;border-radius:4px;padding:6px"><ol class="qs">${tp.grc.map((q) => `<li>${esc(q)}</li>`).join("")}</ol></div>`;
}

function tpView(view, id) {
  const tp = CATALOG.find((t) => t.id === id);
  if (!tp) { view.innerHTML = "<p>TP introuvable.</p>"; return; }
  if (MODE === "expert") return tpViewExpert(view, tp);
  view.innerHTML = `${tpIntro(tp)}
    <h2 class="row">Les étapes <span class="spacer"></span><button class="button is-small" data-runall>Exécuter tout le TP</button></h2>
    <div class="tplayout">
      <aside class="stepnav" id="stepnav" data-tp="${tp.id}">${stepNavHTML(tp)}</aside>
      <div>
        <div class="box flat small" style="margin-bottom:16px">Pour chaque étape : lisez le <b>pourquoi</b>, tapez les commandes <b>une par une</b> dans le <a href="#/terminal">Terminal</a>, remplacez les <code>&lt;valeurs&gt;</code> par ce que la commande précédente a affiché, puis comparez au <b>résultat attendu</b>. Bloqué ? Ouvrez un indice, ou cliquez sur « Exécuter l'étape ».</div>
        ${tp.steps.map(stepCard).join("")}
        ${tpOutro(tp)}
      </div></div>`;
  view.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => runStep(b.dataset.run)));
  tp.steps.forEach((s) => wireHints(s, $(`#step-${s.id}`, view)));
  $("[data-runall]", view).addEventListener("click", async () => {
    for (const s of tp.steps) {
      $(`#step-${s.id}`).scrollIntoView({ behavior: "smooth", block: "start" });
      const st = await runStep(s.id);
      if (st !== "ok") { toast(`Arrêt à l'étape ${s.num} : résultat attendu non obtenu`); break; }
    }
  });
  wireStepNav(view);
}

// ---- reconnaissance (mode expert) : ce qu'un attaquant peut constater AVANT de sécuriser
const RECON = {
  tp1: {
    intro: "Avant de tout mettre sous clé, mettez-vous à la place d'un attaquant : où traînent les secrets et les données en clair ? Chaque constat justifie une mesure de la phase 2.",
    items: [
      { t: "Mots de passe en clair dans le vieux script (état : au repos, dans le code)", c: `grep -nE "PASS|SECRET|KEY|URL" ~/legacy/ingest_legacy.sh` },
      { t: "IBAN lisibles dans le fichier de la base sur le disque (état : au repos)", link: "#/crypto/rest" },
      { t: "Mot de passe qui circule : chiffré (TLS) ou en clair ? (état : en transit)", link: "#/crypto/transit" },
    ],
  },
  tp2: {
    intro: "Un compte peut être authentifié (TP1) mais voir bien trop de choses. Constatez ce qu'un analyste ou un curieux peut lire de trop, avant de poser les bonnes barrières.",
    items: [
      { t: "La classification dit ce qui est sensible : sait-on qui devrait y accéder ?", c: `sql "SELECT table_name, column_name, niveau FROM gouvernance.classification_donnees WHERE niveau='RESTREINT'"` },
      { t: "Un analyste (Bruno) peut-il lire toute la table RH, NIR et salaires compris ?", c: `sql-as bruno "SELECT nom, nir, salaire_brut_annuel FROM rh.employes LIMIT 3" 2>&1 || echo "(refusé = déjà sécurisé)"` },
      { t: "Données au repos dans le stockage objet (état : au repos)", link: "#/crypto/rest" },
    ],
  },
  tp3: {
    intro: "Un attaquant agit… puis efface ses traces. Constatez d'abord qu'il n'y a presque rien de journalisé, avant d'installer l'audit et le coffre de preuves ineffaçable.",
    items: [
      { t: "Rejouer une « nuit agitée » d'incidents (simulation formateur)", c: `/lab/scripts/simulate-incidents.sh` },
      { t: "Que reste-t-il comme traces des accès refusés ?", c: `logs minio; logs vault` },
      { t: "Sans coffre WORM, peut-on effacer une preuve ? (à retester après la phase 2)", c: `mc ls --recursive dc/audit-logs 2>&1 | tail -3 || echo "(pas encore de coffre : c'est justement le problème)"` },
    ],
  },
};

function tpViewExpert(view, tp) {
  const rec = RECON[tp.id] || { intro: "", items: [] };
  const done = tp.steps.filter((s) => SCORE[s.id]).length;
  const got = tp.steps.reduce((a, s) => a + (SCORE[s.id]?.points || 0), 0);
  const max = tp.steps.length * STEP_MAX;
  view.innerHTML = `${tpIntro(tp)}
    <h2 class="row">Phase 1 — Reconnaissance <span class="spacer"></span><span class="tag">non noté</span></h2>
    <div class="box">
      <p class="small" style="margin:0 0 10px">${esc(rec.intro)}</p>
      ${rec.items.map((it, i) => `<div class="recon">
        <div class="row"><span class="tag">${i + 1}</span><b>${esc(it.t)}</b><span class="spacer"></span>
          ${it.link ? `<a class="button is-small" href="${it.link}">Ouvrir la démo ↗</a>` : `<button class="button is-small is-primary" data-recon="${i}">Constater</button>`}</div>
        ${it.link ? "" : `<div class="term" data-recterm="${i}" hidden></div>`}</div>`).join("")}
    </div>
    <h2 class="row">Phase 2 — Sécuriser <span class="spacer"></span><span class="tag">${done}/${tp.steps.length} · ${got}/${max} pts</span></h2>
    <div class="tplayout">
      <aside class="stepnav" id="stepnav" data-tp="${tp.id}">${stepNavHTML(tp)}</aside>
      <div>
        <div class="box flat small" style="margin-bottom:16px">👣 Chaque étape est découpée en <b>petites commandes</b>. Lisez l'objectif de la commande, <b>tapez-la vous-même</b>, puis « ▶ Valider » : la suivante se débloque. 💡 Les <b>indices</b> sont gratuits et vont du plus vague au plus précis. 🔓 Voir la commande n'est possible qu'après tous les indices, et ne rapporte que 25 % des points de cette commande. Étape sans solution : ${STEP_MAX} pts.</div>
        ${tp.steps.map(stepCard).join("")}
        ${tpOutro(tp)}
      </div></div>`;
  rec.items.forEach((it, i) => { if (it.link) return;
    const b = view.querySelector(`[data-recon="${i}"]`);
    b.onclick = async () => { const t = view.querySelector(`[data-recterm="${i}"]`); t.hidden = false; b.disabled = true;
      await streamTo("/api/exec", { cmd: it.c }, t); b.disabled = false; };
  });
  tp.steps.forEach((s) => { const c = $(`#step-${s.id}`, view); if (s.tasks?.length) wireTasks(s, c); else { wireExpertStep(s, c); wireHints(s, c); } });
  wireStepNav(view);
}

// ---- score view
function scoreView(view) {
  const rows = [];
  let got = 0, max = 0;
  for (const tp of CATALOG) for (const s of tp.steps) {
    const sc = SCORE[s.id]; max += STEP_MAX; got += sc?.points || 0;
    rows.push({ tp: tp.id.toUpperCase(), num: s.num, title: s.title, sc });
  }
  const pct = max ? Math.round((100 * got) / max) : 0;
  const label = METHOD_LABEL;
  const medal = pct >= 90 ? "Expert confirmé" : pct >= 70 ? "Bon niveau" : pct >= 40 ? "En progrès" : "Débutant";
  view.innerHTML = `
    <h1>Mon score</h1>
    <p class="sub">Barème personnel du mode Expert (${esc(fullName())}). Enregistré dans ce navigateur.</p>
    <div class="box scoretop">
      <div><div class="bignum">${got} <span class="muted" style="font-size:18px">/ ${max} pts</span></div>
        <div class="pbar" style="margin:8px 0"><i style="width:${pct}%"></i></div>
        <div class="small muted">${pct}% · ${medal}</div></div>
    </div>
    <div class="tablewrap"><table class="table is-fullwidth acc"><thead><tr><th>TP</th><th>Étape</th><th>Méthode</th><th style="text-align:right">Points</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${r.tp}</td><td>${r.num}. ${esc(r.title)}</td>
        <td>${r.sc ? label[r.sc.method] : "<span class='muted'>—</span>"}</td>
        <td style="text-align:right"><b class="${r.sc ? (r.sc.points >= PTS.typed ? "n good" : "") : "muted"}">${r.sc ? r.sc.points : 0}</b> / ${STEP_MAX}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="row" style="margin-top:14px"><span class="muted small">Barème : tapé sans aide ${PTS.typed} · pré-rempli ${PTS.prefill} · solution ${PTS.solution} pts par étape.</span>
      <span class="spacer"></span><button class="button is-small" id="scoreReset">Réinitialiser mon score</button></div>`;
  $("#scoreReset").onclick = () => { if (!confirm("Effacer votre score personnel ?")) return; SCORE = {}; saveScore(); updateScoreBadge(); scoreView(view); };
}

function updateScoreBadge() {
  const nav = $("#navScore"); if (!nav) return;
  nav.hidden = MODE !== "expert";
  if (MODE === "expert") {
    let got = 0, max = 0;
    for (const tp of CATALOG) for (const s of tp.steps) { max += STEP_MAX; got += SCORE[s.id]?.points || 0; }
    nav.innerHTML = `🏆 Mon score<em>${got}/${max}</em>`;
  }
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-copy]"); if (!b) return;
  const txt = b.parentElement.innerText.replace(/^Copier\n?/, "");
  navigator.clipboard?.writeText(txt).then(() => toast("Copié"), () => toast("Copie impossible"));
});

// ---------------------------------------------------------------- EN TRANSIT
function transitView(view) {
  view.innerHTML = `
    <h1><span class="dot t" style="display:inline-block"></span> Chiffrement en transit</h1>
    <p class="sub">La console se connecte elle-même à chaque service (depuis les réseaux net-data et net-broker) et montre ce que TLS protège — et ce qui se passe quand on tente de s'en passer.</p>
    <div class="box">
      <div class="row"><h3 style="margin:0">1 · Poignée de main TLS avec chaque service</h3><span class="spacer"></span>
        <select id="tlsTest">
          <option value="normal">Connexion normale (CA du lab, bon nom)</option>
          <option value="wrongname">Attaque : mauvais nom de serveur (homme du milieu)</option>
          <option value="noca">Client sans la CA du lab</option>
          <option value="tls11">Client limité à TLS 1.1</option>
        </select>
        <button class="button is-primary" id="tlsGo">Inspecter</button></div>
      <p class="muted small" id="tlsExplain">Même vérification que <code>sslmode=verify-full</code> : chaîne de confiance jusqu'à la CA du lab + nom du serveur dans le certificat (SAN).</p>
      <div class="lgrid g2" id="tlsOut"></div>
    </div>
    <h2>2 · Les connexions en clair sont refusées</h2>
    <div class="box"><div class="row"><span class="muted">pg_hba.conf, listeners TLS-only, port AMQP désactivé : on essaie quand même.</span><span class="spacer"></span><button class="button is-primary" id="plainGo">Tenter en clair</button></div><div id="plainOut" class="lgrid" style="margin-top:12px"></div></div>
    <h2>3 · Ce que voit un espion sur le réseau</h2>
    <div class="box">
      <div class="row"><label class="muted small">Donnée sensible envoyée :</label><input type="text" id="wireSecret" value="FR7630001007941234567890185" size="34">
        <button class="button is-primary" id="wireGo">Envoyer en HTTPS et en HTTP clair</button></div>
      <p class="muted small">La même requête <code>POST {"iban": …}</code> part vers Vault en HTTPS (TLS 1.3) et vers audit-sink en HTTP. La console enregistre chaque octet écrit sur la socket TCP, comme le ferait <code>tcpdump</code>.</p>
      <div class="lgrid g2" id="wireOut"></div>
    </div>`;
  const go = async () => {
    const test = $("#tlsTest").value, out = $("#tlsOut");
    out.innerHTML = `<p class="muted">Connexion…</p>`;
    try {
      const res = await api(`/api/tls?test=${test}`);
      $("#tlsExplain").textContent = res[0]?.explain || "Même vérification que sslmode=verify-full : chaîne de confiance jusqu'à la CA du lab + nom du serveur dans le certificat (SAN).";
      out.innerHTML = res.map(tlsCard).join("");
    } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  $("#tlsGo").onclick = go; $("#tlsTest").onchange = go; go();
  $("#plainGo").onclick = async () => {
    const res = await api("/api/plaintext");
    $("#plainOut").innerHTML = res.map((r) => `<div class="box flat">
      <div class="row"><b>${esc(r.target)}</b><span class="spacer"></span><span class="pill ${r.refused ? "good" : "bad"}">${r.refused ? "REFUSÉ" : "ACCEPTÉ !"}</span></div>
      <div class="small muted">${esc(r.attempt)}</div><pre class="hex">${esc(r.response)}</pre><div class="small" style="margin-top:6px">${esc(r.explain)}</div></div>`).join("");
  };
  $("#wireGo").onclick = async () => {
    const s = encodeURIComponent($("#wireSecret").value);
    const [a, b] = await Promise.all([api(`/api/wire?mode=tls&secret=${s}`), api(`/api/wire?mode=clear&secret=${s}`)]);
    $("#wireOut").innerHTML = wireCard(a, "HTTPS (TLS 1.3) → vault:8200") + wireCard(b, "HTTP en clair → audit-sink:8088");
  };
}

function tlsCard(r) {
  const leaf = r.chain?.[0], root = r.chain?.[r.chain.length - 1];
  // Test d'attaque : un refus est le bon résultat, une connexion acceptée est une faille.
  const attack = r.test !== "normal";
  const [cls, label] = attack ? (r.ok ? ["bad", "ACCEPTÉ ⚠ faille"] : ["good", "refusé ✓ (attendu)"]) : (r.ok ? ["good", "vérifié ✓"] : ["bad", "échec ✗"]);
  return `<div class="box flat tls">
    <div class="row"><b>${esc(r.name)}</b><span class="muted small mono">${esc(r.addr)}</span><span class="spacer"></span>
      <span class="pill ${cls}">${label}</span></div>
    ${attack && r.ok ? `<div class="verdict bad small">Ce service a accepté la connexion malgré le test « ${esc(r.test)} »${r.test === "tls11" ? " : il n'impose pas TLS ≥ 1.2 (correctif : management.ssl.versions.1 = tlsv1.3 et .2 = tlsv1.2 dans rabbitmq.conf)" : ""}.</div>` : ""}
    <div class="small muted">${esc(r.usage)}</div>
    ${r.ok ? `<div class="row" style="margin:6px 0"><span class="big">${esc(r.version)}</span><span class="pill">${esc(r.cipher)}</span>${r.alpn ? `<span class="pill">ALPN ${esc(r.alpn)}</span>` : ""}<span class="muted small">${r.ms} ms</span></div>
      ${r.kx ? `<div class="small muted">Échange de clé : ${esc(r.kx)}</div>` : ""}` : `<div class="err mono" style="margin:6px 0">${esc(r.error)}</div>`}
    ${leaf ? `<dl class="kv" style="margin-top:6px">
      <dt>Certificat</dt><dd>${esc(leaf.subject)}</dd>
      <dt>Émis par</dt><dd>${esc(leaf.issuer)}</dd>
      <dt>SAN</dt><dd>${esc((leaf.sans || []).join(", "))}</dd>
      <dt>Clé / signature</dt><dd>${esc(leaf.keyAlgo)} · ${esc(leaf.sigAlgo)}</dd>
      <dt>Validité</dt><dd>${esc(leaf.notBefore)} → ${esc(leaf.notAfter)}</dd>
      <dt>SHA-256</dt><dd class="small">${esc(leaf.fingerprint.match(/.{1,2}/g).slice(0, 12).join(":"))}…</dd>
      ${root && root !== leaf ? `<dt>Ancre</dt><dd>${esc(root.subject)} (${esc(root.keyAlgo)})</dd>` : ""}
    </dl>` : ""}</div>`;
}

function markSecret(text, secret) {
  const e = esc(text), s = esc(secret);
  return s ? e.split(s).join(`<mark>${s}</mark>`) : e;
}
function wireCard(w, title) {
  return `<div class="box flat">
    <h3>${esc(title)}</h3>
    <div class="verdict ${w.found ? "bad" : "good"}">${w.found ? `⚠ « ${esc(w.secret)} » est lisible sur le réseau` : `✓ « ${esc(w.secret)} » introuvable dans les octets capturés`}</div>
    <div class="small muted">Octets envoyés (début) :</div>
    <pre class="hex">${esc(w.rawSent)}</pre>
    <div class="wire" style="margin-top:8px">${(w.records || []).map((r) => `<div class="rec">
      <b>${esc(r.dir)} ${esc(r.type)}</b> <span class="muted small">${r.version ? "version " + esc(r.version) + " · " : ""}${r.len} octets</span>
      <div class="ascii">${markSecret(r.ascii, w.secret)}</div></div>`).join("")}</div>
    <p class="small" style="margin-bottom:0">${esc(w.note)}</p></div>`;
}

// ---------------------------------------------------------------- APPLICATIF (Vault transit)
const CTS = [];
function appView(view) {
  view.innerHTML = `
    <h1><span class="dot a" style="display:inline-block"></span> Chiffrement applicatif — Vault transit</h1>
    <p class="sub">« Encryption as a service » : l'application envoie l'IBAN à Vault, reçoit <code>vault:vN:…</code> et ne voit jamais la clé AES-256-GCM96 <code>datacorp-pii</code>. C'est ce que fait <code>consumer.py</code> avant d'écrire en base (TP1 · étape 5).</p>
    <div id="keyCard" class="box"><p class="muted">Lecture de la clé…</p></div>
    <div class="lgrid g2" style="margin-top:14px">
      <div class="box">
        <h3>Chiffrer / déchiffrer</h3>
        <div class="row"><input type="text" id="pt" value="FR7630001007941234567890185" style="flex:1">
          <select id="ver"><option value="0">dernière version</option></select>
          <button class="button is-primary" id="encGo">Chiffrer</button></div>
        <p class="muted small">Chiffrez deux fois la même valeur (question 3 du TP1) : le nonce aléatoire de GCM rend chaque chiffré unique. Après une rotation, <b>rewrap</b> ré-emballe un ancien chiffré avec la nouvelle version sans jamais exposer le clair.</p>
        <div class="ctlist" id="cts"></div>
      </div>
      <div class="lgrid">
        <div class="box">
          <h3>Pseudonymiser : HMAC-SHA256</h3>
          <div class="row"><input type="text" id="hin" value="282053487661364" style="flex:1"><button class="button" id="hmacGo">HMAC</button></div>
          <p class="muted small">Contrairement au chiffrement, le HMAC est <b>déterministe</b> (même entrée → même sortie) et <b>irréversible</b> : parfait pour joindre des tables sans révéler le NIR (même principe que les vues masquées du TP2).</p>
          <div id="hmacOut"></div>
        </div>
        <div class="box">
          <h3>Chiffrement d'enveloppe (clé de données)</h3>
          <div class="row"><input type="text" id="envIn" value="Bulletin de paie 09/2026 — J. Martin — 4 250,00 €" style="flex:1"><button class="button" id="envGo">Chiffrer localement</button></div>
          <p class="muted small">Vault fournit une clé de données (DEK) en clair <i>et</i> chiffrée. On chiffre le fichier localement avec la DEK puis on l'oublie ; on ne stocke que la DEK chiffrée. C'est le mécanisme de SSE-S3 dans MinIO et du chiffrement de disques par KMS.</p>
          <div id="envOut"></div>
        </div>
      </div>
    </div>`;
  loadKey(); renderCTs();
  $("#encGo").onclick = async () => {
    try {
      const r = await post("/api/transit/encrypt", { plaintext: $("#pt").value, version: +$("#ver").value });
      CTS.unshift({ pt: $("#pt").value, ct: r.ciphertext }); renderCTs();
    } catch (e) { toast(e.message); }
  };
  $("#hmacGo").onclick = async () => {
    try { const r = await post("/api/transit/hmac", { plaintext: $("#hin").value });
      $("#hmacOut").innerHTML = `<pre class="hex">${esc($("#hin").value)}\n→ ${esc(r.hmac)}</pre>` + $("#hmacOut").innerHTML;
    } catch (e) { toast(e.message); }
  };
  $("#envGo").onclick = async () => {
    try { const r = await post("/api/transit/envelope", { plaintext: $("#envIn").value });
      $("#envOut").innerHTML = `<dl class="kv">
        <dt>DEK (clair)</dt><dd>${esc(r.dekClearPreview)}</dd>
        <dt>DEK chiffrée</dt><dd>${esc(r.dekWrapped)}</dd>
        <dt>Nonce</dt><dd>${esc(r.nonce)}</dd>
        <dt>Données</dt><dd>${esc(r.ciphertext)}</dd>
        <dt>Relu</dt><dd style="color:var(--c-ok)">${esc(r.decrypted)}</dd></dl>
        <div class="small muted" style="margin-top:6px">Ce qui est stocké sur disque :</div><pre class="hex">${esc(JSON.stringify(r.stored, null, 1))}</pre>`;
    } catch (e) { toast(e.message); }
  };
}

async function loadKey() {
  const c = $("#keyCard"); if (!c) return;
  try {
    const k = await post("/api/transit/key");
    const vers = Object.keys(k.keys || {}).map(Number).sort((a, b) => a - b);
    c.innerHTML = `<div class="row"><h3 style="margin:0">Clé <code>transit/keys/datacorp-pii</code></h3><span class="spacer"></span>
      <button class="button is-danger is-outlined" id="rotGo">↻ Rotation (nouvelle version)</button></div>
      <div class="row" style="margin-top:8px"><span class="tag a">type ${esc(k.type)}</span><span class="tag">version courante <b>&nbsp;v${k.latest_version}</b></span>
      <span class="tag">déchiffrement minimal v${k.min_decryption_version}</span><span class="tag">${k.exportable ? "exportable !" : "non exportable"}</span>
      <span class="tag">${k.deletion_allowed ? "suppression autorisée" : "suppression interdite"}</span></div>
      <div style="margin-top:8px">${vers.map((v) => `<span class="ver">v${v}</span><span class="muted small">${new Date(k.keys[v] * 1000 || k.keys[v]).toLocaleString?.() || ""}</span> `).join("")}</div>`;
    const sel = $("#ver"); if (sel) sel.innerHTML = `<option value="0">dernière (v${k.latest_version})</option>` + vers.map((v) => `<option value="${v}">v${v}</option>`).join("");
    $("#rotGo").onclick = async () => { try { await post("/api/transit/rotate"); toast("Nouvelle version de clé"); loadKey(); } catch (e) { toast(e.message); } };
  } catch (e) {
    c.innerHTML = `<p class="err">${esc(e.message)}</p><p class="muted small">Le moteur transit et la clé sont créés à <a href="#/tp/tp1">TP1 · étape 5</a> (Vault doit être ouvert : étape 2).</p>`;
  }
}

function renderCTs() {
  const box = $("#cts"); if (!box) return;
  box.innerHTML = CTS.map((c, i) => `<div class="ct">
    <div class="row"><span class="ver">${esc(c.ct.split(":")[1])}</span><span class="small muted">clair : ${esc(c.pt)}</span><span class="spacer"></span>
      <button class="button is-small" data-dec="${i}">Déchiffrer</button><button class="button is-small" data-rew="${i}">Rewrap</button></div>
    <code>${esc(c.ct)}</code>${c.out ? `<div class="small" style="margin-top:4px;color:var(--c-ok)">${esc(c.out)}</div>` : ""}</div>`).join("") || `<p class="muted small">Aucun chiffré pour l'instant.</p>`;
  box.querySelectorAll("[data-dec]").forEach((b) => (b.onclick = async () => {
    const c = CTS[b.dataset.dec];
    try { const r = await post("/api/transit/decrypt", { ciphertext: c.ct }); c.out = `déchiffré → ${r.decoded}`; } catch (e) { c.out = "✗ " + e.message; }
    renderCTs();
  }));
  box.querySelectorAll("[data-rew]").forEach((b) => (b.onclick = async () => {
    const c = CTS[b.dataset.rew];
    try { const r = await post("/api/transit/rewrap", { ciphertext: c.ct }); CTS.unshift({ pt: c.pt, ct: r.ciphertext, out: `rewrap de ${c.ct.split(":")[1]} → ${r.ciphertext.split(":")[1]} (le clair n'a jamais quitté Vault)` }); } catch (e) { c.out = "✗ " + e.message; }
    renderCTs();
  }));
}

// ---------------------------------------------------------------- AU REPOS
function entropyBar(h) { return `<div class="small muted">Entropie : ${h.toFixed(2)} bits/octet ${h > 7.5 ? "(aléatoire → chiffré)" : h < 5 ? "(structuré → lisible)" : ""}</div><div class="entropy"><i style="width:${(h / 8) * 100}%"></i></div>`; }

function restView(view) {
  view.innerHTML = `
    <h1><span class="dot r" style="display:inline-block"></span> Chiffrement au repos</h1>
    <p class="sub">La console lit les fichiers <b>directement sur les disques</b> des conteneurs (comme un voleur de sauvegarde ou de disque) et cherche les données sensibles.</p>
    <div class="box">
      <div class="row"><h3 style="margin:0">PostgreSQL — fichier de la table <code>rh.employes</code></h3><span class="spacer"></span>
        <button class="button is-primary" id="pgGo">Lire le fichier sur disque</button><button class="button" id="pgVac">VACUUM FULL puis relire</button></div>
      <p class="muted small">PostgreSQL ne chiffre pas ses fichiers (pas de TDE) : seules les colonnes chiffrées par l'application (IBAN via Vault transit, TP1 · 5) sont protégées. C'est exactement la fiche GRC 6.3 du TP1 « une sauvegarde est volée ».</p>
      <div id="pgOut"></div>
    </div>
    <div class="box" style="margin-top:14px">
      <div class="row"><h3 style="margin:0">MinIO — SSE-S3 : même objet, bucket clair vs bucket chiffré</h3><span class="spacer"></span>
        <button class="button is-primary" id="mnGo">Écrire puis lire les disques</button></div>
      <p class="muted small">Un virement fictif est déposé dans <code>demo-clair</code> (sans chiffrement) et <code>demo-chiffre</code> (<code>mc encrypt set sse-s3</code>, comme raw-data et curated). Puis on lit le fichier de données <code>/data/&lt;bucket&gt;/virement.json/&lt;uuid&gt;/part.1</code> directement sur le disque du conteneur MinIO.</p>
      <div id="mnOut"></div>
    </div>
    <div class="box" style="margin-top:14px">
      <div class="row"><h3 style="margin:0">Vault — stockage <code>/vault/file</code> derrière la barrière</h3><span class="spacer"></span>
        <button class="button is-primary" id="vtGo">Lire le stockage</button></div>
      <p class="muted small">Tout ce que Vault écrit sur disque est chiffré (AES-256-GCM) par une clé elle-même protégée par la clé maître découpée en 5 fragments de Shamir (TP1 · 2). Sans 3 fragments, les fichiers sont inexploitables.</p>
      <div id="vtOut"></div>
    </div>`;
  const pg = async (method) => {
    const out = $("#pgOut"); out.innerHTML = `<p class="muted">Lecture…</p>`;
    try {
      const r = await api("/api/rest/postgres", { method });
      out.innerHTML = `<dl class="kv" style="margin:8px 0"><dt>Fichier</dt><dd>${esc(r.file)} (${(r.size / 1024).toFixed(0)} Kio)</dd>
        <dt>Lignes vivantes</dt><dd>${esc(r.rows)} dont ${esc(r.encryptedRows)} IBAN chiffrés</dd>
        <dt>Tuples morts</dt><dd>${esc(r.deadTuples)} comptés par PostgreSQL (après autovacuum : 0, mais les octets restent)</dd></dl>
        ${entropyBar(r.entropy)}
        ${r.findings.map((f) => `<div class="find"><span class="n ${f.danger ? "bad" : "good"}">${f.count}</span><div style="min-width:0;flex:1"><b>${esc(f.label)}</b>
          ${f.sample ? `<span class="muted small"> · 1er à l'octet ${f.offset} : <code>${esc(f.sample)}</code></span><pre class="hex">${markSecret(f.hexdump, "")}</pre>` : ""}</div></div>`).join("")}
        <p class="small">${+r.encryptedRows === 0 ? "⚠ Les IBAN ne sont pas encore chiffrés : faites <a href='#/tp/tp1'>TP1 · étape 5</a> puis relisez." :
          r.findings[1].count > 0 ? "⚠ Toutes les lignes vivantes sont chiffrées, mais des IBAN en clair subsistent sur le disque : l'UPDATE a écrit de nouvelles versions des lignes, et les anciennes (tuples morts) restent dans le fichier même après l'autovacuum, qui libère la place sans l'effacer. Cliquez « VACUUM FULL » pour réécrire le fichier (bonus de la correction TP1)." :
          "✓ Plus aucun IBAN en clair sur disque. Mais les NIR, noms et salaires restent lisibles : il faudrait chiffrer le disque/les sauvegardes, ou ces colonnes aussi."}</p>`;
    } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  $("#pgGo").onclick = () => pg("GET"); $("#pgVac").onclick = () => pg("POST");
  $("#mnGo").onclick = async () => {
    const out = $("#mnOut"); out.innerHTML = `<p class="muted">Écriture et lecture…</p>`;
    try {
      const r = await api("/api/rest/minio", { method: "POST" });
      const col = (k, title) => { const x = r[k]; if (x.error) return `<div class="box flat err">${esc(x.error)}</div>`;
        return `<div class="box flat"><h3>${title}</h3><div class="small muted mono">${esc(x.file)} · ${x.size} octets</div>
        <div class="verdict ${x.finding.count ? "bad" : "good"}">${x.finding.count ? "⚠ IBAN lisible sur le disque" : "✓ IBAN introuvable sur le disque"}</div>
        ${entropyBar(x.entropy)}
        <div class="small muted" style="margin-top:6px">Octets bruts du fichier sur le disque :</div><pre class="hex">${esc(x.dump)}</pre></div>`; };
      out.innerHTML = `<div class="lgrid g2" style="margin-top:8px">${col("demo-clair", "demo-clair (aucun chiffrement)")}${col("demo-chiffre", "demo-chiffre (SSE-S3)")}</div>
        <details class="runcode"><summary>Sortie mc (stat, encrypt info, relecture HTTPS)</summary><pre class="hex">${esc(r.mc)}</pre></details>`;
    } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  $("#vtGo").onclick = async () => {
    const out = $("#vtOut"); out.innerHTML = `<p class="muted">Lecture…</p>`;
    try {
      const r = await api("/api/rest/vault");
      if (!r.count) { out.innerHTML = `<p class="muted">Stockage vide : Vault n'est pas encore initialisé (<a href="#/tp/tp1">TP1 · étape 2</a>).</p>`; return; }
      out.innerHTML = `<div class="verdict ${r.secretFound ? "bad" : "good"}">${r.secretFound ? "⚠" : "✓"} ${r.count} fichiers lus — ${esc(r.secretLabel)} : ${r.secretFound ? "TROUVÉ en clair" : "introuvable"}</div>
        <details class="runcode"><summary>Arborescence (${r.count} fichiers)</summary><pre class="hex">${esc(r.names.sort().join("\n"))}</pre></details>
        ${r.samples.map((s) => `<div class="box flat" style="margin-top:8px"><b class="mono small">${esc(s.path)}</b><pre class="hex">${esc(s.raw)}</pre>
          <div class="small muted" style="margin-top:6px">Champ Value décodé (base64) :</div><pre class="hex">${esc(s.hexdump)}</pre>${entropyBar(s.entropy)}</div>`).join("")}`;
    } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
}

// ---------------------------------------------------------------- accès aux services
let ACCESS = [];
function accessView(view) {
  view.innerHTML = `
    <h1>Comptes et accès</h1>
    <p class="sub">Identifiants lus à la demande dans le <code>.env</code> (comptes d'amorçage) et dans Vault (comptes nominatifs créés aux TP1-TP2). Masqués par défaut.</p>
    <div class="row" style="margin-bottom:12px"><button class="button" id="accReload">↻ Relire</button><button class="button" id="accShowAll">Tout afficher</button>
      <span class="muted small">Certificats signés par la CA du lab : acceptez l'avertissement du navigateur ou importez <code>ca.crt</code> (volume certs).</span></div>
    <div id="accOut"><p class="muted">Lecture de Vault…</p></div>
    <h2>Comptes éphémères délivrés par Vault</h2>
    <div class="box">
      <p class="muted small" style="margin-top:0">Le bon usage : pas de mot de passe permanent, Vault crée un compte à la demande qui expire seul (TP1 · étapes 4 et 6).</p>
      <div class="row"><button class="button is-primary" data-dyn="rabbitmq">Compte RabbitMQ du pipeline (1 h)</button>
        <button class="button is-primary" data-dyn="postgres">Compte PostgreSQL lecture seule (1 h)</button></div>
      <div id="dynOut" class="lgrid" style="margin-top:12px"></div>
    </div>`;
  const load = async () => {
    try { ACCESS = await api("/api/access"); renderAccess(false); }
    catch (e) { $("#accOut").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  $("#accReload").onclick = load;
  $("#accShowAll").onclick = () => renderAccess(true);
  view.querySelectorAll("[data-dyn]").forEach((b) => (b.onclick = async () => {
    try {
      const r = await post(`/api/access/dynamic/${b.dataset.dyn}`);
      $("#dynOut").insertAdjacentHTML("afterbegin", `<div class="box flat"><dl class="kv">
        <dt>Chemin Vault</dt><dd>${esc(r.path)}</dd><dt>Utilisateur</dt><dd>${esc(r.username)}</dd>
        <dt>Mot de passe</dt><dd><span class="secret">${esc(r.password)}</span></dd>
        <dt>Expire dans</dt><dd>${Math.round(r.ttl / 60)} min</dd><dt>Bail</dt><dd class="small">${esc(r.lease)}</dd></dl>
        <div class="small muted" style="margin-top:6px">Révocation immédiate : <code>vault lease revoke ${esc(r.lease)}</code></div>
        ${b.dataset.dyn === "rabbitmq" ? `<div class="small" style="color:var(--c-warn);margin-top:4px">Ce compte sert au pipeline (connexion AMQPS) : il ne peut pas ouvrir l'interface web RabbitMQ. C'est voulu (moindre privilège).</div>` : ""}</div>`);
    } catch (e) { toast(e.message); }
  }));
  load();
}

function renderAccess(showAll) {
  $("#accOut").innerHTML = ACCESS.map((s, si) => `<div class="box" style="margin-bottom:14px">
    <div class="row"><h3 style="margin:0">${esc(s.name)}</h3><span class="spacer"></span>
      ${s.url ? `<a class="button is-small is-primary" href="${esc(s.url)}" target="_blank" rel="noopener">Ouvrir ${esc(s.url)}</a>` : `<span class="tag">interne au lab</span>`}</div>
    <div class="small muted mono" style="margin-top:4px">${esc(s.internal)}</div>
    <p class="small" style="margin:6px 0 0">${esc(s.note)}</p>
    ${s.accounts.length ? `<div class="tablewrap"><table class="table is-fullwidth acc"><thead><tr><th>Identifiant</th><th>Rôle</th><th>Secret</th><th></th><th>Source</th></tr></thead><tbody>
      ${s.accounts.map((a, ai) => `<tr><td class="mono">${esc(a.login)}</td><td>${esc(a.role || "")}</td>
        <td><span class="secret ${showAll ? "" : "masked"}" data-sec="${si}:${ai}">${showAll ? esc(a.secret) : "••••••••••"}</span>
          ${a.warning ? `<div class="small" style="color:var(--c-warn)">⚠ ${esc(a.warning)}</div>` : ""}</td>
        <td style="white-space:nowrap"><button class="button is-small" data-eye="${si}:${ai}">Voir</button> <button class="button is-small" data-cp="${si}:${ai}">Copier</button></td>
        <td class="small muted">${esc(a.source)}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="muted small">Aucun compte : exécutez d'abord le TP correspondant.</p>`}</div>`).join("");
  const acc = (k) => { const [si, ai] = k.split(":"); return ACCESS[si].accounts[ai]; };
  document.querySelectorAll("[data-eye]").forEach((b) => (b.onclick = () => {
    const el = document.querySelector(`[data-sec="${b.dataset.eye}"]`), hidden = el.classList.toggle("masked");
    el.textContent = hidden ? "••••••••••" : acc(b.dataset.eye).secret;
  }));
  document.querySelectorAll("[data-cp]").forEach((b) => (b.onclick = () =>
    navigator.clipboard?.writeText(acc(b.dataset.cp).secret).then(() => toast("Copié"), () => toast("Copie impossible (contexte non sécurisé)"))));
}

// ---------------------------------------------------------------- aide-mémoire
const CHEAT = `<dl class="cheat">
  <dt>sql "SELECT …"</dt><dd>requête SQL en administrateur (mot de passe lu dans Vault)</dd>
  <dt>sql -f fichier.sql</dt><dd>exécute un fichier SQL</dd>
  <dt>sql-as bruno "SELECT …"</dt><dd>requête en tant qu'alice, bruno, claire, david, samira ou nadia (TP2+)</dd>
  <dt>vault status</dt><dd>état du coffre (Sealed true = fermé)</dd>
  <dt>vault-cles</dt><dd>les 5 clés d'ouverture et le jeton root</dd>
  <dt>cat fichier</dt><dd>lire un script ou un fichier SQL avant de le lancer</dd>
  <dt>logs tout</dt><dd>journaux d'audit lisibles : <code>logs audit</code>, <code>logs echecs</code>, <code>logs minio</code>, <code>logs vault</code> (TP3)</dd>
  <dt>$POSTGRES_PASSWORD …</dt><dd>les mots de passe du fichier .env sont déjà dans des variables</dd>
</dl>`;

// ---------------------------------------------------------------- identifiants (fenêtre)
async function showCreds() {
  const dlg = $("#creds"), out = $("#credsOut");
  out.innerHTML = `<p class="muted">Lecture…</p>`;
  if (!dlg.open) dlg.showModal();
  let c;
  try { c = await api("/api/credentials"); } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const CREDS = [...c.vault, ...c.env];
  const row = (x, i) => `<tr><td>${esc(x.label)}</td>
    <td><span class="secret ${x.secret ? "masked" : ""}" data-cv="${i}">${x.secret ? "••••••••••" : esc(x.value)}</span>${x.hint ? `<div class="hint">${esc(x.hint)}</div>` : ""}</td>
    <td>${x.secret ? `<button class="button is-small" data-ce="${i}">Voir</button> ` : ""}<button class="button is-small" data-cc="${i}">Copier</button></td></tr>`;
  out.innerHTML = `
    <h3>Vault</h3>
    <div class="row" style="margin-bottom:8px"><a class="button is-primary is-small" href="${esc(c.vault_url)}" target="_blank" rel="noopener">Ouvrir Vault UI ↗</a>
      <span class="muted small">${esc(c.vault_url)}</span></div>
    ${c.initialized ? `<table class="table is-fullwidth creds"><tbody>${c.vault.map((x, i) => row(x, i)).join("")}</tbody></table>
      <p class="muted small">Il faut ${c.threshold} clés sur ${c.vault.length - 1} pour ouvrir le coffre. En entreprise, chaque clé est confiée à une personne différente.</p>`
      : `<p class="muted small">Vault n'est pas encore initialisé : faites le <a href="#/tp/tp1">TP1 · étape 2</a>. Le jeton root et les 5 clés apparaîtront ici.</p>`}
    <h3>Comptes administrateur (fichier .env)</h3>
    <div class="row" style="margin-bottom:8px"><a class="button is-small" href="${esc(c.minio_url)}" target="_blank" rel="noopener">Ouvrir MinIO ↗</a>
      <a class="button is-small" href="${esc(c.rabbitmq_url)}" target="_blank" rel="noopener">Ouvrir RabbitMQ ↗</a></div>
    <table class="table is-fullwidth creds"><tbody>${c.env.map((x, i) => row(x, i + c.vault.length)).join("")}</tbody></table>
    <p class="muted small">Personnes du TP2 (alice, bruno…) : page <a href="#/access">Accès aux services</a>.</p>`;
  out.querySelectorAll("[data-ce]").forEach((b) => (b.onclick = () => {
    const el = out.querySelector(`[data-cv="${b.dataset.ce}"]`), hidden = el.classList.toggle("masked");
    el.textContent = hidden ? "••••••••••" : CREDS[b.dataset.ce].value;
  }));
  out.querySelectorAll("[data-cc]").forEach((b) => (b.onclick = () =>
    navigator.clipboard?.writeText(CREDS[b.dataset.cc].value).then(() => toast("Copié"), () => toast("Copie impossible"))));
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-creds]")) { e.preventDefault(); showCreds(); }
});

// ---------------------------------------------------------------- identification (nom / prénom)
function loadMe() { try { ME = JSON.parse(localStorage.getItem("etudiant") || "null"); } catch { ME = null; } }
function askName() {
  return new Promise((resolve) => {
    const dlg = $("#ident");
    $("#idPrenom").value = ME?.prenom || ""; $("#idNom").value = ME?.nom || ""; $("#idEcole").value = ME?.ecole || "";
    $("#identForm").onsubmit = async (e) => {
      e.preventDefault();
      const prenom = $("#idPrenom").value.trim(), nom = $("#idNom").value.trim(), ecole = $("#idEcole").value.trim();
      if (!prenom || !nom || !ecole) return;
      try {
        const r = await post("/api/register", { prenom, nom, ecole, token: ME?.token || "" });
        ME = { prenom: r.prenom, nom: r.nom, ecole: r.ecole, token: r.token, id: r.id };
      } catch (err) { $("#identErr").textContent = err.message; return; }
      try { localStorage.setItem("etudiant", JSON.stringify(ME)); } catch {}
      dlg.close(); showMe(); resolve();
    };
    dlg.addEventListener("cancel", (e) => { if (!ME?.token) e.preventDefault(); });
    dlg.showModal(); $("#idPrenom").focus();
  });
}
// Session serveur : reprise de la progression enregistrée (autre poste, navigateur vidé…)
async function checkSession() {
  if (!ME?.token || !ME?.ecole) { await askName(); }
  let r;
  try { r = await api("/api/me"); }
  catch { // session inconnue du serveur (console réinstallée) : on se réinscrit avec les mêmes infos
    try { const x = await post("/api/register", { prenom: ME.prenom, nom: ME.nom, ecole: ME.ecole }); ME = { ...ME, token: x.token, id: x.id }; localStorage.setItem("etudiant", JSON.stringify(ME)); r = await api("/api/me"); } catch { return; }
  }
  for (const [id, sc] of Object.entries(r.score || {})) if (sc.points > (SCORE[id]?.points ?? -1)) SCORE[id] = sc;
  for (const [id, sc] of Object.entries(SCORE)) if (!r.score?.[id] || r.score[id].points < sc.points) pushScore("step", id, sc.points, sc.max || STEP_MAX, sc.method);
  saveScore();
}
function showMe() {
  const m = MODE === "expert" ? "mode expert" : "mode facile";
  $("#whoami").innerHTML = `<b>${esc(fullName())}</b>${ME?.ecole ? ` <span class="muted">· ${esc(ME.ecole)}</span>` : ""} · <a href="#" id="changeMode">${m}</a> · <a href="#" id="changeMe">changer de nom</a>`;
  $("#changeMode").onclick = (e) => { e.preventDefault(); askMode(); };
  $("#changeMe").onclick = (e) => { e.preventDefault(); askName(); };
}

// ---------------------------------------------------------------- mode facile / expert
function loadMode() { try { MODE = localStorage.getItem("mode") === "expert" ? "expert" : (localStorage.getItem("mode") === "facile" ? "facile" : ""); } catch { MODE = ""; } }
function applyMode(m) {
  MODE = m; try { localStorage.setItem("mode", m); } catch {}
  document.body.dataset.mode = m;
  showMe(); updateScoreBadge();
}
function askMode() {
  return new Promise((resolve) => {
    const dlg = $("#mode");
    $$("[data-mode-set]", dlg).forEach((b) => (b.onclick = () => { applyMode(b.dataset.modeSet); dlg.close(); route(); resolve(); }));
    dlg.addEventListener("cancel", (e) => { if (!MODE) e.preventDefault(); });
    dlg.showModal();
  });
}

// ---------------------------------------------------------------- terminal
const QUICK = [
  ["check-stack", "/lab/scripts/check-stack.sh"],
  ["vault status", "vault status"],
  ["desceller Vault", "/lab/scripts/vault-unseal.sh"],
  ["moteurs Vault", "vault secrets list"],
  ["baux actifs", "vault list sys/leases/lookup/database/creds/app-ingest 2>&1"],
  ["pipeline (50 tx)", "/lab/scripts/with-vault-creds.sh python3 /lab/pipeline/producer.py 50 && /lab/scripts/with-vault-creds.sh python3 /lab/pipeline/consumer.py"],
  ["publier seulement (200 tx)", "/lab/scripts/with-vault-creds.sh python3 /lab/pipeline/producer.py 200 && echo '→ RabbitMQ Management, onglet Queues : ingest.transactions a 200 messages Ready. Videz-la avec « consommer la file ».'"],
  ["consommer la file", "/lab/scripts/with-vault-creds.sh python3 /lab/pipeline/consumer.py"],
  ["pipeline lent (80 tx, ~45 s)", "W=/lab/scripts/with-vault-creds.sh; echo '→ Ouvrez RabbitMQ Management (Overview / Queues) pendant ~45 s.'; $W python3 /lab/pipeline/producer.py 80 0.25 & sleep 2; $W python3 /lab/pipeline/consumer.py 500 0.5 10; wait"],
  ["dernières transactions", `sql "SELECT reference, left(iban_contrepartie,32) AS iban, ingere_par FROM finance.transactions ORDER BY id DESC LIMIT 5"`],
  ["clés Vault", "vault-cles"],
  ["buckets MinIO", "mc ls dc; for b in raw-data curated audit-logs; do mc encrypt info dc/$b 2>&1 | tail -1; done"],
  ["TLS PostgreSQL", `sql "SELECT ssl, version, cipher, bits FROM pg_stat_ssl WHERE pid = pg_backend_pid()"`],
  ["certificat Vault", "openssl s_client -connect vault:8200 -CAfile /certs/ca.crt </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates -ext subjectAltName"],
];
// ---------------------------------------------------------------- thème clair / sombre
function setTheme(t) {
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else { delete document.documentElement.dataset.theme; t = "auto"; }
  try { localStorage.setItem("theme", t); } catch {}
  document.querySelectorAll("[data-theme-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === t)));
}
document.querySelectorAll("[data-theme-set]").forEach((b) => (b.onclick = () => setTheme(b.dataset.themeSet)));
setTheme(document.documentElement.dataset.theme || "auto");
$("#navToggle").onclick = () => { const o = document.body.classList.toggle("navopen"); $("#navToggle").setAttribute("aria-expanded", String(o)); };

// ---------------------------------------------------------------- démarrage
(async function init() {
  loadMe(); loadMode(); loadScore(); loadTprog();
  await checkSession(); showMe();
  INFO = await api("/api/info").catch(() => ({}));
  $("#credsBtn").onclick = showCreds;
  $("#credsClose").onclick = () => $("#creds").close();
  CATALOG = await api("/api/catalog");
  if (!MODE) await askMode(); else applyMode(MODE);
  updateScoreBadge();
  await refreshStatus();
  window.addEventListener("hashchange", route);
  route();
  setInterval(() => { if (!document.hidden) refreshStatus(); }, 5000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshStatus(); });
})();

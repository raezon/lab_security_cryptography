"use strict";
// Console DataCorp Secure — client (sans dépendance)

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let CATALOG = [], STATUS = { steps: {} }, BUSY = false, INFO = {}, ME = null;
let MODE = "facile";           // "facile" (boutons) ou "expert" (on tape les commandes, noté)
let SCORE = {};                // { stepId: { points, max, method } } — personnel, en localStorage
const STEP_MAX = 10, PTS = { typed: 10, prefill: 4, solution: 2 };
const HINT = {};               // { stepId: niveau d'aide déjà utilisé } (mémoire de session)
function loadScore() { try { SCORE = JSON.parse(localStorage.getItem("score") || "{}"); } catch { SCORE = {}; } }
function saveScore() { try { localStorage.setItem("score", JSON.stringify(SCORE)); } catch {} }
function award(id, method) {
  const pts = PTS[method] ?? 0, cur = SCORE[id]?.points ?? -1;
  if (pts > cur) { SCORE[id] = { points: pts, max: STEP_MAX, method }; saveScore(); }
}
// Nom de l'étudiant, envoyé à chaque appel : la console note qui a lancé quoi (lab partagé).
const fullName = () => (ME ? `${ME.prenom} ${ME.nom}` : "");
const hdrs = () => ({ "Content-Type": "application/json", "X-Etudiant": encodeURIComponent(fullName()) });
const trainer = () => $("#trainer").checked;

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
  if (v.error) { b.className = "vbadge ko"; b.textContent = "Vault : injoignable"; }
  else if (!v.initialized) { b.className = "vbadge ko"; b.textContent = "Vault : non initialisé (TP1 · 2)"; }
  else if (v.sealed) { b.className = "vbadge ko"; b.textContent = `Vault : scellé (${v.progress}/${v.t})`; }
  else { b.className = "vbadge ok"; b.textContent = `Vault : ouvert · Shamir ${v.t}/${v.n}`; }
  for (const tp of CATALOG) {
    const done = tp.steps.filter((s) => STATUS.steps[s.id]?.status === "ok").length;
    $(`#prog-${tp.id}`).textContent = `${done}/${tp.steps.length}`;
  }
  if (location.hash === "" || location.hash === "#/") renderHomeLive();
}

// ---------------------------------------------------------------- routeur
const routes = {
  "": home, "#/": home,
  "#/crypto/transit": transitView, "#/crypto/app": appView, "#/crypto/rest": restView, "#/terminal": terminalView, "#/access": accessView, "#/score": scoreView,
};
function route() {
  const h = location.hash;
  const view = $("#view");
  let key = "home";
  if (h.startsWith("#/tp/")) { key = h.slice(5); tpView(view, key); }
  else if (h.startsWith("#/cours/")) { key = "cours-" + h.slice(8); coursView(view, h.slice(8)); }
  else { (routes[h] || home)(view); key = { "#/crypto/transit": "transit", "#/crypto/app": "app", "#/crypto/rest": "rest", "#/terminal": "terminal", "#/access": "access", "#/score": "score" }[h] || "home"; }
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === key));
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

function home(view) {
  view.innerHTML = `
    <h1>Lab « Sécurité de la chaîne de valeur Data »</h1>
    <p class="sub">Les 3 TP de l'énoncé, exécutables pas à pas dans la toolbox, et des démonstrations en direct du chiffrement <b style="color:var(--transit)">en transit</b>, <b style="color:var(--app)">applicatif</b> et <b style="color:var(--rest)">au repos</b>.</p>
    <div class="grid g3" id="tpcards"></div>
    <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn sm" id="resetProg">Remettre la progression à zéro</button>
      <a class="btn sm" href="#/access">🔑 Accès aux services</a></div>
    <h2>Architecture et protection de chaque flux</h2>
    <div class="card">${ARCHI}
      <div class="legend" style="margin-top:8px">
        <span style="--c:var(--transit)">chiffré en transit (TLS vérifié par la CA du lab)</span>
        <span style="--c:var(--ko)">en clair sur le réseau (net-data isolé, jeton partagé)</span>
        <span style="--c:var(--app)">journalisation</span>
        <span class="muted">Cliquez un composant pour ouvrir la démonstration correspondante.</span>
      </div>
    </div>
    <h2>Conteneurs</h2>
    <div class="grid g4" id="containers"></div>
    <h2>Interfaces web du lab</h2>
    <div class="grid g3">
      <div class="card"><h3>Vault UI</h3><p class="muted small" style="margin:0 0 10px">Connexion : méthode « Token », avec le jeton root (après TP1 · étape 2).</p>
        <div class="row"><a class="btn primary sm" href="${esc(INFO.vault_url)}" target="_blank" rel="noopener">Ouvrir Vault UI ↗</a><button class="btn sm" data-creds>🔑 Voir les identifiants</button></div></div>
      <div class="card"><h3>MinIO Console</h3><p class="muted small" style="margin:0 0 10px">Stockage des fichiers. Compte MinIO de la fenêtre « identifiants ».</p>
        <div class="row"><a class="btn primary sm" href="${esc(INFO.minio_url)}" target="_blank" rel="noopener">Ouvrir MinIO ↗</a><button class="btn sm" data-creds>🔑 Voir les identifiants</button></div></div>
      <div class="card"><h3>RabbitMQ Management</h3><p class="muted small" style="margin:0 0 10px">File de messages du pipeline. Compte RabbitMQ de la fenêtre « identifiants ».</p>
        <div class="row"><a class="btn primary sm" href="${esc(INFO.rabbitmq_url)}" target="_blank" rel="noopener">Ouvrir RabbitMQ ↗</a><button class="btn sm" data-creds>🔑 Voir les identifiants</button></div></div>
    </div>`;
  view.querySelectorAll(".node").forEach((n) => n.addEventListener("click", () => (location.hash = n.dataset.go)));
  $("#resetProg").onclick = async () => {
    if (!window.confirm("Effacer les coches ✅ de la console ? (l'état du lab lui-même n'est pas modifié)")) return;
    await post("/api/reset"); await refreshStatus(); toast("Progression remise à zéro");
  };
  renderHomeLive();
}

function renderHomeLive() {
  const cards = $("#tpcards"); if (!cards) return;
  cards.innerHTML = CATALOG.map((tp) => {
    const done = tp.steps.filter((s) => STATUS.steps[s.id]?.status === "ok").length;
    return `<a class="card" href="#/tp/${tp.id}" style="text-decoration:none;color:inherit">
      <div class="row"><span class="tpnum">${tp.id.slice(2)}</span><b>${esc(tp.title.split("—")[1] || tp.title)}</b></div>
      <p class="muted small" style="margin:8px 0">${esc(tp.tools)}</p>
      <div class="progress"><i style="width:${(100 * done) / tp.steps.length}%"></i></div>
      <div class="small muted" style="margin-top:6px">${done} / ${tp.steps.length} étapes validées</div></a>`;
  }).join("");
  const c = $("#containers");
  c.innerHTML = (STATUS.containers || []).sort((a, b) => a.name.localeCompare(b.name)).map((x) => `
    <div class="card flat svc"><span class="led ${x.state === "running" ? "on" : x.service === "certs-init" ? "" : "off"}"></span>
      <div style="min-width:0"><b>${esc(x.service)}</b><div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.status)}</div></div></div>`).join("");
}

// ---------------------------------------------------------------- TP
function codeBlock(src) {
  const html = esc(src).split("\n").map((l) => {
    const i = l.search(/\s#\s/);
    return i >= 0 ? l.slice(0, i) + `<span class="cm">${l.slice(i)}</span>` : l;
  }).join("\n");
  return `<pre class="code"><button class="btn sm copy" data-copy>Copier</button>${html}</pre>`;
}

function stepHead(s, st, cls, right) {
  return `<div class="stephead">
      <div class="stepnum">${s.num}</div>
      <div style="flex:1;min-width:0">
        <div class="row"><h3 style="margin:0">Étape ${s.num} — ${esc(s.title)}</h3><span class="spacer"></span>
          <span class="chip ${cls}" data-badge title="${st?.by ? "par " + esc(st.by) : ""}">${st ? (st.status === "ok" ? "✅ validée" : "✗ critère non atteint") + (st.by ? " · " + esc(st.by) : "") : "à faire"}</span>
          ${right}</div>
        <div class="row" style="margin-top:6px"><span class="chip role">${esc(s.role)}</span>${s.crypto ? `<span class="chip crypto">🔐 ${esc(s.crypto)}</span>` : ""}</div>
      </div>
    </div>`;
}

function stepCard(s) {
  const st = STATUS.steps[s.id];
  const cls = st ? st.status : "";
  if (MODE === "expert") return stepCardExpert(s, st, cls);
  return `<section class="step ${cls}" id="step-${s.id}">
    ${stepHead(s, st, cls, `<button class="btn primary" data-run="${s.id}">▶ Exécuter</button>`)}
    <div class="stepbody">
      <p class="why">🎯 ${esc(s.why)}</p>
      ${codeBlock(s.doc)}
      <details class="runcode"><summary>Voir la version non interactive exécutée par la console</summary>${codeBlock(s.run.join("\n"))}</details>
      ${s.figure ? `<div class="figure"><img src="/img/${s.figure}" alt="" loading="lazy"></div>` : ""}
      <div class="verify">✅ <b>Vérifier :</b> ${esc(s.verify)}</div>
      <div class="checks" data-checks>${st ? checksHTML(st.checks) : ""}</div>
      <div class="term" data-term></div>
    </div></section>`;
}

// Mode expert : l'étudiant tape la commande. Documentation + indices progressifs.
function stepCardExpert(s, st, cls) {
  const sc = SCORE[s.id];
  const badge = sc ? `<span class="chip ok" data-pts>🏆 ${sc.points}/${STEP_MAX} pts</span>` : `<span class="chip" data-pts>${STEP_MAX} pts à gagner</span>`;
  return `<section class="step ${cls}" id="step-${s.id}">
    ${stepHead(s, st, cls, badge)}
    <div class="stepbody">
      <p class="why">🎯 ${esc(s.why)}</p>
      <div class="verify">✅ <b>Objectif :</b> ${esc(s.verify)}</div>
      ${s.figure ? `<div class="figure"><img src="/img/${s.figure}" alt="" loading="lazy"></div>` : ""}
      <div class="hints">
        <button class="btn sm" data-hint="doc">📖 Documentation</button>
        <button class="btn sm" data-hint="fill">⬇️ Pré-remplir la commande <span class="muted">(−pts)</span></button>
        <button class="btn sm" data-hint="sol">🔓 Solution <span class="muted">(min. pts)</span></button>
      </div>
      <div class="hintbox" data-hintbox hidden></div>
      <textarea class="cmd" data-cmd rows="3" placeholder="Tapez ici votre (vos) commande(s), puis « Valider »…" spellcheck="false"></textarea>
      <div class="row"><button class="btn primary" data-check="${s.id}">▶ Valider ma commande</button>
        <span class="muted small">Tapé sans aide : ${PTS.typed} pts · pré-rempli : ${PTS.prefill} pts · solution : ${PTS.solution} pts</span></div>
      <div class="checks" data-checks>${st ? checksHTML(st.checks) : ""}</div>
      <div class="term" data-term></div>
    </div></section>`;
}
const checksHTML = (cs) => (cs || []).map((c) => `<span class="chip ${c.ok ? "ok" : "ko"}" title="expression attendue dans la sortie">${c.ok ? "✓" : "✗"} <code>${esc(c.pattern)}</code></span>`).join("");

async function runStep(id) {
  const card = $(`#step-${id}`); if (!card || BUSY) return;
  BUSY = true;
  document.querySelectorAll("[data-run],[data-runall]").forEach((b) => (b.disabled = true));
  const badge = $("[data-badge]", card), term = $("[data-term]", card);
  badge.className = "chip run"; badge.textContent = "⏳ en cours…";
  card.classList.remove("ok", "ko");
  const end = await streamTo(`/api/run/${id}`, {}, term).catch((e) => ({ status: "ko", code: -1, checks: [], err: e }));
  card.classList.add(end.status);
  badge.className = `chip ${end.status}`;
  badge.textContent = end.status === "ok" ? "✅ validée" : "✗ critère non atteint";
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
    if (b.dataset.hint === "doc") return show(`<div class="small muted" style="margin-bottom:6px">📖 Commandes de référence de l'énoncé — à vous de les taper et d'adapter les <code>&lt;valeurs&gt;</code> :</div>${codeBlock(s.doc)}`);
    if (b.dataset.hint === "fill") {
      HINT[s.id] = HINT[s.id] === "solution" ? "solution" : "prefill";
      ta.value = s.doc; ta.focus();
      show(`<div class="small">⬇️ Énoncé recopié. Adaptez les <code>&lt;valeurs&gt;</code> puis validez — validation ainsi : <b>${PTS.prefill} pts</b>.</div>`);
    }
    if (b.dataset.hint === "sol") {
      HINT[s.id] = "solution";
      ta.value = s.run.join("\n"); ta.focus();
      show(`<div class="small">🔓 Commande exacte insérée. Validation ainsi : <b>${PTS.solution} pts</b> (l'important reste de comprendre pourquoi).</div>`);
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
  badge.className = "chip run"; badge.textContent = "⏳ en cours…";
  card.classList.remove("ok", "ko");
  const end = await streamTo(`/api/check/${id}`, { cmd }, term).catch((e) => ({ status: "ko", code: -1, checks: [], err: e }));
  card.classList.add(end.status);
  badge.className = `chip ${end.status}`;
  badge.textContent = end.status === "ok" ? "✅ validée" : "✗ critère non atteint";
  $("[data-checks]", card).innerHTML = checksHTML(end.checks);
  if (end.status === "ok") {
    const method = HINT[id] || "typed";
    award(id, method);
    const sc = SCORE[id];
    $("[data-pts]", card).className = "chip ok"; $("[data-pts]", card).textContent = `🏆 ${sc.points}/${STEP_MAX} pts`;
    toast(`Étape validée · +${sc.points} pts (${{ typed: "tapé sans aide", prefill: "pré-rempli", solution: "solution" }[method]})`);
    updateScoreBadge();
  }
  BUSY = false;
  $$("[data-check]").forEach((b) => (b.disabled = false));
  refreshStatus();
  return end.status;
}

function tpView(view, id) {
  const tp = CATALOG.find((t) => t.id === id);
  if (!tp) { view.innerHTML = "<p>TP introuvable.</p>"; return; }
  if (MODE === "expert") return tpViewExpert(view, tp);
  view.innerHTML = `
    <div class="row"><h1>${esc(tp.title)}</h1></div>
    <p class="sub">${esc(tp.subtitle)} · Outils : ${esc(tp.tools)}</p>
    <div class="grid g2">
      <div class="card"><h3>Contexte</h3><p style="margin:0">${esc(tp.context)}</p></div>
      <div class="card"><h3>Le cours en bref</h3><ul class="course" style="margin:0;padding-left:18px">${tp.course.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>
    </div>
    <div class="figs" style="margin-top:14px">${tp.figures.map((f) => `<div class="figure"><img src="/img/${f}" alt="" loading="lazy"></div>`).join("")}</div>
    <h2 class="row">Manipulations guidées <span class="spacer"></span>
      <button class="btn" data-runall>▶▶ Exécuter tout le TP</button></h2>
    <div class="card" style="margin-bottom:14px"><h3>Comment travailler</h3>
      <p class="small" style="margin:0 0 10px">Pour chaque étape : lisez le 🎯 <b>pourquoi</b>, tapez les commandes <b>une par une</b> dans l'onglet <a href="#/terminal">Terminal</a> (bouton « Copier »), puis contrôlez le ✅. Remplacez les <code>&lt;valeurs&gt;</code> par ce que la commande précédente a affiché. Bloqué ? « ▶ Exécuter » lance l'étape pour vous. Les mots de passe sont derrière le bouton <a href="#" data-creds>🔑 Voir les identifiants</a>.</p>
      ${CHEAT}</div>
    ${tp.steps.map(stepCard).join("")}
    <h2>Questions de compréhension</h2>
    <div class="card"><ol class="qs" style="margin:0">${tp.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol></div>
    <h2>Volet GRC — ${esc(tp.grcTitle)}</h2>
    <div class="card"><img src="/img/fig_grc_methode.png" alt="" style="max-width:520px;width:100%;background:#fff;border-radius:8px;padding:6px"><ol class="qs">${tp.grc.map((q) => `<li>${esc(q)}</li>`).join("")}</ol></div>
    ${tp.answers?.length ? `<div id="answers" ${trainer() ? "" : "hidden"}>
      <h2>Pistes de correction (formateur)</h2>
      <div class="card answers"><ul style="padding-left:18px">${tp.answers.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>
    </div>` : ""}`;
  view.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => runStep(b.dataset.run)));
  $("[data-runall]", view).addEventListener("click", async () => {
    for (const s of tp.steps) {
      $(`#step-${s.id}`).scrollIntoView({ behavior: "smooth", block: "start" });
      const st = await runStep(s.id);
      if (st !== "ok") { toast(`Arrêt à l'étape ${s.num} : critère non atteint`); break; }
    }
  });
}

// ---- reconnaissance (mode expert) : ce qu'un attaquant peut constater AVANT de sécuriser
const RECON = {
  tp1: {
    intro: "Avant de tout mettre sous clé, mettez-vous à la place d'un attaquant : où traînent les secrets et les données en clair ? Chaque constat justifie une mesure de la phase 2.",
    items: [
      { t: "Mots de passe en clair dans le vieux script (état : au repos, dans le code)", c: `grep -nE "PASS|SECRET|KEY|URL" /lab/scripts/legacy/ingest_legacy.sh` },
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
  view.innerHTML = `
    <div class="row"><h1>${esc(tp.title)}</h1><span class="spacer"></span><span class="chip crypto">🕵️ Mode Expert · noté</span></div>
    <p class="sub">${esc(tp.subtitle)} · Outils : ${esc(tp.tools)}</p>
    <div class="grid g2">
      <div class="card"><h3>Contexte</h3><p style="margin:0">${esc(tp.context)}</p></div>
      <div class="card"><h3>Le cours en bref</h3><ul class="course" style="margin:0;padding-left:18px">${tp.course.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        <div class="row" style="margin-top:10px"><a class="btn sm" href="#/terminal">Terminal libre</a><button class="btn sm" data-creds>🔑 Identifiants</button><a class="btn sm" href="#/score">🏆 Mon score</a></div></div>
    </div>

    <h2 class="row">🕵️ Phase 1 — Reconnaissance <span class="spacer"></span><span class="chip">non noté</span></h2>
    <div class="card">
      <p class="small" style="margin:0 0 10px">${esc(rec.intro)}</p>
      ${rec.items.map((it, i) => `<div class="recon">
        <div class="row"><span class="chip">${i + 1}</span><b>${esc(it.t)}</b><span class="spacer"></span>
          ${it.link ? `<a class="btn sm primary" href="${it.link}">Ouvrir la démo ↗</a>` : `<button class="btn sm primary" data-recon="${i}">▶ Constater</button>`}</div>
        ${it.link ? "" : `<div class="term" data-recterm="${i}" hidden></div>`}</div>`).join("")}
    </div>

    <h2 class="row">🛡️ Phase 2 — Sécuriser (à vous de taper les commandes) <span class="spacer"></span>
      <span class="chip">${done}/${tp.steps.length} · ${got}/${max} pts</span></h2>
    <div class="card" style="margin-bottom:14px"><h3>Comment ça marche</h3>
      <p class="small" style="margin:0 0 10px">Pour chaque étape : lisez l'objectif ✅, <b>tapez votre commande</b> dans le cadre puis « Valider ». Besoin d'aide ? <b>📖 Documentation</b> (gratuit), <b>⬇️ Pré-remplir</b> (${PTS.prefill} pts) ou <b>🔓 Solution</b> (${PTS.solution} pts). Tapé sans aide = <b>${PTS.typed} pts</b>. Les <code>&lt;valeurs&gt;</code> se remplacent par ce que la commande précédente affiche.</p>
      ${CHEAT}</div>
    ${tp.steps.map(stepCard).join("")}

    <h2>Questions de compréhension</h2>
    <div class="card"><ol class="qs" style="margin:0">${tp.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol></div>
    <h2>Volet GRC — ${esc(tp.grcTitle)}</h2>
    <div class="card"><img src="/img/fig_grc_methode.png" alt="" style="max-width:520px;width:100%;background:#fff;border-radius:8px;padding:6px"><ol class="qs">${tp.grc.map((q) => `<li>${esc(q)}</li>`).join("")}</ol></div>`;
  rec.items.forEach((it, i) => { if (it.link) return;
    const b = view.querySelector(`[data-recon="${i}"]`);
    b.onclick = async () => { const t = view.querySelector(`[data-recterm="${i}"]`); t.hidden = false; b.disabled = true;
      await streamTo("/api/exec", { cmd: it.c }, t); b.disabled = false; };
  });
  tp.steps.forEach((s) => wireExpertStep(s, $(`#step-${s.id}`, view)));
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
  const label = { typed: "tapé sans aide", prefill: "pré-rempli", solution: "solution" };
  const medal = pct >= 90 ? "🥇 Expert confirmé" : pct >= 70 ? "🥈 Bon niveau" : pct >= 40 ? "🥉 En progrès" : "🔰 Débutant";
  view.innerHTML = `
    <h1>🏆 Mon score</h1>
    <p class="sub">Barème personnel du mode Expert (${esc(fullName())}). Enregistré dans ce navigateur.</p>
    <div class="card scoretop">
      <div><div class="bignum">${got} <span class="muted" style="font-size:18px">/ ${max} pts</span></div>
        <div class="progress" style="margin:8px 0"><i style="width:${pct}%"></i></div>
        <div class="small muted">${pct}% · ${medal}</div></div>
    </div>
    <div class="tablewrap"><table class="acc"><thead><tr><th>TP</th><th>Étape</th><th>Méthode</th><th style="text-align:right">Points</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${r.tp}</td><td>${r.num}. ${esc(r.title)}</td>
        <td>${r.sc ? label[r.sc.method] : "<span class='muted'>—</span>"}</td>
        <td style="text-align:right"><b class="${r.sc ? (r.sc.points >= PTS.typed ? "n good" : "") : "muted"}">${r.sc ? r.sc.points : 0}</b> / ${STEP_MAX}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="row" style="margin-top:14px"><span class="muted small">Barème : tapé sans aide ${PTS.typed} · pré-rempli ${PTS.prefill} · solution ${PTS.solution} pts par étape.</span>
      <span class="spacer"></span><button class="btn sm" id="scoreReset">Réinitialiser mon score</button></div>`;
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
$("#trainer").addEventListener("change", () => { const a = $("#answers"); if (a) a.hidden = !trainer(); });

// ---------------------------------------------------------------- EN TRANSIT
function transitView(view) {
  view.innerHTML = `
    <h1><span class="dot t" style="display:inline-block"></span> Chiffrement en transit</h1>
    <p class="sub">La console se connecte elle-même à chaque service (depuis les réseaux net-data et net-broker) et montre ce que TLS protège — et ce qui se passe quand on tente de s'en passer.</p>
    <div class="card">
      <div class="row"><h3 style="margin:0">1 · Poignée de main TLS avec chaque service</h3><span class="spacer"></span>
        <select id="tlsTest">
          <option value="normal">Connexion normale (CA du lab, bon nom)</option>
          <option value="wrongname">Attaque : mauvais nom de serveur (homme du milieu)</option>
          <option value="noca">Client sans la CA du lab</option>
          <option value="tls11">Client limité à TLS 1.1</option>
        </select>
        <button class="btn primary" id="tlsGo">Inspecter</button></div>
      <p class="muted small" id="tlsExplain">Même vérification que <code>sslmode=verify-full</code> : chaîne de confiance jusqu'à la CA du lab + nom du serveur dans le certificat (SAN).</p>
      <div class="grid g2" id="tlsOut"></div>
    </div>
    <h2>2 · Les connexions en clair sont refusées</h2>
    <div class="card"><div class="row"><span class="muted">pg_hba.conf, listeners TLS-only, port AMQP désactivé : on essaie quand même.</span><span class="spacer"></span><button class="btn primary" id="plainGo">Tenter en clair</button></div><div id="plainOut" class="grid" style="margin-top:12px"></div></div>
    <h2>3 · Ce que voit un espion sur le réseau</h2>
    <div class="card">
      <div class="row"><label class="muted small">Donnée sensible envoyée :</label><input type="text" id="wireSecret" value="FR7630001007941234567890185" size="34">
        <button class="btn primary" id="wireGo">Envoyer en HTTPS et en HTTP clair</button></div>
      <p class="muted small">La même requête <code>POST {"iban": …}</code> part vers Vault en HTTPS (TLS 1.3) et vers audit-sink en HTTP. La console enregistre chaque octet écrit sur la socket TCP, comme le ferait <code>tcpdump</code>.</p>
      <div class="grid g2" id="wireOut"></div>
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
    $("#plainOut").innerHTML = res.map((r) => `<div class="card flat">
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
  return `<div class="card flat tls">
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
  return `<div class="card flat">
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
    <div id="keyCard" class="card"><p class="muted">Lecture de la clé…</p></div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card">
        <h3>Chiffrer / déchiffrer</h3>
        <div class="row"><input type="text" id="pt" value="FR7630001007941234567890185" style="flex:1">
          <select id="ver"><option value="0">dernière version</option></select>
          <button class="btn primary" id="encGo">Chiffrer</button></div>
        <p class="muted small">Chiffrez deux fois la même valeur (question 3 du TP1) : le nonce aléatoire de GCM rend chaque chiffré unique. Après une rotation, <b>rewrap</b> ré-emballe un ancien chiffré avec la nouvelle version sans jamais exposer le clair.</p>
        <div class="ctlist" id="cts"></div>
      </div>
      <div class="grid">
        <div class="card">
          <h3>Pseudonymiser : HMAC-SHA256</h3>
          <div class="row"><input type="text" id="hin" value="282053487661364" style="flex:1"><button class="btn" id="hmacGo">HMAC</button></div>
          <p class="muted small">Contrairement au chiffrement, le HMAC est <b>déterministe</b> (même entrée → même sortie) et <b>irréversible</b> : parfait pour joindre des tables sans révéler le NIR (même principe que les vues masquées du TP2).</p>
          <div id="hmacOut"></div>
        </div>
        <div class="card">
          <h3>Chiffrement d'enveloppe (clé de données)</h3>
          <div class="row"><input type="text" id="envIn" value="Bulletin de paie 09/2026 — J. Martin — 4 250,00 €" style="flex:1"><button class="btn" id="envGo">Chiffrer localement</button></div>
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
      <button class="btn danger" id="rotGo">↻ Rotation (nouvelle version)</button></div>
      <div class="row" style="margin-top:8px"><span class="chip a">type ${esc(k.type)}</span><span class="chip">version courante <b>&nbsp;v${k.latest_version}</b></span>
      <span class="chip">déchiffrement minimal v${k.min_decryption_version}</span><span class="chip">${k.exportable ? "exportable !" : "non exportable"}</span>
      <span class="chip">${k.deletion_allowed ? "suppression autorisée" : "suppression interdite"}</span></div>
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
      <button class="btn sm" data-dec="${i}">Déchiffrer</button><button class="btn sm" data-rew="${i}">Rewrap</button></div>
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
    <div class="card">
      <div class="row"><h3 style="margin:0">PostgreSQL — fichier de la table <code>rh.employes</code></h3><span class="spacer"></span>
        <button class="btn primary" id="pgGo">Lire le fichier sur disque</button><button class="btn" id="pgVac">VACUUM FULL puis relire</button></div>
      <p class="muted small">PostgreSQL ne chiffre pas ses fichiers (pas de TDE) : seules les colonnes chiffrées par l'application (IBAN via Vault transit, TP1 · 5) sont protégées. C'est exactement la fiche GRC 6.3 du TP1 « une sauvegarde est volée ».</p>
      <div id="pgOut"></div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="row"><h3 style="margin:0">MinIO — SSE-S3 : même objet, bucket clair vs bucket chiffré</h3><span class="spacer"></span>
        <button class="btn primary" id="mnGo">Écrire puis lire les disques</button></div>
      <p class="muted small">Un virement fictif est déposé dans <code>demo-clair</code> (sans chiffrement) et <code>demo-chiffre</code> (<code>mc encrypt set sse-s3</code>, comme raw-data et curated). Puis on lit le fichier de données <code>/data/&lt;bucket&gt;/virement.json/&lt;uuid&gt;/part.1</code> directement sur le disque du conteneur MinIO.</p>
      <div id="mnOut"></div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="row"><h3 style="margin:0">Vault — stockage <code>/vault/file</code> derrière la barrière</h3><span class="spacer"></span>
        <button class="btn primary" id="vtGo">Lire le stockage</button></div>
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
      const col = (k, title) => { const x = r[k]; if (x.error) return `<div class="card flat err">${esc(x.error)}</div>`;
        return `<div class="card flat"><h3>${title}</h3><div class="small muted mono">${esc(x.file)} · ${x.size} octets</div>
        <div class="verdict ${x.finding.count ? "bad" : "good"}">${x.finding.count ? "⚠ IBAN lisible sur le disque" : "✓ IBAN introuvable sur le disque"}</div>
        ${entropyBar(x.entropy)}
        <div class="small muted" style="margin-top:6px">Octets bruts du fichier sur le disque :</div><pre class="hex">${esc(x.dump)}</pre></div>`; };
      out.innerHTML = `<div class="grid g2" style="margin-top:8px">${col("demo-clair", "demo-clair (aucun chiffrement)")}${col("demo-chiffre", "demo-chiffre (SSE-S3)")}</div>
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
        ${r.samples.map((s) => `<div class="card flat" style="margin-top:8px"><b class="mono small">${esc(s.path)}</b><pre class="hex">${esc(s.raw)}</pre>
          <div class="small muted" style="margin-top:6px">Champ Value décodé (base64) :</div><pre class="hex">${esc(s.hexdump)}</pre>${entropyBar(s.entropy)}</div>`).join("")}`;
    } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
}

// ---------------------------------------------------------------- accès aux services
let ACCESS = [];
function accessView(view) {
  view.innerHTML = `
    <h1>🔑 Accès aux services</h1>
    <p class="sub">Identifiants lus à la demande dans le <code>.env</code> (comptes d'amorçage) et dans Vault (comptes nominatifs créés aux TP1-TP2). Masqués par défaut.</p>
    <div class="row" style="margin-bottom:12px"><button class="btn" id="accReload">↻ Relire</button><button class="btn" id="accShowAll">Tout afficher</button>
      <span class="muted small">Certificats signés par la CA du lab : acceptez l'avertissement du navigateur ou importez <code>ca.crt</code> (volume certs).</span></div>
    <div id="accOut"><p class="muted">Lecture de Vault…</p></div>
    <h2>Comptes éphémères délivrés par Vault</h2>
    <div class="card">
      <p class="muted small" style="margin-top:0">Le bon usage : pas de mot de passe permanent, Vault crée un compte à la demande qui expire seul (TP1 · étapes 4 et 6).</p>
      <div class="row"><button class="btn primary" data-dyn="rabbitmq">Compte RabbitMQ du pipeline (1 h)</button>
        <button class="btn primary" data-dyn="postgres">Compte PostgreSQL lecture seule (1 h)</button></div>
      <div id="dynOut" class="grid" style="margin-top:12px"></div>
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
      $("#dynOut").insertAdjacentHTML("afterbegin", `<div class="card flat"><dl class="kv">
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
  $("#accOut").innerHTML = ACCESS.map((s, si) => `<div class="card" style="margin-bottom:14px">
    <div class="row"><h3 style="margin:0">${esc(s.name)}</h3><span class="spacer"></span>
      ${s.url ? `<a class="btn sm primary" href="${esc(s.url)}" target="_blank" rel="noopener">Ouvrir ${esc(s.url)}</a>` : `<span class="chip">interne au lab</span>`}</div>
    <div class="small muted mono" style="margin-top:4px">${esc(s.internal)}</div>
    <p class="small" style="margin:6px 0 0">${esc(s.note)}</p>
    ${s.accounts.length ? `<div class="tablewrap"><table class="acc"><thead><tr><th>Identifiant</th><th>Rôle</th><th>Secret</th><th></th><th>Source</th></tr></thead><tbody>
      ${s.accounts.map((a, ai) => `<tr><td class="mono">${esc(a.login)}</td><td>${esc(a.role || "")}</td>
        <td><span class="secret ${showAll ? "" : "masked"}" data-sec="${si}:${ai}">${showAll ? esc(a.secret) : "••••••••••"}</span>
          ${a.warning ? `<div class="small" style="color:var(--c-warn)">⚠ ${esc(a.warning)}</div>` : ""}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-eye="${si}:${ai}">👁</button> <button class="btn sm" data-cp="${si}:${ai}">Copier</button></td>
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
    <td>${x.secret ? `<button class="btn sm" data-ce="${i}">👁</button> ` : ""}<button class="btn sm" data-cc="${i}">Copier</button></td></tr>`;
  out.innerHTML = `
    <h3>Vault</h3>
    <div class="row" style="margin-bottom:8px"><a class="btn primary sm" href="${esc(c.vault_url)}" target="_blank" rel="noopener">Ouvrir Vault UI ↗</a>
      <span class="muted small">${esc(c.vault_url)}</span></div>
    ${c.initialized ? `<table class="creds"><tbody>${c.vault.map((x, i) => row(x, i)).join("")}</tbody></table>
      <p class="muted small">Il faut ${c.threshold} clés sur ${c.vault.length - 1} pour ouvrir le coffre. En entreprise, chaque clé est confiée à une personne différente.</p>`
      : `<p class="muted small">Vault n'est pas encore initialisé : faites le <a href="#/tp/tp1">TP1 · étape 2</a>. Le jeton root et les 5 clés apparaîtront ici.</p>`}
    <h3>Comptes administrateur (fichier .env)</h3>
    <div class="row" style="margin-bottom:8px"><a class="btn sm" href="${esc(c.minio_url)}" target="_blank" rel="noopener">Ouvrir MinIO ↗</a>
      <a class="btn sm" href="${esc(c.rabbitmq_url)}" target="_blank" rel="noopener">Ouvrir RabbitMQ ↗</a></div>
    <table class="creds"><tbody>${c.env.map((x, i) => row(x, i + c.vault.length)).join("")}</tbody></table>
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
    $("#idPrenom").value = ME?.prenom || ""; $("#idNom").value = ME?.nom || "";
    $("#identForm").onsubmit = (e) => {
      e.preventDefault();
      const prenom = $("#idPrenom").value.trim(), nom = $("#idNom").value.trim();
      if (!prenom || !nom) return;
      ME = { prenom, nom };
      try { localStorage.setItem("etudiant", JSON.stringify(ME)); } catch {}
      dlg.close(); showMe(); resolve();
    };
    dlg.addEventListener("cancel", (e) => { if (!ME) e.preventDefault(); });
    dlg.showModal(); $("#idPrenom").focus();
  });
}
function showMe() {
  const m = MODE === "expert" ? "🕵️ Expert" : "🎓 Facile";
  $("#whoami").innerHTML = `${esc(fullName())} · <a href="#" id="changeMode">${m}</a> · <a href="#" id="changeMe">nom</a>`;
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
  ["dernières transactions", `sql "SELECT reference, left(iban_contrepartie,32) AS iban, ingere_par FROM finance.transactions ORDER BY id DESC LIMIT 5"`],
  ["clés Vault", "vault-cles"],
  ["buckets MinIO", "mc ls dc; for b in raw-data curated audit-logs; do mc encrypt info dc/$b 2>&1 | tail -1; done"],
  ["TLS PostgreSQL", `sql "SELECT ssl, version, cipher, bits FROM pg_stat_ssl WHERE pid = pg_backend_pid()"`],
  ["certificat Vault", "openssl s_client -connect vault:8200 -CAfile /certs/ca.crt </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates -ext subjectAltName"],
];
function terminalView(view) {
  view.innerHTML = `
    <h1>Terminal toolbox</h1>
    <p class="sub">Votre poste de travail : chaque commande s'exécute dans la toolbox du lab. Une commande par ligne ; Ctrl+Entrée pour lancer.</p>
    <details class="card" style="margin-bottom:12px"><summary><b>Aide-mémoire des commandes</b></summary><div style="margin-top:10px">${CHEAT}</div></details>
    <div class="row" style="margin-bottom:10px">${QUICK.map(([l], i) => `<button class="btn sm" data-q="${i}">${esc(l)}</button>`).join("")}</div>
    <div class="row"><textarea id="cmd" rows="3" style="flex:1" placeholder="vault status">vault status</textarea>
      <button class="btn primary" id="cmdGo" style="align-self:stretch">▶ Exécuter<br><span class="small muted">Ctrl+Entrée</span></button></div>
    <div class="term" id="cmdOut" style="max-height:620px"></div>`;
  const run = async () => {
    const b = $("#cmdGo"); b.disabled = true;
    const end = await streamTo("/api/exec", { cmd: $("#cmd").value }, $("#cmdOut"));
    $("#cmdOut").insertAdjacentHTML("beforeend", `\n<span class="${end.code === 0 ? "a-green" : "a-red"}">[code de sortie ${end.code}]</span>`);
    b.disabled = false;
  };
  $("#cmdGo").onclick = run;
  $("#cmd").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(); });
  view.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { $("#cmd").value = QUICK[b.dataset.q][1]; run(); }));
}

// ---------------------------------------------------------------- thème clair / sombre
function setTheme(t) {
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else { delete document.documentElement.dataset.theme; t = "auto"; }
  try { localStorage.setItem("theme", t); } catch {}
  document.querySelectorAll("[data-theme-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === t)));
}
document.querySelectorAll("[data-theme-set]").forEach((b) => (b.onclick = () => setTheme(b.dataset.themeSet)));
setTheme(document.documentElement.dataset.theme || "auto");

// ---------------------------------------------------------------- démarrage
(async function init() {
  try { $("#trainer").checked = localStorage.getItem("trainer") === "1"; } catch {}
  $("#trainer").addEventListener("change", () => { try { localStorage.setItem("trainer", trainer() ? "1" : "0"); } catch {} });
  loadMe(); loadMode(); loadScore();
  if (!ME) await askName(); else showMe();
  INFO = await api("/api/info").catch(() => ({}));
  if (INFO.student_mode) { $("#trainerToggle").hidden = true; $("#trainer").checked = false; }
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

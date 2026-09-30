"use strict";
// Console DataCorp Secure — cours (projet, Vault, MinIO, RabbitMQ), défis ludiques,
// visionneuse de buckets MinIO, animations et zoom plein écran. Chargé après app.js.

// ================================================================ zoom plein écran
// Ouvre une image ou un schéma SVG dans une fenêtre plein écran : molette = zoom
// (vers le curseur), glisser = déplacer, double-clic = recentrer, Échap = fermer.
function openZoom(node, title) {
  let dlg = $("#zoomdlg");
  if (!dlg) {
    dlg = document.createElement("div");
    dlg.id = "zoomdlg"; dlg.className = "zoomdlg";
    dlg.innerHTML = `<div class="zoombar"><b data-ztitle></b><span class="muted small">molette = zoom · glisser = déplacer · double-clic = recentrer · Échap = fermer</span>
      <span class="spacer"></span><button class="button is-small" data-z="-">−</button><span class="small mono" data-zpct>100 %</span>
      <button class="button is-small" data-z="+">+</button><button class="button is-small" data-z="0">⟲ Ajuster</button><button class="button is-small" data-z="x">Fermer ✕</button></div>
      <div class="zoomstage"><div class="zoomcontent"></div></div>`;
    document.body.append(dlg);
    const stage = $(".zoomstage", dlg), box = $(".zoomcontent", dlg);
    const S = (dlg._s = { z: 1, x: 0, y: 0 });
    const apply = () => { box.style.transform = `translate(${S.x}px,${S.y}px) scale(${S.z})`; $("[data-zpct]", dlg).textContent = Math.round(S.z * 100) + " %"; };
    const zoomAt = (f, cx, cy) => {
      const nz = Math.min(8, Math.max(0.5, S.z * f)); const r = stage.getBoundingClientRect();
      cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
      S.x = cx - (cx - S.x) * (nz / S.z); S.y = cy - (cy - S.y) * (nz / S.z); S.z = nz; apply();
    };
    dlg._fit = () => {
      const r = stage.getBoundingClientRect(), c = box.firstElementChild; if (!c) return;
      const w = c.naturalWidth || c.getBoundingClientRect().width / S.z || 1000, h = c.naturalHeight || c.getBoundingClientRect().height / S.z || 600;
      S.z = Math.min(r.width / w, r.height / h) * 0.96; S.x = (r.width - w * S.z) / 2; S.y = (r.height - h * S.z) / 2; apply();
    };
    dlg._close = () => { dlg.classList.remove("open"); document.body.style.overflow = ""; box.innerHTML = ""; };
    stage.addEventListener("wheel", (e) => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    let drag = null;
    stage.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, sx: S.x, sy: S.y }; stage.setPointerCapture(e.pointerId); stage.classList.add("drag"); });
    stage.addEventListener("pointermove", (e) => { if (!drag) return; S.x = drag.sx + e.clientX - drag.x; S.y = drag.sy + e.clientY - drag.y; apply(); });
    const end = () => { drag = null; stage.classList.remove("drag"); };
    stage.addEventListener("pointerup", end); stage.addEventListener("pointercancel", end);
    stage.addEventListener("dblclick", () => dlg._fit());
    $$("[data-z]", dlg).forEach((b) => (b.onclick = () => ({ "+": () => zoomAt(1.3), "-": () => zoomAt(1 / 1.3), "0": () => dlg._fit(), x: () => dlg._close() })[b.dataset.z]()));
    document.addEventListener("keydown", (e) => {
      if (!dlg.classList.contains("open")) return;
      if (e.key === "Escape") dlg._close(); else if (e.key === "+" || e.key === "=") zoomAt(1.3); else if (e.key === "-") zoomAt(1 / 1.3); else if (e.key === "0") dlg._fit();
    });
  }
  const box = $(".zoomcontent", dlg);
  box.innerHTML = "";
  const c = node.cloneNode(true);
  if (c.tagName.toLowerCase() === "svg") {
    const vb = (c.getAttribute("viewBox") || "0 0 1000 600").split(/\s+/).map(Number);
    c.setAttribute("width", vb[2]); c.setAttribute("height", vb[3]); c.style.width = vb[2] + "px"; c.style.height = vb[3] + "px";
    c.style.maxWidth = "none"; c.classList.add("zoomsvg");
  } else { c.removeAttribute("loading"); c.style.maxWidth = "none"; c.style.width = "auto"; }
  box.append(c);
  $("[data-ztitle]", dlg).textContent = title || "Vue agrandie";
  dlg.classList.add("open"); document.body.style.overflow = "hidden";
  const fit = () => dlg._fit();
  if (c.tagName.toLowerCase() === "img" && !c.complete) c.onload = fit; else requestAnimationFrame(fit);
}
// Toute image de cours, figure de TP ou capture est agrandissable d'un clic.
document.addEventListener("click", (e) => {
  const z = e.target.closest("[data-zoom]");
  if (z) { const t = z.dataset.zoom ? $(z.dataset.zoom) : z.querySelector("svg, img"); if (t) openZoom(t, z.dataset.ztitle || ""); return; }
  const img = e.target.closest(".figure img, .shot img");
  if (img && !img.closest(".shot.missing")) openZoom(img, img.closest(".shot")?.querySelector("figcaption b")?.textContent || "");
});

// ================================================================ défis (ludique)
const DEFIS = {
  transit: [
    ["t-mitm", "🕵️ Lancer l'attaque « homme du milieu » et constater qu'elle est refusée"],
    ["t-wire", "📡 Envoyer un secret en HTTP et en HTTPS et voir lequel l'espion lit"],
    ["t-plain", "🚪 Tenter une connexion en clair sur les 3 services"],
  ],
  app: [
    ["a-twice", "🎲 Chiffrer deux fois le même IBAN et obtenir deux résultats différents"],
    ["a-dec", "🔓 Déchiffrer un résultat (Vault vous rend le clair)"],
    ["a-rot", "🔁 Faire une rotation de clé puis un « rewrap »"],
    ["a-hmac", "🧬 Calculer deux fois le HMAC du même NIR (identiques !)"],
  ],
  rest: [
    ["r-pg", "💽 Voler le fichier PostgreSQL et y chercher les IBAN"],
    ["r-minio", "🪣 Comparer le bucket clair et le bucket chiffré sur le disque"],
    ["r-vault", "🏦 Essayer de lire le coffre Vault directement sur le disque"],
    ["r-obj", "🔍 Ouvrir un objet dans la visionneuse de buckets (S3 vs disque)"],
  ],
};
let DONE = {};
try { DONE = JSON.parse(localStorage.getItem("defis") || "{}"); } catch { DONE = {}; }
function defiDone(id) {
  if (DONE[id]) return;
  DONE[id] = Date.now(); try { localStorage.setItem("defis", JSON.stringify(DONE)); } catch {}
  if (typeof pushScore === "function") pushScore("defi", id, 1, 1);
  const label = Object.values(DEFIS).flat().find((d) => d[0] === id)?.[1] || "";
  toast(`🏅 Défi réussi : ${label.replace(/^\S+\s/, "")}`);
  $$("[data-defis]").forEach(renderDefis);
}
function renderDefis(el) {
  const list = DEFIS[el.dataset.defis] || [];
  const n = list.filter(([id]) => DONE[id]).length;
  el.innerHTML = `<div class="row"><b>🎮 Défis de la page</b><span class="tag ${n === list.length ? "ok" : ""}">${n} / ${list.length}${n === list.length ? " · 🏆 page terminée !" : ""}</span></div>
    <div class="defis">${list.map(([id, l]) => `<span class="defi ${DONE[id] ? "done" : ""}">${DONE[id] ? "✅" : "⬜"} ${esc(l)}</span>`).join("")}</div>`;
}
const defisBox = (page) => `<div class="box defibox" data-defis="${page}"></div>`;

// ================================================================ bandeau « histoire »
function storyBox(icon, title, html) {
  return `<div class="story"><div class="story-ic">${icon}</div><div><b class="story-t">${title}</b><div>${html}</div></div></div>`;
}

// ================================================================ capture d'écran
// cours/sources.json (facultatif) crédite les captures reprises de la documentation
// officielle ; scripts/captures-cours.sh le supprime quand il prend les vraies captures.
let SHOTSRC = {};
const shotSrcHTML = (file) => {
  const s = SHOTSRC[file];
  return s && s[0] ? `Capture illustrative : <a href="${esc(s[1])}" target="_blank" rel="noopener">${esc(s[0])} ↗</a> — ton écran peut différer un peu (version, noms).` : "";
};
fetch("/cours/sources.json").then((r) => (r.ok ? r.json() : {})).then((j) => {
  SHOTSRC = j || {};
  $$(".shot-src[data-file]").forEach((el) => (el.innerHTML = shotSrcHTML(el.dataset.file)));
}).catch(() => {});
function shot(file, title, steps = []) {
  return `<figure class="shot">
    <div class="shot-img"><img src="/cours/${file}" alt="${esc(title)}" loading="lazy" onerror="this.closest('.shot').classList.add('missing')">
      <div class="shot-missing">📸 <b>Capture à venir</b><br><span class="small">${esc(title)}</span></div>
      <span class="shot-zoom">🔍 cliquer pour agrandir</span></div>
    <figcaption><b>${esc(title)}</b>${steps.length ? `<ol>${steps.map((s) => `<li>${s}</li>`).join("")}</ol>` : ""}<small class="shot-src muted" data-file="${esc(file)}">${shotSrcHTML(file)}</small></figcaption>
  </figure>`;
}

// ================================================================ quiz
function quiz(id, qs) {
  return `<div class="box quiz" data-quiz="${id}">${qs.map((q, i) => `<div class="q" data-q="${i}">
    <p><b>${i + 1}. ${q.q}</b></p><div class="row">${q.c.map((c, j) => `<button class="button is-small" data-a="${j}">${c}</button>`).join("")}</div>
    <div class="qwhy small" hidden></div></div>`).join("")}<div class="qscore small muted"></div></div>`;
}
function wireQuiz(view, id, qs) {
  const box = $(`[data-quiz="${id}"]`, view); if (!box) return;
  const got = {};
  $$("[data-a]", box).forEach((b) => (b.onclick = () => {
    const qd = b.closest("[data-q]"), i = +qd.dataset.q, q = qs[i], ok = +b.dataset.a === q.ok;
    $$("[data-a]", qd).forEach((x) => { x.disabled = true; if (+x.dataset.a === q.ok) x.classList.add("good"); });
    if (!ok) b.classList.add("bad");
    const why = $(".qwhy", qd); why.hidden = false; why.innerHTML = (ok ? "✅ Bravo ! " : "❌ Pas tout à fait. ") + q.why;
    got[i] = ok;
    const n = Object.keys(got).length, s = Object.values(got).filter(Boolean).length;
    if (n === qs.length && typeof pushScore === "function") pushScore("quiz", id, s, qs.length);
    $(".qscore", box).innerHTML = n === qs.length ? `<b>Score : ${s} / ${qs.length}</b> ${s === qs.length ? "🏆 parfait !" : s >= qs.length / 2 ? "👍 bien joué" : "📖 relis le cours et retente (recharge la page)"}` : `${n} / ${qs.length} réponses`;
  }));
}

// ================================================================ petites animations
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
// Déplace un élément SVG (<g>) d'un point à un autre.
function moveTo(g, from, to, dur = 900) {
  return new Promise((res) => {
    const t0 = performance.now();
    (function f(now) {
      const t = Math.min(1, (now - t0) / dur), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      g.setAttribute("transform", `translate(${from[0] + (to[0] - from[0]) * e},${from[1] + (to[1] - from[1]) * e})`);
      if (t < 1) requestAnimationFrame(f); else res();
    })(t0);
  });
}

// ================================================================ COURS : données
const COURS = {
  projet: { title: "🏢 Le projet DataCorp", render: coursProjet },
  vault: { title: "🏦 Vault — le coffre-fort des secrets", render: coursVault },
  minio: { title: "🪣 MinIO — l'entrepôt de fichiers", render: coursMinio },
  rabbitmq: { title: "📮 RabbitMQ — la poste des messages", render: coursRabbit },
};

function coursView(view, id) {
  const c = COURS[id];
  if (!c) { view.innerHTML = "<p>Cours introuvable.</p>"; return; }
  c.render(view);
}

function coursNav(id) {
  const order = ["projet", "vault", "minio", "rabbitmq"], i = order.indexOf(id);
  const prev = order[i - 1], next = order[i + 1];
  return `<div class="row coursnav">${prev ? `<a class="button" href="#/cours/${prev}">← ${COURS[prev].title}</a>` : ""}<span class="spacer"></span>
    ${next ? `<a class="button is-primary" href="#/cours/${next}">${COURS[next].title} →</a>` : `<a class="button is-primary" href="#/tp/tp1">Passer au TP1 →</a>`}</div>`;
}

// ---------------------------------------------------------------- 1. le projet
function coursProjet(view) {
  view.innerHTML = `
  <h1>Le projet DataCorp : de quoi parle ce lab ?</h1>
  <p class="sub">Avant de toucher une commande : l'entreprise, ses données, ce qui la menace — et quel outil la protège.</p>
  ${storyBox("🏢", "L'entreprise", `<b>DataCorp</b> est une entreprise (fictive) qui gère la paie et les virements de ses clients. Dans sa base de données :
    <b>200 salariés</b> avec leur <b>NIR</b> (n° de sécurité sociale), leur <b>IBAN</b> et leur <b>salaire</b>, 60 clients et 2 000 transactions.
    Ce sont des données <b>très sensibles</b> (RGPD) : une fuite = amende, perte de confiance, fraude aux virements.`)}
  <h2>Le voyage d'une transaction (cliquez sur « Jouer »)</h2>
  <div class="box">
    <div class="row"><button class="button is-primary" id="pjPlay">▶ Jouer le voyage</button><span class="muted small" id="pjCap">Une transaction bancaire arrive chez DataCorp. Suivez-la jusqu'à son stockage.</span>
      <span class="spacer"></span><button class="button is-small" data-zoom="#pjSvg" data-ztitle="Voyage d'une transaction">⛶ Agrandir</button></div>
    <svg id="pjSvg" class="journey" viewBox="0 0 1000 300" role="img" aria-label="Voyage d'une transaction dans DataCorp">
      <g class="jn" data-n="prod"><rect x="20" y="115" width="140" height="70" rx="12"/><text x="90" y="145" class="ji">🏭</text><text x="90" y="172">Producteur</text></g>
      <g class="jn" data-n="rmq"><rect x="220" y="115" width="140" height="70" rx="12"/><text x="290" y="145" class="ji">📮</text><text x="290" y="172">RabbitMQ</text></g>
      <g class="jn" data-n="cons"><rect x="420" y="115" width="140" height="70" rx="12"/><text x="490" y="145" class="ji">⚙️</text><text x="490" y="172">Consommateur</text></g>
      <g class="jn" data-n="vault"><rect x="420" y="10" width="140" height="70" rx="12"/><text x="490" y="40" class="ji">🏦</text><text x="490" y="67">Vault</text></g>
      <g class="jn" data-n="pg"><rect x="640" y="60" width="150" height="70" rx="12"/><text x="715" y="90" class="ji">🐘</text><text x="715" y="117">PostgreSQL</text></g>
      <g class="jn" data-n="minio"><rect x="640" y="175" width="150" height="70" rx="12"/><text x="715" y="205" class="ji">🪣</text><text x="715" y="232">MinIO</text></g>
      <g class="jn" data-n="audit"><rect x="850" y="115" width="130" height="70" rx="12"/><text x="915" y="145" class="ji">📜</text><text x="915" y="172">Audit (SIEM)</text></g>
      <path class="jl" d="M160 150H220M360 150H420M490 115V80M560 140L640 100M560 160L640 205M790 210L850 165"/>
      <g id="pjTok" transform="translate(90,150)"><rect x="-58" y="-16" width="116" height="32" rx="16" class="tok"/><text id="pjTxt" y="5">FR76 3000…</text></g>
    </svg>
  </div>
  <h2>Les 4 menaces… et qui nous en protège</h2>
  <div class="lgrid g2">
    <div class="box threat"><h3>L'espion sur le réseau</h3><p class="small">Il écoute les câbles et lit tout ce qui passe en clair (mots de passe, IBAN).</p>
      <p class="small">🛡️ <b>Chiffrement en transit (TLS)</b> sur chaque flux : RabbitMQ en AMQPS, PostgreSQL en <code>verify-full</code>, Vault et MinIO en HTTPS.</p><a class="button is-small" href="#/crypto/transit">Voir la démo →</a></div>
    <div class="box threat"><h3>Le voleur de disque ou de sauvegarde</h3><p class="small">Il repart avec un disque dur ou une copie de sauvegarde et lit les fichiers directement.</p>
      <p class="small">🛡️ <b>Chiffrement au repos</b> : IBAN chiffrés par Vault avant d'entrer en base, buckets MinIO en SSE-S3, stockage Vault derrière sa « barrière ».</p><a class="button is-small" href="#/crypto/rest">Voir la démo →</a></div>
    <div class="box threat"><h3>Le curieux interne</h3><p class="small">Un analyste qui peut lire les salaires et les NIR alors que son travail ne l'exige pas.</p>
      <p class="small">🛡️ <b>Contrôle d'accès</b> (TP2) : rôles, sécurité ligne à ligne, vues masquées, politiques MinIO.</p><a class="button is-small" href="#/tp/tp2">TP2 →</a></div>
    <div class="box threat"><h3>L'attaquant qui efface ses traces</h3><p class="small">Il agit, puis supprime les journaux pour qu'on ne sache jamais ce qui s'est passé.</p>
      <p class="small">🛡️ <b>Audit + coffre WORM</b> (TP3) : pgAudit, journaux chaînés par SHA-256, bucket <code>audit-logs</code> ineffaçable 30 jours.</p><a class="button is-small" href="#/tp/tp3">TP3 →</a></div>
  </div>
  <h2>Les outils, expliqués comme à un ami</h2>
  <div class="tablewrap"><table class="table is-fullwidth acc"><thead><tr><th>Outil</th><th>C'est comme…</th><th>Son rôle dans DataCorp</th><th>Cours</th></tr></thead><tbody>
    <tr><td><b>RabbitMQ</b></td><td>📮 un bureau de poste</td><td>reçoit les transactions et les garde en file jusqu'à ce qu'on les traite</td><td><a href="#/cours/rabbitmq">📮 cours</a></td></tr>
    <tr><td><b>Vault</b></td><td>🏦 le coffre-fort d'une banque + un notaire</td><td>range les mots de passe, chiffre les IBAN, fabrique des comptes temporaires</td><td><a href="#/cours/vault">🏦 cours</a></td></tr>
    <tr><td><b>PostgreSQL</b></td><td>🗃️ une armoire à fiches</td><td>la base de données (salariés, clients, transactions)</td><td><a href="#/tp/tp2">TP2</a></td></tr>
    <tr><td><b>MinIO</b></td><td>🪣 un entrepôt avec des étagères</td><td>stocke les fichiers (lots de transactions, exports, journaux)</td><td><a href="#/cours/minio">🪣 cours</a></td></tr>
    <tr><td><b>audit-sink</b></td><td>📹 une caméra de surveillance</td><td>reçoit les événements d'audit (SIEM simulé)</td><td><a href="#/tp/tp3">TP3</a></td></tr>
    <tr><td><b>toolbox</b></td><td>🧑‍💻 ton poste de travail</td><td>c'est là que s'exécutent tes commandes (<code>vault</code>, <code>mc</code>, <code>sql</code>…)</td><td><a href="#/terminal">Terminal</a></td></tr>
  </tbody></table></div>
  <h2>L'architecture complète</h2>
  <div class="box"><div class="row"><span class="muted small">Cliquez un composant pour ouvrir sa démonstration.</span><span class="spacer"></span><button class="button is-small" data-zoom="#pjArchi svg" data-ztitle="Architecture DataCorp">⛶ Agrandir</button></div>
    <div id="pjArchi">${ARCHI}</div></div>
  <h2>Les personnages du lab</h2>
  <div class="lgrid g3">${[["👩‍💻", "Alice Martin", "Data Engineer", "construit le pipeline"], ["📊", "Bruno Leroy", "Data Analyst", "fait des statistiques… sans voir les NIR"],
    ["⚖️", "Claire Dubois", "DPO", "veille au respect du RGPD"], ["🛠️", "David Nguyen", "SysAdmin", "fait tourner les serveurs"],
    ["🛡️", "Samira Haddad", "Data Security Engineer", "pose les protections, surveille"], ["👔", "Nadia Benali", "Manager RH", "voit les salariés de SON département"]]
    .map(([i, n, r, d]) => `<div class="box persona"><div class="pic">${i}</div><div><b>${n}</b><div class="small muted">${r}</div><div class="small">${d}</div></div></div>`).join("")}</div>
  <h2>Et toi, tu fais quoi ?</h2>
  <div class="box"><ol style="margin:0;padding-left:20px">
    <li><b>TP1</b> — tu ranges les secrets dans Vault et tu chiffres les IBAN (Samira).</li>
    <li><b>TP2</b> — tu donnes à chacun <i>juste</i> les droits dont il a besoin (Alice, Bruno, Nadia, Claire).</li>
    <li><b>TP3</b> — tu installes l'audit et un coffre à preuves que personne ne peut effacer.</li></ol>
    <p class="small muted" style="margin-bottom:0">Conseil : lis d'abord les cours <a href="#/cours/vault">Vault</a>, <a href="#/cours/minio">MinIO</a> et <a href="#/cours/rabbitmq">RabbitMQ</a> (10 min chacun).</p></div>
  ${coursNav("projet")}`;
  view.querySelectorAll("#pjArchi .node").forEach((n) => n.addEventListener("click", () => (location.hash = n.dataset.go)));
  const tok = $("#pjTok"), txt = $("#pjTxt"), cap = $("#pjCap"), lit = (n) => { $$(".jn", view).forEach((g) => g.classList.toggle("on", g.dataset.n === n)); };
  const STEPS = [
    ["prod", [90, 150], [290, 150], "🏭 Le producteur envoie la transaction à RabbitMQ… par un tunnel <b>chiffré (AMQPS/TLS)</b> : l'espion ne lit rien.", "FR76 3000…"],
    ["rmq", [290, 150], [490, 150], "📮 RabbitMQ garde le message dans la file <code>ingest.transactions</code>, puis le remet au consommateur.", "FR76 3000…"],
    ["cons", [490, 150], [490, 45], "⚙️ Le consommateur demande à Vault de <b>chiffrer l'IBAN</b>. Vault garde la clé : elle ne sort jamais du coffre.", "FR76 3000…"],
    ["vault", [490, 45], [490, 150], "🏦 Vault renvoie <code>vault:v1:…</code> : un charabia illisible sans la clé.", "vault:v1:8fQ…"],
    ["cons", [490, 150], [715, 95], "🐘 L'IBAN chiffré est rangé dans PostgreSQL (connexion TLS <code>verify-full</code>).", "vault:v1:8fQ…"],
    ["pg", [715, 95], [715, 210], "🪣 Le lot de transactions est archivé dans MinIO, dans un bucket chiffré au repos (SSE-S3).", "🔒 lot.json"],
    ["minio", [715, 210], [915, 150], "📜 Chaque accès est journalisé et envoyé à l'audit. Si quelqu'un triche, on le saura.", "📜 journal"],
    ["audit", [915, 150], [915, 150], "✅ Voyage terminé : l'IBAN n'a <b>jamais</b> circulé ni été stocké en clair.", "✅"],
  ];
  let playing = false;
  $("#pjPlay").onclick = async () => {
    if (playing) return; playing = true; $("#pjPlay").disabled = true;
    for (const [n, a, b, c, t] of STEPS) { if (!tok.isConnected) return; lit(n); cap.innerHTML = c; txt.textContent = t; tok.classList.toggle("enc", !t.startsWith("FR")); await moveTo(tok, a, b, 1100); await sleepMs(1300); }
    playing = false; $("#pjPlay").disabled = false; $("#pjPlay").textContent = "↺ Rejouer";
  };
}

// ---------------------------------------------------------------- 2. Vault
function coursVault(view) {
  const qs = [
    { q: "Vault vient de redémarrer. Il est « scellé ». Que faut-il pour l'ouvrir ?", c: ["Le jeton root", "3 des 5 fragments de clé (Shamir)", "Le mot de passe PostgreSQL"], ok: 1, why: "Au démarrage, Vault ne sait même pas lire son propre disque : il faut reconstituer la clé maître avec 3 fragments sur 5, détenus par des personnes différentes." },
    { q: "Avec le moteur <b>transit</b>, où se trouve la clé qui chiffre les IBAN ?", c: ["Dans l'application", "Dans la base PostgreSQL", "Uniquement dans Vault"], ok: 2, why: "C'est tout l'intérêt : l'application envoie la donnée, Vault renvoie le chiffré. La clé ne quitte jamais le coffre." },
    { q: "Pourquoi le moteur <b>database</b> est-il plus sûr qu'un mot de passe dans un fichier ?", c: ["Il crée des comptes temporaires qui expirent seuls", "Il chiffre la base", "Il est plus rapide"], ok: 0, why: "Chaque demande donne un compte neuf valable 1 h. Un mot de passe volé devient vite inutile, et on peut le révoquer." },
  ];
  view.innerHTML = `
  <h1>Vault — le coffre-fort des secrets</h1>
  <p class="sub">Outil HashiCorp · version 1.17 · interface : <a href="${esc(INFO.vault_url || "#")}" target="_blank" rel="noopener">${esc(INFO.vault_url || "Vault UI")} ↗</a> · identifiants : <a href="#" data-creds>🔑</a></p>
  ${storyBox("🏦", "L'image à retenir", `Vault, c'est le <b>coffre-fort d'une banque</b> tenu par un <b>notaire</b> très pointilleux :
    on y range les mots de passe (au lieu de les laisser dans des fichiers), il <b>chiffre</b> les données pour les applications sans jamais leur donner la clé,
    et il distribue des <b>badges temporaires</b> qui expirent tout seuls. Il note tout dans un registre.`)}
  <h2>Jeu : ouvre le coffre (Shamir 3 sur 5)</h2>
  <div class="box">
    <p class="small" style="margin-top:0">Au démarrage, Vault est <b>scellé</b> : sa clé maître a été coupée en <b>5 morceaux</b> confiés à 5 personnes. Il en faut <b>3</b> pour ouvrir. Personne ne peut ouvrir seul.
      Clique sur 3 personnes pour qu'elles apportent leur fragment.</p>
    <div class="unseal">
      <div class="keys">${["🛡️ Samira", "🛠️ David", "⚖️ Claire", "👔 Nadia", "👩‍💻 Alice"].map((p, i) => `<button class="button keyholder" data-k="${i}">${p}<br><span class="small muted">fragment ${i + 1}</span></button>`).join("")}</div>
      <div class="safe" id="safe"><div class="door">🔒</div><div class="small" id="safeTxt">Scellé · 0 / 3</div><div class="bar"><i id="safeBar"></i></div></div>
    </div>
    <p class="small muted" style="margin-bottom:0">Dans le lab : <code>vault operator unseal</code> × 3 (TP1 · étape 2). La console le fait pour toi si Vault redémarre.</p>
  </div>
  <h2>Les 6 mots à connaître</h2>
  <div class="lgrid g3">
    <div class="box concept"><b>🔒 Scellé / descellé</b><p class="small">Scellé = le coffre ne peut rien lire, même pas son disque. On le descelle avec 3 fragments sur 5.</p></div>
    <div class="box concept"><b>🎫 Jeton (token)</b><p class="small">Le badge qu'on présente à chaque demande. Le jeton <i>root</i> ouvre tout : on ne l'utilise que pour l'installation.</p></div>
    <div class="box concept"><b>📜 Politique (policy)</b><p class="small">La liste de ce qu'un badge peut faire : « peut chiffrer avec datacorp-pii, ne peut pas lire kv/… ». C'est le moindre privilège.</p></div>
    <div class="box concept"><b>🗄️ KV</b><p class="small">Un tiroir à secrets (mots de passe, clés d'API). Chaque version est gardée.</p></div>
    <div class="box concept"><b>⚙️ Transit</b><p class="small">Une <b>machine à chiffrer</b> : on envoie « FR76… », on reçoit « vault:v1:… ». La clé ne sort jamais.</p></div>
    <div class="box concept"><b>⏳ Bail (lease) + TTL</b><p class="small">Les comptes créés par Vault (PostgreSQL, RabbitMQ) ont une durée de vie : 1 h, puis ils disparaissent.</p></div>
  </div>
  <h2>Vault dans DataCorp</h2>
  <div class="tablewrap"><table class="table is-fullwidth acc"><thead><tr><th>Moteur</th><th>À quoi il sert ici</th><th>Qui l'utilise</th><th>TP</th></tr></thead><tbody>
    <tr><td><code>kv/</code></td><td>range les mots de passe d'administration (« bris de glace » MinIO, PostgreSQL…)</td><td>Samira, David</td><td>TP1 · 3</td></tr>
    <tr><td><code>transit/</code> · clé <code>datacorp-pii</code></td><td>chiffre les IBAN avant qu'ils entrent en base (AES-256-GCM)</td><td>le consommateur du pipeline</td><td>TP1 · 5</td></tr>
    <tr><td><code>database/</code></td><td>crée un compte PostgreSQL temporaire (1 h) à chaque exécution du pipeline</td><td>consumer.py via <code>with-vault-creds.sh</code></td><td>TP1 · 4</td></tr>
    <tr><td><code>rabbitmq/</code></td><td>crée un compte RabbitMQ temporaire pour publier / consommer</td><td>producer.py, consumer.py</td><td>TP1 · 6</td></tr>
    <tr><td>auth <code>approle</code></td><td>l'application s'authentifie avec un rôle (pas un humain)</td><td>le pipeline</td><td>TP1</td></tr>
  </tbody></table></div>
  <h2>Faire la même chose avec l'interface graphique</h2>
  <p class="small muted">Ouvre <a href="${esc(INFO.vault_url || "#")}" target="_blank" rel="noopener">Vault UI ↗</a> dans un autre onglet et suis les captures. Clique sur une capture pour l'agrandir.</p>
  <div class="shots">
    ${shot("vault-1-connexion.png", "1 · Se connecter", ["Méthode : <b>Token</b>.", "Colle le jeton root (bouton <a href='#' data-creds>🔑 Voir les identifiants</a>).", "Clique sur <b>Sign in</b>."])}
    ${shot("vault-2-moteurs.png", "2 · Les moteurs de secrets", ["Menu <b>Secrets Engines</b>.", "Tu retrouves <code>kv/</code>, <code>transit/</code>, <code>database/</code>, <code>rabbitmq/</code> : ce sont les « tiroirs » du tableau ci-dessus."])}
    ${shot("vault-3-cle-transit.png", "3 · La clé de chiffrement des IBAN", ["Ouvre <code>transit/</code> puis la clé <b>datacorp-pii</b>.", "Onglet <b>Details</b> : type <code>aes256-gcm96</code>, non exportable (personne ne peut la récupérer)."])}
    ${shot("vault-4-versions.png", "4 · Les versions et la rotation", ["Onglet <b>Versions</b> : chaque rotation crée v2, v3…", "Bouton <b>Rotate encryption key</b> = même chose que le bouton ↻ de la page <a href='#/crypto/app'>Applicatif</a>."])}
    ${shot("vault-5-chiffrer.png", "5 · Chiffrer à la main", ["Sur la clé, <b>Key actions → Encrypt</b>.", "Tape un IBAN, coche <b>Encode to base64</b>, clique <b>Encrypt</b>.", "Tu obtiens <code>vault:vN:…</code>. Essaie ensuite <b>Decrypt</b> avec ce résultat."])}
    ${shot("vault-6-kv.png", "6 · Le tiroir à mots de passe (KV)", ["Ouvre <code>kv/</code> puis <code>datacorp/</code>.", "Les valeurs sont masquées : l'œil 👁 les révèle, et <b>chaque lecture est journalisée</b>."])}
    ${shot("vault-7-politiques.png", "7 · Les politiques (qui a le droit de quoi)", ["Menu <b>Policies</b>.", "Ouvre <code>finance-app</code> : elle peut chiffrer/déchiffrer avec datacorp-pii, rien d'autre."])}
  </div>
  <h2>⌨️ Les mêmes gestes dans le terminal</h2>
  <div class="box">${codeBlock(`vault status                                  # scellé ? initialisé ?
vault secrets list                            # les moteurs (tiroirs)
vault read transit/keys/datacorp-pii          # la clé des IBAN (sans la clé elle-même !)
vault write transit/encrypt/datacorp-pii plaintext=$(echo -n FR7630001007941234567890185 | base64)
vault write -f transit/keys/datacorp-pii/rotate   # rotation
vault kv list kv/datacorp                     # le tiroir KV
vault policy read finance-app                 # une politique`)}
    <div class="row"><a class="button is-small" href="#/terminal">Ouvrir le terminal</a><a class="button is-small" href="#/crypto/app">Démo interactive transit →</a></div></div>
  <h2>Quiz</h2>
  ${quiz("vault", qs)}
  ${coursNav("vault")}`;
  wireQuiz(view, "vault", qs);
  const got = new Set();
  $$("[data-k]", view).forEach((b) => (b.onclick = () => {
    if (got.size >= 3 || got.has(b.dataset.k)) return;
    got.add(b.dataset.k); b.classList.add("used"); b.disabled = true;
    $("#safeBar").style.width = (got.size / 3) * 100 + "%";
    $("#safeTxt").textContent = got.size < 3 ? `Scellé · ${got.size} / 3` : "Descellé ✓ — le coffre est ouvert";
    if (got.size === 3) { $("#safe").classList.add("open"); $("#safe .door").textContent = "🔓"; toast("🎉 Coffre ouvert : 3 fragments réunis !");
      $$("[data-k]", view).forEach((x) => (x.disabled = true)); }
  }));
}

// ---------------------------------------------------------------- 3. MinIO
function coursMinio(view) {
  const qs = [
    { q: "Dans MinIO, qu'est-ce qu'un <b>bucket</b> ?", c: ["Un disque dur", "Une étagère (un conteneur) qui regroupe des objets", "Un utilisateur"], ok: 1, why: "Un bucket est un conteneur nommé (raw-data, curated, audit-logs…). Dedans, des objets identifiés par une clé qui ressemble à un chemin." },
    { q: "Le bucket est chiffré en SSE-S3. Un utilisateur autorisé lit un objet avec <code>mc cat</code>. Que voit-il ?", c: ["Le contenu en clair", "Du charabia chiffré", "Une erreur"], ok: 0, why: "Le chiffrement au repos protège le DISQUE. Pour un utilisateur autorisé, MinIO déchiffre de façon transparente. Contre lui, c'est le contrôle d'accès (TP2) qui protège." },
    { q: "Un bucket avec <b>Object Lock</b> en mode COMPLIANCE 30 jours : l'administrateur peut-il supprimer un journal avant 30 jours ?", c: ["Oui, il est root", "Non, personne ne peut", "Oui, s'il désactive le versioning"], ok: 1, why: "C'est le principe WORM (write once, read many) : même root ne peut ni modifier ni supprimer avant l'échéance. Idéal pour des preuves (TP3)." },
  ];
  view.innerHTML = `
  <h1>MinIO — l'entrepôt de fichiers</h1>
  <p class="sub">Stockage objet compatible <b>Amazon S3</b> · interface : <a href="${esc(INFO.minio_url || "#")}" target="_blank" rel="noopener">${esc(INFO.minio_url || "MinIO Console")} ↗</a> · identifiants : <a href="#" data-creds>🔑</a></p>
  ${storyBox("📦", "L'image à retenir", `MinIO, c'est un <b>entrepôt</b> : des <b>étagères</b> (les <i>buckets</i>) sur lesquelles on range des <b>cartons</b> (les <i>objets</i> : fichiers JSON, CSV, journaux…).
    Chaque carton a une étiquette (sa <i>clé</i>, par ex. <code>transactions/2026/09/28/lot.json</code>). On peut mettre les cartons dans des <b>coffres blindés</b> (chiffrement SSE-S3)
    et installer une <b>vitrine scellée</b> dont rien ne peut sortir avant 30 jours (Object Lock / WORM).`)}
  <h2>Les mots à connaître</h2>
  <div class="lgrid g3">
    <div class="box concept"><b>🪣 Bucket</b><p class="small">Une étagère nommée : <code>raw-data</code> (données brutes), <code>curated</code> (données nettoyées), <code>audit-logs</code> (preuves).</p></div>
    <div class="box concept"><b>📦 Objet + clé</b><p class="small">Un fichier et son « chemin » : <code>raw-data/transactions/2026/09/28/lot-145248.json</code>.</p></div>
    <div class="box concept"><b>🔐 SSE-S3</b><p class="small">Chiffrement côté serveur : chaque objet est chiffré sur le disque (AES-256) avec une clé elle-même protégée par la clé maître (KMS).</p></div>
    <div class="box concept"><b>🕰️ Versioning</b><p class="small">Chaque écriture garde l'ancienne version : on peut revenir en arrière après une erreur ou un rançongiciel.</p></div>
    <div class="box concept"><b>🧊 Object Lock (WORM)</b><p class="small">Écrire une fois, lire souvent : impossible d'effacer ou modifier avant la date de rétention. Même pour root.</p></div>
    <div class="box concept"><b>📜 Politique IAM</b><p class="small">Qui a le droit de lire/écrire quel bucket : <code>ingest-writer</code>, <code>data-analyst</code>, <code>dpo-auditor</code>… (TP2).</p></div>
  </div>
  <h2>Visionneuse : les VRAIS buckets du lab, en direct</h2>
  <div class="box"><p class="small" style="margin-top:0">Clique sur un bucket pour voir ses objets, puis sur un objet pour le comparer <b>vu par S3</b> (un utilisateur autorisé) et <b>lu sur le disque</b> (un voleur de disque).</p>
    <div data-buckets></div></div>
  <h2>Faire la même chose avec l'interface graphique</h2>
  <p class="small muted">Ouvre <a href="${esc(INFO.minio_url || "#")}" target="_blank" rel="noopener">MinIO Console ↗</a> et suis les captures (clic = agrandir).</p>
  <div class="shots">
    ${shot("minio-1-connexion.png", "1 · Se connecter", ["Utilisateur et mot de passe <b>MINIO_ROOT_USER / MINIO_ROOT_PASSWORD</b> (bouton <a href='#' data-creds>🔑</a>).", "Clique sur <b>Login</b>."])}
    ${shot("minio-2-buckets.png", "2 · La liste des buckets", ["Menu <b>Object Browser</b> : une ligne par bucket.", "Tu dois voir <code>raw-data</code> (et, plus tard, <code>curated</code>, <code>audit-logs</code>) ainsi que <code>demo-clair</code> / <code>demo-chiffre</code>."])}
    ${shot("minio-3-objets.png", "3 · Parcourir un bucket", ["Clique sur <code>raw-data</code>.", "Navigue dans les « dossiers » <code>transactions/2026/…</code> : ce sont juste des morceaux de clé."])}
    ${shot("minio-4-objet-detail.png", "4 · Le détail d'un objet", ["Clique sur un fichier : le panneau de droite affiche taille, date…", "Dans les métadonnées : <code>X-Amz-Server-Side-Encryption: AES256</code> = l'objet est chiffré sur le disque."])}
    ${shot("minio-5-bucket-reglages.png", "5 · Les réglages d'un bucket", ["Menu <b>Buckets</b> → <code>raw-data</code> → <b>Summary</b>.", "Tu vois <b>Encryption : SSE-S3</b>, le <b>Versioning</b> et l'<b>Object Locking</b> (activé sur <code>audit-logs</code> au TP3)."])}
    ${shot("minio-6-politiques.png", "6 · Les politiques d'accès", ["Menu <b>Policies</b>.", "Ouvre <code>data-analyst</code> : lecture de <code>curated</code> seulement — Bruno ne voit pas les données brutes."])}
  </div>
  <h2>⌨️ Les mêmes gestes dans le terminal</h2>
  <div class="box">${codeBlock(`mc ls dc                                   # les buckets
mc ls --recursive dc/raw-data              # les objets d'un bucket
mc encrypt info dc/raw-data                # chiffrement au repos du bucket
mc stat dc/demo-chiffre/virement.json      # métadonnées (X-Amz-Server-Side-Encryption)
mc cat dc/demo-chiffre/virement.json       # lecture (déchiffrée pour un utilisateur autorisé)
mc retention info --default dc/audit-logs  # Object Lock (après TP3)`)}
    <div class="row"><a class="button is-small" href="#/terminal">Ouvrir le terminal</a><a class="button is-small" href="#/crypto/rest">Démo « au repos » →</a></div></div>
  <h2>Quiz</h2>
  ${quiz("minio", qs)}
  ${coursNav("minio")}`;
  wireQuiz(view, "minio", qs);
  bucketBrowser($("[data-buckets]", view));
}

// ---------------------------------------------------------------- 4. RabbitMQ
function coursRabbit(view) {
  const qs = [
    { q: "Pourquoi DataCorp met-il RabbitMQ entre le producteur et le consommateur ?", c: ["Pour chiffrer les données", "Pour que les transactions attendent sagement si le consommateur est occupé ou en panne", "Pour remplacer la base"], ok: 1, why: "La file découple les deux : le producteur dépose, le consommateur traite à son rythme. Rien n'est perdu si le consommateur redémarre." },
    { q: "Les messages en attente dans la file sont-ils chiffrés sur le disque de RabbitMQ ?", c: ["Oui, toujours", "Non : c'est pour ça que l'IBAN est chiffré par l'application (Vault) avant de sortir du pipeline", "Seulement le week-end"], ok: 1, why: "RabbitMQ chiffre le transport (AMQPS/TLS), pas le stockage des messages. Les données sensibles doivent donc être protégées au niveau applicatif." },
    { q: "Le compte RabbitMQ du pipeline peut-il ouvrir l'interface web d'administration ?", c: ["Oui", "Non, et c'est voulu"], ok: 1, why: "Moindre privilège : le compte créé par Vault sert seulement à publier/consommer en AMQPS, pour 1 h. Pas d'accès d'administration." },
  ];
  view.innerHTML = `
  <h1>RabbitMQ — la poste des messages</h1>
  <p class="sub">Courtier de messages (protocole AMQP) · interface : <a href="${esc(INFO.rabbitmq_url || "#")}" target="_blank" rel="noopener">${esc(INFO.rabbitmq_url || "RabbitMQ Management")} ↗</a> · identifiants : <a href="#" data-creds>🔑</a></p>
  ${storyBox("📮", "L'image à retenir", `RabbitMQ, c'est un <b>bureau de poste</b>. Le <b>producteur</b> dépose des lettres (les transactions) au guichet (l'<i>exchange</i>),
    qui les trie et les met dans la bonne <b>boîte aux lettres</b> (la <i>file</i> <code>ingest.transactions</code>). Le <b>consommateur</b> (le facteur) vient les chercher
    et signe un <b>accusé de réception</b> (<i>ack</i>). Si le facteur tombe malade, les lettres attendent dans la boîte : rien n'est perdu.`)}
  <h2>Mini-simulation : remplis et vide la file</h2>
  <div class="box">
    <div class="row"><button class="button is-primary" id="rqPub">📨 Le producteur publie 5 transactions</button><button class="button" id="rqCons">📬 Le consommateur en traite 1</button>
      <button class="button" id="rqCrash">💥 Panne du consommateur</button><span class="spacer"></span><span class="small muted">simulation pédagogique (ne touche pas au lab)</span></div>
    <div class="postsim"><div class="ps-actor">🏭<div class="small">Producteur</div></div><div class="ps-arrow">🔒 AMQPS →</div>
      <div class="ps-queue"><div class="small muted">file <code>ingest.transactions</code></div><div class="ps-slots" id="rqSlots"></div><div class="small"><b id="rqReady">0</b> prêts · <b id="rqUnack">0</b> en cours</div></div>
      <div class="ps-arrow">→ 🔒 AMQPS</div><div class="ps-actor" id="rqConsumer">⚙️<div class="small">Consommateur</div></div><div class="ps-arrow">→</div>
      <div class="ps-actor">🐘<div class="small">Base : <b id="rqDone">0</b></div></div></div>
    <p class="small" id="rqCap" style="margin-bottom:0">Clique sur « publier » pour commencer.</p>
  </div>
  <h2>Les mots à connaître</h2>
  <div class="lgrid g3">
    <div class="box concept"><b>📤 Producteur / 📥 consommateur</b><p class="small"><code>producer.py</code> envoie les transactions, <code>consumer.py</code> les lit, fait chiffrer l'IBAN par Vault et les range.</p></div>
    <div class="box concept"><b>🔀 Exchange</b><p class="small">Le centre de tri : il reçoit les messages et les route vers une ou plusieurs files.</p></div>
    <div class="box concept"><b>📬 File (queue)</b><p class="small">La boîte aux lettres où les messages attendent. <i>Ready</i> = en attente, <i>Unacked</i> = pris mais pas encore confirmé.</p></div>
    <div class="box concept"><b>✅ Ack</b><p class="small">L'accusé de réception : tant que le consommateur n'a pas confirmé, le message n'est pas supprimé.</p></div>
    <div class="box concept"><b>🔒 AMQPS (port 5671)</b><p class="small">AMQP dans un tunnel TLS. Le port en clair (5672) est désactivé dans le lab.</p></div>
    <div class="box concept"><b>🏠 Vhost + utilisateur</b><p class="small">Un espace isolé et des comptes. Ceux du pipeline sont créés à la demande par Vault (moteur <code>rabbitmq/</code>) et expirent.</p></div>
  </div>
  <div class="box warnbox" style="margin-top:14px">⚠️ <b>À retenir :</b> RabbitMQ chiffre le <b>voyage</b> des messages (TLS) mais <b>pas leur stockage</b> dans la file. Un message en attente contient l'IBAN en clair sur le disque du serveur RabbitMQ.
    C'est pour ça que DataCorp fait chiffrer l'IBAN par Vault <b>dès le consommateur</b>, et que RabbitMQ n'a aucune route vers le réseau des données.</div>
  <h2>Faire la même chose avec l'interface graphique</h2>
  <p class="small muted">Ouvre <a href="${esc(INFO.rabbitmq_url || "#")}" target="_blank" rel="noopener">RabbitMQ Management ↗</a> et suis les captures (clic = agrandir). Le bouton « pipeline (50 tx) » est trop rapide pour l'interface, qui ne mesure que <b>toutes les 5 s</b> : dans le <a href="#/terminal">terminal</a>, utilise plutôt
    <b>📮 publier seulement</b> (les messages restent en <i>Ready</i>, tu peux les lire avec « Get messages »), puis <b>consommer la file</b>,
    ou <b>🐢 pipeline lent</b> (~45 s de trafic : <i>Publish</i>, <i>Deliver</i>, <i>Unacked</i>, <i>Consumer ack</i> bougent en direct).</p>
  <div class="shots">
    ${shot("rabbitmq-1-connexion.png", "1 · Se connecter", ["Utilisateur et mot de passe <b>RABBITMQ_ADMIN_USER / RABBITMQ_ADMIN_PASSWORD</b> (bouton <a href='#' data-creds>🔑</a>).", "Clique sur <b>Login</b>."])}
    ${shot("rabbitmq-2-apercu.png", "2 · La vue d'ensemble", ["Onglet <b>Overview</b> : messages en file, débit, nœud.", "Tout en bas, <b>Ports and contexts</b> : <code>amqp/ssl 5671</code> et <code>https 15671</code>, aucun port en clair."])}
    ${shot("rabbitmq-3-connexions.png", "3 · Qui est connecté (et chiffré ?)", ["Onglet <b>Connections</b> pendant que le pipeline tourne.", "Colonne <b>SSL / TLS</b> : un point ● = connexion chiffrée. L'utilisateur est un compte temporaire créé par Vault."])}
    ${shot("rabbitmq-4-files.png", "4 · Les files", ["Onglet <b>Queues and Streams</b>.", "La file <code>ingest.transactions</code> : <b>Ready</b> (en attente) et <b>Unacked</b> (en cours)."])}
    ${shot("rabbitmq-5-message.png", "5 · Regarder un message", ["Clique sur la file, section <b>Get messages</b>.", "Choisis <i>Nack message requeue true</i> (le message reste dans la file), puis <b>Get Message(s)</b>.", "Observe le contenu : l'IBAN est encore en clair ici !"])}
    ${shot("rabbitmq-6-utilisateurs.png", "6 · Les utilisateurs", ["Onglet <b>Admin → Users</b>.", "À côté de l'admin, des comptes au nom bizarre (<code>…-root-…</code>) : ce sont ceux créés par Vault, ils disparaissent seuls."])}
  </div>
  <h2>Comprendre chaque métrique de RabbitMQ Management</h2>
  <p class="small muted">Lance « 🐢 pipeline lent » dans le <a href="#/terminal">terminal</a>, ouvre l'interface à côté et déplie chaque onglet : pour chaque chiffre, ce qu'il signifie, la valeur normale dans DataCorp et ce qui doit alerter un analyste sécurité. Les débits sont en <b>messages/seconde</b>, mesurés toutes les 5 s.</p>
  ${coursRabbitMetrics()}
  <div class="box warnbox" style="margin-top:14px">🔎 <b>Les 3 réflexes de surveillance :</b> <b>Ready</b> qui monte sans redescendre (consommateur tombé), une connexion <b>sans ● TLS</b> ou avec le compte <b>admin</b> (secret mal géré), un <b>consommateur ou une file de trop</b> (quelqu'un copie le flux de transactions).</div>
  <h2>⌨️ Les mêmes gestes dans le terminal</h2>
  <div class="box">${codeBlock(`/lab/scripts/with-vault-creds.sh python3 /lab/pipeline/producer.py 5   # publie 5 transactions
/lab/scripts/with-vault-creds.sh python3 /lab/pipeline/consumer.py     # les consomme
vault read rabbitmq/creds/<rôle>                                       # un compte temporaire (voir TP1 · 6)
openssl s_client -connect rabbitmq:5671 -CAfile /certs/ca.crt </dev/null | head -5   # le TLS d'AMQPS`)}
    <div class="row"><a class="button is-small" href="#/terminal">Ouvrir le terminal</a><a class="button is-small" href="#/crypto/transit">Démo « en transit » →</a></div></div>
  <h2>Quiz</h2>
  ${quiz("rabbitmq", qs)}
  ${coursNav("rabbitmq")}`;
  wireQuiz(view, "rabbitmq", qs);
  // --- simulation
  let ready = 0, unack = 0, done = 0, n = 0, down = false;
  const draw = (cap) => {
    if (!$("#rqSlots")) return;
    $("#rqSlots").innerHTML = Array.from({ length: ready + unack }, (_, i) => `<span class="letter ${i >= ready ? "unack" : ""}">✉️</span>`).join("") || `<span class="muted small">vide</span>`;
    $("#rqReady").textContent = ready; $("#rqUnack").textContent = unack; $("#rqDone").textContent = done;
    $("#rqConsumer").classList.toggle("down", down); if (cap) $("#rqCap").innerHTML = cap;
  };
  $("#rqPub").onclick = () => { ready += 5; n += 5; draw(`📨 5 transactions déposées, chiffrées pendant le voyage (TLS). Elles attendent dans la file.`); };
  $("#rqCons").onclick = async () => {
    if (down) return draw("💥 Le consommateur est en panne : les messages attendent sans se perdre. Re-clique « Panne » pour le réparer.");
    if (!ready) return draw("📭 La file est vide : rien à traiter.");
    ready--; unack++; draw("⚙️ Le consommateur a pris un message (<i>unacked</i>) et demande à Vault de chiffrer l'IBAN…");
    await sleepMs(900); unack--; done++; draw("✅ Rangé en base avec l'IBAN chiffré, puis <b>ack</b> envoyé : RabbitMQ supprime le message.");
  };
  $("#rqCrash").onclick = () => { down = !down; if (!down && unack) { ready += unack; unack = 0; }
    draw(down ? "💥 Panne ! Les messages restent dans la file. Aucun n'est perdu." : "🔧 Consommateur réparé : les messages non confirmés sont remis en file (<i>requeue</i>)."); };
  draw();
}

// ================================================================ visionneuse de buckets
async function bucketBrowser(el) {
  if (!el) return;
  el.innerHTML = `<p class="muted">Lecture des buckets…</p>`;
  let list;
  try { list = await api("/api/minio/buckets"); } catch (e) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  if (!list.length) { el.innerHTML = `<p class="muted">Aucun bucket pour l'instant (ils sont créés au TP1).</p>`; return; }
  const lockTxt = (l) => l ? `🧊 WORM ${esc(l.mode || "")} ${esc(l.validity || "")}`.trim() : "";
  el.innerHTML = `<div class="buckets">${list.map((b, i) => `<button class="bucket" data-b="${i}">
      <div class="bk-ic">🪣</div><div style="min-width:0;flex:1"><b>${esc(b.name)}</b><div class="small muted">${b.count} objet${b.count > 1 ? "s" : ""}</div>
      <div class="row" style="gap:4px;margin-top:4px">${b.encryption ? `<span class="tag ok">🔐 ${esc(b.encryption === "AES256" ? "SSE-S3 (AES-256)" : b.encryption)}</span>` : `<span class="tag ko">⚠ non chiffré au repos</span>`}
        ${b.versioning === "Enabled" ? `<span class="tag">🕰️ versioning</span>` : ""}${b.lock ? `<span class="tag crypto">${lockTxt(b.lock)}</span>` : ""}</div></div></button>`).join("")}</div>
    <div data-objs></div>`;
  const objs = $("[data-objs]", el);
  $$("[data-b]", el).forEach((btn) => (btn.onclick = () => {
    $$("[data-b]", el).forEach((x) => x.classList.toggle("on", x === btn));
    const b = list[+btn.dataset.b];
    const url = INFO.minio_url ? `${INFO.minio_url.replace(/\/$/, "")}/browser/${encodeURIComponent(b.name)}` : "";
    objs.innerHTML = `<div class="row" style="margin:12px 0 6px"><h3 style="margin:0">${esc(b.name)}</h3><span class="spacer"></span>
        ${url ? `<a class="button is-small" href="${esc(url)}" target="_blank" rel="noopener">Ouvrir dans MinIO Console ↗</a>` : ""}</div>
      <p class="small muted" style="margin:0 0 8px">${b.encryption ? "🔐 Ce bucket chiffre chaque objet sur le disque (SSE-S3)." : "⚠ Ce bucket ne chiffre pas : les objets sont en clair sur le disque."}
        ${b.lock ? " 🧊 Object Lock : aucun objet ne peut être supprimé avant l'échéance." : ""}</p>
      ${b.objects.length ? `<div class="tablewrap"><table class="table is-fullwidth acc objtable"><thead><tr><th>Objet (clé)</th><th>Taille</th><th>Modifié</th><th></th></tr></thead><tbody>
        ${b.objects.slice(0, 60).map((o, j) => `<tr><td class="mono small">${esc(o.key)}</td><td class="small">${fmtSize(o.size)}</td><td class="small muted">${esc((o.lastModified || "").slice(0, 16).replace("T", " "))}</td>
          <td><button class="button is-small" data-o="${j}">🔍 S3 vs disque</button></td></tr>`).join("")}</tbody></table></div>
        ${b.count > 60 ? `<p class="small muted">… ${b.count - 60} autres objets (voir dans MinIO Console).</p>` : ""}` : `<p class="muted small">Bucket vide.</p>`}
      <div data-detail></div>`;
    $$("[data-o]", objs).forEach((ob) => (ob.onclick = () => objectDetail($("[data-detail]", objs), b, b.objects[+ob.dataset.o])));
  }));
}
function fmtSize(n) { return n < 1024 ? `${n} o` : n < 1048576 ? `${(n / 1024).toFixed(1)} Kio` : `${(n / 1048576).toFixed(1)} Mio`; }
async function objectDetail(box, b, o) {
  box.innerHTML = `<p class="muted">Lecture de ${esc(o.key)}…</p>`;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  try {
    const r = await api(`/api/minio/object?bucket=${encodeURIComponent(b.name)}&key=${encodeURIComponent(o.key)}`);
    const meta = r.stat?.metadata || {}, sse = meta["X-Amz-Server-Side-Encryption"];
    const d = r.disk || {};
    box.innerHTML = `<div class="lgrid g2" style="margin-top:10px">
      <div class="box flat"><h3>Vu par S3 (utilisateur autorisé)</h3>
        <div class="small muted mono">mc cat dc/${esc(b.name)}/${esc(o.key)}</div>
        <div class="verdict good small">${sse ? `🔐 Chiffré sur le disque (${esc(sse)}) mais <b>déchiffré automatiquement</b> pour qui a le droit de lire.` : "Lu tel quel."}</div>
        <pre class="hex">${esc(r.content || "(vide)")}</pre>
        <p class="small" style="margin-bottom:0">Contre un utilisateur autorisé, le chiffrement au repos ne sert à rien : c'est le <b>contrôle d'accès</b> (TP2) qui protège.</p></div>
      <div class="box flat"><h3>Lu directement sur le disque (voleur)</h3>
        ${d.error ? `<p class="err">${esc(d.error)}</p>` : `<div class="small muted mono">${esc(d.file)} · ${d.size} octets</div>
        <div class="verdict ${d.readable ? "bad" : "good"} small">${d.readable ? "⚠ Le contenu apparaît <b>en clair</b> dans les octets du disque !" : "✓ Le contenu est <b>introuvable</b> : les octets sont chiffrés."}</div>
        ${entropyBar(d.entropy)}<pre class="hex">${esc(d.dump)}</pre>
        <p class="small" style="margin-bottom:0">${d.readable ? "Un disque ou une sauvegarde volés suffisent à lire ce fichier. Solution : <code>mc encrypt set sse-s3</code> sur le bucket." : "Sans la clé maître de MinIO, ces octets sont inexploitables : c'est le chiffrement au repos."}</p>`}</div></div>`;
    defiDone("r-obj");
  } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

// ================================================================ pages « chiffrement » : plus claires et ludiques
function heroTransit() {
  return `${storyBox("🕵️", "L'histoire", `Alice envoie un IBAN à Vault. Entre les deux, <b>Eve</b> l'espionne a branché une sonde sur le câble.
    Sans chiffrement, Eve lit tout. Avec TLS, elle ne voit qu'un <b>charabia</b> — et si elle se fait passer pour Vault, le certificat la <b>démasque</b>.`)}
  <div class="box"><div class="row"><b>🎬 Démo express</b><span class="spacer"></span>
    <button class="button is-small" data-tmode="http">📨 Envoyer en HTTP (clair)</button><button class="button is-small is-primary" data-tmode="https">🔒 Envoyer en HTTPS (TLS)</button>
    <button class="button is-small" data-tmode="mitm">🎭 Eve se fait passer pour Vault</button></div>
    <svg class="spy" viewBox="0 0 900 170" id="spySvg">
      <g><rect x="20" y="55" width="130" height="60" rx="12" class="sbox"/><text x="85" y="82" class="big">👩‍💼</text><text x="85" y="105">Alice</text></g>
      <g><rect x="750" y="55" width="130" height="60" rx="12" class="sbox" id="spyDst"/><text x="815" y="82" class="big" id="spyDstIc">🏦</text><text x="815" y="105" id="spyDstTx">Vault</text></g>
      <line x1="150" y1="85" x2="750" y2="85" class="wire"/>
      <g id="eve"><text x="450" y="162" class="big">🕵️</text><text x="450" y="130" class="small" id="eveSays">Eve écoute le câble…</text></g>
      <g id="pkt" transform="translate(150,85)"><rect x="-80" y="-15" width="160" height="30" rx="15" class="pkt"/><text id="pktTx" y="5">FR76 3000 1007…</text></g>
    </svg>
    <p class="small" id="spyCap" style="margin-bottom:0">Choisis un envoi pour voir ce que voit Eve.</p></div>`;
}
async function spyPlay(view, mode) {
  const pkt = $("#pktTx", view).parentNode, tx = $("#pktTx", view), eve = $("#eveSays", view), cap = $("#spyCap", view);
  const dstIc = $("#spyDstIc", view), dstTx = $("#spyDstTx", view);
  dstIc.textContent = mode === "mitm" ? "😈" : "🏦"; dstTx.textContent = mode === "mitm" ? "« Vault » (faux)" : "Vault";
  pkt.classList.remove("enc", "blocked"); eve.textContent = "Eve écoute le câble…";
  tx.textContent = mode === "http" ? "FR76 3000 1007 9412…" : "🔒 17 03 03 9f a2 c4…";
  if (mode !== "http") pkt.classList.add("enc");
  cap.textContent = mode === "http" ? "Envoi en clair…" : mode === "https" ? "Poignée de main TLS, puis envoi chiffré…" : "Eve a détourné le trafic vers SA machine…";
  await moveTo(pkt, [150, 85], [450, 85], 900);
  eve.textContent = mode === "http" ? "😈 « J'ai l'IBAN : FR76 3000 1007 9412 » !" : mode === "https" ? "😩 « 17 03 03 9f a2… je ne comprends rien »" : "😈 « Je présente mon faux certificat… »";
  await sleepMs(900);
  if (mode === "mitm") { pkt.classList.add("blocked"); tx.textContent = "⛔ certificat refusé";
    cap.innerHTML = "✅ <b>Connexion refusée</b> : le certificat d'Eve n'est pas signé par la CA du lab ou ne porte pas le bon nom. Alice n'envoie rien. C'est la vérification <code>verify-full</code>."; return; }
  await moveTo(pkt, [450, 85], [750, 85], 800);
  cap.innerHTML = mode === "http" ? "❌ <b>Fuite</b> : en HTTP, n'importe qui sur le chemin lit les données. Vérifie-le en vrai dans la section 3 ci-dessous."
    : "✅ <b>Protégé</b> : seul Vault, qui a la clé de session TLS, peut lire l'IBAN. Eve n'a vu que du bruit.";
}
function heroApp() {
  return `${storyBox("⚙️", "L'histoire", `Vault transit est une <b>machine à chiffrer</b> installée dans le coffre. L'application glisse un IBAN par la fente,
    la machine rend un ticket <code>vault:v1:…</code>. <b>La clé ne sort jamais du coffre</b> : même si un pirate vole la base ET le code de l'application, il n'a pas la clé.
    Changer la clé (rotation) = <b>changer la serrure</b> sans devoir refaire tout de suite tous les anciens tickets.`)}
  <div class="box"><b>🔎 Anatomie d'un chiffré</b> — survole chaque morceau :
    <div class="anat"><span class="p1" title="préfixe : ce chiffré vient de Vault">vault</span>:<span class="p2" title="version de la clé utilisée : après une rotation, les nouveaux chiffrés passent en v2, v3…">v1</span>:<span class="p3" title="base64 de : nonce aléatoire (12 octets) + données chiffrées AES-256-GCM + étiquette d'authenticité (16 octets)">q9ZcLm1rT0xk3hQpJ2Y1bA…==</span></div>
    <div class="lgrid g3 small" style="margin-top:8px"><div><b class="c1">vault</b> : « ça vient de Vault »</div><div><b class="c2">v1</b> : numéro de version de la clé</div><div><b class="c3">q9Zc…</b> : nonce + chiffré + sceau anti-falsification</div></div></div>`;
}
function heroRest() {
  return `${storyBox("🦹", "L'histoire", `Un soir, un <b>voleur</b> repart avec un disque dur du datacenter (ou une vieille sauvegarde). Il n'a <b>aucun mot de passe</b>, mais il peut lire
    les fichiers octet par octet. Qu'est-ce qu'il y trouve ? Clique sur les trois boutons « voler » ci-dessous et observe l'<b>entropie</b> :
    un texte lisible ≈ 4-5 bits/octet, des données chiffrées ≈ 8 (du pur hasard).`)}
  <div class="lgrid g3">
    <div class="box flat mini"><b>🐘 PostgreSQL</b><div class="small">pas de chiffrement du disque : seules les colonnes chiffrées par Vault sont protégées</div></div>
    <div class="box flat mini"><b>🪣 MinIO</b><div class="small">chiffre chaque objet si le bucket a SSE-S3 — comparez les deux buckets</div></div>
    <div class="box flat mini"><b>🏦 Vault</b><div class="small">tout est chiffré derrière la « barrière » : le voleur ne trouve que du bruit</div></div></div>`;
}

// Un seul écouteur global (#view est réutilisé d'une page à l'autre) : la page courante décide.
let DEFI_PAGE = "";
function wireDefis(view, page) {
  $$("[data-defis]", view).forEach(renderDefis);
  DEFI_PAGE = page;
}
document.addEventListener("click", (e) => {
    const page = location.hash.startsWith("#/crypto/") ? DEFI_PAGE : "";
    const t = e.target.closest("#view button"); if (!t || !page) return;
    const id = t.id;
    if (page === "transit") {
      if (id === "tlsGo" && $("#tlsTest")?.value === "wrongname") setTimeout(() => defiDone("t-mitm"), 1200);
      if (t.dataset.tmode === "mitm") setTimeout(() => defiDone("t-mitm"), 2000);
      if (id === "wireGo") setTimeout(() => defiDone("t-wire"), 1500);
      if (id === "plainGo") setTimeout(() => defiDone("t-plain"), 1500);
    }
    if (page === "app") {
      if (id === "encGo") setTimeout(() => { const seen = {}; for (const c of CTS) { if (seen[c.pt] && seen[c.pt] !== c.ct) defiDone("a-twice"); seen[c.pt] = c.ct; } }, 1500);
      if (t.dataset.dec !== undefined) setTimeout(() => { if (CTS.some((c) => (c.out || "").startsWith("déchiffré"))) defiDone("a-dec"); }, 1500);
      if (t.dataset.rew !== undefined) setTimeout(() => { if (CTS.some((c) => (c.out || "").startsWith("rewrap")) && CTS.some((c) => c.ct.split(":")[1] !== "v1")) defiDone("a-rot"); }, 1500);
      if (id === "hmacGo") setTimeout(() => { const l = ($("#hmacOut")?.innerText || "").match(/hmac:v\d+:\S+/g) || []; if (l.length >= 2 && new Set(l).size < l.length) defiDone("a-hmac"); }, 1500);
    }
    if (page === "rest") {
      if (id === "pgGo" || id === "pgVac") setTimeout(() => defiDone("r-pg"), 2500);
      if (id === "mnGo") setTimeout(() => defiDone("r-minio"), 3000);
      if (id === "vtGo") setTimeout(() => defiDone("r-vault"), 2000);
    }
});

// ================================================================ branchement dans la console
(function install() {
  const _transit = transitView, _app = appView, _rest = restView, _home = home;
  routes["#/crypto/transit"] = (view) => {
    _transit(view);
    $(".sub", view).insertAdjacentHTML("afterend", heroTransit() + defisBox("transit"));
    $$("[data-tmode]", view).forEach((b) => (b.onclick = () => spyPlay(view, b.dataset.tmode)));
    // Explication en langage simple de chaque test TLS.
    const plain = { normal: "🙂 Cas normal : chaque service prouve son identité avec un certificat signé par la CA du lab.",
      wrongname: "🎭 On se connecte avec un AUTRE nom que celui du certificat, comme si Eve s'était glissée au milieu. Un refus = bonne nouvelle.",
      noca: "🤷 Le client ne connaît pas la CA du lab : il ne peut pas vérifier le certificat, donc il refuse. Il faut distribuer ca.crt.",
      tls11: "👴 Un vieux client qui ne parle que TLS 1.1 (cassé). Les services doivent le refuser et exiger TLS 1.2 ou 1.3." };
    const sel = $("#tlsTest", view), hint = document.createElement("div");
    hint.className = "verdict small"; hint.style.margin = "8px 0"; sel.closest(".box").insertBefore(hint, $("#tlsOut", view));
    const upd = () => (hint.textContent = plain[sel.value] || ""); sel.addEventListener("change", upd); upd();
    wireDefis(view, "transit");
  };
  routes["#/crypto/app"] = (view) => {
    _app(view);
    $(".sub", view).insertAdjacentHTML("afterend", heroApp() + defisBox("app"));
    wireDefis(view, "app");
  };
  routes["#/crypto/rest"] = (view) => {
    _rest(view);
    $(".sub", view).insertAdjacentHTML("afterend", heroRest() + defisBox("rest"));
    $("#mnOut", view).closest(".box").insertAdjacentHTML("afterend", `<div class="box" style="margin-top:14px">
      <div class="row"><h3 style="margin:0">Visionneuse de buckets MinIO</h3><span class="spacer"></span><a class="button is-small" href="#/cours/minio">Cours MinIO →</a></div>
      <p class="muted small">Tous les buckets du lab, leur chiffrement, et chaque objet vu par S3 ou lu sur le disque.</p><div data-buckets></div></div>`);
    bucketBrowser($("[data-buckets]", view));
    wireDefis(view, "rest");
  };
  const homeWrap = (view) => {
    _home(view);
    const card = $("svg.archi", view)?.closest(".box");
    if (card) card.insertAdjacentHTML("afterbegin", `<div class="row" style="margin-bottom:6px"><span class="spacer"></span><button class="button is-small" data-zoom="#view svg.archi" data-ztitle="Architecture DataCorp">⛶ Agrandir</button></div>`);
    $(".sub", view).insertAdjacentHTML("afterend", `<div class="box coursbanner"><div class="row"><b>Nouveau ici ?</b><span class="small muted">Commence par les cours : l'histoire du projet, puis Vault, MinIO et RabbitMQ, avec captures et quiz.</span>
      <span class="spacer"></span><a class="button is-primary is-small" href="#/cours/projet">Commencer le cours →</a></div></div>`);
  };
  routes[""] = homeWrap; routes["#/"] = homeWrap;
})();


// Métriques de RabbitMQ Management, onglet par onglet : sens, valeur attendue dans le lab, signal d'alerte.
const RQ_METRICS = [
  { tab: "Overview → Queued messages", intro: "Le graphe du haut : combien de messages sont dans <b>toutes</b> les files du serveur, à l'instant T.", rows: [
    ["Ready", "Messages en attente dans la file, que personne n'a encore pris.", "Monte avec « 📮 publier seulement », redescend à 0 avec « consommer la file ».", "Monte sans jamais redescendre : le consommateur est arrêté ou trop lent. Les IBAN en clair s'accumulent sur le disque."],
    ["Unacked", "Messages remis à un consommateur mais pas encore confirmés (<i>ack</i>). S'il meurt, ils redeviennent <i>Ready</i>.", "Avec « 🐢 pipeline lent », oscille entre 0 et la taille du lot (prefetch).", "Bloqué à une valeur fixe : consommateur figé (base inaccessible, Vault scellé…)."],
    ["Total", "Ready + Unacked.", "Égal au nombre de transactions pas encore en base.", "Croissance continue = backlog, risque d'alarme mémoire/disque."],
  ] },
  { tab: "Overview → Message rates", intro: "Des <b>débits</b> en messages par seconde, calculés sur les 5 dernières secondes (d'où « no metrics » si le trafic dure moins de 5 s).", rows: [
    ["Publish", "Messages reçus des producteurs.", "≈ 1/s avec le pipeline lent, pic très court avec « pipeline (50 tx) ».", "Pic inattendu : producteur qui s'emballe ou compte volé qui inonde la file."],
    ["Publisher confirm", "Accusés renvoyés par RabbitMQ au producteur (« bien reçu et stocké »).", "0 : <code>producer.py</code> n'active pas les confirmations.", "En production, Publish ≠ Publisher confirm = messages perdus sans que le producteur le sache."],
    ["Deliver (manual ack)", "Messages poussés à un consommateur qui confirmera lui-même.", "Suit Publish : c'est le mode de <code>consumer.py</code>.", "0 alors que Ready monte : aucun consommateur branché."],
    ["Deliver (auto ack)", "Messages poussés et considérés comme traités dès l'envoi.", "0 dans le lab.", "Non nul : un message peut être perdu si le consommateur plante (mauvaise pratique pour des données sensibles)."],
    ["Consumer ack", "Accusés de réception reçus des consommateurs.", "Arrive par paquets : <code>consumer.py</code> acquitte un lot entier (<code>multiple=True</code>).", "Très inférieur à Deliver : traitements qui échouent ou restent bloqués."],
    ["Redelivered", "Messages renvoyés une 2ᵉ fois (consommateur mort avant son ack, ou nack avec requeue).", "Non nul après « Get messages » avec <i>Nack requeue true</i>, ou après avoir coupé un consommateur.", "Valeur élevée et régulière : message « poison » qui fait planter le consommateur en boucle."],
    ["Get (manual ack) / Get (auto ack)", "Lectures « à la demande » (<i>basic.get</i>), comme le bouton <b>Get Message(s)</b> de l'interface.", "Non nul quand tu lis un message à la main.", "En production, quelqu'un qui « lit » les files à la main = consultation de données en clair à tracer."],
    ["Get (empty)", "Lectures à la demande sur une file vide.", "Si tu cliques Get sur une file vide.", "Élevé : client qui interroge en boucle au lieu de s'abonner (gaspillage)."],
    ["Unroutable (return / drop)", "Messages qu'aucune file n'accepte : renvoyés au producteur (<i>return</i>) ou jetés (<i>drop</i>).", "0 : la file <code>ingest.transactions</code> existe.", "Non nul : file supprimée ou mauvaise clé de routage → <b>transactions perdues</b>."],
    ["Disk read / Disk write", "Messages lus / écrits sur le disque par le serveur.", "Disk write suit Publish : les messages sont persistants (<code>delivery_mode=2</code>, file durable).", "Rappel sécurité : ce qui est écrit sur disque l'est <b>en clair</b> (IBAN compris)."],
  ] },
  { tab: "Overview → Global counts", intro: "Les compteurs en haut à droite de l'Overview.", rows: [
    ["Connections", "Connexions TCP (TLS) ouvertes par des clients.", "0 au repos, 1 à 2 pendant le pipeline.", "Des dizaines de connexions : fuite de connexions ou scan."],
    ["Channels", "Sous-canaux AMQP multiplexés dans une connexion (chaque script en ouvre 1).", "Égal aux connexions.", "Beaucoup de canaux par connexion : bug client (fuite de canaux)."],
    ["Exchanges", "Centres de tri déclarés (les 7 de base <code>amq.*</code> + celui par défaut).", "Stable.", "Un exchange inconnu : quelqu'un a modifié la topologie."],
    ["Queues", "Nombre de files.", "1 : <code>ingest.transactions</code>.", "Nouvelles files inattendues : copie discrète du flux (fuite de données)."],
    ["Consumers", "Abonnés actifs sur les files.", "1 pendant « consommer la file », 0 sinon.", "Un consommateur de plus que prévu : quelqu'un écoute les transactions."],
  ] },
  { tab: "Overview → Nodes", intro: "La santé du serveur <code>rabbit@…</code> (une ligne par nœud).", rows: [
    ["File descriptors", "Fichiers et sockets ouverts / limite du système.", "Quelques dizaines.", "Proche de la limite : plus aucune connexion acceptée (déni de service)."],
    ["Erlang processes", "Processus légers de la machine virtuelle Erlang (un par connexion, canal, file…).", "Quelques centaines.", "Croissance continue : fuite de connexions ou de files."],
    ["Memory", "RAM utilisée, avec le seuil <i>high watermark</i> (40 % de la RAM par défaut).", "Largement sous le seuil.", "Seuil dépassé → alarme : RabbitMQ <b>bloque tous les producteurs</b> (connexions en <i>blocked</i>)."],
    ["Disk space", "Espace libre, avec la limite <i>low watermark</i>.", "Plusieurs Go libres.", "Sous la limite → même blocage des producteurs ; une file jamais vidée peut provoquer ça."],
    ["Uptime", "Depuis quand le nœud tourne.", "Depuis le dernier <code>docker compose up</code>.", "Redémarrage inexpliqué : crash ou intervention non tracée."],
    ["Info (basic, disc, rss)", "Type de nœud (disc = stocke sur disque) et méthode de calcul mémoire.", "basic · disc.", "—"],
  ] },
  { tab: "Overview → Churn statistics", intro: "Créations / fermetures par seconde.", rows: [
    ["Connection / Channel / Queue operations", "Nombre de connexions, canaux et files ouverts puis fermés.", "Un pic à chaque lancement de script : chaque exécution reçoit un <b>nouveau compte Vault</b> et ouvre une nouvelle connexion.", "Churn élevé en continu : client qui se reconnecte en boucle (mot de passe expiré, TLS refusé…)."],
  ] },
  { tab: "Connections", intro: "Une ligne par client connecté. Cliquer une ligne ouvre son détail.", rows: [
    ["Virtual host", "L'espace isolé utilisé.", "<code>datacorp</code>.", "Un vhost inattendu."],
    ["User name", "Le compte utilisé.", "Un nom <code>…-root-…</code> généré par Vault, différent à chaque exécution.", "Le compte <b>admin</b> utilisé par une application : secret partagé à supprimer."],
    ["State", "<i>running</i> (normal), <i>flow</i> (freiné car trop rapide), <i>blocking/blocked</i> (alarme mémoire/disque).", "running.", "blocked : le serveur est saturé, plus aucun message n'entre."],
    ["SSL / TLS", "● = connexion chiffrée.", "● sur toutes les lignes (seul le port 5671 est ouvert).", "Une connexion sans ● : trafic en clair, IBAN lisible sur le réseau."],
    ["Protocol", "Version du protocole (AMQP 0-9-1).", "AMQP 0-9-1.", "—"],
    ["Channels", "Canaux ouverts dans cette connexion.", "1.", "—"],
    ["From client / To client", "Débit réseau entrant / sortant en octets/s.", "Quelques Ko/s pendant le trafic.", "Gros débit sortant vers un client inconnu : exfiltration."],
  ] },
  { tab: "Channels", intro: "Le détail des canaux (plus fin que Connections).", rows: [
    ["Mode", "<b>C</b> = confirmations éditeur activées, <b>T</b> = transactionnel, vide = aucun.", "Vide.", "—"],
    ["Prefetch", "Nombre max de messages non confirmés qu'un consommateur peut détenir.", "La taille de lot donnée à <code>consumer.py</code> (0 = illimité).", "0 en production : un seul consommateur aspire toute la file en mémoire."],
    ["Unacked", "Messages détenus par ce canal et pas encore confirmés.", "≤ prefetch.", "Figé : consommateur bloqué."],
    ["Unconfirmed", "Messages publiés en attente de confirmation (mode C).", "0.", "—"],
    ["publish / confirm / deliver / ack", "Les mêmes débits que l'Overview, pour ce canal seul.", "Permet de voir <b>qui</b> produit et <b>qui</b> consomme.", "—"],
  ] },
  { tab: "Queues and Streams", intro: "Une ligne par file ; cliquer la file ouvre son graphe détaillé.", rows: [
    ["Type", "<i>classic</i>, <i>quorum</i> (répliquée) ou <i>stream</i>.", "classic.", "—"],
    ["Features", "<b>D</b> = durable (survit au redémarrage), <b>AD</b> = auto-delete, <b>Excl</b> = exclusive, <b>TTL</b>, <b>DLX</b> (file des rejets), <b>Args</b>.", "D.", "Pas de D sur une file de transactions : tout est perdu au redémarrage."],
    ["State", "<i>running</i>, <i>idle</i> (inactive), <i>flow</i> (freinée).", "idle au repos, running pendant le trafic.", "—"],
    ["Ready / Unacked / Total", "Les mêmes compteurs que l'Overview, pour cette file.", "Voir ci-dessus.", "—"],
    ["incoming / deliver / get / ack", "Débits de cette file (msg/s).", "incoming ≈ deliver ≈ ack quand tout va bien.", "incoming > ack durablement : la file grossit."],
    ["Consumers · Consumer capacity", "Nombre d'abonnés et % du temps où ils peuvent recevoir immédiatement.", "1 · proche de 100 %.", "Capacité basse : consommateurs saturés, il en faut plus (ou un prefetch plus grand)."],
    ["Memory · Persistent · Paged out", "RAM de la file, messages persistants, messages déchargés sur disque.", "Faible.", "Paged out élevé : la file est trop grosse pour la RAM."],
  ] },
  { tab: "Exchanges", intro: "Les centres de tri.", rows: [
    ["Type", "<i>direct</i> (clé exacte), <i>fanout</i> (toutes les files), <i>topic</i> (motif), <i>headers</i>.", "Le pipeline utilise l'exchange par défaut (direct, nom vide) : la clé de routage = le nom de la file.", "—"],
    ["Message rate in / out", "Messages entrants / routés vers des files.", "in = out.", "in > out : messages non routables (perdus)."],
  ] },
];

function coursRabbitMetrics() {
  return RQ_METRICS.map((g) => `
    <details class="box metric"><summary><b>${g.tab}</b> <span class="muted small">· ${g.rows.length} métrique${g.rows.length > 1 ? "s" : ""}</span></summary>
      <p class="small">${g.intro}</p>
      <div class="tablewrap"><table class="table is-fullwidth acc"><thead><tr><th>Métrique</th><th>Ce que ça veut dire</th><th>Dans le lab</th><th>🚨 Signal d'alerte</th></tr></thead><tbody>
      ${g.rows.map(([m, d, lab, alerte]) => `<tr><td><b>${m}</b></td><td>${d}</td><td>${lab}</td><td>${alerte}</td></tr>`).join("")}
      </tbody></table></div></details>`).join("");
}

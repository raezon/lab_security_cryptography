"use strict";
// Terminal interactif (xterm.js ⇄ WebSocket ⇄ shell de l'étudiant dans la toolbox),
// coffre Vault personnel, classement, feedback, espace formateur, journaux.

// ================================================================ composant terminal
const TERM_THEME = {
  background: "#0d1117", foreground: "#d6dde6", cursor: "#7ee787", cursorAccent: "#0d1117", selectionBackground: "#264f78",
  black: "#484f58", red: "#ff7b72", green: "#7ee787", yellow: "#e3b341", blue: "#79c0ff", magenta: "#d2a8ff", cyan: "#56d4dd", white: "#d6dde6",
  brightBlack: "#6e7681", brightRed: "#ffa198", brightGreen: "#aff5b4", brightYellow: "#f8e3a1", brightBlue: "#a5d6ff", brightMagenta: "#e2c5ff", brightCyan: "#b3f0ff", brightWhite: "#ffffff",
};
let TERM_FONT = 13.5;
try { TERM_FONT = +localStorage.getItem("termFont") || 13.5; } catch {}

class LabTerm {
  constructor(kind = "toolbox") {
    this.kind = kind; this.target = null; this.onCmd = null; this.lastCode = null;
    this.el = document.createElement("div");
    this.el.className = "tw" + (kind === "coffre" ? " coffre" : "");
    const who = (ME?.prenom || "etudiant").toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
    this.el.innerHTML = `
      <div class="tw-bar">
        <span class="tw-dots"><i></i><i></i><i></i></span>
        <span class="tw-title">${esc(who)}@${kind === "coffre" ? "coffre-perso" : "toolbox"}</span>
        <span class="tw-tgt" data-tgt></span>
        <span class="spacer"></span>
        <button type="button" data-tw="log" title="Mes anciens terminaux (journal)">📜</button>
        <button type="button" data-tw="font-" title="Texte plus petit">A−</button>
        <button type="button" data-tw="font+" title="Texte plus grand">A+</button>
        <button type="button" data-tw="clear" title="Effacer l'écran (Ctrl+L)">⌫</button>
        <button type="button" data-tw="full" title="Plein écran (Échap pour sortir)">⛶</button>
      </div>
      <div class="tw-body"></div>
      <div class="tw-status"><span class="tw-led"></span><span data-st>connexion…</span><span class="spacer"></span><span data-code></span></div>`;
    this.body = this.el.querySelector(".tw-body");
    this.el.querySelectorAll("[data-tw]").forEach((b) => (b.onclick = () => this.action(b.dataset.tw)));
    this.el.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.el.classList.contains("full")) this.action("full"); });
  }
  start() {
    if (this.term) return;
    this.term = new Terminal({ fontFamily: "'IBM Plex Mono', 'JetBrains Mono', Menlo, Consolas, monospace", fontSize: TERM_FONT, lineHeight: 1.2,
      cursorBlink: true, cursorStyle: "bar", scrollback: 8000, theme: TERM_THEME, allowTransparency: false, macOptionIsMeta: true, rightClickSelectsWord: true });
    this.fit = new FitAddon.FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(this.body);
    this.term.onData((d) => this.send({ t: "i", d }));
    this.term.attachCustomKeyEventHandler((e) => {
      // Ctrl+Maj+C / Ctrl+Maj+V : copier-coller comme dans un vrai terminal
      if (e.type === "keydown" && e.ctrlKey && e.shiftKey && e.code === "KeyC") { navigator.clipboard?.writeText(this.term.getSelection()); return false; }
      if (e.type === "keydown" && e.ctrlKey && e.shiftKey && e.code === "KeyV") { navigator.clipboard?.readText().then((t) => this.type(t)); return false; }
      return true;
    });
    new ResizeObserver(() => this.refit()).observe(this.body);
    this.connect();
  }
  refit() {
    if (!this.term || !this.body.offsetParent) return;
    try { this.fit.fit(); } catch {}
    this.send({ t: "resize", cols: this.term.cols, rows: this.term.rows });
  }
  connect() {
    this.refit();
    const q = new URLSearchParams({ kind: this.kind, cols: this.term.cols || 100, rows: this.term.rows || 30 });
    if (this.target) { q.set("step", this.target.step); q.set("task", this.target.task); }
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/term?${q}`);
    ws.binaryType = "arraybuffer"; this.ws = ws;
    this.status("connexion…", "wait");
    ws.onopen = () => { this.status("connecté · toutes les commandes sont permises", "on"); this.refit(); };
    ws.onmessage = (m) => {
      if (typeof m.data !== "string") { this.term.write(new Uint8Array(m.data)); return; }
      const ev = JSON.parse(m.data);
      if (ev.t === "error") this.term.write(`\r\n\x1b[1;31m[console] ${ev.msg}\x1b[0m\r\n`);
      if (ev.t === "cmd") {
        this.lastCode = ev.code;
        const c = this.el.querySelector("[data-code]");
        c.textContent = `dernier code : ${ev.code}`; c.className = ev.code === 0 ? "ok" : "ko";
        this.onCmd?.(ev);
        document.dispatchEvent(new CustomEvent("labcmd", { detail: { ...ev, kind: this.kind } }));
      }
    };
    ws.onclose = () => {
      this.status("déconnecté — appuyez sur Entrée pour rouvrir", "off");
      this.term.write("\r\n\x1b[2m[terminal fermé — Entrée pour rouvrir une session]\x1b[0m\r\n");
      const sub = this.term.onData((d) => { if (d === "\r") { sub.dispose(); this.term.reset(); this.connect(); } });
    };
  }
  status(txt, cls) { const s = this.el.querySelector("[data-st]"); s.textContent = txt; this.el.querySelector(".tw-led").className = `tw-led ${cls}`; }
  send(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }
  type(text) { this.send({ t: "i", d: text }); this.term?.focus(); }
  run(cmd) { this.send({ t: "i", d: "\x15" + cmd + "\r" }); this.term?.focus(); }   // Ctrl+U vide la ligne d'abord
  setTarget(step, task, label) {
    this.target = step ? { step, task } : null;
    this.send({ t: "target", step: step || "", task: task ?? -1 });
    const t = this.el.querySelector("[data-tgt]");
    t.innerHTML = step ? `🎯 ${esc(label || step)}` : "";
  }
  action(a) {
    if (a === "clear") { this.term.clear(); this.send({ t: "i", d: "\x0c" }); }
    if (a === "font+" || a === "font-") {
      TERM_FONT = Math.max(10, Math.min(22, TERM_FONT + (a === "font+" ? 1 : -1)));
      try { localStorage.setItem("termFont", TERM_FONT); } catch {}
      for (const t of [TERMS.toolbox, TERMS.coffre]) if (t?.term) { t.term.options.fontSize = TERM_FONT; t.refit(); }
    }
    if (a === "full") { this.el.classList.toggle("full"); document.body.classList.toggle("twfull", this.el.classList.contains("full")); setTimeout(() => { this.refit(); this.term.focus(); }, 30); }
    if (a === "log") showLogs(this.target?.step || (this.kind === "coffre" ? "coffre" : "libre"));
  }
  mount(slot) { slot.append(this.el); this.start(); setTimeout(() => this.refit(), 30); }
}
const TERMS = {};
function getTerm(kind = "toolbox") { return (TERMS[kind] ||= new LabTerm(kind)); }

// ================================================================ dock (TP)
// Terminal ancré en bas des pages de TP : il suit l'étape affichée.
function mountDock(view) {
  let dock = $("#dock");
  if (!dock) {
    dock = document.createElement("div"); dock.id = "dock"; dock.className = "dock";
    dock.innerHTML = `<div class="dock-grip" title="Glisser pour agrandir"></div><div class="dock-head"><b>💻 Terminal</b>
      <span class="small muted">Tapez vos commandes ici. Toute commande qui donne le bon résultat valide l'objectif 🎯.</span><span class="spacer"></span>
      <button class="button is-small" data-dockmin>▾ Réduire</button></div><div class="dock-slot"></div>`;
    document.body.append(dock);
    const grip = $(".dock-grip", dock);
    grip.onpointerdown = (e) => {
      grip.setPointerCapture(e.pointerId);
      const move = (ev) => { const h = Math.max(160, Math.min(window.innerHeight - 90, window.innerHeight - ev.clientY)); dock.style.height = h + "px"; document.body.style.setProperty("--dockh", h + "px"); };
      grip.onpointermove = move; grip.onpointerup = () => { grip.onpointermove = null; getTerm().refit(); };
    };
    $("[data-dockmin]", dock).onclick = () => {
      const min = dock.classList.toggle("min"); document.body.classList.toggle("dockmin", min);
      $("[data-dockmin]", dock).textContent = min ? "▴ Ouvrir" : "▾ Réduire"; if (!min) setTimeout(() => getTerm().refit(), 30);
    };
  }
  dock.hidden = false; document.body.classList.add("hasdock");
  getTerm().mount($(".dock-slot", dock));
}
function unmountDock() { const d = $("#dock"); if (d) d.hidden = true; document.body.classList.remove("hasdock"); }

// Cible du terminal = sous-commande en cours de l'étape visible.
function targetStep(s) {
  if (!s) return;
  const t = getTerm(), n = s.tasks?.length ? tprog(s.id).i : -1;
  const done = s.tasks?.length && n >= s.tasks.length;
  t.setTarget(done ? "" : s.id, n, done ? "" : `Étape ${s.num}${n >= 0 ? ` · commande ${n + 1}/${s.tasks.length}` : ""}`);
}
const stepById = (id) => { for (const tp of CATALOG) for (const s of tp.steps) if (s.id === id) return s; return null; };

// Résultat d'une commande tapée dans le terminal.
document.addEventListener("labcmd", (e) => {
  const ev = e.detail; if (ev.kind !== "toolbox" || !ev.step) return;
  const s = stepById(ev.step); if (!s) return;
  const card = $(`#step-${s.id}`);
  if (!s.tasks?.length) return;
  const p = tprog(s.id);
  if (ev.task !== p.i) return;
  const zone = card && $("[data-tasks]", card);
  if (!ev.ok) {
    const c = zone && $("[data-tchecks]", zone);
    if (c) c.innerHTML = `<span class="tag">⌨️ ${esc(ev.cmd.slice(0, 60))}</span> <span class="small muted">exécutée (code ${ev.code}) — l'objectif n'est pas encore atteint. Explorez librement (ls, cat, --help…) : toute commande qui donne le bon résultat sera acceptée.</span>`;
    return;
  }
  p.cmds[p.i] = ev.cmd; delete p.cmds["cur" + p.i]; p.i++; saveTprog();
  if (card && zone) { zone.innerHTML = tasksHTML(s); wireTasks(s, card); }
  if (p.i >= s.tasks.length) {
    if (MODE === "expert") {
      const pts = taskPoints(s), method = Object.keys(p.sol).length ? "guided-sol" : "guided";
      if (pts > (SCORE[s.id]?.points ?? -1)) { SCORE[s.id] = { points: pts, max: STEP_MAX, method }; saveScore(); pushScore("step", s.id, pts, STEP_MAX, method); }
      const pb = card && $("[data-pts]", card); if (pb) { pb.className = "tag ok"; pb.textContent = `🏆 ${SCORE[s.id].points}/${STEP_MAX} pts`; }
      updateScoreBadge();
    }
    const badge = card && $("[data-badge]", card); if (badge) { badge.className = "tag ok"; badge.textContent = "✅ validée"; card.classList.add("ok"); }
    toast(`🎉 Étape ${s.num} terminée !`);
    if (s.id === "tp1-1") setTimeout(() => toast("🔒 Votre mot de passe PostgreSQL legacy vient d'être révoqué"), 2800);
    refreshStatus();
  } else toast(`✅ Commande ${p.i} réussie — « ${ev.cmd.slice(0, 40)} »`);
  targetStep(s);
});

// ================================================================ scores serveur
function pushScore(kind, id, points, max, method) { post("/api/score", { kind, id, points, max, method }).catch(() => {}); }

// ================================================================ journaux
async function showLogs(step) {
  let dlg = $("#logs");
  if (!dlg) {
    dlg = document.createElement("dialog"); dlg.id = "logs"; dlg.className = "dlg wide";
    dlg.innerHTML = `<div class="row"><h2 class="dlg-title" style="margin:0">📜 Mes anciens terminaux</h2><span class="spacer"></span><select data-lsel></select>
      <button class="delete is-medium" data-lclose aria-label="Fermer"></button></div>
      <p class="small muted">Chaque commande que vous avez lancée (terminal, ▶ Exécuter, Valider) est gardée, étape par étape — même après avoir terminé.</p>
      <div class="term logterm" data-lbody></div>`;
    document.body.append(dlg);
    $("[data-lclose]", dlg).onclick = () => dlg.close();
    $("[data-lsel]", dlg).onchange = (e) => loadLog(e.target.value);
  }
  const list = await api("/api/termlog").catch(() => []);
  const label = (id) => id === "libre" ? "💻 Terminal libre" : id === "coffre" ? "🔐 Mon coffre" : (() => { const s = stepById(id); return s ? `${id.slice(0, 3).toUpperCase()} · étape ${s.num} — ${s.title}` : id; })();
  const ids = [...new Set([step, ...list.map((x) => x.step)])].filter(Boolean);
  $("[data-lsel]", dlg).innerHTML = ids.map((id) => `<option value="${esc(id)}" ${id === step ? "selected" : ""}>${esc(label(id))}</option>`).join("");
  dlg.showModal(); loadLog(step);
  async function loadLog(id) {
    const b = $("[data-lbody]", dlg); b.textContent = "Lecture…";
    const r = await api(`/api/termlog?step=${encodeURIComponent(id)}`).catch((e) => ({ log: "" }));
    b.innerHTML = r.log ? ansiHTML(r.log) : `<span class="muted">Aucune commande enregistrée ici pour l'instant.</span>`;
    b.scrollTop = b.scrollHeight;
  }
}
function logFold(s) {
  return `<details class="fold logfold" data-logs="${s.id}"><summary>📜 Mes anciens terminaux pour cette étape <span class="muted small">relire ce que vous avez tapé et obtenu</span></summary>
    <div class="foldbody"><div class="term logterm" data-logbody>Lecture…</div></div></details>`;
}
document.addEventListener("toggle", async (e) => {
  const d = e.target; if (!d.matches?.("[data-logs]") || !d.open) return;
  const r = await api(`/api/termlog?step=${encodeURIComponent(d.dataset.logs)}`).catch(() => ({ log: "" }));
  const b = $("[data-logbody]", d);
  b.innerHTML = r.log ? ansiHTML(r.log) : `<span class="muted">Rien pour l'instant : les commandes de cette étape s'afficheront ici.</span>`;
  b.scrollTop = b.scrollHeight;
}, true);

// ================================================================ page Terminal
function terminalView(view) {
  view.innerHTML = `
    <div class="row"><div><h1>💻 Terminal</h1><p class="sub" style="margin:0">Un vrai shell dans la toolbox, dans <b>votre</b> dossier : <code>ls</code>, <code>cd</code>, <code>vim</code>, <code>psql</code>, complétion avec Tab, historique avec ↑. Rien n'est imposé.</p></div></div>
    <div class="tabs is-boxed termtabs"><ul>
      <li class="is-active" data-ttab="toolbox"><a>🧰 Toolbox du lab</a></li>
      <li data-ttab="coffre"><a>🔐 Mon coffre Vault (bac à sable)</a></li></ul></div>
    <div class="termpage" data-tslot></div>
    <div class="lgrid g2" style="margin-top:14px">
      <details class="fold" open><summary>⚡ Raccourcis <span class="muted small">cliquer = taper la commande dans le terminal</span></summary>
        <div class="foldbody"><div class="row" style="gap:6px">${QUICK.map(([l], i) => `<button class="button is-small" data-q="${i}">${esc(l)}</button>`).join("")}</div></div></details>
      <details class="fold"><summary>⌨️ Astuces du terminal</summary><div class="foldbody small">
        <ul><li><b>Tab</b> complète les commandes et chemins · <b>↑ / ↓</b> historique · <b>Ctrl+R</b> recherche dans l'historique</li>
        <li><b>Ctrl+C</b> interrompt · <b>Ctrl+L</b> efface · <b>Ctrl+Maj+C / V</b> copier / coller</li>
        <li><code>aide</code> : commandes du lab · <code>ll</code> : liste détaillée · <code>cd ~</code> : votre dossier</li>
        <li>Vos fichiers, variables (<code>export X=…</code>) et historique sont à vous seul(e) ; les services (Vault, PostgreSQL, MinIO, RabbitMQ) sont communs à la classe.</li>
        <li>📜 dans la barre du terminal : relire vos anciennes sessions.</li></ul></div></details>
    </div>
    <details class="fold"><summary>Aide-mémoire des commandes</summary><div class="foldbody">${CHEAT}</div></details>`;
  const slot = $("[data-tslot]", view);
  const show = (k) => {
    $$("[data-ttab]", view).forEach((li) => li.classList.toggle("is-active", li.dataset.ttab === k));
    slot.innerHTML = ""; getTerm(k).mount(slot); getTerm(k).setTarget("", -1); getTerm(k).term?.focus();
  };
  $$("[data-ttab]", view).forEach((li) => (li.onclick = () => show(li.dataset.ttab)));
  show("toolbox");
  view.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { show("toolbox"); getTerm().run(QUICK[b.dataset.q][1]); }));
}

// ================================================================ coffre Vault personnel
const HOLDERS = [["Alice", "DSI"], ["Bruno", "Data analyst"], ["Claire", "DPO"], ["Samira", "Sécurité"], ["David", "Direction"], ["Emma", "Audit"], ["Farid", "Ops"], ["Gaëlle", "RH"], ["Hugo", "Juridique"], ["Inès", "Finance"]];
let COFFRE = null, COFFRE_T = null;
function coffreView(view) {
  view.innerHTML = `
    <h1>🔐 Sceller et desceller un coffre Vault</h1>
    <p class="sub">Un <b>vrai</b> serveur Vault rien que pour vous (le coffre du lab n'est pas touché). Cassez-le, fermez-le, rouvrez-le autant que vous voulez.</p>
    <div class="lgrid g2 coffregrid">
      <div class="box">
        <div class="row"><h3 style="margin:0">Mon coffre</h3><span class="spacer"></span><span class="tag" data-cst>…</span></div>
        <div class="vaultdoor" data-door>${doorSVG()}</div>
        <p class="small center" data-cmsg>Démarrage du coffre…</p>
        <div class="buttons is-centered" data-cbtns></div>
      </div>
      <div class="box">
        <h3>Le principe (Shamir)</h3>
        <ol class="small">
          <li><b>Chiffré au repos :</b> tout ce que Vault écrit sur disque est chiffré par une clé maître.</li>
          <li><b>Scellé (sealed) :</b> au démarrage Vault ne connaît PAS cette clé : il ne peut rien lire, rien déchiffrer. Il refuse tout.</li>
          <li><b>Partage de secret :</b> à l'initialisation, la clé est découpée en <b>N parts</b> (ici 5) ; il en faut <b>K</b> (ici 3) pour la reconstituer. Avec 2 parts, on n'apprend <i>rien</i>.</li>
          <li><b>Descellement (unseal) :</b> K personnes différentes donnent chacune leur part → Vault reconstruit la clé et s'ouvre.</li>
          <li><b>Sceller (seal) :</b> en cas d'attaque on referme le coffre d'un coup ; un redémarrage ou une panne le referme aussi.</li>
        </ol>
        <div class="defis small" data-cdefis></div>
      </div>
    </div>
    <h2>Les dépositaires des clés</h2>
    <div class="holders" data-holders><p class="muted small">Initialisez le coffre pour distribuer les clés.</p></div>
    <h2 class="row">En ligne de commande <span class="spacer"></span><span class="small muted">même coffre, commandes réelles</span></h2>
    <div class="box flat small">Essayez : <code>vault status</code> · <code>vault operator init -key-shares=5 -key-threshold=3</code> · <code>vault operator unseal</code> (la clé est demandée sans s'afficher) · <code>vault login &lt;jeton&gt;</code> puis <code>vault operator seal</code> · <code>coffre restart</code> (panne) · <code>coffre reset</code>.</div>
    <div class="termpage short" data-cslot></div>`;
  getTerm("coffre").mount($("[data-cslot]", view));
  coffreCall("GET", "");
  clearInterval(COFFRE_T);
  COFFRE_T = setInterval(() => { if (!document.hidden && location.hash === "#/coffre") coffreCall("GET", "", true); else if (location.hash !== "#/coffre") clearInterval(COFFRE_T); }, 4000);
}
function doorSVG() {
  return `<svg viewBox="0 0 220 220" role="img" aria-label="Porte du coffre">
    <rect x="10" y="10" width="200" height="200" rx="16" class="d-frame"/>
    <g class="d-door"><rect x="24" y="24" width="172" height="172" rx="10" class="d-plate"/>
      <circle cx="110" cy="110" r="46" class="d-ring"/>
      <g class="d-wheel">${[0, 60, 120].map((a) => `<rect x="106" y="58" width="8" height="104" rx="4" transform="rotate(${a} 110 110)" class="d-spoke"/>`).join("")}<circle cx="110" cy="110" r="12" class="d-hub"/></g>
      <g data-bolts></g></g>
    <text x="110" y="206" text-anchor="middle" class="d-lbl" data-dlbl></text></svg>`;
}
async function coffreCall(method, op, quiet, body) {
  try {
    const r = method === "GET" ? await api("/api/coffre") : await post(`/api/coffre/${op}`, body || {});
    COFFRE = r; renderCoffre(r.msg && !quiet ? r.msg : null);
  } catch (e) { if (!quiet) toast(e.message); const m = $("[data-cmsg]"); if (m) m.textContent = e.message; }
}
const CDEFIS = [["c-init", "Initialiser le coffre (5 clés, seuil 3)"], ["c-unseal", "L'ouvrir avec 3 clés"], ["c-seal", "Le sceller en urgence"], ["c-crash", "Survivre à une panne (redémarrage)"]];
let CDONE = {}; try { CDONE = JSON.parse(localStorage.getItem("cdefis") || "{}"); } catch {}
function cDefi(id) { if (CDONE[id]) return; CDONE[id] = 1; try { localStorage.setItem("cdefis", JSON.stringify(CDONE)); } catch {} pushScore("defi", id, 1, 1); toast("🏅 " + CDEFIS.find((d) => d[0] === id)[1]); }
function renderCoffre(msg) {
  const r = COFFRE, st = r?.status, view = $("#view"); if (!$("[data-door]", view)) return;
  const init = !!st?.initialized, sealed = st ? st.sealed : true, t = st?.t || 3, n = st?.n || 5, prog = st?.progress || 0;
  const state = !r?.running ? "arret" : !init ? "vierge" : sealed ? "scelle" : "ouvert";
  const lbl = { arret: "⏻ Arrêté", vierge: "🆕 Non initialisé", scelle: `🔒 Scellé · ${prog}/${t} clés`, ouvert: "🔓 Descellé (ouvert)" }[state];
  const cst = $("[data-cst]", view); cst.textContent = lbl; cst.className = `tag ${state === "ouvert" ? "ok" : state === "scelle" ? "ko" : ""}`;
  const door = $("[data-door]", view); door.dataset.state = state;
  $("[data-bolts]", door).innerHTML = Array.from({ length: t }, (_, i) => {
    const y = 60 + (i * 100) / Math.max(1, t - 1 || 1), on = state === "ouvert" || i < prog;
    return `<g class="d-bolt ${on ? "on" : ""}"><rect x="170" y="${t === 1 ? 104 : y - 6}" width="34" height="12" rx="3"/><circle cx="160" cy="${t === 1 ? 110 : y}" r="5"/></g>`;
  }).join("");
  $("[data-dlbl]", door).textContent = state === "ouvert" ? "OUVERT" : state === "scelle" ? `${prog} / ${t}` : "";
  if (state === "ouvert") { if (init) cDefi("c-unseal"); }
  if (init) cDefi("c-init");
  $("[data-cmsg]", view).innerHTML = msg ? esc(msg) : {
    arret: "Le coffre est arrêté.", vierge: "Coffre neuf : il faut l'initialiser (générer la clé maître et la découper).",
    scelle: `Il faut encore <b>${t - prog}</b> clé(s) différente(s) pour l'ouvrir.`, ouvert: "Le coffre peut lire ses données. Scellez-le pour tout bloquer d'un coup.",
  }[state];
  const B = (id, label, cls = "") => `<button class="button is-small ${cls}" data-cop="${id}">${label}</button>`;
  $("[data-cbtns]", view).innerHTML = {
    arret: B("start", "⏻ Démarrer", "is-primary"),
    vierge: `<label class="small">Parts <input type="number" min="1" max="10" value="5" data-csh class="input is-small" style="width:60px"></label>
             <label class="small">Seuil <input type="number" min="1" max="10" value="3" data-cth class="input is-small" style="width:60px"></label>${B("init", "🧩 Initialiser", "is-primary")}`,
    scelle: B("restart", "⚡ Simuler une panne") + B("reset", "🗑️ Tout effacer"),
    ouvert: B("seal", "🔒 Sceller maintenant", "is-danger") + B("restart", "⚡ Simuler une panne") + B("reset", "🗑️ Tout effacer"),
  }[state];
  $$("[data-cop]", view).forEach((b) => (b.onclick = async () => {
    const op = b.dataset.cop;
    if (op === "reset" && !confirm("Effacer ce coffre (données et clés) et repartir de zéro ?")) return;
    b.classList.add("is-loading");
    const body = op === "init" ? { shares: +$("[data-csh]", view).value, threshold: +$("[data-cth]", view).value } : {};
    const wasOpen = state === "ouvert";
    await coffreCall("POST", op, false, body);
    if (op === "seal") cDefi("c-seal");
    if (op === "restart" && wasOpen) cDefi("c-crash");
  }));
  // dépositaires
  const keys = r?.keys || [];
  const hz = $("[data-holders]", view);
  if (!init) hz.innerHTML = `<p class="muted small">Initialisez le coffre : chaque personne recevra une part de la clé maître.</p>`;
  else if (!keys.length) hz.innerHTML = `<p class="small">Coffre initialisé depuis le terminal : les clés n'ont pas été enregistrées ici. Collez-en une :</p>
      <div class="row"><input class="input is-small" data-ckey placeholder="clé d'ouverture (base64)" style="max-width:420px"><button class="button is-small is-primary" data-cpaste>🔑 Donner cette clé</button></div>`;
  else hz.innerHTML = `<div class="lgrid g5">${keys.map((k, i) => `<div class="box holder ${state === "ouvert" ? "done" : ""}">
      <div class="h-av">${HOLDERS[i % HOLDERS.length][0][0]}</div><b>${HOLDERS[i % HOLDERS.length][0]}</b><div class="small muted">${HOLDERS[i % HOLDERS.length][1]}</div>
      <code class="h-key" title="${esc(k)}">🔑 ${esc(k.slice(0, 6))}…${esc(k.slice(-4))}</code>
      <button class="button is-small" data-cidx="${i}" ${state !== "scelle" ? "disabled" : ""}>Donner sa clé</button></div>`).join("")}</div>
      ${r.root ? `<p class="small muted" style="margin-top:8px">Jeton root de votre coffre (pour <code>vault login</code> dans le terminal) : <code>${esc(r.root)}</code></p>` : ""}`;
  $$("[data-cidx]", hz).forEach((b) => (b.onclick = () => { b.classList.add("is-loading"); coffreCall("POST", "unseal", false, { index: +b.dataset.cidx }); }));
  const pb = $("[data-cpaste]", hz); if (pb) pb.onclick = () => coffreCall("POST", "unseal", false, { key: $("[data-ckey]", hz).value.trim() });
  $("[data-cdefis]", view).innerHTML = `<b>🎮 Défis</b> ${CDEFIS.map(([id, l]) => `<span class="defi ${CDONE[id] ? "done" : ""}">${CDONE[id] ? "✅" : "⬜"} ${esc(l)}</span>`).join("")}`;
}
document.addEventListener("labcmd", (e) => { if (e.detail.kind === "coffre" && location.hash === "#/coffre") setTimeout(() => coffreCall("GET", "", true), 400); });

// ================================================================ classement
async function classementView(view, adminMode) {
  view.innerHTML = `<h1>🏆 Classement</h1><p class="sub">Chargement…</p>`;
  let d;
  try { d = await api("/api/dashboard" + (adminMode && adminMode !== true ? `?ecole=${encodeURIComponent(adminMode)}` : "")); }
  catch (e) { view.innerHTML = `<h1>🏆 Classement</h1><p class="notification is-danger is-light">${esc(e.message)}</p>`; return; }
  const rows = d.rows, n = rows.length;
  const avg = n ? Math.round(rows.reduce((a, r) => a + r.total, 0) / n) : 0;
  const quizMax = (q) => rows.reduce((m, r) => Math.max(m, r.quiz?.[q.id]?.max || 0), 0);
  const cell = (p) => p ? `<span class="${p.points === p.max ? "n good" : ""}">${p.points}/${p.max}</span>${p.tries > 1 ? `<span class="muted small"> ·${p.tries}×</span>` : ""}` : `<span class="muted">—</span>`;
  const mine = rows.find((r) => r.me);
  view.innerHTML = `
    <div class="row"><div><h1>🏆 Classement ${d.admin ? "de la classe" : "— " + esc(d.ecole)}</h1>
      <p class="sub" style="margin:0">Quiz des cours (${d.quizPtsPerAnswer} pts par bonne réponse) + points des TP en mode expert.</p></div><span class="spacer"></span>
      ${d.admin ? `<div class="select is-small"><select data-school><option value="">Toutes les écoles</option>${Object.entries(d.schools || {}).sort().map(([s, c]) => `<option ${s === d.ecole ? "selected" : ""} value="${esc(s)}">${esc(s)} (${c})</option>`).join("")}</select></div>
        <a class="button is-small" href="#/formateur">🧑‍🏫 Espace formateur</a>` : ""}</div>
    <div class="lgrid g4 kpis">
      <div class="box kpi"><div class="kpi-l">Étudiants</div><div class="kpi-v">${n}</div></div>
      <div class="box kpi"><div class="kpi-l">Total moyen</div><div class="kpi-v">${avg}</div></div>
      <div class="box kpi"><div class="kpi-l">Meilleur total</div><div class="kpi-v">${n ? rows[0].total : 0}</div><div class="small muted">${n ? esc(rows[0].name) : ""}</div></div>
      <div class="box kpi"><div class="kpi-l">${mine ? "Mon rang" : "Quiz terminés"}</div><div class="kpi-v">${mine ? `${rows.indexOf(mine) + 1}<span class="muted" style="font-size:1rem"> / ${n}</span>` : rows.reduce((a, r) => a + Object.keys(r.quiz || {}).length, 0)}</div></div>
    </div>
    <div class="tablewrap"><table class="table is-fullwidth is-hoverable acc rank"><thead><tr><th>#</th><th>Étudiant</th>${d.admin ? "<th>École</th>" : ""}
      ${d.quizzes.map((q) => `<th class="num">Quiz ${esc(q.title)}</th>`).join("")}<th class="num">Quiz (pts)</th>
      ${d.tps.map((t) => `<th class="num">${t.id.toUpperCase()}</th>`).join("")}<th class="num">Défis</th><th class="num">Total</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${r.me ? "me" : ""}"><td>${i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</td><td><b>${esc(r.name)}</b>${r.me ? ' <span class="tag ok">moi</span>' : ""}</td>${d.admin ? `<td>${esc(r.ecole)}</td>` : ""}
        ${d.quizzes.map((q) => `<td class="num">${cell(r.quiz?.[q.id])}</td>`).join("")}<td class="num">${r.quizPts}</td>
        ${d.tps.map((t) => `<td class="num">${r.tp?.[t.id] || 0}<span class="muted small">/${t.max}</span></td>`).join("")}<td class="num">${r.defis}</td><td class="num"><b>${r.total}</b></td></tr>`).join("") || `<tr><td colspan="20" class="muted">Personne n'a encore de score.</td></tr>`}
    </tbody></table></div>
    ${d.admin ? `<div class="row" style="margin-top:10px"><span class="spacer"></span><button class="button is-small" data-csv>⬇️ Exporter en CSV</button></div>` : `<p class="small muted">Vous ne voyez que les étudiants de votre école.</p>`}`;
  $("[data-school]", view)?.addEventListener("change", (e) => classementView(view, e.target.value || true));
  $("[data-csv]", view)?.addEventListener("click", () => {
    const head = ["rang", "nom", "ecole", ...d.quizzes.map((q) => "quiz_" + q.id), "quiz_pts", ...d.tps.map((t) => t.id), "defis", "total"];
    const lines = rows.map((r, i) => [i + 1, r.name, r.ecole, ...d.quizzes.map((q) => r.quiz?.[q.id] ? `${r.quiz[q.id].points}/${r.quiz[q.id].max}` : ""), r.quizPts, ...d.tps.map((t) => r.tp?.[t.id] || 0), r.defis, r.total]);
    const csv = [head, ...lines].map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = "classement-datacorp.csv"; a.click();
  });
}

// ================================================================ feedback
const SUJETS = [["general", "Le projet en général"], ["tp1", "TP1 · Secrets et chiffrement"], ["tp2", "TP2 · Droits et anonymisation"], ["tp3", "TP3 · Audit et preuves"], ["cours", "Les cours"], ["console", "La console / le terminal"]];
async function feedbackView(view) {
  let note = 0;
  view.innerHTML = `
    <h1>💬 Votre avis</h1>
    <p class="sub">Notez le projet et dites ce qu'il faut améliorer. Le formateur lit tous les avis (résumé envoyé chaque soir).</p>
    <div class="box fbform">
      <label class="label">Votre note</label>
      <div class="stars" data-stars>${[1, 2, 3, 4, 5].map((i) => `<button type="button" data-star="${i}" aria-label="${i} sur 5">★</button>`).join("")}<span class="small muted" data-starlbl>cliquez une étoile</span></div>
      <div class="field"><label class="label" for="fbSujet">Sur quoi ?</label><div class="select"><select id="fbSujet">${SUJETS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select></div></div>
      <div class="field"><label class="label" for="fbAime">👍 Ce que vous avez aimé</label><textarea class="textarea" id="fbAime" rows="2" maxlength="2000"></textarea></div>
      <div class="field"><label class="label" for="fbAm">🔧 Ce qu'il faut améliorer (TP peu clair, bug, trop long…)</label><textarea class="textarea" id="fbAm" rows="3" maxlength="2000"></textarea></div>
      <div class="field"><label class="label" for="fbId">💡 Idées : que faudrait-il ajouter ou faire autrement ?</label><textarea class="textarea" id="fbId" rows="2" maxlength="2000"></textarea></div>
      <button class="button is-primary" data-fbsend>Envoyer mon avis</button>
    </div>
    <h2>Mes avis envoyés</h2><div data-fbmine class="small muted">…</div>`;
  const labels = ["", "😞 Décevant", "😕 Bof", "🙂 Correct", "😀 Bien", "🤩 Excellent"];
  const paint = (k) => $$("[data-star]", view).forEach((b) => b.classList.toggle("on", +b.dataset.star <= k));
  $$("[data-star]", view).forEach((b) => {
    b.onclick = () => { note = +b.dataset.star; paint(note); $("[data-starlbl]", view).textContent = `${note}/5 · ${labels[note]}`; };
    b.onmouseenter = () => paint(+b.dataset.star); b.onmouseleave = () => paint(note);
  });
  $("[data-fbsend]", view).onclick = async () => {
    if (!note) { toast("Choisissez d'abord une note (1 à 5 étoiles)"); return; }
    try {
      await post("/api/feedback", { note, sujet: $("#fbSujet").value, aime: $("#fbAime").value, ameliorer: $("#fbAm").value, idees: $("#fbId").value });
      toast("Merci pour votre avis 🙏"); feedbackView(view);
    } catch (e) { toast(e.message); }
  };
  const d = await api("/api/feedback").catch(() => ({ items: [] }));
  $("[data-fbmine]", view).innerHTML = d.items.length ? d.items.map(fbCard).join("") : "Aucun avis envoyé pour l'instant.";
}
function fbCard(f) {
  const sj = Object.fromEntries(SUJETS)[f.sujet] || f.sujet;
  return `<div class="box flat fbcard"><div class="row"><span class="stars-ro">${"★".repeat(f.note)}<span class="muted">${"★".repeat(5 - f.note)}</span></span>
    <b>${esc(sj)}</b><span class="spacer"></span><span class="small muted">${f.name ? esc(f.name) + " · " + esc(f.ecole) + " · " : ""}${new Date(f.at).toLocaleString("fr-FR")}</span></div>
    ${f.aime ? `<p class="small">👍 ${esc(f.aime)}</p>` : ""}${f.ameliorer ? `<p class="small">🔧 ${esc(f.ameliorer)}</p>` : ""}${f.idees ? `<p class="small">💡 ${esc(f.idees)}</p>` : ""}</div>`;
}

// ================================================================ espace formateur
async function formateurView(view) {
  const d = await api("/api/feedback").catch(() => ({ admin: false, items: [] }));
  if (!d.admin) {
    view.innerHTML = `<h1>🧑‍🏫 Espace formateur</h1><p class="sub">Classement de toutes les écoles, avis des étudiants et envoi du résumé par mail.</p>
      <form class="box" style="max-width:380px" data-alogin>
        <div class="field"><label class="label" for="aU">Nom d'utilisateur</label><input class="input" id="aU" autocomplete="username" required></div>
        <div class="field"><label class="label" for="aP">Mot de passe</label><input class="input" id="aP" type="password" autocomplete="current-password" required></div>
        <button class="button is-primary" type="submit">Se connecter</button></form>`;
    $("[data-alogin]", view).onsubmit = async (e) => {
      e.preventDefault();
      try { await post("/api/admin/login", { user: $("#aU").value, pass: $("#aP").value }); formateurView(view); } catch (err) { toast(err.message); }
    };
    return;
  }
  const items = d.items, n = items.length, avg = n ? (items.reduce((a, f) => a + f.note, 0) / n).toFixed(1) : "–";
  const dist = [5, 4, 3, 2, 1].map((k) => [k, items.filter((f) => f.note === k).length]);
  const m = d.mail || {};
  view.innerHTML = `
    <div class="row"><h1>🧑‍🏫 Espace formateur</h1><span class="spacer"></span><a class="button is-small" href="#/classement">🏆 Classement complet</a><button class="button is-small" data-alogout>Se déconnecter</button></div>
    <div class="lgrid g3 kpis">
      <div class="box kpi"><div class="kpi-l">Avis reçus</div><div class="kpi-v">${n}</div></div>
      <div class="box kpi"><div class="kpi-l">Note moyenne</div><div class="kpi-v">${avg}<span class="muted" style="font-size:1rem"> / 5</span></div></div>
      <div class="box kpi"><div class="kpi-l">Répartition</div>${dist.map(([k, c]) => `<div class="distrow"><span>${k}★</span><div class="pbar"><i style="width:${n ? (100 * c) / n : 0}%"></i></div><span class="small">${c}</span></div>`).join("")}</div>
    </div>
    <details class="fold" ${d.mailReady ? "" : "open"}><summary>✉️ Résumé quotidien par mail ${d.mailReady ? `<span class="tag ok">actif · ${m.hour} h</span>` : `<span class="tag ko">à configurer</span>`}</summary>
      <div class="foldbody"><p class="small">Gratuit avec Gmail : activez la validation en 2 étapes, puis créez un <b>mot de passe d'application</b> sur <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com/apppasswords</a> (16 lettres). Chaque jour à l'heure choisie, les nouveaux avis sont envoyés en un seul mail « Feedback ${esc(m.project || "")} — date ».</p>
      <div class="lgrid g2">
        <div class="field"><label class="label small">Compte d'envoi (Gmail)</label><input class="input is-small" data-m="user" value="${esc(m.user || "")}" placeholder="vous@gmail.com"></div>
        <div class="field"><label class="label small">Mot de passe d'application ${d.mailReady ? "(laisser vide = inchangé)" : ""}</label><input class="input is-small" type="password" data-m="pass" placeholder="xxxx xxxx xxxx xxxx"></div>
        <div class="field"><label class="label small">Destinataire(s)</label><input class="input is-small" data-m="to" value="${esc(m.to || "")}" placeholder="vous@gmail.com"></div>
        <div class="field"><label class="label small">Nom du projet (objet du mail)</label><input class="input is-small" data-m="project" value="${esc(m.project || "")}"></div>
        <div class="field"><label class="label small">Heure d'envoi (Paris)</label><input class="input is-small" type="number" min="0" max="23" data-m="hour" value="${m.hour ?? 19}"></div>
        <div class="field"><label class="label small">Serveur SMTP</label><input class="input is-small" data-m="host" value="${esc(m.host || "smtp.gmail.com")}"></div>
      </div>
      <div class="buttons"><button class="button is-primary is-small" data-msave>Enregistrer</button><button class="button is-small" data-mtest>✉️ Envoyer un test maintenant</button>
        <a class="button is-small" href="/api/admin/digest" target="_blank" rel="noopener">👁️ Aperçu du résumé</a></div></div></details>
    <h2>Tous les avis</h2>
    <div class="row" style="margin-bottom:8px"><div class="select is-small"><select data-fsuj><option value="">Tous les sujets</option>${SUJETS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select></div></div>
    <div data-flist>${items.map(fbCard).join("") || `<p class="muted">Aucun avis pour l'instant.</p>`}</div>`;
  $("[data-alogout]", view).onclick = async () => { await post("/api/admin/logout"); formateurView(view); };
  $("[data-fsuj]", view).onchange = (e) => { $("[data-flist]", view).innerHTML = items.filter((f) => !e.target.value || f.sujet === e.target.value).map(fbCard).join("") || `<p class="muted">Aucun avis.</p>`; };
  const conf = () => Object.fromEntries($$("[data-m]", view).map((i) => [i.dataset.m, i.dataset.m === "hour" ? +i.value : i.value]));
  $("[data-msave]", view).onclick = async () => { try { await post("/api/admin/mail", conf()); toast("Réglages enregistrés"); formateurView(view); } catch (e) { toast(e.message); } };
  $("[data-mtest]", view).onclick = async (e) => {
    e.target.classList.add("is-loading");
    try { await post("/api/admin/mail", conf()); const r = await post("/api/admin/mail/test"); toast(`Mail de test envoyé (${r.count} avis)`); } catch (err) { toast("Échec : " + err.message); }
    e.target.classList.remove("is-loading");
  };
}

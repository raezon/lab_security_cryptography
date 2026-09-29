// Captures d'écran des cours (Vault, MinIO, RabbitMQ) pour la console.
// Lancé par scripts/captures-cours.sh — les identifiants arrivent par variables
// d'environnement et ne sont jamais écrits. Les zones importantes sont encadrées
// en orange avant chaque capture. Sortie : webapp/static/cours/*.png
const { chromium } = require("playwright");
const D = process.env.DOMAIN;
const V = `https://vault.${D}`, M = `https://minio.${D}`, R = `https://rabbitmq.${D}`;
const OUT = "/out";

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 820 }, ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  const ok = [], ko = [];

  // Encadre les éléments dont le texte correspond (repères visuels sur la capture).
  async function mark(texts) {
    for (const t of texts) {
      try {
        const box = await p.getByText(t, { exact: false }).first().boundingBox({ timeout: 2500 });
        if (!box) continue;
        await p.evaluate(([x, y, w, h]) => {
          const d = document.createElement("div");
          d.className = "__mark";
          Object.assign(d.style, { position: "fixed", left: x - 5 + "px", top: y - 4 + "px", width: w + 10 + "px", height: h + 8 + "px",
            border: "3px solid #f97316", borderRadius: "8px", zIndex: 99999, pointerEvents: "none", boxShadow: "0 0 0 4px #f9731633" });
          document.body.append(d);
        }, [box.x, box.y, box.width, box.height]);
      } catch {}
    }
  }
  async function shot(name, url, texts = [], before) {
    try {
      if (url) await p.goto(url, { waitUntil: "networkidle", timeout: 25000 }).catch(() => {});
      await p.waitForTimeout(2000);
      if (before) await before();
      await p.evaluate(() => document.querySelectorAll(".__mark").forEach((e) => e.remove()));
      await mark(texts);
      await p.screenshot({ path: `${OUT}/${name}` });
      ok.push(name);
    } catch (e) { ko.push(`${name} : ${e.message.split("\n")[0]}`); }
  }

  // ---------------- Vault
  await shot("vault-1-connexion.png", `${V}/ui/vault/auth?with=token`, ["Token", "Sign in"]);
  await p.locator('input[name="token"], #token').first().fill(process.env.VTOKEN).catch(() => {});
  await p.locator('button[type="submit"]').first().click().catch(() => {});
  await p.waitForTimeout(2500);
  await shot("vault-2-moteurs.png", `${V}/ui/vault/secrets`, ["transit/", "kv/", "database/", "rabbitmq/"]);
  await shot("vault-3-cle-transit.png", `${V}/ui/vault/secrets/transit/show/datacorp-pii`, ["aes256-gcm96", "Details"]);
  await shot("vault-4-versions.png", `${V}/ui/vault/secrets/transit/show/datacorp-pii?tab=versions`, ["Rotate encryption key", "Versions"]);
  await shot("vault-5-chiffrer.png", `${V}/ui/vault/secrets/transit/actions/datacorp-pii?action=encrypt`, ["Encrypt", "Plaintext"],
    async () => { await p.locator("textarea, .CodeMirror").first().click().catch(() => {}); await p.keyboard.type("FR7630001007941234567890185").catch(() => {}); });
  await shot("vault-6-kv.png", `${V}/ui/vault/secrets/kv/kv/list`, ["datacorp/"]);
  await shot("vault-7-politiques.png", `${V}/ui/vault/policies/acl`, ["finance-app", "ingest-pipeline"]);

  // ---------------- MinIO
  await shot("minio-1-connexion.png", `${M}/login`, ["Login"]);
  await p.locator("#accessKey").fill(process.env.MUSER).catch(() => {});
  await p.locator("#secretKey").fill(process.env.MPASS).catch(() => {});
  await p.locator('button[type="submit"]').first().click().catch(() => {});
  await p.waitForTimeout(3000);
  await shot("minio-2-buckets.png", `${M}/browser`, ["raw-data", "demo-chiffre"]);
  await shot("minio-3-objets.png", `${M}/browser/raw-data/dHJhbnNhY3Rpb25zLw==`, ["transactions"]);
  await shot("minio-4-objet-detail.png", null, ["Encryption", "AES256"], async () => {
    await p.getByText(".json").first().click().catch(() => {}); await p.waitForTimeout(2000);
  });
  await shot("minio-5-bucket-reglages.png", `${M}/buckets/raw-data/admin/summary`, ["Encryption", "Versioning"]);
  await shot("minio-6-politiques.png", `${M}/policies`, ["data-analyst", "ingest-writer"]);

  // ---------------- RabbitMQ
  await shot("rabbitmq-1-connexion.png", `${R}/`, ["Username", "Login"]);
  await p.locator('input[name="username"]').fill(process.env.RUSER).catch(() => {});
  await p.locator('input[name="password"]').fill(process.env.RPASS).catch(() => {});
  await p.locator('input[type="submit"], button[type="submit"]').first().click().catch(() => {});
  await p.waitForTimeout(3000);
  await shot("rabbitmq-2-apercu.png", `${R}/#/`, ["Ports and contexts", "amqp/ssl"], async () => {
    await p.getByText("Ports and contexts").first().scrollIntoViewIfNeeded().catch(() => {});
  });
  await shot("rabbitmq-3-connexions.png", `${R}/#/connections`, ["SSL / TLS", "Connections"]);
  await shot("rabbitmq-4-files.png", `${R}/#/queues`, ["ingest.transactions", "Ready", "Unacked"]);
  await shot("rabbitmq-5-message.png", `${R}/#/queues/%2F/ingest.transactions`, ["Get messages", "Payload"], async () => {
    await p.getByText("Get messages").first().click().catch(() => {});
    await p.locator('select[name="ackmode"]').selectOption("ack_requeue_true").catch(() => {});
    await p.locator('input[value="Get Message(s)"]').click().catch(() => {});
    await p.waitForTimeout(1500);
    await p.getByText("Payload").first().scrollIntoViewIfNeeded().catch(() => {});
  });
  await shot("rabbitmq-6-utilisateurs.png", `${R}/#/users`, ["Users"]);

  console.log(`captures réussies (${ok.length}) : ${ok.join(", ")}`);
  if (ko.length) console.log(`échecs : \n  ${ko.join("\n  ")}`);
  await b.close();
})();

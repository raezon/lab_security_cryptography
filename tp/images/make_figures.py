#!/usr/bin/env python3
"""Génère les illustrations des TP (PNG) — python3 make_figures.py"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

OUT = os.path.dirname(os.path.abspath(__file__))
P, D, T, L = "#5B5B79", "#44445A", "#202122", "#EEEEEE"
VERT, JAUNE, ORANGE, ROUGE, BLEU = "#3E9B6B", "#E9C46A", "#E07A3F", "#C0392B", "#3A6EA5"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11})


def canvas(w, h):
    fig, ax = plt.subplots(figsize=(w, h))
    ax.set_xlim(0, w * 10); ax.set_ylim(0, h * 10); ax.axis("off")
    return fig, ax


def box(ax, x, y, w, h, title, sub=None, fc=L, ec=P, tc=T, fs=11, bold=True):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.4,rounding_size=1.2",
                                fc=fc, ec=ec, lw=1.6))
    if sub:
        ax.text(x + w / 2, y + h * 0.66, title, ha="center", va="center", fontsize=fs,
                fontweight="bold" if bold else "normal", color=tc)
        ax.text(x + w / 2, y + h * 0.30, sub, ha="center", va="center", fontsize=fs - 2.5, color=tc,
                linespacing=1.25)
    else:
        ax.text(x + w / 2, y + h / 2, title, ha="center", va="center", fontsize=fs,
                fontweight="bold" if bold else "normal", color=tc, linespacing=1.25)


def arrow(ax, x1, y1, x2, y2, label=None, color=D, style="-|>", ls="-", lw=1.6, fs=9, off=(0, 1.6), rad=0):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=style, mutation_scale=14, color=color,
                                 lw=lw, linestyle=ls, connectionstyle=f"arc3,rad={rad}"))
    if label:
        ax.text((x1 + x2) / 2 + off[0], (y1 + y2) / 2 + off[1], label, ha="center", va="bottom",
                fontsize=fs, color=color)


def save(fig, name):
    fig.savefig(os.path.join(OUT, name), dpi=170, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("écrit", name)


# ---------------------------------------------------------------------------- architecture
def architecture():
    fig, ax = canvas(11, 5.2)
    ax.text(55, 50, "DataCorp Secure : le pipeline de données du lab", ha="center", fontsize=14,
            fontweight="bold", color=P)
    box(ax, 2, 28, 16, 10, "Producteur", "plateforme\nde paiement")
    box(ax, 26, 28, 16, 10, "RabbitMQ", "file d'attente\ningest.transactions", fc="#E3E3EE")
    box(ax, 49, 28, 18, 10, "Consommateur", "pipeline\nd'ingestion", fs=10.5)
    box(ax, 80, 38, 24, 9, "PostgreSQL", "données RH & finance", fc="#DDE7F3", ec=BLEU)
    box(ax, 80, 22, 24, 9, "MinIO (S3)", "lots bruts archivés", fc="#DDE7F3", ec=BLEU)
    box(ax, 44, 4, 28, 10, "HashiCorp Vault", "coffre-fort : clés + mots de passe", fc="#F6E7C8", ec=ORANGE)
    box(ax, 80, 4, 24, 9, "Collecteur d'audit", "SIEM simulé", fc="#E6F2EA", ec=VERT)
    arrow(ax, 18.5, 33, 25.5, 33, "TLS")
    arrow(ax, 42.5, 33, 49.5, 33, "TLS")
    arrow(ax, 66.5, 35, 79.5, 42, "TLS", off=(-2, 1))
    arrow(ax, 66.5, 31, 79.5, 27, "TLS", off=(-2, -4))
    arrow(ax, 58, 27.5, 58, 14.5, "mots de passe\ntemporaires", color=ORANGE, style="<|-|>", off=(8, -3))
    arrow(ax, 92, 21.5, 92, 13.5, "journaux", color=VERT, off=(5, -2))
    ax.text(2, 18, "Toolbox = votre poste de travail\n(psql, vault, mc, jq)", fontsize=10, color=D,
            style="italic")
    save(fig, "fig_architecture.png")


# ---------------------------------------------------------------------------- méthode GRC
def methode_grc():
    fig, ax = canvas(11, 3.6)
    ax.text(55, 34, "La méthode GRC en 4 étapes (utilisée dans les 3 TP)", ha="center", fontsize=14,
            fontweight="bold", color=P)
    etapes = [("1. IDENTIFIER", "Quelle donnée ?\nQuelle sensibilité ?\nQui y accède ?", BLEU),
              ("2. ÉVALUER", "Quel scénario ?\nVraisemblance × Impact\n= criticité", ORANGE),
              ("3. TRAITER", "Quelle mesure ?\nQuel article / contrôle\nla justifie ?", VERT),
              ("4. PROUVER", "Quelle preuve ?\n(commande, log, capture)\nQui vérifie, quand ?", P)]
    x = 2
    for i, (t, s, c) in enumerate(etapes):
        box(ax, x, 8, 22, 19, t, s, fc="white", ec=c, tc=T, fs=12)
        ax.add_patch(FancyBboxPatch((x, 24.5), 22, 2.5, boxstyle="square,pad=0", fc=c, ec=c))
        if i < 3:
            arrow(ax, x + 22.8, 17.5, x + 26.2, 17.5)
        x += 27.5
    arrow(ax, 94, 6.8, 13, 6.8, color=D, ls="--", lw=1.2)
    ax.text(55, 2.5, "on recommence à chaque changement : nouveau projet, incident, audit annuel", ha="center",
            fontsize=10, color=D, style="italic")
    save(fig, "fig_grc_methode.png")


# ---------------------------------------------------------------------------- matrice de risques
def matrice(name, points, titre):
    fig, ax = plt.subplots(figsize=(6.2, 5))
    for v in range(1, 5):
        for i in range(1, 5):
            c = v * i
            col = VERT if c <= 3 else JAUNE if c <= 6 else ORANGE if c <= 9 else ROUGE
            ax.add_patch(plt.Rectangle((i - 0.5, v - 0.5), 1, 1, fc=col, ec="white", lw=2, alpha=0.85))
            ax.text(i + 0.33, v - 0.33, str(c), fontsize=8, color="white", ha="center", va="center")
    for (lab, i, v, col) in points:
        ax.text(i, v, lab, ha="center", va="center", fontsize=10, fontweight="bold", color=col,
                bbox=dict(boxstyle="round,pad=0.35", fc="white", ec=col, lw=2.2))
    for (a, b) in [(points[k], points[k + 1]) for k in range(0, len(points) - 1, 2)]:
        ax.annotate("", xy=(b[1], b[2]), xytext=(a[1], a[2]),
                    arrowprops=dict(arrowstyle="-|>", lw=2, color=T, shrinkA=18, shrinkB=18))
    ax.set_xlim(0.5, 4.5); ax.set_ylim(0.5, 4.5)
    ax.set_xticks([1, 2, 3, 4], ["1\nfaible", "2\nmoyen", "3\nfort", "4\ncritique"])
    ax.set_yticks([1, 2, 3, 4], ["1 rare", "2 possible", "3 probable", "4 quasi sûr"])
    ax.set_xlabel("IMPACT (gravité pour l'entreprise et les personnes)", fontsize=10, color=D)
    ax.set_ylabel("VRAISEMBLANCE", fontsize=10, color=D)
    ax.set_title(titre, fontsize=12, fontweight="bold", color=P)
    for s in ax.spines.values(): s.set_visible(False)
    save(fig, name)


# ---------------------------------------------------------------------------- TP1
def tp1_etats():
    fig, ax = canvas(11, 3.8)
    ax.text(55, 35, "Les 3 états de la donnée… et ce qui la protège", ha="center", fontsize=14,
            fontweight="bold", color=P)
    data = [("AU REPOS", "stockée sur un disque,\nune sauvegarde, un bucket", "Menace : vol du disque\nou de la sauvegarde",
             "Protection : chiffrement\n(Vault transit, SSE-S3)", BLEU),
            ("EN TRANSIT", "qui circule sur le réseau", "Menace : écoute,\nhomme du milieu",
             "Protection : TLS vérifié\n(sslmode=verify-full)", VERT),
            ("EN USAGE", "en mémoire, pendant\nle calcul", "Menace : admin ou\nhyperviseur malveillant",
             "Protection : enclaves\n(Confidential Computing)", ORANGE)]
    x = 2
    for t, d, m, p, c in data:
        ax.add_patch(FancyBboxPatch((x, 2), 32, 28, boxstyle="round,pad=0.4,rounding_size=1.5", fc="white", ec=c, lw=2))
        ax.add_patch(FancyBboxPatch((x, 25), 32, 5, boxstyle="round,pad=0.4,rounding_size=1.5", fc=c, ec=c))
        ax.text(x + 16, 27.5, t, ha="center", va="center", color="white", fontweight="bold", fontsize=12)
        ax.text(x + 16, 20.5, d, ha="center", va="center", fontsize=10, color=T)
        ax.text(x + 16, 13, m, ha="center", va="center", fontsize=9.5, color=ROUGE)
        ax.text(x + 16, 6, p, ha="center", va="center", fontsize=9.5, color=T, fontweight="bold")
        x += 36
    ax.text(83, -1.5, "hors lab : notion de cours", ha="center", fontsize=8.5, color=D, style="italic")
    save(fig, "fig_tp1_etats.png")


def tp1_secret():
    fig, ax = canvas(11, 5.6)
    ax.text(55, 54, "Avant / après : du mot de passe en dur au mot de passe temporaire", ha="center",
            fontsize=13.5, fontweight="bold", color=P)
    # Avant
    ax.text(14, 47, "AVANT (2019)", ha="center", fontsize=11, fontweight="bold", color=ROUGE)
    box(ax, 2, 30, 24, 12, "ingest_legacy.sh", 'DB_PASS="DataCorp2019!"\nmême mot de passe\npour tous, depuis 2019',
        fc="#F8E1DE", ec=ROUGE)
    box(ax, 2, 8, 24, 10, "PostgreSQL", "compte legacy_etl\ntous les droits", fc="#F8E1DE", ec=ROUGE)
    arrow(ax, 14, 29.5, 14, 18.5, "connexion", color=ROUGE, off=(6, -2))
    ax.plot([33, 33], [3, 49], color="#BBBBBB", lw=1, ls=":")
    # Après
    ax.text(72, 47, "APRÈS (TP1)", ha="center", fontsize=11, fontweight="bold", color=VERT)
    xs = {"pipe": 42, "vault": 67, "pg": 92}
    for k, lab in [("pipe", "Pipeline"), ("vault", "Vault"), ("pg", "PostgreSQL")]:
        box(ax, xs[k] - 8, 38, 16, 6, lab, fc={"vault": "#F6E7C8"}.get(k, "#DDE7F3"),
            ec={"vault": ORANGE}.get(k, BLEU))
        ax.plot([xs[k], xs[k]], [4, 37.5], color="#AAAAAA", lw=1, ls="--")
    steps = [(34, "pipe", "vault", "① « je suis le pipeline » (AppRole)"),
             (29, "vault", "pg", "② CREATE ROLE v-approle-… VALID 1h"),
             (24, "vault", "pipe", "③ identifiant + mot de passe (1 h)"),
             (19, "pipe", "pg", "④ INSERT des transactions (TLS)"),
             (13, "pipe", "vault", "⑤ « j'ai fini » : révocation"),
             (8, "vault", "pg", "⑥ DROP ROLE : le compte disparaît")]
    for y, a, b, t in steps:
        arrow(ax, xs[a] + (0.5 if xs[b] > xs[a] else -0.5), y, xs[b] - (0.5 if xs[b] > xs[a] else -0.5), y, t,
              color=VERT if "④" in t else D, fs=8.8, off=(0, 0.6))
    save(fig, "fig_tp1_secret_dynamique.png")


# ---------------------------------------------------------------------------- TP2
def tp2_rbac():
    fig, ax = canvas(11, 5.4)
    ax.text(55, 52, "RBAC : on donne les droits à des RÔLES, puis les rôles à des PERSONNES", ha="center",
            fontsize=13, fontweight="bold", color=P)
    ax.text(12, 46, "PERSONNES (LOGIN)", ha="center", fontsize=10, fontweight="bold", color=D)
    ax.text(50, 46, "RÔLES FONCTIONNELS (NOLOGIN)", ha="center", fontsize=10, fontweight="bold", color=D)
    ax.text(92, 46, "DONNÉES", ha="center", fontsize=10, fontweight="bold", color=D)
    pers = [("Alice · Data Engineer", 38), ("Bruno · Analyste", 29), ("Claire · DPO", 20), ("Nadia · Manager RH", 11), ("David · SysAdmin", 2)]
    roles = [("r_data_engineer", 38), ("r_data_analyst", 29), ("r_dpo", 20), ("r_rh_manager", 11), ("r_sysadmin", 2)]
    objs = [("rh.employes", "Alice : sans NIR ni IBAN\nNadia : son département (RLS)", 32, ROUGE),
            ("analytics.v_*", "vues masquées\n(après validation DPO)", 21, VERT),
            ("gouvernance.*", "registre RGPD,\nvalidations DPO", 10, BLEU),
            ("statistiques", "d'exploitation\n(aucune donnée métier)", 0, D)]
    for t, y in pers: box(ax, 1, y, 22, 6, t, fs=9.5, bold=False, fc="white")
    for t, y in roles: box(ax, 39, y, 22, 6, t, fs=10, fc="#E3E3EE")
    for t, sub, y, c in objs: box(ax, 78, y, 27, 9, t, sub, fs=10.5, fc="white", ec=c)
    for (_, y1), (_, y2) in zip(pers, roles): arrow(ax, 23.5, y1 + 3, 38.5, y2 + 3)
    links = [(41, 38, ROUGE), (41, 25, VERT), (32, 25.5, VERT), (23, 14.5, BLEU), (23, 26, VERT), (14, 35, ROUGE), (5, 4.5, D)]
    for y1, y2, c in links:
        arrow(ax, 61.5, y1, 77.5, y2, color=c)
    save(fig, "fig_tp2_rbac.png")


def tp2_masquage():
    fig, ax = canvas(11, 4.2)
    ax.text(55, 40, "Ce que voit l'analyste : avant / après la vue masquée", ha="center", fontsize=13.5,
            fontweight="bold", color=P)
    cols = ["matricule", "nom", "email", "NIR", "naissance", "salaire"]
    avant = ["DC00042", "MARTIN", "karim.martin42@…", "190105041228538", "22/10/1990", "88 400 €"]
    apres = ["58e94559…", "—", "k***@datacorp…", "—", "30-39 ans", "80-90 k€"]
    techn = ["HMAC\n(pseudonyme)", "supprimé", "masqué", "supprimé", "généralisé", "généralisé"]
    w = 17
    for j, c in enumerate(cols):
        x = 4 + j * w
        box(ax, x, 29, w - 1, 5, c, fs=9.5, fc=P, ec=P, tc="white")
        box(ax, x, 21, w - 1, 5, avant[j], fs=8.8, bold=False, fc="#F8E1DE", ec=ROUGE)
        box(ax, x, 8, w - 1, 5, apres[j], fs=8.8, bold=False, fc="#E6F2EA", ec=VERT)
        ax.text(x + w / 2 - 0.5, 16.8, techn[j], ha="center", va="center", fontsize=8, color=D, style="italic")
        arrow(ax, x + w / 2 - 0.5, 20.3, x + w / 2 - 0.5, 13.7, color="#999999", lw=1)
    ax.text(2, 23.5, "table\nbrute", ha="right", va="center", fontsize=9, color=ROUGE, fontweight="bold")
    ax.text(2, 10.5, "vue\nanalytics", ha="right", va="center", fontsize=9, color=VERT, fontweight="bold")
    ax.text(55, 2, "Pseudonymisé ≠ anonyme : la personne reste ré-identifiable si l'on croise assez de colonnes.",
            ha="center", fontsize=9.5, color=ROUGE)
    save(fig, "fig_tp2_masquage.png")


def tp2_cycle():
    fig, ax = canvas(11, 3.4)
    ax.text(55, 31, "Cycle de vie d'une habilitation (qui demande, qui valide, qui retire)", ha="center",
            fontsize=13, fontweight="bold", color=P)
    et = [("DEMANDE", "le manager\nexprime le besoin"), ("VALIDATION", "propriétaire de la\ndonnée + DPO"),
          ("ATTRIBUTION", "l'admin ajoute\nle RÔLE (pas les droits)"), ("REVUE", "tous les 6-12 mois :\ntoujours utile ?"),
          ("RETRAIT", "départ, mobilité,\nfin de mission")]
    x = 1
    for i, (t, s) in enumerate(et):
        box(ax, x, 5, 19, 18, t, s, fc="white", ec=[BLEU, ORANGE, VERT, P, ROUGE][i], fs=11)
        if i < 4: arrow(ax, x + 19.6, 14, x + 21.4, 14)
        x += 21.5
    save(fig, "fig_tp2_cycle_habilitations.png")


# ---------------------------------------------------------------------------- TP3
def tp3_chaine():
    fig, ax = canvas(11, 4.4)
    ax.text(55, 42, "De l'événement à la preuve : la chaîne de journalisation", ha="center", fontsize=13.5,
            fontweight="bold", color=P)
    srcs = [("PostgreSQL + pgAudit", "qui a lu quelle table ?", 28), ("Vault audit", "qui a pris quel secret ?", 17),
            ("MinIO webhook", "qui a lu quel fichier ?", 6)]
    for t, s, y in srcs:
        box(ax, 1, y, 22, 8.5, t, s, fc="#DDE7F3", ec=BLEU, fs=10)
        arrow(ax, 23.5, y + 4, 31.5, 19)
    etapes = [("COLLECTER", "tout au même\nendroit"), ("NORMALISER", "même format,\nheure en UTC"),
              ("DÉTECTER", "règles R1…R9\n→ alertes"), ("SCELLER", "SHA-256 + coffre\nWORM (30 j)")]
    x = 32
    for i, (t, s) in enumerate(etapes):
        box(ax, x, 12, 15, 14, t, s, fc="white", ec=[D, D, ORANGE, VERT][i], fs=10.5)
        if i < 3: arrow(ax, x + 15.5, 19, x + 17.5, 19)
        x += 18
    ax.text(62, 4, "→ rapport d'audit GRC   → décision RGPD (CNIL sous 72 h ?)", ha="center", fontsize=10, color=P, fontweight="bold")
    save(fig, "fig_tp3_chaine_logs.png")


def tp3_arbre():
    fig, ax = canvas(11, 6.2)
    ax.text(55, 60, "Violation de données : faut-il notifier ? (RGPD art. 33 et 34)", ha="center", fontsize=13.5,
            fontweight="bold", color=P)
    box(ax, 34, 47, 42, 8, "Des données personnelles ont-elles été\nperdues, lues ou modifiées sans droit ?", fs=9.5, fc="#E3E3EE")
    box(ax, 2, 33, 26, 8, "Pas une violation RGPD\n→ incident sécurité classique", fs=9, bold=False, fc="white", ec=D)
    box(ax, 38, 32, 34, 9, "Risque pour les droits et libertés\ndes personnes ?", fs=9.5, fc="#E3E3EE")
    box(ax, 1, 17, 30, 9, "Documenter dans le registre\ninterne (art. 33.5)\npas de notification", fs=9, bold=False, fc="#E6F2EA", ec=VERT)
    box(ax, 38, 17, 34, 9, "NOTIFIER LA CNIL sous 72 h (art. 33)", "+ documenter dans le registre", fc="#FBE5D6", ec=ORANGE, fs=10)
    box(ax, 78, 17, 26, 9, "Risque ÉLEVÉ\npour les personnes ?", fs=9.5, fc="#E3E3EE")
    box(ax, 60, 1, 22, 9, "Données chiffrées,\nclé non compromise ?", fs=9.2, fc="#E3E3EE")
    box(ax, 86, 1, 21, 9, "INFORMER LES\nPERSONNES (art. 34)", fs=9.2, fc="#F8E1DE", ec=ROUGE)
    box(ax, 30, 1, 24, 9, "Exemption art. 34.3.a :\npas d'information", fs=9, bold=False, fc="#E6F2EA", ec=VERT)
    arrow(ax, 33.5, 51, 24, 41.5, "non", off=(-3, 0))
    arrow(ax, 55, 46.5, 55, 41.5, "oui", off=(3, -1.5))
    arrow(ax, 37.5, 34, 30.5, 26.5, "non\n(improbable)", off=(-7, -1))
    arrow(ax, 55, 31.5, 55, 26.5, "oui", off=(3, -1.5))
    arrow(ax, 72.5, 21.5, 77.5, 21.5)
    arrow(ax, 91, 16.5, 76, 10.5, "oui", off=(3, 0))
    arrow(ax, 59.5, 5.5, 54.5, 5.5, "oui", off=(0, 0.5))
    arrow(ax, 82.5, 5.5, 85.5, 5.5, "non", off=(0, 0.5))
    save(fig, "fig_tp3_arbre_violation.png")


if __name__ == "__main__":
    architecture(); methode_grc()
    matrice("fig_tp1_matrice_risque.png",
            [("avant", 4, 4, ROUGE), ("après", 2, 1, VERT)],
            "Exemple TP1 : « mot de passe en dur divulgué »")
    tp1_etats(); tp1_secret()
    tp2_rbac(); tp2_masquage(); tp2_cycle()
    tp3_chaine(); tp3_arbre()

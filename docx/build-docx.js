// Génère les .docx des TP à partir des .md (charte graphique alignée sur le TD1)
// Usage : node build-docx.js <in.md> <out.docx> <etiquette TP> [--eleve]
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType,
  AlignmentType, BorderStyle, Header, Footer, PageNumber, LevelFormat, HeadingLevel, TableLayoutType, ImageRun,
} = require("docx");
const path = require("path");

const [, , inFile, outFile, label, flag] = process.argv;
const eleve = flag === "--eleve";
let lines = fs.readFileSync(inFile, "utf8").split("\n");
if (eleve) {
  const i = lines.findIndex((l) => l.startsWith("## 8. Pistes de correction"));
  if (i > 0) lines = lines.slice(0, i);
}

const C = { primary: "5B5B79", dark: "44445A", text: "202122", muted: "6B6B80", code: "F5F5F5", key: "EEEEEE", border: "C9C9D6" };
const BODY = 21, W = 9638; // 10.5 pt, largeur utile A4 (marges 2 cm)
const HEAD = "Georgia", SANS = "Calibri", MONO = "Consolas";

// ---------------------------------------------------------------- inline
function runs(text, base = {}) {
  const out = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|(?<![\w*])\*[^*\s][^*]*?\*(?![\w*]))/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const t = m[0];
    if (t.startsWith("`")) out.push(new TextRun({ text: t.slice(1, -1), font: MONO, size: (base.size || BODY) - 2, color: C.dark, shading: { type: ShadingType.CLEAR, fill: C.key } }));
    else if (t.startsWith("**")) out.push(new TextRun({ text: t.slice(2, -2), ...base, bold: true }));
    else out.push(new TextRun({ text: t.slice(1, -1), ...base, italics: true }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out;
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: C.border };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function para(text, opts = {}) {
  return new Paragraph({ spacing: { after: 120, line: 276 }, ...opts, children: runs(text, opts.run || {}) });
}

// ---------------------------------------------------------------- tables
function splitRow(l) {
  return l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}
function buildTable(rows) {
  const header = rows[0];
  const body = rows.slice(2).filter((r) => r.length);
  const kv = header.every((h) => h === ""); // tableau "clé / valeur" (en-tête vide)
  const n = header.length;
  const size = n >= 7 ? 16 : n >= 5 ? 17 : 19;
  const all = kv ? body : [header, ...body];
  // largeurs proportionnelles à la longueur du contenu (bornées)
  const len = Array.from({ length: n }, (_, j) =>
    Math.min(60, Math.max(4, ...all.map((r) => (r[j] || "").replace(/[`*]/g, "").length))));
  // chaque colonne doit pouvoir contenir son mot le plus long sans césure
  const mot = Array.from({ length: n }, (_, j) =>
    Math.min(16, Math.max(...all.map((r) => Math.max(0, ...(r[j] || "").replace(/[`*]/g, "").split(/\s+/).map((w) => w.length))))));
  if (kv) { len[0] = Math.max(len[0], 18); }
  const charW = size * 5.2; // largeur approx. d'un caractère (DXA) à cette taille
  const minW = mot.map((m) => Math.ceil((m + 1) * charW) + 200);
  const tot = len.reduce((a, b) => a + b, 0);
  let widths = len.map((x) => Math.floor((x / tot) * W));
  // relever les colonnes trop étroites, en reprenant la place sur les plus larges
  for (let k = 0; k < 5; k++) {
    let deficit = 0;
    widths = widths.map((w, j) => { if (w < minW[j]) { deficit += minW[j] - w; return minW[j]; } return w; });
    const riches = widths.map((w, j) => (w > minW[j] ? w - minW[j] : 0));
    const pool = riches.reduce((a, b) => a + b, 0);
    if (!deficit || !pool) break;
    widths = widths.map((w, j) => w - Math.floor((riches[j] / pool) * deficit));
  }
  widths[n - 1] += W - widths.reduce((a, b) => a + b, 0);
  
  const mk = (cells, isHead) => new TableRow({
    tableHeader: isHead,
    children: cells.map((c, j) => new TableCell({
      width: { size: widths[j], type: WidthType.DXA },
      borders,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      shading: isHead ? { type: ShadingType.CLEAR, fill: C.primary }
             : kv && j === 0 ? { type: ShadingType.CLEAR, fill: C.key } : undefined,
      children: [new Paragraph({
        children: runs(c || "", isHead ? { bold: true, color: "FFFFFF", size, font: SANS }
                                       : { size, color: C.text, bold: kv && j === 0, font: SANS }),
      })],
    })),
  });
  const trs = [];
  if (!kv) trs.push(mk(header, true));
  body.forEach((r) => trs.push(mk(Array.from({ length: n }, (_, j) => r[j] || ""), false)));
  return [new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, rows: trs }),
          new Paragraph({ spacing: { after: 120 }, children: [] })];
}

// ---------------------------------------------------------------- code & callouts
function codeBlock(codeLines) {
  return codeLines.map((l, i) => new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: C.code },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: C.primary, space: 6 } },
    spacing: { after: i === codeLines.length - 1 ? 160 : 0, line: 240 },
    indent: { left: 120, right: 120 },
    children: [new TextRun({ text: l.length ? l : " ", font: MONO, size: 16, color: C.text })],
  }));
}
function callout(text) {
  return new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: C.code },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: C.primary, space: 8 } },
    indent: { left: 160, right: 160 },
    spacing: { before: 80, after: 160, line: 276 },
    children: runs(text, { italics: true, color: C.dark }),
  });
}

// ---------------------------------------------------------------- parse
const children = [];
let numInstance = 0, currentNum = null;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (!l.trim()) { currentNum = null; continue; }

  if (l.startsWith("```")) {
    const buf = [];
    i++;
    while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
    children.push(...codeBlock(buf));
    continue;
  }
  if (l.startsWith("|")) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith("|")) rows.push(splitRow(lines[i++]));
    i--;
    children.push(...buildTable(rows));
    continue;
  }
  if (l.startsWith("# ")) {
    children.push(new Paragraph({ spacing: { before: 120, after: 120 },
      children: [new TextRun({ text: l.slice(2), font: HEAD, bold: true, size: 40, color: C.primary })] }));
    continue;
  }
  if (l.startsWith("## ")) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 140 }, keepNext: true,
      children: [new TextRun({ text: l.slice(3), font: HEAD, bold: true, size: 30, color: C.primary })] }));
    continue;
  }
  if (l.startsWith("### ")) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 100 }, keepNext: true,
      children: [new TextRun({ text: l.slice(4), font: HEAD, bold: true, size: 24, color: C.dark })] }));
    continue;
  }
  if (l.startsWith("> ")) { children.push(callout(l.slice(2))); continue; }
  const img = l.match(/^!\[(.*)\]\((.*)\)$/);
  if (img) {
    const file = path.join(path.dirname(inFile), img[2]);
    const buf = fs.readFileSync(file);
    const w0 = buf.readUInt32BE(16), h0 = buf.readUInt32BE(20);   // en-tête PNG
    const w = Math.min(h0 / w0 > 0.6 ? 360 : 620, w0), h = Math.round((w * h0) / w0);
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 40 }, keepNext: true,
      children: [new ImageRun({ type: "png", data: buf, transformation: { width: w, height: h },
                                altText: { title: img[1], description: img[1], name: path.basename(file) } })] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
      children: [new TextRun({ text: img[1], italics: true, size: 17, color: C.muted })] }));
    continue;
  }
  const b = l.match(/^(\s*)- (.*)$/);
  if (b) {
    children.push(new Paragraph({ numbering: { reference: "puces", level: b[1].length >= 2 ? 1 : 0 },
      spacing: { after: 60, line: 276 }, children: runs(b[2], { size: BODY, color: C.text }) }));
    continue;
  }
  const n = l.match(/^(\d+)\. (.*)$/);
  if (n) {
    if (n[1] === "1" || currentNum === null) currentNum = `num${numInstance++}`;
    children.push(new Paragraph({ numbering: { reference: "numeros", level: 0, instance: numInstance },
      spacing: { after: 80, line: 276 }, children: runs(n[2], { size: BODY, color: C.text }) }));
    continue;
  }
  // lignes de sous-titre du bandeau (gras seul / italique seul)
  if (/^\*\*[^*]+\*\*$/.test(l) && children.length < 3) {
    children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: l.slice(2, -2), font: SANS, bold: true, size: 22, color: C.dark })] }));
    continue;
  }
  if (/^\*[^*]+\*$/.test(l) && children.length < 4) {
    children.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: l.slice(1, -1), font: HEAD, italics: true, size: 24, color: C.dark })] }));
    continue;
  }
  children.push(para(l, { run: { size: BODY, color: C.text } }));
}

const titre = (lines.find((l) => l.startsWith("# ")) || "").slice(2);
const doc = new Document({
  creator: "DataCorp Secure — Module Sécurité des Données",
  title: titre,
  styles: {
    default: { document: { run: { font: SANS, size: BODY, color: C.text } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: HEAD, size: 30, bold: true, color: C.primary }, paragraph: { outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: HEAD, size: 24, bold: true, color: C.dark }, paragraph: { outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: "puces", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1000, hanging: 270 } } } }] },
      { reference: "numeros", levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.border, space: 4 } },
      children: [new TextRun({ text: `Sécurité des Données & DevSecOps — Projet fil rouge DataCorp Secure · ${label}${eleve ? "" : " · Version formateur"}`, size: 16, color: C.muted })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `${titre} · Page `, size: 16, color: C.muted }),
                 new TextRun({ children: [PageNumber.CURRENT], size: 16, color: C.muted }),
                 new TextRun({ text: " / ", size: 16, color: C.muted }),
                 new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: C.muted })] })] }) },
    children,
  }],
});
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(outFile, buf); console.log("écrit :", outFile); });

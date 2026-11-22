// Turns a Markdown document into a clean A4 PDF with jsPDF (vendor/jspdf.umd.min.js).
import { mdBlocks, plain } from './md.js';

const SAFE = { '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '→': '->', '✓': '', '✔': '', '✦': '', ' ': ' ' };
function clean(s) {
  return plain(s).replace(/[–—‘’“”…→✓✔✦ ]/g, c => SAFE[c] ?? '')
    // keep Latin-1 (covers £, ·, accents); drop anything the standard fonts cannot draw
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff€]/g, '');
}

export function mdToPdf(md, { title = 'Document', kind = 'doc' } = {}) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setProperties({ title: clean(title), creator: 'Northstar' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = kind === 'letter' ? 64 : 52;
  const maxW = W - M * 2;
  let y = M;
  const ink = [30, 41, 36], green = [36, 98, 75], muted = [96, 108, 100];
  const need = h => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const text = (s, { size = 10.5, style = 'normal', color = ink, indent = 0, gap = 1.38, align = 'left' } = {}) => {
    doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(clean(s), maxW - indent);
    const lh = size * gap;
    for (const ln of lines) { need(lh); doc.text(ln, align === 'center' ? W / 2 : M + indent, y + size * 0.8, { align }); y += lh; }
  };
  const blocks = mdBlocks(md);
  let first = true;
  for (const b of blocks) {
    const isItalic = b.text && /^\*[^*].*\*$/.test(b.text.trim());
    const isBold = b.text && /^\*\*[^*].*\*\*$/.test(b.text.trim());
    if (b.t === 'h1') { text(b.text, { size: kind === 'cv' ? 20 : 16, style: 'bold', color: kind === 'cv' ? ink : green }); y += 2; first = false; continue; }
    if (b.t === 'h2') {
      y += first ? 0 : 9; need(26);
      text(b.text.toUpperCase(), { size: 10.5, style: 'bold', color: green });
      doc.setDrawColor(205, 214, 206); doc.setLineWidth(0.6); doc.line(M, y + 1, W - M, y + 1); y += 7; continue;
    }
    if (b.t === 'h3') { y += 5; text(b.text, { size: 11, style: 'bold' }); continue; }
    if (b.t === 'h4') { y += 3; text(b.text, { size: 10.5, style: 'bold', color: muted }); continue; }
    if (b.t === 'hr') { y += 4; need(8); doc.setDrawColor(220, 224, 218); doc.line(M, y, W - M, y); y += 8; continue; }
    if (b.t === 'li' || b.t === 'oli') {
      const ind = 14 + (b.level ? 14 : 0);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.2);
      const lines = doc.splitTextToSize(clean(b.text), maxW - ind);
      need(14);
      doc.setTextColor(...green); doc.text(b.t === 'li' ? '•' : b.n + '.', M + ind - 11, y + 8.2);
      doc.setTextColor(...ink);
      for (const ln of lines) { need(14); doc.text(ln, M + ind, y + 8.2); y += 14; }
      y += 1.5; continue;
    }
    if (b.t === 'table') {
      for (const r of b.rows) text(r.filter(Boolean).join('  ·  '), { size: 9.8 });
      y += 4; continue;
    }
    if (b.t === 'quote') { text(b.text, { size: 10.2, style: 'italic', color: muted, indent: 10 }); y += 4; continue; }
    text(b.text, { size: kind === 'letter' ? 11 : 10.3, style: isItalic ? 'italic' : isBold ? 'bold' : 'normal', color: isItalic ? muted : ink, gap: kind === 'letter' ? 1.5 : 1.38 });
    y += kind === 'letter' ? 8 : 4;
    first = false;
  }
  return doc;
}

export function pdfBlob(md, opts) { return mdToPdf(md, opts).output('blob'); }
export function pdfBase64(md, opts) { return mdToPdf(md, opts).output('datauristring').split(',')[1]; }
export function savePdf(md, filename, opts) { mdToPdf(md, opts).save(filename); }

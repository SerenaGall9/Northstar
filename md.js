// Minimal, safe Markdown -> blocks -> HTML. Shared by the document viewer and the PDF writer.
export function esc(s = '') {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function mdBlocks(text = '') {
  const out = [];
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  let para = [];
  const flush = () => { if (para.length) { out.push({ t: 'p', text: para.join('\n') }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) { flush(); continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flush(); out.push({ t: 'h' + Math.min(m[1].length, 4), text: m[2] }); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { flush(); out.push({ t: 'hr' }); continue; }
    if ((m = raw.match(/^(\s*)[-*•]\s+(.*)$/))) { flush(); out.push({ t: 'li', text: m[2], level: m[1].length >= 2 ? 1 : 0 }); continue; }
    if ((m = raw.match(/^(\s*)(\d+)[.)]\s+(.*)$/))) { flush(); out.push({ t: 'oli', n: +m[2], text: m[3], level: m[1].length >= 2 ? 1 : 0 }); continue; }
    if (line.startsWith('|')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const r = lines[i].trim();
        if (!/^\|[\s:|-]+\|?$/.test(r)) rows.push(r.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
        i++;
      }
      i--;
      if (rows.length) out.push({ t: 'table', rows });
      continue;
    }
    if (line.startsWith('>')) { flush(); out.push({ t: 'quote', text: line.replace(/^>\s?/, '') }); continue; }
    para.push(line);
  }
  flush();
  return out;
}

export function inline(s = '') {
  let h = esc(s);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return h.replace(/\n/g, '<br>');
}

export function mdToHtml(text = '') {
  const b = mdBlocks(text);
  let html = '', list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const x of b) {
    if (x.t === 'li' || x.t === 'oli') {
      const tag = x.t === 'li' ? 'ul' : 'ol';
      if (list !== tag) { close(); html += `<${tag}>`; list = tag; }
      html += `<li class="${x.level ? 'sub' : ''}">${inline(x.text)}</li>`;
      continue;
    }
    close();
    if (/^h\d$/.test(x.t)) html += `<${x.t}>${inline(x.text)}</${x.t}>`;
    else if (x.t === 'hr') html += '<hr>';
    else if (x.t === 'quote') html += `<blockquote>${inline(x.text)}</blockquote>`;
    else if (x.t === 'table') html += `<div class="doc-table"><table>${x.rows.map((r, i) => `<tr>${r.map(c => i === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</table></div>`;
    else html += `<p>${inline(x.text)}</p>`;
  }
  close();
  return html;
}

export function plain(s = '') {
  return String(s || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

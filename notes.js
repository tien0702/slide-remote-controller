/* Đọc ghi chú người thuyết trình từ file .pptx hoặc .txt.
   Dùng được cả trên trình duyệt (window.NotesParser) và Node (module.exports) để kiểm thử. */
(function (root) {
  'use strict';

  function resolvePath(baseDir, target) {
    if (target.charAt(0) === '/') return target.slice(1);
    const out = [];
    (baseDir + target).split('/').forEach(p => {
      if (p === '..') out.pop();
      else if (p && p !== '.') out.push(p);
    });
    return out.join('/');
  }

  function dirOf(path) { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i + 1); }
  function baseOf(path) { return path.slice(path.lastIndexOf('/') + 1); }
  function byLocal(node, name) { return Array.from(node.getElementsByTagNameNS('*', name)); }
  function relsOf(doc) {
    const map = {};
    byLocal(doc, 'Relationship').forEach(r => {
      map[r.getAttribute('Id')] = { target: r.getAttribute('Target'), type: r.getAttribute('Type') || '' };
    });
    return map;
  }

  /* Văn bản của một khung chữ: mỗi đoạn <a:p> một dòng, <a:br> xuống dòng. */
  function textOfShape(sp) {
    const paras = byLocal(sp, 'p').filter(p => p.namespaceURI && p.namespaceURI.indexOf('drawingml') >= 0);
    return paras.map(p => {
      let s = '';
      const walk = n => {
        for (let c = n.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          const ln = c.localName;
          if (ln === 't') s += c.textContent;
          else if (ln === 'br') s += '\n';
          else walk(c);
        }
      };
      walk(p);
      return s;
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function notesFromNotesXml(doc) {
    const shapes = byLocal(doc, 'sp');
    const body = [];
    const fallback = [];
    shapes.forEach(sp => {
      const ph = byLocal(sp, 'ph')[0];
      const type = ph ? (ph.getAttribute('type') || '') : '';
      if (type === 'body') body.push(textOfShape(sp));
      else if (ph && !type && ph.getAttribute('idx') === '1') fallback.push(textOfShape(sp));
    });
    const list = body.length ? body : fallback;
    return list.filter(Boolean).join('\n\n');
  }

  /**
   * zip: đối tượng JSZip đã nạp. parse: (xmlString) => Document.
   * Trả về { notes: string[], hidden: number } theo thứ tự trình chiếu, bỏ slide ẩn
   * (PDF xuất từ PowerPoint mặc định không chứa slide ẩn).
   */
  async function notesFromPptxZip(zip, parse) {
    const read = async p => { const f = zip.file(p); return f ? f.async('string') : null; };
    const presXml = await read('ppt/presentation.xml');
    const presRelsXml = await read('ppt/_rels/presentation.xml.rels');
    if (!presXml || !presRelsXml) throw new Error('File không phải PowerPoint (.pptx) hợp lệ.');
    const pres = parse(presXml);
    const presRels = relsOf(parse(presRelsXml));
    const notes = [];
    let hidden = 0;
    for (const sld of byLocal(pres, 'sldId')) {
      const rid = sld.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sld.getAttribute('r:id');
      const rel = presRels[rid];
      if (!rel) continue;
      const slidePath = resolvePath('ppt/', rel.target);
      const slideXml = await read(slidePath);
      if (!slideXml) { notes.push(''); continue; }
      const slideDoc = parse(slideXml);
      if (slideDoc.documentElement.getAttribute('show') === '0') { hidden++; continue; }
      const relsXml = await read(dirOf(slidePath) + '_rels/' + baseOf(slidePath) + '.rels');
      let text = '';
      if (relsXml) {
        const rels = relsOf(parse(relsXml));
        const nr = Object.values(rels).find(r => /\/notesSlide$/.test(r.type));
        if (nr) {
          const notesXml = await read(resolvePath(dirOf(slidePath), nr.target));
          if (notesXml) text = notesFromNotesXml(parse(notesXml));
        }
      }
      notes.push(text);
    }
    return { notes, hidden };
  }

  /* .txt / .md: các slide ngăn cách bằng một dòng chỉ có --- */
  function notesFromText(text) {
    return text.replace(/\r\n?/g, '\n').split(/^[ \t]*---[ \t]*$/m).map(s => s.trim());
  }

  /* Xuất ghi chú thành .txt cùng định dạng để nạp lại được. */
  function notesToText(notes) {
    return notes.map(n => (n || '').trim()).join('\n\n---\n\n') + '\n';
  }

  const api = { notesFromPptxZip, notesFromText, notesToText, resolvePath };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NotesParser = api;
})(typeof window !== 'undefined' ? window : globalThis);

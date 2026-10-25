/* Trình Chiếu Từ Xa — laptop chiếu PDF, điện thoại điều khiển qua WebRTC (PeerJS). */
(function () {
  'use strict';

  const PREFIX = 'tcvn-remote-';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const THUMB_W = 480;
  const $ = id => document.getElementById(id);
  const clamp = (i, n) => Math.max(0, Math.min(n - 1, i | 0));

  const store = {
    get(k, d) { try { const v = localStorage.getItem('tc.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('tc.' + k, JSON.stringify(v)); } catch (e) {} }
  };

  function show(id) {
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== id; });
  }

  let toastTimer = null;
  function toast(text, ms) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }

  function newCode() {
    let s = '';
    const a = new Uint32Array(6);
    crypto.getRandomValues(a);
    for (let i = 0; i < 6; i++) s += CODE_CHARS[a[i] % CODE_CHARS.length];
    return s;
  }
  const cleanCode = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const fmt = ms => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(sec).padStart(2, '0');
  };
  const fmtShort = ms => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  function librariesReady() {
    const missing = [];
    if (!window.pdfjsLib) missing.push('pdf.js');
    if (!window.Peer) missing.push('PeerJS');
    return missing;
  }

  /* =====================================================================
     LAPTOP: trang chủ + màn chiếu
     ===================================================================== */
  const Host = {
    pdf: null, count: 0, title: '', notes: [], index: 0,
    blank: 'none', qr: true, thumbs: [], conns: new Set(), peer: null, code: '',
    renderToken: 0, cache: new Map(), cacheKey: '',

    initHome() {
      show('home');
      let pdfFile = null, notesFile = null;
      const setPdf = f => { pdfFile = f; $('pdfName').textContent = f ? f.name : 'Chưa chọn'; $('startBtn').disabled = !f; };
      const setNotes = f => { notesFile = f; $('notesName').textContent = f ? f.name : 'Chưa chọn'; };
      const classify = files => {
        Array.from(files).forEach(f => {
          const n = f.name.toLowerCase();
          if (n.endsWith('.pdf')) setPdf(f);
          else if (n.endsWith('.pptx') || n.endsWith('.txt') || n.endsWith('.md')) setNotes(f);
          else toast('Không dùng được file “' + f.name + '”. Hãy chọn .pdf, .pptx hoặc .txt');
        });
      };
      $('pdfInput').addEventListener('change', e => setPdf(e.target.files[0] || null));
      $('notesInput').addEventListener('change', e => setNotes(e.target.files[0] || null));
      const drop = $('drop');
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', e => classify(e.dataTransfer.files));
      document.addEventListener('dragover', e => e.preventDefault());
      document.addEventListener('drop', e => { e.preventDefault(); if (!drop.contains(e.target)) classify(e.dataTransfer.files); });
      $('startBtn').addEventListener('click', () => this.load(pdfFile, notesFile));
      const demoBtn = $('demoBtn');
      if (demoBtn) demoBtn.addEventListener('click', () => { location.hash = 'demo'; location.reload(); });
    },

    msg(text, kind) { const m = $('homeMsg'); m.textContent = text; m.className = 'msg ' + (kind || ''); m.hidden = !text; },

    async load(pdfFile, notesFile) {
      if (document.body.classList.contains('demo')) { toast('Bản xem thử: hãy mở web trên GitHub Pages để chọn file thật.', 4000); return; }
      const missing = librariesReady();
      if (missing.length) { this.msg('Không tải được thư viện ' + missing.join(', ') + '. Kiểm tra kết nối mạng rồi tải lại trang.', 'err'); return; }
      $('startBtn').disabled = true;
      this.msg('Đang mở PDF…');
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const data = new Uint8Array(await pdfFile.arrayBuffer());
        this.pdf = await pdfjsLib.getDocument({ data }).promise;
      } catch (e) {
        this.msg('Không mở được file PDF này. Hãy xuất lại PDF từ phần mềm trình chiếu.', 'err');
        $('startBtn').disabled = false;
        return;
      }
      this.count = this.pdf.numPages;
      this.title = pdfFile.name.replace(/\.pdf$/i, '');
      this.notes = new Array(this.count).fill('');
      let warn = '';
      if (notesFile) {
        try {
          let list;
          if (notesFile.name.toLowerCase().endsWith('.pptx')) {
            this.msg('Đang đọc ghi chú từ PowerPoint…');
            const zip = await JSZip.loadAsync(notesFile);
            const parse = s => new DOMParser().parseFromString(s, 'application/xml');
            const r = await NotesParser.notesFromPptxZip(zip, parse);
            list = r.notes;
            if (r.hidden) warn += 'Đã bỏ qua ' + r.hidden + ' slide ẩn trong PowerPoint. ';
          } else {
            list = NotesParser.notesFromText(await notesFile.text());
          }
          if (list.length !== this.count) warn += 'PowerPoint/ghi chú có ' + list.length + ' slide nhưng PDF có ' + this.count + ' trang: ghi chú có thể bị lệch.';
          for (let i = 0; i < this.count; i++) this.notes[i] = list[i] || '';
        } catch (e) {
          warn = 'Không đọc được ghi chú (' + (e.message || 'lỗi file') + '). Vẫn chiếu được slide.';
        }
      }
      this.thumbs = new Array(this.count).fill(null);
      this.enterScreen();
      if (warn) toast(warn, 7000);
      this.makeThumbs();
    },

    enterScreen() {
      show('screen');
      document.title = this.title + ' · Trình Chiếu Từ Xa';
      this.index = 0;
      this.bindScreen();
      this.render();
      this.setQr(true);
      if (this.demo) return;
      this.startPeer();
      addEventListener('beforeunload', e => { e.preventDefault(); e.returnValue = ''; });
    },

    bindScreen() {
      $('sPrev').onclick = () => this.go(this.index - 1);
      $('sNext').onclick = () => this.go(this.index + 1);
      $('sQr').onclick = () => this.setQr(!this.qr);
      $('qrClose').onclick = () => this.setQr(false);
      $('sFull').onclick = () => this.fullscreen();
      $('sNotes').onclick = () => this.downloadNotes();
      $('sExit').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); if (this.demo) { toast('Đây là bản xem thử: nút Thoát đưa về trang chủ.'); return; } location.href = location.pathname; };
      $('stage').addEventListener('click', () => this.go(this.index + 1));
      addEventListener('keydown', e => {
        if (e.target.closest('input, textarea')) return;
        const k = e.key;
        if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(k)) { e.preventDefault(); this.go(this.index + 1); }
        else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) { e.preventDefault(); this.go(this.index - 1); }
        else if (k === 'Home') this.go(0);
        else if (k === 'End') this.go(this.count - 1);
        else if (k === 'f' || k === 'F') this.fullscreen();
        else if (k === 'q' || k === 'Q') this.setQr(!this.qr);
        else if (k === 'b' || k === 'B' || k === '.') this.setBlank(this.blank === 'black' ? 'none' : 'black');
        else if (k === 'w' || k === 'W' || k === ',') this.setBlank(this.blank === 'white' ? 'none' : 'white');
        else if (k === 'Escape' && this.qr) this.setQr(false);
      });
      let idle = null;
      const wake = () => { $('screenBar').classList.add('on'); document.body.style.cursor = ''; clearTimeout(idle); idle = setTimeout(() => { $('screenBar').classList.remove('on'); if (!this.demo) document.body.style.cursor = 'none'; }, 2500); };
      addEventListener('mousemove', wake);
      wake();
      addEventListener('resize', () => { this.cache.clear(); this.render(); });
    },

    fullscreen() {
      const el = document.documentElement;
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      const p = el.requestFullscreen ? el.requestFullscreen() : null;
      if (p && p.catch) p.catch(() => toast('Trình duyệt chặn toàn màn hình. Bấm phím F trên laptop.'));
    },

    /* ---------- vẽ slide ---------- */
    async drawPage(i, maxW, maxH) {
      if (this.demo) return Demo.drawSlide(i, maxW, maxH);
      const page = await this.pdf.getPage(i + 1);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = Math.min(maxW / vp1.width, maxH / vp1.height);
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(vp.width));
      c.height = Math.max(1, Math.floor(vp.height));
      await page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
      return c;
    },

    async pageCanvas(i) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const st = $('stage');
      const w = st.clientWidth || innerWidth, h = st.clientHeight || innerHeight;
      const key = w + 'x' + h + '@' + dpr;
      if (key !== this.cacheKey) { this.cache.clear(); this.cacheKey = key; }
      if (!this.cache.has(i)) this.cache.set(i, this.drawPage(i, w * dpr, h * dpr));
      if (this.cache.size > 6) {
        for (const k of this.cache.keys()) { if (Math.abs(k - this.index) > 2) this.cache.delete(k); if (this.cache.size <= 6) break; }
      }
      return this.cache.get(i);
    },

    async render() {
      if (!this.pdf && !this.demo) return;
      const token = ++this.renderToken;
      $('sCount').textContent = (this.index + 1) + ' / ' + this.count;
      try {
        const src = await this.pageCanvas(this.index);
        if (token !== this.renderToken) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const out = $('stageCanvas');
        out.width = src.width; out.height = src.height;
        out.style.width = (src.width / dpr) + 'px';
        out.style.height = (src.height / dpr) + 'px';
        out.getContext('2d').drawImage(src, 0, 0);
        if (this.index + 1 < this.count) this.pageCanvas(this.index + 1);
      } catch (e) { /* trang lỗi: giữ trang cũ */ }
    },

    async makeThumbs() {
      for (let i = 0; i < this.count; i++) {
        try {
          const c = await this.drawPage(i, THUMB_W, THUMB_W);
          const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.78));
          const bytes = await blob.arrayBuffer();
          this.thumbs[i] = bytes;
          this.broadcast({ t: 'thumb', i, bytes });
        } catch (e) {}
      }
    },

    /* ---------- trạng thái ---------- */
    go(i) {
      i = clamp(i, this.count);
      if (i === this.index) return;
      this.index = i;
      this.render();
      this.sendState();
    },
    setBlank(v) {
      this.blank = v;
      const b = $('blank');
      b.hidden = v === 'none';
      b.className = v === 'white' ? 'white' : 'black';
      this.sendState();
    },
    setQr(v) {
      this.qr = v;
      $('qrOverlay').hidden = !v;
      this.sendState();
    },
    stateMsg() { return { t: 'state', i: this.index, blank: this.blank, qr: this.qr }; },
    sendState() { this.broadcast(this.stateMsg()); },
    broadcast(m) { this.conns.forEach(c => { if (c.open) { try { c.send(m); } catch (e) {} } }); },

    laser(m) {
      const dot = $('laser');
      if (!m.on) { dot.hidden = true; return; }
      const r = $('stageCanvas').getBoundingClientRect();
      dot.style.left = (r.left + m.x * r.width) + 'px';
      dot.style.top = (r.top + m.y * r.height) + 'px';
      dot.hidden = false;
    },

    downloadNotes() {
      const blob = new Blob([NotesParser.notesToText(this.notes)], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (this.title || 'ghi-chu') + ' - ghi chu.txt';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast('Đã tải file ghi chú. Lần sau chọn file .txt này ở mục Ghi chú.');
    },

    /* ---------- kết nối ---------- */
    joinUrl() { return location.origin + location.pathname + '?join=' + this.code; },

    drawQr() {
      const qr = qrcode(0, 'M');
      qr.addData(this.joinUrl());
      qr.make();
      $('qrBox').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      $('qrCode').textContent = this.code;
    },

    updateConnUi() {
      const n = Array.from(this.conns).filter(c => c.open).length;
      $('sConn').textContent = n + ' điện thoại';
      $('sDot').classList.toggle('on', n > 0);
      $('qrStatus').textContent = n ? 'Đã kết nối ' + n + ' điện thoại' : (this.peer && this.peer.open ? 'Đang chờ điện thoại…' : 'Đang tạo kết nối…');
    },

    startPeer() {
      let code;
      try { code = sessionStorage.getItem('tc.hostCode'); } catch (e) {}
      this.code = code || newCode();
      try { sessionStorage.setItem('tc.hostCode', this.code); } catch (e) {}
      this.drawQr();
      const peer = new Peer(PREFIX + this.code.toLowerCase(), { debug: 0 });
      this.peer = peer;
      peer.on('open', () => this.updateConnUi());
      peer.on('connection', conn => this.accept(conn));
      peer.on('disconnected', () => { setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 1500); });
      peer.on('error', err => {
        if (err.type === 'unavailable-id') {
          try { sessionStorage.removeItem('tc.hostCode'); } catch (e) {}
          peer.destroy();
          this.startPeer();
        } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
          $('qrStatus').textContent = 'Mất kết nối máy chủ trung gian, đang thử lại…';
          setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 3000);
        } else if (err.type === 'browser-incompatible') {
          $('qrStatus').textContent = 'Trình duyệt không hỗ trợ WebRTC. Hãy dùng Chrome, Edge, Safari hoặc Firefox mới.';
        }
      });
    },

    accept(conn) {
      conn.on('open', () => {
        this.conns.add(conn);
        this.updateConnUi();
        conn.send({ t: 'hello', count: this.count, title: this.title, notes: this.notes, code: this.code });
        conn.send(this.stateMsg());
        this.thumbs.forEach((bytes, i) => { if (bytes) conn.send({ t: 'thumb', i, bytes }); });
        if (this.qr) { setTimeout(() => this.setQr(false), 1200); }
        toast('Điện thoại đã kết nối');
      });
      conn.on('data', m => this.onMessage(m, conn));
      const drop = () => { this.conns.delete(conn); this.updateConnUi(); $('laser').hidden = true; };
      conn.on('close', drop);
      conn.on('error', drop);
    },

    onMessage(m) {
      if (!m || typeof m !== 'object') return;
      switch (m.t) {
        case 'go': this.go(m.i); break;
        case 'blank': this.setBlank(['black', 'white'].includes(m.v) ? m.v : 'none'); break;
        case 'qr': this.setQr(!!m.v); break;
        case 'laser': this.laser(m); break;
        case 'full': this.fullscreen(); break;
        case 'note':
          if (typeof m.text === 'string' && m.i >= 0 && m.i < this.count) {
            this.notes[m.i] = m.text.slice(0, 20000);
            this.broadcast({ t: 'note', i: m.i, text: this.notes[m.i] });
          }
          break;
      }
    }
  };

  /* =====================================================================
     ĐIỆN THOẠI: điều khiển
     ===================================================================== */
  const Remote = {
    code: '', peer: null, conn: null, count: 0, notes: [], title: '', index: 0, noteMode: 'edit',
    blank: 'none', qr: false, thumbUrls: [], tab: 'control', retry: null, wakeLock: null,
    opts: null, timer: null,

    start(code, localConn) {
      this.code = code;
      if (!localConn) store.set('lastCode', code);
      if (!localConn) show('remote');
      document.body.classList.add('is-remote');
      $('setCode').textContent = code;
      this.opts = {
        font: store.get('font', 20), light: store.get('light', false), vibrate: store.get('vibrate', false),
        swipe: store.get('swipe', true), awake: store.get('awake', true)
      };
      this.timer = { running: false, startAt: 0, elapsed: 0, target: store.get('target', 45), slideStart: Date.now(), slideMs: [], warned5: false, warned0: false };
      this.bind();
      this.applyOpts();
      this.renderAll();
      if (localConn) {
        this.conn = localConn;
        localConn.on('data', m => this.onMessage(m));
        this.status('Đã kết nối (xem thử)', true);
      } else this.connect();
      setInterval(() => this.tick(), 500);
    },

    status(text, on) { $('rStatus').textContent = text; $('rDot').classList.toggle('on', !!on); },

    /* ---------- kết nối ---------- */
    connect() {
      clearTimeout(this.retry);
      const missing = librariesReady();
      if (missing.length) { this.status('Không tải được thư viện, kiểm tra mạng', false); return; }
      if (!this.peer || this.peer.destroyed) {
        this.peer = new Peer({ debug: 0 });
        this.peer.on('open', () => this.dial());
        this.peer.on('disconnected', () => { setTimeout(() => { if (this.peer && !this.peer.destroyed) this.peer.reconnect(); }, 1500); });
        this.peer.on('error', err => {
          if (err.type === 'peer-unavailable') this.status('Chưa thấy màn chiếu – kiểm tra mã', false);
          else this.status('Lỗi kết nối, đang thử lại…', false);
          this.scheduleRetry();
        });
      } else if (this.peer.open) {
        this.dial();
      }
    },
    dial() {
      if (this.conn && this.conn.open) return;
      this.status('Đang kết nối…', false);
      const conn = this.peer.connect(PREFIX + this.code.toLowerCase(), { reliable: true });
      this.conn = conn;
      conn.on('open', () => { this.status('Đã kết nối', true); this.vibrate(30); });
      conn.on('data', m => this.onMessage(m));
      conn.on('close', () => { if (this.conn === conn) { this.status('Mất kết nối, đang thử lại…', false); this.scheduleRetry(); } });
      conn.on('error', () => { if (this.conn === conn) this.scheduleRetry(); });
    },
    scheduleRetry() { clearTimeout(this.retry); this.retry = setTimeout(() => this.connect(), 2500); },
    send(m) { if (this.conn && this.conn.open) { try { this.conn.send(m); return true; } catch (e) {} } return false; },

    onMessage(m) {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello') {
        this.count = m.count | 0;
        this.title = String(m.title || '');
        this.notes = Array.isArray(m.notes) ? m.notes.map(String) : [];
        this.thumbUrls.forEach(u => u && URL.revokeObjectURL(u));
        this.thumbUrls = new Array(this.count).fill(null);
        while (this.timer.slideMs.length < this.count) this.timer.slideMs.push(0);
        this.buildGrid();
        this.renderAll();
      } else if (m.t === 'thumb') {
        if (m.i < 0 || m.i >= this.count) return;
        const bytes = m.bytes instanceof Uint8Array ? m.bytes : new Uint8Array(m.bytes);
        if (this.thumbUrls[m.i]) URL.revokeObjectURL(this.thumbUrls[m.i]);
        this.thumbUrls[m.i] = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
        const cell = document.querySelector('#slideGrid [data-i="' + m.i + '"] .g-img');
        if (cell) cell.style.backgroundImage = 'url("' + this.thumbUrls[m.i] + '")';
        if (m.i === this.index || m.i === this.index + 1) this.renderPreviews();
      } else if (m.t === 'state') {
        this.blank = m.blank || 'none';
        this.qr = !!m.qr;
        this.setIndex(m.i | 0, false);
        this.renderTools();
      } else if (m.t === 'note') {
        if (m.i >= 0 && m.i < this.count) { this.notes[m.i] = String(m.text); this.renderNotes(); }
      }
    },

    /* ---------- điều hướng ---------- */
    setIndex(i, fromHere) {
      if (!this.count) return;
      i = clamp(i, this.count);
      if (i === this.index) return;
      const now = Date.now();
      if (this.timer.running) this.timer.slideMs[this.index] = (this.timer.slideMs[this.index] || 0) + (now - this.timer.slideStart);
      this.timer.slideStart = now;
      this.index = i;
      if (fromHere) { this.send({ t: 'go', i }); if (this.opts.vibrate) this.vibrate(15); }
      this.renderAll();
    },
    go(i) { this.setIndex(i, true); },

    /* ---------- giao diện ---------- */
    bind() {
      document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => this.setTab(b.dataset.go)));
      $('rClock').addEventListener('click', () => this.setTab('timer'));
      $('rPrev').onclick = () => this.go(this.index - 1);
      $('rNext').onclick = () => this.go(this.index + 1);

      // vuốt trên ghi chú
      let sx = 0, sy = 0, st = 0;
      const area = $('tab-control');
      area.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
      area.addEventListener('touchend', e => {
        if (!this.opts.swipe) return;
        const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
        if (Date.now() - st < 600 && Math.abs(dx) > 60 && Math.abs(dy) < 50) this.go(this.index + (dx < 0 ? 1 : -1));
      }, { passive: true });

      // ghi chú
      $('nEditMode').onclick = () => this.setNoteMode('edit');
      $('nAllMode').onclick = () => this.setNoteMode('all');
      $('noteSave').onclick = () => {
        const text = $('noteEditor').value;
        this.notes[this.index] = text;
        if (this.send({ t: 'note', i: this.index, text })) toast('Đã lưu ghi chú slide ' + (this.index + 1));
        else toast('Chưa kết nối: ghi chú mới chỉ lưu trên điện thoại');
        this.renderNotes();
      };
      $('noteRevert').onclick = () => { $('noteEditor').value = this.notes[this.index] || ''; };
      $('noteCopy').onclick = async () => {
        const text = NotesParser.notesToText(this.notes);
        try { await navigator.clipboard.writeText(text); toast('Đã sao chép ghi chú'); }
        catch (e) { this.setNoteMode('all'); toast('Không sao chép được. Hãy giữ để chọn văn bản.'); }
      };

      // hẹn giờ
      $('tStart').onclick = () => this.toggleTimer();
      $('tReset').onclick = () => this.resetTimer();
      $('tTarget').addEventListener('change', e => this.setTarget(e.target.value));
      document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => this.setTarget(c.dataset.min)));

      // công cụ
      $('toolBlack').onclick = () => this.send({ t: 'blank', v: this.blank === 'black' ? 'none' : 'black' });
      $('toolWhite').onclick = () => this.send({ t: 'blank', v: this.blank === 'white' ? 'none' : 'white' });
      $('toolQr').onclick = () => this.send({ t: 'qr', v: !this.qr });
      $('toolFirst').onclick = () => this.go(0);
      $('toolLast').onclick = () => this.go(this.count - 1);
      $('toolFull').onclick = () => { this.send({ t: 'full' }); toast('Nếu laptop không chuyển toàn màn hình, bấm phím F trên laptop'); };
      this.bindLaser();

      // cài đặt
      $('fontUp').onclick = () => { this.opts.font = Math.min(40, this.opts.font + 2); this.applyOpts(); };
      $('fontDown').onclick = () => { this.opts.font = Math.max(14, this.opts.font - 2); this.applyOpts(); };
      [['optLight', 'light'], ['optVibrate', 'vibrate'], ['optSwipe', 'swipe'], ['optAwake', 'awake']].forEach(([id, k]) => {
        $(id).addEventListener('change', e => { this.opts[k] = e.target.checked; this.applyOpts(); });
      });
      $('disconnectBtn').onclick = () => {
        clearTimeout(this.retry);
        try { if (this.peer) this.peer.destroy(); } catch (e) {}
        if (this.conn && this.conn.demo) { toast('Bản xem thử không ngắt kết nối được.'); return; }
        location.href = location.pathname + '?join=';
      };
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        this.keepAwake();
        if (!this.conn || !this.conn.open) this.connect();
      });
    },

    bindLaser() {
      const pad = $('laserPad');
      let active = false, pending = null, raf = 0;
      const flush = () => { raf = 0; if (pending) { this.send(pending); pending = null; } };
      const pos = e => {
        const r = pad.getBoundingClientRect();
        return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
      };
      const queue = m => { pending = m; if (!raf) raf = requestAnimationFrame(flush); };
      pad.addEventListener('pointerdown', e => { active = true; pad.setPointerCapture(e.pointerId); pad.classList.add('on'); queue(Object.assign({ t: 'laser', on: true }, pos(e))); e.preventDefault(); });
      pad.addEventListener('pointermove', e => { if (active) queue(Object.assign({ t: 'laser', on: true }, pos(e))); });
      const end = () => { if (!active) return; active = false; pad.classList.remove('on'); queue({ t: 'laser', on: false }); };
      pad.addEventListener('pointerup', end);
      pad.addEventListener('pointercancel', end);
    },

    setTab(name) {
      this.tab = name;
      document.querySelectorAll('.panel').forEach(p => { p.hidden = p.dataset.tab !== name; });
      document.querySelectorAll('.tab').forEach(b => { const on = b.dataset.go === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
      $('rControls').hidden = name === 'tools' || name === 'timer';
      if (name === 'slides') { const cur = document.querySelector('#slideGrid .g.cur'); if (cur) cur.scrollIntoView({ block: 'center' }); }
      if (name === 'notes') this.renderNotes();
      if (name === 'timer') this.renderTimer();
    },

    setNoteMode(mode) {
      $('nEditMode').classList.toggle('on', mode === 'edit');
      $('nAllMode').classList.toggle('on', mode === 'all');
      $('noteEditWrap').hidden = mode !== 'edit';
      $('noteAll').hidden = mode !== 'all';
      this.noteMode = mode;
      this.renderNotes();
    },

    applyOpts() {
      const o = this.opts;
      document.documentElement.style.setProperty('--note-size', o.font + 'px');
      $('fontVal').textContent = o.font;
      $('optLight').checked = o.light; $('optVibrate').checked = o.vibrate; $('optSwipe').checked = o.swipe; $('optAwake').checked = o.awake;
      $('notes').classList.toggle('light', o.light);
      Object.keys(o).forEach(k => store.set(k, o[k]));
      this.keepAwake();
    },

    async keepAwake() {
      try {
        if (!this.opts.awake) { if (this.wakeLock) { await this.wakeLock.release(); this.wakeLock = null; } return; }
        if (navigator.wakeLock && !document.hidden && !this.wakeLock) {
          this.wakeLock = await navigator.wakeLock.request('screen');
          this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
        }
      } catch (e) {}
    },
    vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} },

    buildGrid() {
      const g = $('slideGrid');
      g.innerHTML = '';
      for (let i = 0; i < this.count; i++) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'g'; b.dataset.i = i;
        const img = document.createElement('span'); img.className = 'g-img';
        const n = document.createElement('span'); n.className = 'g-n'; n.textContent = i + 1;
        const dot = document.createElement('span'); dot.className = 'g-note'; dot.title = 'Có ghi chú'; dot.textContent = 'ghi chú';
        b.append(img, n, dot);
        b.addEventListener('click', () => { this.go(i); this.setTab('control'); });
        g.appendChild(b);
      }
      $('gridInfo').textContent = this.count + ' slide';
      $('toolLastSub').textContent = 'Slide ' + this.count;
    },

    renderPreviews() {
      const set = (el, i) => {
        const url = i < this.count ? this.thumbUrls[i] : null;
        el.style.backgroundImage = url ? 'url("' + url + '")' : '';
        el.classList.toggle('empty', !url);
        el.textContent = i >= this.count ? 'Hết' : (url ? '' : 'Đang tải…');
      };
      set($('pvCur'), this.index);
      set($('pvNext'), this.index + 1);
    },

    renderNotes() {
      const n = this.notes[this.index] || '';
      const el = $('notes');
      el.textContent = this.count ? (n || 'Slide này chưa có ghi chú.') : 'Đang chờ màn chiếu gửi bộ slide…';
      el.classList.toggle('empty', !n);
      $('noteEditLabel').textContent = 'Slide ' + (this.index + 1) + (this.count ? ' / ' + this.count : '');
      if (document.activeElement !== $('noteEditor')) $('noteEditor').value = n;
      if (this.noteMode === 'all') {
        const all = $('noteAll');
        all.innerHTML = '';
        this.notes.forEach((t, i) => {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'na' + (i === this.index ? ' cur' : '');
          const h = document.createElement('b'); h.textContent = 'Slide ' + (i + 1);
          const p = document.createElement('span'); p.textContent = t || '(chưa có ghi chú)';
          item.append(h, p);
          item.addEventListener('click', () => { this.go(i); this.setNoteMode('edit'); });
          all.appendChild(item);
        });
      }
      document.querySelectorAll('#slideGrid .g').forEach(b => {
        const i = +b.dataset.i;
        b.classList.toggle('cur', i === this.index);
        b.classList.toggle('has-note', !!(this.notes[i] || '').trim());
      });
    },

    renderTools() {
      $('toolBlack').setAttribute('aria-pressed', String(this.blank === 'black'));
      $('toolWhite').setAttribute('aria-pressed', String(this.blank === 'white'));
      $('toolQr').setAttribute('aria-pressed', String(this.qr));
    },

    renderAll() {
      $('rCount').textContent = this.count ? (this.index + 1) + ' / ' + this.count : '– / –';
      $('rPrev').disabled = !this.count || this.index === 0;
      $('rNext').disabled = !this.count || this.index >= this.count - 1;
      this.renderPreviews();
      this.renderNotes();
      this.renderTools();
      if (this.tab === 'timer') this.renderTimer();
      $('notes').scrollTop = 0;
    },

    /* ---------- hẹn giờ ---------- */
    elapsed() { return this.timer.elapsed + (this.timer.running ? Date.now() - this.timer.startAt : 0); },
    toggleTimer() {
      const t = this.timer, now = Date.now();
      if (t.running) {
        t.elapsed += now - t.startAt;
        t.slideMs[this.index] = (t.slideMs[this.index] || 0) + (now - t.slideStart);
        t.running = false;
      } else {
        t.startAt = now; t.slideStart = now; t.running = true;
      }
      this.renderTimer();
    },
    resetTimer() {
      const t = this.timer;
      t.running = false; t.elapsed = 0; t.slideMs = new Array(this.count).fill(0); t.warned5 = false; t.warned0 = false;
      this.renderTimer(); this.tick();
    },
    setTarget(v) {
      const n = Math.max(0, Math.min(600, parseInt(v, 10) || 0));
      this.timer.target = n; this.timer.warned5 = false; this.timer.warned0 = false;
      store.set('target', n);
      $('tTarget').value = n;
      this.renderTimer(); this.tick();
    },
    tick() {
      const t = this.timer, el = this.elapsed(), targetMs = t.target * 60000;
      if (targetMs) {
        const left = targetMs - el;
        $('rClock').textContent = (left < 0 ? '+' : '') + fmt(Math.abs(left));
        $('rClock').className = 'r-clock' + (left < 0 ? ' over' : left < 300000 ? ' low' : '');
        if (t.running && !t.warned5 && left <= 300000 && left > 0 && t.target > 5) { t.warned5 = true; this.vibrate([200, 100, 200]); toast('Còn 5 phút'); }
        if (t.running && !t.warned0 && left <= 0) { t.warned0 = true; this.vibrate([400, 150, 400, 150, 400]); toast('Đã hết giờ'); }
      } else {
        $('rClock').textContent = fmt(el);
        $('rClock').className = 'r-clock';
      }
      const onSlide = (t.running ? Date.now() - t.slideStart : 0) + 0;
      $('slideTime').textContent = fmtShort((t.slideMs[this.index] || 0) + onSlide);
      if (this.tab === 'timer') this.renderTimer(true);
    },
    renderTimer(light) {
      const t = this.timer, el = this.elapsed(), targetMs = t.target * 60000;
      $('tStart').textContent = t.running ? 'Tạm dừng' : (el ? 'Tiếp tục' : 'Bắt đầu');
      if (targetMs) {
        const left = targetMs - el;
        $('tMode').textContent = left < 0 ? 'QUÁ GIỜ' : 'CÒN LẠI';
        $('tBig').textContent = fmt(Math.abs(left));
        $('tBig').className = 'timer-big' + (left < 0 ? ' over' : left < 300000 ? ' low' : '');
        $('tSub').textContent = 'Đã nói ' + fmt(el) + ' / ' + t.target + ' phút';
        const timeFrac = Math.min(1, el / targetMs);
        const slideFrac = this.count ? (this.index + 1) / this.count : 0;
        $('barTime').style.width = (timeFrac * 100) + '%';
        $('barSlide').style.width = (slideFrac * 100) + '%';
        if (el > 0 && this.count) {
          const diffMin = (slideFrac - timeFrac) * t.target;
          $('tPace').textContent = Math.abs(diffMin) < 1 ? 'Đúng tiến độ' : diffMin > 0 ? 'Nhanh hơn kế hoạch khoảng ' + Math.round(diffMin) + ' phút' : 'Chậm hơn kế hoạch khoảng ' + Math.round(-diffMin) + ' phút';
          $('tPace').className = 'pace' + (diffMin < -1 ? ' behind' : diffMin > 1 ? ' ahead' : '');
        } else { $('tPace').textContent = 'Thanh trên: thời gian · thanh dưới: số slide đã qua'; $('tPace').className = 'pace'; }
      } else {
        $('tMode').textContent = 'ĐÃ NÓI';
        $('tBig').textContent = fmt(el);
        $('tBig').className = 'timer-big';
        $('tSub').textContent = t.running ? 'Đang đếm' : (el ? 'Đang dừng' : 'Chưa bắt đầu');
        $('barTime').style.width = '0%';
        $('barSlide').style.width = (this.count ? (this.index + 1) / this.count * 100 : 0) + '%';
        $('tPace').textContent = '';
      }
      if (light) return;
      $('tTarget').value = t.target;
      const body = $('timesBody');
      body.innerHTML = '';
      const now = Date.now();
      for (let i = 0; i < this.count; i++) {
        let ms = t.slideMs[i] || 0;
        if (t.running && i === this.index) ms += now - t.slideStart;
        const tr = document.createElement('tr');
        if (i === this.index) tr.className = 'cur';
        const a = document.createElement('td'); a.textContent = 'Slide ' + (i + 1);
        const b = document.createElement('td'); b.textContent = ms ? fmtShort(ms) : '–';
        tr.append(a, b);
        body.appendChild(tr);
      }
    }
  };

  /* =====================================================================
     XEM THỬ: chạy màn chiếu và điện thoại trong cùng một trang, slide mẫu
     ===================================================================== */
  const Demo = {
    slides: [
      { t: 'Game & Web/App tại Việt Nam 2026', s: 'Buổi định hướng nghề nghiệp', bg: '#10172A', fg: '#F6F5F0', ac: '#F2994A',
        n: 'Chào mọi người. Hôm nay chúng ta nhìn vào hai ngành mà rất nhiều bạn trẻ đang cân nhắc: game và web/app.\n\nMục tiêu: hiểu thị trường đang ở đâu, và người mới nên chuẩn bị gì trong 1–5 năm tới.' },
      { t: 'Nội dung buổi định hướng', s: 'Thị trường game · Web/App · Outsource · Nghề nghiệp', bg: '#F6F5F0', fg: '#10172A', ac: '#B4570A',
        n: 'Bốn phần. Ba phần đầu là bức tranh thị trường, phần cuối là phần quan trọng nhất: nên học gì, làm gì.' },
      { t: 'Ngành game Việt: nhỏ trong nước, lớn trên thế giới', s: '~650 triệu USD nội địa · Top 5 phát hành game mobile', bg: '#10172A', fg: '#F6F5F0', ac: '#F2994A',
        n: 'Thị trường nội địa mới khoảng 650 triệu USD, nhưng Việt Nam nằm trong top 5 thế giới về phát hành game mobile theo lượt tải.' },
      { t: 'Cạnh tranh việc làm: đông ứng viên, thiếu người giỏi', s: '85% doanh nghiệp coi kinh nghiệm dự án là tiêu chí số 1', bg: '#F6F5F0', fg: '#10172A', ac: '#B4570A',
        n: 'Việc làm vẫn nhiều nhưng cạnh tranh rất gắt. Hơn một nửa doanh nghiệp tập trung vào hiệu suất, nên mỗi vị trí tuyển đều kỹ hơn.' },
      { t: 'AI không xóa chỗ cho người mới – nó nâng chuẩn đầu vào', s: 'Thông điệp chính của buổi hôm nay', bg: '#F2994A', fg: '#10172A', ac: '#10172A',
        n: 'Doanh nghiệp không trả tiền cho việc gõ code nhanh, mà cho việc hiểu vấn đề, dùng AI hiệu quả và biết khi nào AI sai.' },
      { t: 'Bắt đầu ngay từ tuần này', s: 'Hỏi & Đáp', bg: '#10172A', fg: '#F6F5F0', ac: '#F2994A',
        n: '' }
    ],

    drawSlide(i, maxW, maxH) {
      const d = this.slides[i];
      const W = 1920, H = 1080, scale = Math.min(maxW / W, maxH / H);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(W * scale)); c.height = Math.max(1, Math.floor(H * scale));
      const g = c.getContext('2d');
      g.scale(scale, scale);
      g.fillStyle = d.bg; g.fillRect(0, 0, W, H);
      g.fillStyle = d.ac; g.beginPath(); g.arc(1690, 250, 110, 0, Math.PI * 2); g.fill();
      const ui = "'Be Vietnam Pro', 'Segoe UI', Arial, sans-serif";
      g.fillStyle = d.ac; g.font = "700 28px 'JetBrains Mono', monospace";
      g.fillText('SLIDE MẪU · ' + (i + 1) + ' / ' + this.slides.length, 128, 170);
      g.fillStyle = d.fg; g.font = '800 104px ' + ui;
      const words = d.t.split(' '); let line = '', y = 470; const lines = [];
      words.forEach(w => { const test = line ? line + ' ' + w : w; if (g.measureText(test).width > 1400 && line) { lines.push(line); line = w; } else line = test; });
      lines.push(line);
      y = 560 - (lines.length - 1) * 60;
      lines.forEach((l, k) => g.fillText(l, 128, y + k * 120));
      g.globalAlpha = 0.75; g.font = '500 44px ' + ui;
      g.fillText(d.s, 128, y + lines.length * 120 + 40);
      g.globalAlpha = 1;
      g.fillRect(128, 900, 220, 8);
      return Promise.resolve(c);
    },

    pair() {
      const mk = () => ({
        open: true, demo: true, h: {},
        on(e, f) { (this.h[e] = this.h[e] || []).push(f); },
        emit(e, v) { (this.h[e] || []).forEach(f => f(v)); },
        send(m) { const o = this.other; setTimeout(() => o.emit('data', structuredClone(m)), 40); }
      });
      const a = mk(), b = mk(); a.other = b; b.other = a;
      return [a, b];
    },

    start() {
      document.body.classList.add('demo');
      const wrap = document.createElement('div');
      wrap.className = 'demo-wrap';
      wrap.innerHTML =
        '<div class="demo-bar">' +
          '<div class="demo-title"><p class="eyebrow">BẢN XEM THỬ · SLIDE MẪU</p><h1>Trình Chiếu Từ Xa</h1></div>' +
          '<div class="seg" role="group" aria-label="Màn hình xem thử">' +
            '<button type="button" class="seg-btn on" data-demo="live">Chiếu + điều khiển</button>' +
            '<button type="button" class="seg-btn" data-demo="home">Trang chủ laptop</button>' +
            '<button type="button" class="seg-btn" data-demo="join">Nhập mã</button>' +
          '</div>' +
        '</div>' +
        '<p class="demo-note">Bên trái là màn chiếu trên laptop, bên phải là điện thoại. Bấm, vuốt, đổi tab trên điện thoại để thử; màn chiếu đổi theo.</p>' +
        '<div class="demo-stage" id="demoLive">' +
          '<div class="frame-laptop"><span class="frame-label">LAPTOP · MÁY CHIẾU</span><div class="screen-box" id="demoScreen"></div></div>' +
          '<div class="frame-phone"><span class="frame-label">ĐIỆN THOẠI</span><div class="phone-box" id="demoPhone"></div></div>' +
        '</div>' +
        '<div class="demo-stage" id="demoHome" hidden><div class="frame-laptop wide"><span class="frame-label">LAPTOP · TRANG CHỦ</span><div class="page-box" id="demoHomeBox"></div></div></div>' +
        '<div class="demo-stage" id="demoJoin" hidden><div class="frame-phone"><span class="frame-label">ĐIỆN THOẠI · MỞ LINK KHÔNG CÓ MÃ</span><div class="phone-box" id="demoJoinBox"></div></div></div>';
      document.body.prepend(wrap);
      $('demoScreen').appendChild($('screen'));
      $('demoPhone').appendChild($('remote'));
      $('demoHomeBox').appendChild($('home'));
      $('demoJoinBox').appendChild($('join'));
      $('home').hidden = false; $('join').hidden = false;
      $('joinForm').addEventListener('submit', e => { e.preventDefault(); toast('Bản xem thử: trên web thật, mã đúng sẽ mở màn hình điều khiển.'); });
      Host.initHome();
      show('none');
      ['home', 'join'].forEach(id => { $(id).hidden = false; });
      wrap.querySelectorAll('[data-demo]').forEach(b => b.addEventListener('click', () => {
        const m = b.dataset.demo;
        wrap.querySelectorAll('[data-demo]').forEach(x => x.classList.toggle('on', x === b));
        $('demoLive').hidden = m !== 'live'; $('demoHome').hidden = m !== 'home'; $('demoJoin').hidden = m !== 'join';
        if (m === 'live') { Host.cache.clear(); Host.render(); }
      }));

      Host.demo = true;
      Host.count = this.slides.length;
      Host.title = 'Bộ slide mẫu';
      Host.notes = this.slides.map(x => x.n);
      Host.thumbs = new Array(Host.count).fill(null);
      Host.code = 'DEMO42';
      Host.peer = { open: true };
      Host.enterScreen();
      ['home', 'join'].forEach(id => { $(id).hidden = false; });
      $('remote').hidden = false;
      Host.drawQr();
      Host.updateConnUi();
      const [a, b] = this.pair();
      Remote.start('DEMO42', b);
      Host.makeThumbs();
      setTimeout(() => { Host.accept(a); a.emit('open'); }, 1800);
    }
  };

  /* =====================================================================
     KHỞI ĐỘNG
     ===================================================================== */
  function boot() {
    const params = new URLSearchParams(location.search);
    if (window.TC_DEMO || location.hash === '#demo' || params.has('demo')) { Demo.start(); return; }
    if (params.has('join')) {
      const code = cleanCode(params.get('join'));
      if (code.length === 6) { Remote.start(code); return; }
      show('join');
      const input = $('joinCode');
      input.value = store.get('lastCode', '');
      $('joinForm').addEventListener('submit', e => {
        e.preventDefault();
        const c = cleanCode(input.value);
        if (c.length !== 6) { const m = $('joinMsg'); m.textContent = 'Mã gồm 6 ký tự, hiện trên màn chiếu.'; m.className = 'msg err'; m.hidden = false; return; }
        location.search = '?join=' + c;
      });
      return;
    }
    Host.initHome();
  }
  boot();
})();

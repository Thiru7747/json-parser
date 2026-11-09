/* ============================================================
   JSON Studio — app
   ============================================================ */
(function () {
  'use strict';

  const J = window.JSONStudio;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');
  const MOD = isMac ? '⌘' : 'Ctrl';
  const STORAGE_KEY = 'json-studio-v1';
  const LINE_HEIGHT = 22;
  const PAD_TOP = 14;
  const PAGE_SIZE = 300;

  /* ------------------------------------------------------------
     Sample data
     ------------------------------------------------------------ */

  const SAMPLE = {
    meta: {
      name: 'Aurora Analytics',
      version: '2.4.0',
      generatedAt: '2026-11-09T09:24:00Z',
      tags: ['analytics', 'realtime', 'dashboard'],
      docs: 'https://example.com/docs'
    },
    workspace: {
      id: 'ws_8f3a2c',
      plan: 'scale',
      seats: 24,
      features: { aiInsights: true, customDomains: true, sso: false },
      limits: { eventsPerSecond: 5000, retentionDays: 90 }
    },
    users: [
      {
        id: 1,
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        role: 'owner',
        active: true,
        lastSeen: '2026-11-09T08:12:41Z',
        preferences: { theme: 'dark', notifications: { email: true, push: false } }
      },
      {
        id: 2,
        name: 'Grace Hopper',
        email: 'grace@example.com',
        role: 'admin',
        active: true,
        lastSeen: '2026-11-09T07:58:03Z',
        preferences: { theme: 'light', notifications: { email: true, push: true } }
      },
      {
        id: 3,
        name: 'Alan Turing',
        email: 'alan@example.com',
        role: 'analyst',
        active: false,
        lastSeen: '2026-10-31T22:04:19Z',
        preferences: { theme: 'dark', notifications: { email: false, push: false } }
      }
    ],
    metrics: {
      mrr: 48250.5,
      churnRate: 0.021,
      nps: 72,
      weeklyActive: [1240, 1382, 1290, 1455, 1602],
      regions: { 'us-east': 0.52, 'eu-west': 0.31, apac: 0.17 }
    },
    integrations: [
      { name: 'Slack', enabled: true, scopes: ['chat:write', 'users:read'] },
      { name: 'Stripe', enabled: true, scopes: ['charges:read'] },
      { name: 'Salesforce', enabled: false, scopes: [] }
    ],
    flags: { betaBilling: null, newOnboarding: true, maxUploadMb: 250 },
    notes: 'Everything here is sample data — edit freely.\nTry Lenient mode, search, paths, and the converters.'
  };

  const SAMPLE_TEXT = JSON.stringify(SAMPLE, null, 2);

  /* ------------------------------------------------------------
     State
     ------------------------------------------------------------ */

  const state = {
    text: '',
    parse: null,
    expanded: new Set(['$']),
    searchExpanded: new Set(),
    shown: new Map(),
    selectedPath: '$',
    cursorLine: 1,
    search: '',
    searchMatches: [],
    searchIndex: -1,
    theme: 'dark',
    indent: '2',
    lenient: false,
    fileName: 'untitled.json',
    lastLoadedText: '',
    dirty: false,
    activeTab: 'tree',
    split: 0.5,
    convertFormat: 'typescript',
    convertText: '',
    statsDirty: true,
    convertDirty: true,
    gutterLineCount: 0,
    dismissedErrorIndex: null,
    toastTimer: 0
  };

  /* ------------------------------------------------------------
     Elements
     ------------------------------------------------------------ */

  const el = {
    html: document.documentElement,
    editor: $('#editor'),
    highlight: $('#highlight'),
    highlightPre: $('#highlightPre'),
    gutterInner: $('#gutterInner'),
    gutter: $('#gutter'),
    activeBand: $('#activeBand'),
    errorBand: $('#errorBand'),
    lineCount: $('#lineCount'),
    fileName: $('#fileName'),
    fileEdited: $('#fileEdited'),
    errorBanner: $('#errorBanner'),
    errorTitle: $('#errorTitle'),
    errorMeta: $('#errorMeta'),
    revealError: $('#revealError'),
    dismissError: $('#dismissError'),
    validity: $('#validity'),
    validityText: $('#validityText'),
    themeBtn: $('#themeBtn'),
    helpBtn: $('#helpBtn'),
    openBtn: $('#openBtn'),
    sampleBtn: $('#sampleBtn'),
    clearBtn: $('#clearBtn'),
    formatBtn: $('#formatBtn'),
    minifyBtn: $('#minifyBtn'),
    sortBtn: $('#sortBtn'),
    copyBtn: $('#copyBtn'),
    downloadBtn: $('#downloadBtn'),
    indentSelect: $('#indentSelect'),
    lenientToggle: $('#lenientToggle'),
    paletteBtn: $('#paletteBtn'),
    workspace: $('#workspace'),
    splitter: $('#splitter'),
    treeSearch: $('#treeSearch'),
    searchCount: $('#searchCount'),
    searchPrev: $('#searchPrev'),
    searchNext: $('#searchNext'),
    searchClear: $('#searchClear'),
    expandAll: $('#expandAll'),
    collapseAll: $('#collapseAll'),
    pathInput: $('#pathInput'),
    pathType: $('#pathType'),
    copyPathBtn: $('#copyPathBtn'),
    treeScroll: $('#treeScroll'),
    tree: $('#tree'),
    statsContent: $('#statsContent'),
    convertSelect: $('#convertSelect'),
    convertOutput: $('#convertOutput'),
    copyConvert: $('#copyConvert'),
    downloadConvert: $('#downloadConvert'),
    tabHint: $('#tabHint'),
    cursorPos: $('#cursorPos'),
    charCount: $('#charCount'),
    statusDot: $('#statusDot'),
    parseStatus: $('#parseStatus'),
    warnChip: $('#warnChip'),
    warnChipText: $('#warnChipText'),
    sizeStat: $('#sizeStat'),
    nodeStat: $('#nodeStat'),
    depthStat: $('#depthStat'),
    timeStat: $('#timeStat'),
    fileInput: $('#fileInput'),
    dropOverlay: $('#dropOverlay'),
    toast: $('#toast'),
    toastText: $('#toastText'),
    toastIcon: $('#toastIcon'),
    shortcutsModal: $('#shortcutsModal'),
    warningsModal: $('#warningsModal'),
    warningsList: $('#warningsList'),
    paletteModal: $('#paletteModal'),
    paletteInput: $('#paletteInput'),
    paletteList: $('#paletteList'),
    formatKbd: $('#formatKbd')
  };

  /* ------------------------------------------------------------
     Utilities
     ------------------------------------------------------------ */

  function formatBytes(n) {
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    if (n < 1024) return Math.round(n) + ' B';
    if (n < 1024 * 1024) {
      const v = n / 1024;
      return (v < 10 ? v.toFixed(1) : Math.round(v)) + ' KB';
    }
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function unitForIndent() {
    return state.indent === 'tab' ? '\t' : ' '.repeat(Number(state.indent) || 2);
  }

  function setPathType(type) {
    el.pathType.textContent = type || '—';
    if (type) el.pathType.dataset.type = type;
    else delete el.pathType.dataset.type;
  }

  function toast(message, kind) {
    kind = kind || 'success';
    el.toastText.textContent = message;
    el.toast.className = 'toast show' + (kind === 'success' ? '' : ' ' + kind);
    const icon = kind === 'error' ? 'i-x' : kind === 'warn' ? 'i-alert' : 'i-check';
    el.toastIcon.innerHTML = '<svg class="icon"><use href="#' + icon + '"/></svg>';
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2300);
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }

  function copyText(text, message) {
    const done = () => toast(message || 'Copied to clipboard');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text);
      done();
    }
  }

  /* ------------------------------------------------------------
     Theme, layout, persistence
     ------------------------------------------------------------ */

  function setTheme(theme) {
    state.theme = theme;
    el.html.dataset.theme = theme;
    try { localStorage.setItem(STORAGE_KEY + ':theme', theme); } catch (e) { /* ignore */ }
    saveStateSoon();
  }

  function toggleTheme() {
    setTheme(state.theme === 'dark' ? 'light' : 'dark');
  }

  function setSplit(ratio, persist) {
    state.split = clamp(ratio, 0.28, 0.72);
    el.workspace.style.setProperty('--split', String(state.split));
    if (persist) saveStateSoon();
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  let saveTimer = 0;
  function saveStateSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 450);
  }

  function saveState() {
    try {
      const canSave = state.text.length < 300000;
      const data = {
        theme: state.theme,
        indent: state.indent,
        lenient: state.lenient,
        split: state.split,
        tab: state.activeTab,
        format: state.convertFormat,
        fileName: state.fileName,
        hasText: canSave,
        tooLarge: !canSave,
        text: canSave ? state.text : ''
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* quota or private mode */ }
  }

  /* ------------------------------------------------------------
     Documents
     ------------------------------------------------------------ */

  function setDocument(text, name) {
    text = String(text == null ? '' : text);
    el.editor.value = text;
    state.text = text;
    state.fileName = name || 'untitled.json';
    state.lastLoadedText = text;
    state.dirty = false;
    state.dismissedErrorIndex = null;
    state.search = '';
    state.searchMatches = [];
    state.searchIndex = -1;
    state.searchExpanded = new Set();
    state.selectedPath = '$';
    el.treeSearch.value = '';
    el.pathInput.value = '$';
    el.pathInput.classList.remove('invalid');
    updateFileMeta();
    updateHighlight();
    updateGutter(text);
    updateCursor();
    parseNow(true);
    el.editor.setSelectionRange(0, 0);
    el.editor.scrollTop = 0;
    syncScroll();
  }

  function loadSample() {
    setDocument(SAMPLE_TEXT, 'aurora-sample.json');
    toast('Sample loaded — explore the tree, search, or convert it');
  }

  function clearAll() {
    setDocument('', 'untitled.json');
    el.editor.focus();
    toast('Editor cleared');
  }

  function readFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast('That file is larger than 20 MB', 'warn');
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      setDocument(String(reader.result || ''), file.name || 'untitled.json');
      toast('Loaded ' + file.name + ' · ' + formatBytes(file.size));
    };
    reader.onerror = function () {
      toast('Could not read that file', 'error');
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------
     Editor chrome
     ------------------------------------------------------------ */

  function updateHighlight() {
    const text = el.editor.value;
    if (text.length > 400000) {
      el.highlight.textContent = text + '\n';
    } else {
      el.highlight.innerHTML = (text ? J.highlight(text, state.lenient) : '') + '\n';
    }
    el.highlightPre.scrollTop = el.editor.scrollTop;
    el.highlightPre.scrollLeft = el.editor.scrollLeft;
  }

  function updateGutter(text) {
    const count = (text.match(/\n/g) || []).length + 1;
    if (state.gutterLineCount !== count) {
      let html = '';
      for (let i = 1; i <= count; i++) {
        html += '<div class="ln" data-line="' + i + '">' + i + '</div>';
      }
      el.gutterInner.innerHTML = html;
      state.gutterLineCount = count;
      el.lineCount.textContent = count.toLocaleString() + (count === 1 ? ' line' : ' lines');
    }
    updateGutterMarks();
  }

  function updateGutterMarks() {
    const active = el.gutterInner.querySelector('.ln.active');
    if (active) active.classList.remove('active');
    const line = state.cursorLine || 1;
    const activeNode = el.gutterInner.querySelector('.ln[data-line="' + line + '"]');
    if (activeNode) activeNode.classList.add('active');

    const errs = el.gutterInner.querySelectorAll('.ln.error');
    for (let i = 0; i < errs.length; i++) errs[i].classList.remove('error');
    const p = state.parse;
    if (p && !p.ok && !p.empty && p.error && state.dismissedErrorIndex !== p.error.index) {
      const errNode = el.gutterInner.querySelector('.ln[data-line="' + p.error.line + '"]');
      if (errNode) errNode.classList.add('error');
    }
  }

  function updateCursor() {
    const pos = el.editor.selectionStart || 0;
    const text = el.editor.value;
    const before = text.slice(0, pos);
    const line = (before.match(/\n/g) || []).length + 1;
    const lineStart = before.lastIndexOf('\n') + 1;
    const col = pos - lineStart + 1;
    const selLen = (el.editor.selectionEnd || pos) - pos;
    state.cursorLine = line;
    el.cursorPos.textContent = 'Ln ' + line + ', Col ' + col + (selLen > 0 ? ' · ' + selLen + ' selected' : '');
    updateGutterMarks();
    updateBands();
  }

  function updateBands() {
    const scrollTop = el.editor.scrollTop;
    const viewH = el.editor.clientHeight;
    const place = (band, line, show) => {
      if (!show || !line) {
        band.classList.remove('show');
        return;
      }
      const top = PAD_TOP + (line - 1) * LINE_HEIGHT - scrollTop;
      band.style.top = top + 'px';
      band.classList.toggle('show', top > -LINE_HEIGHT && top < viewH - 1);
    };

    place(el.activeBand, state.cursorLine || 1, true);

    const p = state.parse;
    const err = p && !p.ok && !p.empty && p.error && state.dismissedErrorIndex !== p.error.index ? p.error : null;
    place(el.errorBand, err ? err.line : 0, !!err);
  }

  function syncScroll() {
    el.highlightPre.scrollTop = el.editor.scrollTop;
    el.highlightPre.scrollLeft = el.editor.scrollLeft;
    el.gutterInner.style.transform = 'translateY(' + (-el.editor.scrollTop) + 'px)';
    updateBands();
  }

  function jumpToIndex(index, length) {
    const text = el.editor.value;
    const start = clamp(index, 0, text.length);
    const end = clamp(start + Math.max(1, length || 1), start, text.length);
    el.editor.focus();
    el.editor.setSelectionRange(start, end);
    const loc = J.locate(text, start);
    el.editor.scrollTop = Math.max(0, (loc.line - 1) * LINE_HEIGHT - el.editor.clientHeight / 2 + LINE_HEIGHT);
    syncScroll();
    updateCursor();
  }

  let chromeRaf = 0;
  function scheduleChrome() {
    if (chromeRaf) return;
    chromeRaf = requestAnimationFrame(function () {
      chromeRaf = 0;
      updateHighlight();
      updateGutter(el.editor.value);
      updateBands();
    });
  }

  /* ------------------------------------------------------------
     Parse pipeline
     ------------------------------------------------------------ */

  let parseTimer = 0;

  function scheduleParse() {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(function () { parseNow(false); }, 150);
  }

  function normalizeError(err) {
    if (err && err.name === 'JSONParseError') return err;
    return {
      name: 'Error',
      message: err && err.message ? String(err.message) : String(err),
      line: 1,
      column: 1,
      index: 0,
      length: 1,
      lineText: ''
    };
  }

  function parseNow(initial) {
    clearTimeout(parseTimer);
    const text = el.editor.value;
    state.text = text;
    const started = performance.now();
    let result;

    if (!text.trim()) {
      result = { ok: false, empty: true, ms: 0 };
    } else {
      try {
        const parsed = J.parseJSON(text, { lenient: state.lenient });
        result = {
          ok: true,
          ast: parsed.ast,
          value: parsed.value,
          warnings: parsed.warnings,
          stats: parsed.stats
        };
      } catch (err) {
        result = { ok: false, error: normalizeError(err) };
      }
    }
    result.ms = performance.now() - started;
    const wasOk = !!(state.parse && state.parse.ok);
    state.parse = result;

    if (result.ok) {
      if (initial || !wasOk) resetTreeState(result.ast, true);
      if (!state.selectedPath || !resolvePath(state.selectedPath)) {
        state.selectedPath = '$';
        el.pathInput.value = '$';
      }
      const selected = resolvePath(state.selectedPath);
      if (selected) setPathType(selected.node.type);
      computeSearch();
      renderTree();
      if (state.activeTab === 'stats') renderStats(); else state.statsDirty = true;
      if (state.activeTab === 'convert') renderConvert(); else state.convertDirty = true;
    } else {
      state.searchMatches = [];
      state.searchIndex = -1;
      if (state.activeTab === 'tree') renderTree();
      if (state.activeTab === 'stats') renderStats();
      if (state.activeTab === 'convert') renderConvert();
    }

    updateStatus();
    updateEditorChrome();
    updateFileMeta();
    saveStateSoon();
  }

  function updateEditorChrome() {
    updateHighlight();
    updateGutter(el.editor.value);
    updateBands();
  }

  function onInput() {
    state.text = el.editor.value;
    state.dirty = state.text !== state.lastLoadedText;
    state.dismissedErrorIndex = null;
    el.charCount.textContent = state.text.length.toLocaleString() + ' chars';
    updateFileMeta();
    updateCursor();
    scheduleChrome();
    scheduleParse();
    saveStateSoon();
  }

  /* ------------------------------------------------------------
     Status bar
     ------------------------------------------------------------ */

  function updateFileMeta() {
    el.fileName.textContent = state.fileName;
    el.fileName.title = state.fileName;
    el.fileEdited.hidden = !state.dirty;
  }

  function updateStatus() {
    const p = state.parse;
    const text = el.editor.value;
    const bytes = J.byteLength(text);
    el.sizeStat.textContent = formatBytes(bytes);
    el.charCount.textContent = text.length.toLocaleString() + ' chars';

    if (!p || p.empty) {
      el.validity.className = 'validity idle';
      el.validityText.textContent = 'Waiting for input';
      el.statusDot.className = 'status-dot empty';
      el.parseStatus.textContent = 'Ready';
      el.nodeStat.textContent = '0 nodes';
      el.depthStat.textContent = 'depth 0';
      el.timeStat.textContent = '—';
      el.warnChip.hidden = true;
      el.errorBanner.hidden = true;
      return;
    }

    el.timeStat.textContent = p.ms > 0 ? p.ms.toFixed(1) + ' ms' : '—';

    if (p.ok) {
      el.validity.className = 'validity valid';
      el.validityText.textContent = 'Valid JSON';
      el.statusDot.className = 'status-dot valid';
      el.parseStatus.textContent = 'Valid JSON';
      el.nodeStat.textContent = p.stats.nodes.toLocaleString() + ' nodes';
      el.depthStat.textContent = 'depth ' + p.stats.depth;
      el.warnChip.hidden = p.warnings.length === 0;
      if (p.warnings.length) {
        el.warnChipText.textContent = p.warnings.length + (p.warnings.length === 1 ? ' warning' : ' warnings');
        el.warnChip.title = p.warnings[0].message;
      }
      el.errorBanner.hidden = true;
    } else {
      const err = p.error;
      el.validity.className = 'validity invalid';
      el.validityText.textContent = 'Invalid JSON';
      el.statusDot.className = 'status-dot invalid';
      el.parseStatus.textContent = 'Parse error';
      el.nodeStat.textContent = '— nodes';
      el.depthStat.textContent = 'depth —';
      el.warnChip.hidden = true;

      const dismissed = state.dismissedErrorIndex === err.index;
      el.errorBanner.hidden = dismissed;
      if (!dismissed) {
        el.errorTitle.textContent = err.message;
        el.errorTitle.title = err.message;
        let meta = 'Line ' + err.line + ', column ' + err.column;
        const snippet = (err.lineText || '').trim();
        if (snippet) meta += ' · ' + snippet.slice(0, 68);
        el.errorMeta.textContent = meta;
      }
    }
  }

  /* ------------------------------------------------------------
     Paths
     ------------------------------------------------------------ */

  function childPath(parent, node) {
    if (node.keyKind === 'index') return parent + '[' + node.key + ']';
    const key = String(node.key);
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return parent + '.' + key;
    return parent + '[' + JSON.stringify(key) + ']';
  }

  function pathFromSegments(segments) {
    let path = '$';
    for (const seg of segments) {
      if (seg.isIndex) {
        path += '[' + seg.key + ']';
      } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(seg.key))) {
        path += '.' + seg.key;
      } else {
        path += '[' + JSON.stringify(String(seg.key)) + ']';
      }
    }
    return path;
  }

  function parsePathString(input) {
    let s = String(input == null ? '' : input).trim();
    if (!s) return null;
    if (s === '$') return { segments: [] };
    if (s.charAt(0) === '$') s = s.slice(1);
    const segments = [];
    let i = 0;

    while (i < s.length) {
      const c = s[i];
      if (c === '.') {
        i++;
        const start = i;
        while (i < s.length && s[i] !== '.' && s[i] !== '[') i++;
        const key = s.slice(start, i);
        if (!key) return null;
        segments.push({ key: key, isIndex: false });
      } else if (c === '[') {
        i++;
        while (i < s.length && /\s/.test(s[i])) i++;
        if (s[i] === '"' || s[i] === "'") {
          const quote = s[i];
          i++;
          let val = '';
          let closed = false;
          while (i < s.length) {
            const ch = s[i];
            if (ch === '\\') {
              const e = s[i + 1];
              if (e === 'u') {
                const hex = s.slice(i + 2, i + 6);
                if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
                val += String.fromCharCode(parseInt(hex, 16));
                i += 6;
              } else {
                const map = { '"': '"', "'": "'", '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
                if (!(e in map)) return null;
                val += map[e];
                i += 2;
              }
            } else if (ch === quote) {
              closed = true;
              i++;
              break;
            } else {
              val += ch;
              i++;
            }
          }
          if (!closed) return null;
          while (i < s.length && /\s/.test(s[i])) i++;
          if (s[i] !== ']') return null;
          i++;
          segments.push({ key: val, isIndex: false });
        } else {
          const start = i;
          while (i < s.length && /[0-9]/.test(s[i])) i++;
          if (start === i) return null;
          const idx = parseInt(s.slice(start, i), 10);
          while (i < s.length && /\s/.test(s[i])) i++;
          if (s[i] !== ']') return null;
          i++;
          segments.push({ key: idx, isIndex: true });
        }
      } else if (i === 0) {
        const start = i;
        while (i < s.length && s[i] !== '.' && s[i] !== '[') i++;
        const key = s.slice(start, i);
        if (!key) return null;
        segments.push({ key: key, isIndex: false });
      } else {
        return null;
      }
    }
    return { segments: segments };
  }

  function resolvePath(pathStr) {
    const parsed = parsePathString(pathStr);
    if (!parsed) return null;
    const p = state.parse;
    if (!p || !p.ok) return null;
    let node = p.ast;
    for (const seg of parsed.segments) {
      if (!node || (node.type !== 'object' && node.type !== 'array')) return null;
      if (node.type === 'array') {
        const idx = seg.isIndex
          ? seg.key
          : (/^\d+$/.test(String(seg.key)) ? Number(seg.key) : NaN);
        if (!Number.isInteger(idx) || idx < 0 || idx >= node.children.length) return null;
        node = node.children[idx];
      } else {
        const key = String(seg.key);
        const child = node.children.find(function (c) { return String(c.key) === key; });
        if (!child) return null;
        node = child;
      }
    }
    return { node: node, segments: parsed.segments };
  }

  function findRow(path) {
    const rows = el.tree.querySelectorAll('.tree-row');
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].dataset.path === path) return rows[i];
    }
    return null;
  }

  function updateTabHint(node) {
    if (!node) {
      el.tabHint.textContent = 'click a node to inspect';
      return;
    }
    if (node.type === 'object') {
      el.tabHint.textContent = node.children.length + (node.children.length === 1 ? ' key' : ' keys');
    } else if (node.type === 'array') {
      el.tabHint.textContent = node.children.length + (node.children.length === 1 ? ' item' : ' items');
    } else if (node.type === 'string') {
      el.tabHint.textContent = 'string · ' + node.value.length + ' chars';
    } else if (node.type === 'number') {
      el.tabHint.textContent = 'number';
    } else if (node.type === 'boolean') {
      el.tabHint.textContent = 'boolean';
    } else {
      el.tabHint.textContent = 'null';
    }
  }

  function selectPath(path, scroll) {
    const resolved = resolvePath(path);
    if (!resolved) return false;
    state.selectedPath = path;
    el.pathInput.value = path;
    el.pathInput.classList.remove('invalid');
    setPathType(resolved.node.type);
    const rows = el.tree.querySelectorAll('.tree-row.selected');
    for (let i = 0; i < rows.length; i++) rows[i].classList.remove('selected');
    const row = findRow(path);
    if (row) {
      row.classList.add('selected');
      if (scroll) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    updateTabHint(resolved.node);
    return true;
  }

  function resetTreeState(ast, autoExpand) {
    state.expanded = new Set();
    state.shown = new Map();
    state.searchExpanded = new Set();
    if (!ast) return;
    state.expanded.add('$');
    if (autoExpand && ast.children) {
      let n = 0;
      for (const child of ast.children) {
        if ((child.type === 'object' || child.type === 'array') && n < 12) {
          state.expanded.add(childPath('$', child));
          n++;
        }
      }
    }
  }

  /* ------------------------------------------------------------
     Tree display helpers
     ------------------------------------------------------------ */

  function highlightHTML(text, query) {
    const s = String(text);
    const q = (query || '').trim();
    if (!q) return J.escapeHTML(s);
    const lower = s.toLowerCase();
    const ql = q.toLowerCase();
    let out = '';
    let i = 0;
    let idx;
    while ((idx = lower.indexOf(ql, i)) !== -1) {
      out += J.escapeHTML(s.slice(i, idx));
      out += '<mark>' + J.escapeHTML(s.slice(idx, idx + q.length)) + '</mark>';
      i = idx + q.length;
      if (i >= s.length) break;
    }
    out += J.escapeHTML(s.slice(i));
    return out;
  }

  function previewText(node) {
    if (node.type === 'object') return '{ ' + node.children.length + (node.children.length === 1 ? ' key' : ' keys') + ' }';
    if (node.type === 'array') return '[ ' + node.children.length + (node.children.length === 1 ? ' item' : ' items') + ' ]';
    if (node.type === 'string') {
      const v = node.value;
      return JSON.stringify(v.length > 42 ? v.slice(0, 42) + '…' : v);
    }
    if (node.type === 'number') return node.raw;
    if (node.type === 'boolean') return String(node.value);
    return 'null';
  }

  function previewValueHTML(node) {
    if (node.type === 'string') {
      const v = node.value;
      return '<span class="pv-str">' + J.escapeHTML(JSON.stringify(v.length > 22 ? v.slice(0, 22) + '…' : v)) + '</span>';
    }
    if (node.type === 'number') return '<span class="pv-num">' + J.escapeHTML(node.raw) + '</span>';
    if (node.type === 'boolean') return '<span class="pv-bool">' + String(node.value) + '</span>';
    if (node.type === 'null') return '<span class="pv-null">null</span>';
    if (node.type === 'object') return '<span class="pv-key">{…}</span>';
    return '<span class="pv-key">[…]</span>';
  }

  function previewHTML(node) {
    const isObj = node.type === 'object';
    const parts = [];
    const kids = node.children.slice(0, 4);
    for (const child of kids) {
      const key = isObj
        ? '<span class="pv-key">' + J.escapeHTML(JSON.stringify(String(child.key))) + '</span>: '
        : '';
      parts.push(key + previewValueHTML(child));
    }
    return (isObj ? '{ ' : '[ ') + parts.join(', ') +
      (node.children.length > 4 ? ', …' : '') +
      (isObj ? ' }' : ' ]');
  }

  function valueHTML(node) {
    if (node.type === 'string') {
      const v = node.value;
      const display = v.length > 120 ? JSON.stringify(v.slice(0, 120) + '…') : node.raw;
      return highlightHTML(display, state.search);
    }
    if (node.type === 'number') return highlightHTML(node.raw, state.search);
    if (node.type === 'boolean') return highlightHTML(String(node.value), state.search);
    return 'null';
  }

  /* ------------------------------------------------------------
     Search
     ------------------------------------------------------------ */

  function computeSearch() {
    state.search = el.treeSearch.value.trim();
    state.searchMatches = [];
    state.searchExpanded = new Set();
    state.searchIndex = -1;

    if (!state.search || !state.parse || !state.parse.ok) {
      updateSearchUI();
      return;
    }

    const q = state.search.toLowerCase();
    const matches = [];
    const ancestors = [];
    const MAX = 2000;

    function walk(node, path) {
      if (matches.length >= MAX) return;
      const keyText = node.keyKind === 'key' ? String(node.key) : '';
      let hit = keyText.toLowerCase().indexOf(q) !== -1;
      if (!hit) {
        if (node.type === 'string') hit = node.value.toLowerCase().indexOf(q) !== -1;
        else if (node.type === 'number') hit = node.raw.toLowerCase().indexOf(q) !== -1;
        else if (node.type === 'boolean') hit = String(node.value).indexOf(q) !== -1;
        else if (node.type === 'null') hit = 'null'.indexOf(q) !== -1;
      }
      if (hit) {
        matches.push(path);
        for (const a of ancestors) state.searchExpanded.add(a);
        state.searchExpanded.add(path);
      }
      if (node.type === 'object' || node.type === 'array') {
        ancestors.push(path);
        for (const child of node.children) {
          walk(child, childPath(path, child));
          if (matches.length >= MAX) break;
        }
        ancestors.pop();
      }
    }

    walk(state.parse.ast, '$');
    state.searchMatches = matches;
    if (matches.length) {
      state.searchIndex = 0;
      ensureVisible(matches[0]);
      selectPath(matches[0], false);
    }
    updateSearchUI();
  }

  function updateSearchUI() {
    const q = el.treeSearch.value.trim();
    el.searchClear.hidden = !q;
    const total = state.searchMatches.length;
    el.searchPrev.disabled = total === 0;
    el.searchNext.disabled = total === 0;
    if (!q) {
      el.searchCount.textContent = '';
      el.searchCount.className = 'search-count';
      return;
    }
    if (!total) {
      el.searchCount.textContent = 'no matches';
      el.searchCount.className = 'search-count no-match';
      return;
    }
    const idx = state.searchIndex >= 0 ? state.searchIndex + 1 : 1;
    el.searchCount.textContent = idx + ' / ' + total;
    el.searchCount.className = 'search-count has-match';
  }

  function navigateSearch(dir) {
    if (!state.searchMatches.length) return;
    const len = state.searchMatches.length;
    if (state.searchIndex < 0) {
      state.searchIndex = dir > 0 ? 0 : len - 1;
    } else {
      state.searchIndex = (state.searchIndex + dir + len) % len;
    }
    const path = state.searchMatches[state.searchIndex];
    ensureVisible(path);
    renderTree();
    updateSearchUI();
    scrollToPath(path, true);
  }

  function scrollToPath(path, flash) {
    const row = findRow(path);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (flash) {
      row.classList.remove('flash');
      void row.offsetWidth;
      row.classList.add('flash');
    }
    selectPath(path, false);
  }

  function ensureVisible(path) {
    const resolved = resolvePath(path);
    if (!resolved) return false;
    let node = state.parse.ast;
    let cur = '$';
    for (const seg of resolved.segments) {
      if (!node || (node.type !== 'object' && node.type !== 'array')) return false;
      state.expanded.add(cur);
      let idx;
      if (node.type === 'array') {
        idx = seg.isIndex ? seg.key : Number(seg.key);
      } else {
        idx = node.children.findIndex(function (c) { return String(c.key) === String(seg.key); });
      }
      if (!Number.isInteger(idx) || idx < 0 || idx >= node.children.length) return false;
      const current = state.shown.get(cur) || PAGE_SIZE;
      if (idx >= current) state.shown.set(cur, Math.ceil((idx + 1) / PAGE_SIZE) * PAGE_SIZE);
      node = node.children[idx];
      cur = childPath(cur, node);
    }
    return true;
  }

  /* ------------------------------------------------------------
     Tree rendering
     ------------------------------------------------------------ */

  function isExpandedPath(path) {
    return state.expanded.has(path) || state.searchExpanded.has(path);
  }

  function rowButton(icon, title, handler) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mini-btn';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = '<svg class="icon"><use href="#' + icon + '"/></svg>';
    btn.addEventListener('click', handler);
    return btn;
  }

  function renderNode(frag, node, path, depth) {
    const isContainer = node.type === 'object' || node.type === 'array';
    const expanded = isContainer && isExpandedPath(path);
    const row = document.createElement('div');
    row.className = 'tree-row' + (isContainer ? ' container' : '') + (expanded ? ' expanded' : '');
    row.dataset.path = path;
    row.style.setProperty('--depth', depth);
    if (path === state.selectedPath) row.classList.add('selected');

    if (isContainer) {
      const twisty = document.createElement('button');
      twisty.type = 'button';
      twisty.className = 'twisty';
      twisty.tabIndex = -1;
      twisty.setAttribute('aria-label', expanded ? 'Collapse' : 'Expand');
      twisty.innerHTML = '<svg class="icon"><use href="#i-chevron"/></svg>';
      twisty.addEventListener('click', function (e) {
        e.stopPropagation();
        togglePath(path);
      });
      row.appendChild(twisty);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'leaf-spacer';
      row.appendChild(spacer);
    }

    if (path !== '$') {
      if (node.keyKind === 'index') {
        const key = document.createElement('span');
        key.className = 't-index';
        key.textContent = '[' + node.key + ']';
        row.appendChild(key);
      } else {
        const key = document.createElement('span');
        key.className = 't-key';
        key.innerHTML = highlightHTML(JSON.stringify(String(node.key)), state.search);
        row.appendChild(key);
      }
      const colon = document.createElement('span');
      colon.className = 't-colon';
      colon.textContent = ':';
      row.appendChild(colon);
    } else {
      const rootKey = document.createElement('span');
      rootKey.className = 't-key root-key';
      rootKey.textContent = '$';
      row.appendChild(rootKey);
    }

    if (isContainer) {
      const badge = document.createElement('span');
      badge.className = 'node-badge ' + node.type;
      const braces = node.type === 'object' ? '{}' : '[]';
      const unit = node.type === 'object'
        ? (node.children.length === 1 ? 'key' : 'keys')
        : (node.children.length === 1 ? 'item' : 'items');
      badge.innerHTML = '<span class="braces">' + braces + '</span><span>' +
        node.children.length.toLocaleString() + ' ' + unit + '</span>';
      row.appendChild(badge);

      if (!expanded) {
        const preview = document.createElement('span');
        preview.className = 't-preview';
        preview.innerHTML = previewHTML(node);
        row.appendChild(preview);
      }
    } else {
      const value = document.createElement('span');
      value.className = 't-val ' + node.type + (node.type === 'string' && node.value === '' ? ' empty' : '');
      value.innerHTML = valueHTML(node);
      row.appendChild(value);
    }

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    actions.appendChild(rowButton('i-link', 'Copy path', function (e) {
      e.stopPropagation();
      copyText(path, 'Path copied');
    }));
    actions.appendChild(rowButton('i-copy', 'Copy value', function (e) {
      e.stopPropagation();
      copyText(J.serialize(node, '', false), 'Value copied');
    }));
    row.appendChild(actions);

    row.addEventListener('click', function (e) {
      if (e.target.closest('.row-actions') || e.target.closest('.twisty')) return;
      selectPath(path, false);
      if (isContainer) togglePath(path);
    });
    row.addEventListener('dblclick', function (e) {
      if (isContainer) return;
      copyText(J.serialize(node, '', false), 'Value copied');
    });

    frag.appendChild(row);

    if (isContainer && expanded) {
      const total = node.children.length;
      const limit = state.shown.get(path) || PAGE_SIZE;
      const count = Math.min(total, limit);
      for (let i = 0; i < count; i++) {
        const child = node.children[i];
        renderNode(frag, child, childPath(path, child), depth + 1);
      }
      if (total > count) {
        const more = document.createElement('div');
        more.className = 'tree-more';
        more.style.setProperty('--depth', depth + 1);
        const btn = document.createElement('button');
        btn.type = 'button';
        const remaining = total - count;
        btn.textContent = 'Show ' + Math.min(PAGE_SIZE, remaining) + ' more · ' + remaining.toLocaleString() + ' remaining';
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          state.shown.set(path, count + PAGE_SIZE);
          renderTree();
        });
        more.appendChild(btn);
        frag.appendChild(more);
      }
    }
  }

  function renderTree() {
    const p = state.parse;
    const scrollTop = el.treeScroll.scrollTop;
    el.tree.innerHTML = '';

    if (!p || p.empty) {
      el.tree.innerHTML = emptyStateHTML();
      el.treeScroll.scrollTop = 0;
      updateSearchUI();
      return;
    }
    if (!p.ok) {
      el.tree.innerHTML = errorStateHTML(p.error);
      el.treeScroll.scrollTop = 0;
      updateSearchUI();
      return;
    }

    const frag = document.createDocumentFragment();
    renderNode(frag, p.ast, '$', 0);
    el.tree.appendChild(frag);
    const row = findRow(state.selectedPath);
    if (row) row.classList.add('selected');
    el.treeScroll.scrollTop = scrollTop;
    updateSearchUI();
  }

  function emptyStateHTML() {
    return '<div class="tree-empty">' +
      '<div class="empty-icon">{ }</div>' +
      '<h3>No JSON yet</h3>' +
      '<p>Paste JSON in the editor, drop a file anywhere, or start with the sample dataset.</p>' +
      '<div class="empty-actions">' +
      '<button class="btn primary" data-empty="sample">Load sample</button>' +
      '<button class="btn" data-empty="open">Open file</button>' +
      '</div></div>';
  }

  function errorStateHTML(err) {
    return '<div class="tree-empty error">' +
      '<div class="empty-icon"><svg class="icon" style="width:26px;height:26px"><use href="#i-alert"/></svg></div>' +
      '<h3>Can\'t build the tree</h3>' +
      '<p>' + J.escapeHTML(err.message) + '</p>' +
      '<div class="err-detail">Line ' + err.line + ', column ' + err.column + '</div>' +
      '<div class="empty-actions"><button class="btn" data-empty="reveal">Reveal error</button></div>' +
      '</div>';
  }

  function togglePath(path) {
    if (isExpandedPath(path)) {
      state.expanded.delete(path);
      state.searchExpanded.delete(path);
    } else {
      state.expanded.add(path);
    }
    renderTree();
  }

  function expandAllNodes() {
    const p = state.parse;
    if (!p || !p.ok) return;
    let count = 0;
    const walk = function (node, path) {
      if (count >= 1500) return;
      if (node.type === 'object' || node.type === 'array') {
        state.expanded.add(path);
        count++;
        for (const child of node.children) walk(child, childPath(path, child));
      }
    };
    walk(p.ast, '$');
    renderTree();
    toast('Expanded ' + count.toLocaleString() + (count >= 1500 ? '+ containers' : ' containers'));
  }

  function collapseAllNodes() {
    state.expanded.clear();
    state.searchExpanded.clear();
    state.shown.clear();
    if (state.search) {
      el.treeSearch.value = '';
      state.search = '';
      state.searchMatches = [];
      state.searchIndex = -1;
      updateSearchUI();
    }
    renderTree();
    toast('Collapsed all nodes');
  }

  /* ------------------------------------------------------------
     Stats
     ------------------------------------------------------------ */

  function renderStats() {
    state.statsDirty = false;
    const p = state.parse;

    if (!p || p.empty) {
      el.statsContent.innerHTML = '<div class="tree-empty" style="min-height:260px">' +
        '<div class="empty-icon">{ }</div><h3>Nothing to analyze</h3>' +
        '<p>Load some JSON to see size, depth, type distribution, top-level entries, and warnings.</p></div>';
      return;
    }
    if (!p.ok) {
      el.statsContent.innerHTML = '<div class="tree-empty error" style="min-height:260px">' +
        '<div class="empty-icon"><svg class="icon" style="width:26px;height:26px"><use href="#i-alert"/></svg></div>' +
        '<h3>Can\'t analyze invalid JSON</h3><p>' + J.escapeHTML(p.error.message) + '</p>' +
        '<div class="err-detail">Line ' + p.error.line + ', column ' + p.error.column + '</div></div>';
      return;
    }

    const s = p.stats;
    const total = Math.max(1, s.nodes);
    let minBytes = null;
    if (state.text.length < 250000) {
      try { minBytes = J.byteLength(J.serialize(p.ast, '', false)); } catch (e) { /* ignore */ }
    }

    const cards = [
      ['Size', formatBytes(s.bytes), minBytes != null ? 'minified ' + formatBytes(minBytes) : 'UTF-8 encoded', 'i-file'],
      ['Values', s.nodes.toLocaleString(), s.keys.toLocaleString() + ' object keys', 'i-braces'],
      ['Depth', String(s.depth), 'nesting levels', 'i-expand'],
      ['Parse', p.ms.toFixed(2) + ' ms', 'in your browser', 'i-clock']
    ];

    let html = '<div class="stat-grid">';
    for (const card of cards) {
      html += '<div class="stat-card">' +
        '<div class="stat-label"><svg class="icon"><use href="#' + card[3] + '"/></svg>' + card[0] + '</div>' +
        '<div class="stat-value">' + card[1] + '</div>' +
        '<div class="stat-sub">' + J.escapeHTML(card[2]) + '</div>' +
        '</div>';
    }
    html += '</div>';

    const types = [
      ['object', 'Objects', 'var(--sky)'],
      ['array', 'Arrays', 'var(--pink)'],
      ['string', 'Strings', 'var(--string)'],
      ['number', 'Numbers', 'var(--number)'],
      ['boolean', 'Booleans', 'var(--bool)'],
      ['null', 'Nulls', 'var(--null)']
    ];
    html += '<div class="section"><div class="section-head"><span>Type distribution</span>' +
      '<span class="count">' + s.nodes.toLocaleString() + ' values</span></div><div class="section-body">';
    for (const t of types) {
      const count = s.counts[t[0]] || 0;
      const pct = (count / total) * 100;
      const pctText = count === 0 ? '0%' : pct < 10 ? pct.toFixed(1) + '%' : Math.round(pct) + '%';
      html += '<div class="dist-row">' +
        '<span class="dist-dot" style="background:' + t[2] + '"></span>' +
        '<span class="dist-name">' + t[1] + '</span>' +
        '<span class="dist-track"><span class="dist-fill" style="width:' + pct.toFixed(2) + '%;background:' + t[2] + '"></span></span>' +
        '<span class="dist-count">' + count.toLocaleString() + '</span>' +
        '<span class="dist-pct">' + pctText + '</span>' +
        '</div>';
    }
    html += '</div></div>';

    const root = p.ast;
    if ((root.type === 'object' || root.type === 'array') && root.children.length) {
      const entries = root.children.slice(0, 40);
      html += '<div class="section"><div class="section-head"><span>Top level</span>' +
        '<span class="count">' + root.children.length.toLocaleString() + ' entries</span></div>' +
        '<div class="section-body top-list">';
      for (const child of entries) {
        const path = childPath('$', child);
        const label = child.keyKind === 'index' ? '[' + child.key + ']' : JSON.stringify(String(child.key));
        html += '<button class="top-row" data-path="' + J.escapeHTML(path) + '">' +
          '<span class="tr-key">' + J.escapeHTML(label) + '</span>' +
          '<span class="tr-type">' + child.type + '</span>' +
          '<span class="tr-preview">' + J.escapeHTML(previewText(child)) + '</span>' +
          '</button>';
      }
      if (root.children.length > 40) {
        html += '<div class="stat-sub" style="padding:7px 8px 2px">…and ' +
          (root.children.length - 40).toLocaleString() + ' more</div>';
      }
      html += '</div></div>';
    }

    if (p.warnings.length) {
      html += '<div class="section"><div class="section-head"><span>Warnings</span>' +
        '<span class="count">' + p.warnings.length + '</span></div><div class="section-body issues-list">';
      for (const w of p.warnings.slice(0, 50)) {
        const loc = J.locate(state.text, w.index);
        html += '<button class="issue-row" data-index="' + w.index + '">' +
          '<svg class="icon"><use href="#i-alert"/></svg>' +
          '<span>' + J.escapeHTML(w.message) + '</span>' +
          '<span class="issue-loc">Ln ' + loc.line + ':' + loc.column + '</span>' +
          '</button>';
      }
      if (p.warnings.length > 50) {
        html += '<div class="stat-sub" style="padding:6px 8px">…and ' + (p.warnings.length - 50) + ' more</div>';
      }
      html += '</div></div>';
    } else {
      html += '<div class="section"><div class="section-body"><div class="clean-state">' +
        '<svg class="icon"><use href="#i-check"/></svg>No warnings — the JSON looks clean.</div></div></div>';
    }

    el.statsContent.innerHTML = html;
  }

  /* ------------------------------------------------------------
     Convert
     ------------------------------------------------------------ */

  function highlightWords(src) {
    const re = /("(?:[^"\\]|\\.)*")|\b(true|false|null|True|False|None|const|export|default)\b/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(src))) {
      out += J.escapeHTML(src.slice(last, m.index));
      if (m[1]) out += '<span class="ts-string">' + J.escapeHTML(m[1]) + '</span>';
      else out += '<span class="ts-keyword">' + m[2] + '</span>';
      last = re.lastIndex;
    }
    out += J.escapeHTML(src.slice(last));
    return out;
  }

  function highlightKeyed(src) {
    return src.split('\n').map(function (line) {
      const m = /^(\s*)((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^:#]+))(\s*:)(.*)$/.exec(line);
      if (!m) return highlightWords(line);
      return J.escapeHTML(m[1]) +
        '<span class="ts-name">' + J.escapeHTML(m[2]) + '</span>' +
        J.escapeHTML(m[3]) +
        highlightWords(m[4]);
    }).join('\n');
  }

  function highlightTypeScript(src) {
    const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*")|\b(export|interface|type|extends|readonly|string|number|boolean|unknown|any|null|Record)\b|([A-Za-z_$][\w$]*)(?=\s*[?:])|([{}[\]();:,|])/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(src))) {
      out += J.escapeHTML(src.slice(last, m.index));
      if (m[1]) out += '<span class="tok-comment">' + J.escapeHTML(m[1]) + '</span>';
      else if (m[2]) out += '<span class="ts-string">' + J.escapeHTML(m[2]) + '</span>';
      else if (m[3]) out += '<span class="ts-keyword">' + m[3] + '</span>';
      else if (m[4]) out += '<span class="ts-name">' + m[4] + '</span>';
      else out += '<span class="ts-punct">' + J.escapeHTML(m[5]) + '</span>';
      last = re.lastIndex;
    }
    out += J.escapeHTML(src.slice(last));
    return out;
  }

  function highlightConvert(src, format) {
    if (src.length > 250000) return J.escapeHTML(src);
    if (format === 'typescript') return highlightTypeScript(src);
    if (format === 'yaml' || format === 'python') return highlightKeyed(src);
    if (format === 'javascript') return highlightWords(src);
    return J.escapeHTML(src);
  }

  function renderConvert() {
    state.convertDirty = false;
    const p = state.parse;

    if (!p || p.empty) {
      state.convertText = '';
      el.convertOutput.innerHTML = '<div class="convert-empty">Nothing to convert yet — load some JSON.</div>';
      return;
    }
    if (!p.ok) {
      state.convertText = '';
      el.convertOutput.innerHTML = '<div class="convert-empty">Fix the JSON in the editor to enable conversion.</div>';
      return;
    }

    let out = '';
    try {
      if (state.convertFormat === 'typescript') out = J.toTypeScript(p.value);
      else if (state.convertFormat === 'yaml') out = J.toYAML(p.value);
      else if (state.convertFormat === 'csv') out = J.toCSV(p.value);
      else if (state.convertFormat === 'python') out = J.toPython(p.value);
      else if (state.convertFormat === 'javascript') out = J.toJavaScript(p.ast);
    } catch (err) {
      out = '// Conversion failed: ' + (err && err.message ? err.message : String(err));
    }

    state.convertText = out;
    if (!out) {
      el.convertOutput.innerHTML = '<div class="convert-empty">No output for this structure.</div>';
      return;
    }
    el.convertOutput.innerHTML = '<code>' + highlightConvert(out, state.convertFormat) + '</code>';
  }

  /* ------------------------------------------------------------
     Editing actions
     ------------------------------------------------------------ */

  function setText(text, message, kind) {
    el.editor.value = text;
    state.text = text;
    state.dirty = true;
    state.dismissedErrorIndex = null;
    updateFileMeta();
    updateHighlight();
    updateGutter(text);
    updateCursor();
    parseNow(false);
    el.editor.setSelectionRange(0, 0);
    el.editor.scrollTop = 0;
    syncScroll();
    if (message) toast(message, kind);
  }

  function revealErrorNow() {
    const p = state.parse;
    if (!p || !p.error) return;
    state.dismissedErrorIndex = null;
    updateStatus();
    updateGutterMarks();
    updateBands();
    jumpToIndex(p.error.index, p.error.length);
  }

  function requireValid() {
    const p = state.parse;
    if (p && p.ok) return true;
    toast('Fix the JSON first', 'error');
    if (p && p.error) revealErrorNow();
    return false;
  }

  function doFormat() {
    if (!requireValid()) return;
    const p = state.parse;
    const out = J.serialize(p.ast, unitForIndent(), false);
    const label = state.indent === 'tab' ? 'tabs' : state.indent + ' spaces';
    setText(out, 'Formatted with ' + label);
  }

  function doMinify() {
    if (!requireValid()) return;
    const p = state.parse;
    const out = J.serialize(p.ast, '', false);
    const before = J.byteLength(state.text);
    const after = J.byteLength(out);
    const saved = before > 0 ? Math.round((1 - after / before) * 100) : 0;
    setText(out, 'Minified' + (saved > 0 ? ' · ' + saved + '% smaller' : ' · already compact'));
  }

  function doSort() {
    if (!requireValid()) return;
    const p = state.parse;
    const out = J.serialize(p.ast, unitForIndent(), true);
    setText(out, 'Keys sorted alphabetically');
  }

  function doCopy() {
    if (!state.text) {
      toast('Nothing to copy', 'warn');
      return;
    }
    copyText(state.text, 'Copied ' + formatBytes(J.byteLength(state.text)) + ' of JSON');
  }

  function ensureJsonName(name) {
    const base = String(name || 'data.json').replace(/\.[^./\\]+$/, '');
    return (base || 'data') + '.json';
  }

  function downloadText(text, name, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }

  function doDownload() {
    if (!state.text.trim()) {
      toast('Nothing to download', 'warn');
      return;
    }
    const p = state.parse;
    let text = state.text;
    if (p && p.ok) text = J.serialize(p.ast, unitForIndent(), false);
    const name = ensureJsonName(state.fileName);
    downloadText(text, name, 'application/json;charset=utf-8');
    state.dirty = false;
    updateFileMeta();
    saveStateSoon();
    toast('Downloaded ' + name);
  }

  function doConvertCopy() {
    if (!state.convertText) {
      toast('Nothing to copy yet', 'warn');
      return;
    }
    copyText(state.convertText, 'Copied ' + state.convertFormat);
  }

  function doConvertDownload() {
    if (!state.convertText) {
      toast('Nothing to download yet', 'warn');
      return;
    }
    const extMap = { typescript: 'ts', yaml: 'yaml', csv: 'csv', python: 'py', javascript: 'js' };
    const ext = extMap[state.convertFormat] || 'txt';
    const base = String(state.fileName || 'data.json').replace(/\.[^./\\]+$/, '') || 'data';
    const name = base + '.' + ext;
    downloadText(state.convertText, name);
    toast('Downloaded ' + name);
  }

  function toggleLenient() {
    state.lenient = !state.lenient;
    el.lenientToggle.classList.toggle('on', state.lenient);
    el.lenientToggle.setAttribute('aria-pressed', String(state.lenient));
    updateHighlight();
    parseNow(false);
    toast(state.lenient
      ? 'Lenient mode on — comments, trailing commas, single quotes and unquoted keys are allowed'
      : 'Strict JSON mode on');
    saveStateSoon();
  }

  /* ------------------------------------------------------------
     Tabs & path bar
     ------------------------------------------------------------ */

  function switchTab(name) {
    state.activeTab = name;
    const tabs = $$('.tab');
    for (const tab of tabs) {
      const on = tab.dataset.tab === name;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
    }
    const panels = $$('.tab-panel');
    for (const panel of panels) {
      panel.classList.toggle('active', panel.id === 'panel-' + name);
    }
    if (name === 'stats' && state.statsDirty) renderStats();
    if (name === 'convert' && state.convertDirty) renderConvert();
    saveStateSoon();
  }

  function commitPath() {
    const raw = el.pathInput.value.trim() || '$';
    const resolved = resolvePath(raw);
    if (!resolved) {
      el.pathInput.classList.add('invalid');
      toast('Path not found: ' + raw, 'error');
      return;
    }
    const canonical = pathFromSegments(resolved.segments);
    ensureVisible(canonical);
    renderTree();
    selectPath(canonical, true);
    el.pathInput.classList.remove('invalid');
    switchTab('tree');
  }

  /* ------------------------------------------------------------
     Modals & warnings
     ------------------------------------------------------------ */

  function closeModals() {
    el.shortcutsModal.hidden = true;
    el.warningsModal.hidden = true;
    el.paletteModal.hidden = true;
  }

  function openModal(modal) {
    closeModals();
    modal.hidden = false;
    const focusable = modal.querySelector('input, button, [tabindex]');
    if (focusable) setTimeout(function () { focusable.focus(); }, 30);
  }

  function openWarnings() {
    const p = state.parse;
    if (!p || !p.ok || !p.warnings.length) {
      toast('No warnings to show');
      return;
    }
    el.warningsList.innerHTML = p.warnings.map(function (w) {
      const loc = J.locate(state.text, w.index);
      return '<button class="warning-item" data-index="' + w.index + '">' +
        '<svg class="icon"><use href="#i-alert"/></svg>' +
        '<span>' + J.escapeHTML(w.message) + '</span>' +
        '<span class="warn-loc">Ln ' + loc.line + ', Col ' + loc.column + '</span>' +
        '</button>';
    }).join('');
    openModal(el.warningsModal);
  }

  /* ------------------------------------------------------------
     Command palette
     ------------------------------------------------------------ */

  let paletteCommands = [];
  let paletteActive = 0;

  function commandList() {
    const p = state.parse;
    return [
      { label: 'Format JSON', hint: MOD + ' ↵', icon: 'i-wand', keywords: 'beautify pretty indent', run: doFormat },
      { label: 'Minify JSON', hint: MOD + ' M', icon: 'i-code', keywords: 'compress compact', run: doMinify },
      { label: 'Sort keys alphabetically', hint: MOD + ' ⇧ S', icon: 'i-collapse', keywords: 'order alphabetical', run: doSort },
      { label: 'Copy JSON', hint: 'Alt C', icon: 'i-copy', keywords: 'clipboard', run: doCopy },
      { label: 'Download JSON', hint: MOD + ' S', icon: 'i-download', keywords: 'save export file', run: doDownload },
      { label: 'Open a file', hint: MOD + ' O', icon: 'i-folder', keywords: 'import load', run: function () { el.fileInput.click(); } },
      { label: 'Load sample data', icon: 'i-sparkles', keywords: 'demo example', run: loadSample },
      { label: 'Clear editor', icon: 'i-trash', keywords: 'reset empty', run: clearAll },
      { label: 'Toggle theme', hint: MOD + ' J', icon: 'i-palette', keywords: 'dark light appearance', run: toggleTheme },
      { label: state.lenient ? 'Disable lenient mode' : 'Enable lenient mode', icon: 'i-check', keywords: 'comments trailing comma single quote', run: toggleLenient },
      { label: 'Expand all nodes', icon: 'i-expand', keywords: 'open tree', run: expandAllNodes },
      { label: 'Collapse all nodes', icon: 'i-collapse', keywords: 'close tree', run: collapseAllNodes },
      { label: 'Search the tree', hint: MOD + ' F', icon: 'i-search', keywords: 'find filter', run: function () { switchTab('tree'); el.treeSearch.focus(); el.treeSearch.select(); } },
      { label: 'Open statistics', icon: 'i-braces', keywords: 'size depth count analysis', run: function () { switchTab('stats'); } },
      { label: 'Open converters', icon: 'i-code', keywords: 'typescript yaml csv python javascript', run: function () { switchTab('convert'); } },
      { label: 'Convert to TypeScript', icon: 'i-code', keywords: 'interface type', run: function () { state.convertFormat = 'typescript'; el.convertSelect.value = 'typescript'; switchTab('convert'); } },
      { label: 'Convert to YAML', icon: 'i-code', keywords: 'yml', run: function () { state.convertFormat = 'yaml'; el.convertSelect.value = 'yaml'; switchTab('convert'); } },
      { label: 'Convert to CSV', icon: 'i-code', keywords: 'table spreadsheet', run: function () { state.convertFormat = 'csv'; el.convertSelect.value = 'csv'; switchTab('convert'); } },
      { label: 'Convert to Python', icon: 'i-code', keywords: 'dict literal', run: function () { state.convertFormat = 'python'; el.convertSelect.value = 'python'; switchTab('convert'); } },
      { label: 'Convert to JavaScript', icon: 'i-code', keywords: 'module export', run: function () { state.convertFormat = 'javascript'; el.convertSelect.value = 'javascript'; switchTab('convert'); } },
      { label: 'Show warnings', icon: 'i-alert', keywords: 'issues duplicates', run: openWarnings, disabled: !(p && p.ok && p.warnings.length) },
      { label: 'Keyboard shortcuts', icon: 'i-help', keywords: 'keys help', run: function () { openModal(el.shortcutsModal); } },
      { label: 'Reset split view', icon: 'i-collapse', keywords: 'layout resize', run: function () { setSplit(0.5, true); } }
    ];
  }

  function renderPalette() {
    const q = el.paletteInput.value.trim().toLowerCase();
    paletteCommands = commandList().filter(function (cmd) {
      if (cmd.disabled) return false;
      if (!q) return true;
      return (cmd.label + ' ' + cmd.keywords).toLowerCase().indexOf(q) !== -1;
    });
    if (paletteActive >= paletteCommands.length) paletteActive = Math.max(0, paletteCommands.length - 1);
    if (!paletteCommands.length) {
      el.paletteList.innerHTML = '<div class="palette-empty">No commands found</div>';
      return;
    }
    el.paletteList.innerHTML = paletteCommands.map(function (cmd, i) {
      return '<button class="palette-item' + (i === paletteActive ? ' active' : '') + '" data-index="' + i + '">' +
        '<svg class="icon"><use href="#' + cmd.icon + '"/></svg>' +
        '<span class="pi-label">' + J.escapeHTML(cmd.label) + '</span>' +
        (cmd.hint ? '<span class="pi-hint">' + J.escapeHTML(cmd.hint) + '</span>' : '') +
        '</button>';
    }).join('');
  }

  function openPalette() {
    el.shortcutsModal.hidden = true;
    el.warningsModal.hidden = true;
    el.paletteModal.hidden = false;
    el.paletteInput.value = '';
    paletteActive = 0;
    renderPalette();
    setTimeout(function () { el.paletteInput.focus(); }, 30);
  }

  function runPaletteCommand(index) {
    const cmd = paletteCommands[index];
    if (!cmd) return;
    closeModals();
    setTimeout(function () { cmd.run(); }, 0);
  }

  function movePalette(delta) {
    if (!paletteCommands.length) return;
    paletteActive = (paletteActive + delta + paletteCommands.length) % paletteCommands.length;
    renderPalette();
    const active = el.paletteList.querySelector('.palette-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  /* ------------------------------------------------------------
     Editor key handling
     ------------------------------------------------------------ */

  function insertAtCursor(text) {
    const start = el.editor.selectionStart;
    const end = el.editor.selectionEnd;
    el.editor.setRangeText(text, start, end, 'end');
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function indentLines(outdent) {
    const text = el.editor.value;
    const start = el.editor.selectionStart;
    const end = el.editor.selectionEnd;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = text.length;
    const block = text.slice(lineStart, lineEnd);
    const unit = unitForIndent();
    const lines = block.split('\n');
    const changed = lines.map(function (line) {
      if (outdent) {
        if (line.startsWith(unit)) return line.slice(unit.length);
        return line.replace(/^( {1,4}|\t)/, '');
      }
      return unit + line;
    });
    const newBlock = changed.join('\n');
    el.editor.setRangeText(newBlock, lineStart, lineEnd, 'select');
    el.editor.setSelectionRange(lineStart, lineStart + newBlock.length);
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function autoIndent() {
    const text = el.editor.value;
    const pos = el.editor.selectionStart;
    const end = el.editor.selectionEnd;
    if (pos !== end) {
      insertAtCursor('\n');
      return;
    }
    const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
    const currentLine = text.slice(lineStart, pos);
    const indentMatch = /^[ \t]*/.exec(currentLine)[0];
    const before = currentLine.replace(/[ \t]+$/, '');
    const prevChar = before.slice(-1);
    const unit = unitForIndent();
    const rest = text.slice(pos);
    const nextMatch = /^[ \t]*([}\]])/.exec(rest);

    if ((prevChar === '{' && nextMatch && nextMatch[1] === '}') ||
        (prevChar === '[' && nextMatch && nextMatch[1] === ']')) {
      const inner = indentMatch + unit;
      const insert = '\n' + inner + '\n' + indentMatch;
      el.editor.setRangeText(insert, pos, pos, 'end');
      const caret = pos + 1 + inner.length;
      el.editor.setSelectionRange(caret, caret);
      el.editor.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    let insert = '\n' + indentMatch;
    if (prevChar === '{' || prevChar === '[') insert += unit;
    el.editor.setRangeText(insert, pos, pos, 'end');
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function handleEditorKeydown(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        indentLines(true);
      } else if (el.editor.selectionStart !== el.editor.selectionEnd) {
        indentLines(false);
      } else {
        insertAtCursor(unitForIndent());
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      autoIndent();
    }
  }

  /* ------------------------------------------------------------
     Global shortcuts
     ------------------------------------------------------------ */

  function handleGlobalKeydown(e) {
    const mod = e.ctrlKey || e.metaKey;
    const key = (e.key || '').toLowerCase();

    if (e.key === 'Escape') {
      if (!el.paletteModal.hidden || !el.shortcutsModal.hidden || !el.warningsModal.hidden) {
        closeModals();
        return;
      }
    }

    if (mod && key === 'k') {
      e.preventDefault();
      openPalette();
      return;
    }

    if (!el.paletteModal.hidden) return;
    if (!el.shortcutsModal.hidden || !el.warningsModal.hidden) return;

    if (mod && e.key === 'Enter') {
      e.preventDefault();
      doFormat();
      return;
    }
    if (mod && e.shiftKey && key === 's') {
      e.preventDefault();
      doSort();
      return;
    }
    if (mod && !e.shiftKey && key === 's') {
      e.preventDefault();
      doDownload();
      return;
    }
    if (mod && !e.shiftKey && key === 'm') {
      e.preventDefault();
      doMinify();
      return;
    }
    if (mod && key === 'f') {
      e.preventDefault();
      switchTab('tree');
      el.treeSearch.focus();
      el.treeSearch.select();
      return;
    }
    if (mod && key === 'o') {
      e.preventDefault();
      el.fileInput.click();
      return;
    }
    if (mod && key === 'j') {
      e.preventDefault();
      toggleTheme();
      return;
    }
    if (e.altKey && key === 'c') {
      e.preventDefault();
      doCopy();
    }
  }

  /* ------------------------------------------------------------
     Event wiring
     ------------------------------------------------------------ */

  function bindEvents() {
    el.editor.addEventListener('input', onInput);
    el.editor.addEventListener('scroll', syncScroll);
    el.editor.addEventListener('keydown', handleEditorKeydown);
    el.editor.addEventListener('click', updateCursor);
    el.editor.addEventListener('keyup', updateCursor);
    document.addEventListener('selectionchange', function () {
      if (document.activeElement === el.editor) updateCursor();
    });
    document.addEventListener('keydown', handleGlobalKeydown);

    el.treeSearch.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        computeSearch();
        renderTree();
      }, 120);
    });
    el.treeSearch.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        navigateSearch(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        el.treeSearch.value = '';
        computeSearch();
        renderTree();
        el.treeSearch.blur();
      }
    });
    el.searchPrev.addEventListener('click', function () { navigateSearch(-1); });
    el.searchNext.addEventListener('click', function () { navigateSearch(1); });
    el.searchClear.addEventListener('click', function () {
      el.treeSearch.value = '';
      computeSearch();
      renderTree();
      el.treeSearch.focus();
    });
    el.expandAll.addEventListener('click', expandAllNodes);
    el.collapseAll.addEventListener('click', collapseAllNodes);

    el.pathInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitPath();
      } else if (e.key === 'Escape') {
        el.pathInput.value = state.selectedPath;
        el.pathInput.classList.remove('invalid');
        const r = resolvePath(state.selectedPath);
        if (r) setPathType(r.node.type);
        el.pathInput.blur();
      }
    });
    el.pathInput.addEventListener('input', function () {
      const r = resolvePath(el.pathInput.value);
      if (r) {
        el.pathInput.classList.remove('invalid');
        setPathType(r.node.type);
      } else {
        setPathType('—');
      }
    });
    el.pathInput.addEventListener('blur', function () {
      el.pathInput.classList.remove('invalid');
    });
    el.copyPathBtn.addEventListener('click', function () {
      copyText(el.pathInput.value || state.selectedPath, 'Path copied');
    });

    el.tree.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-empty]');
      if (!btn) return;
      const action = btn.dataset.empty;
      if (action === 'sample') loadSample();
      else if (action === 'open') el.fileInput.click();
      else if (action === 'reveal') revealErrorNow();
    });

    el.statsContent.addEventListener('click', function (e) {
      const top = e.target.closest('.top-row');
      if (top) {
        const path = top.dataset.path;
        ensureVisible(path);
        renderTree();
        selectPath(path, true);
        switchTab('tree');
        return;
      }
      const issue = e.target.closest('.issue-row');
      if (issue) jumpToIndex(Number(issue.dataset.index), 1);
    });

    el.warningsList.addEventListener('click', function (e) {
      const btn = e.target.closest('.warning-item');
      if (!btn) return;
      const idx = Number(btn.dataset.index);
      closeModals();
      jumpToIndex(idx, 1);
    });

    el.paletteInput.addEventListener('input', function () {
      paletteActive = 0;
      renderPalette();
    });
    el.paletteInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        movePalette(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        movePalette(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        runPaletteCommand(paletteActive);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeModals();
      }
    });
    el.paletteList.addEventListener('click', function (e) {
      const item = e.target.closest('.palette-item');
      if (!item) return;
      runPaletteCommand(Number(item.dataset.index));
    });

    const backdrops = $$('.modal-backdrop');
    for (const backdrop of backdrops) {
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) closeModals();
      });
    }
    const closeButtons = $$('[data-close]');
    for (const btn of closeButtons) btn.addEventListener('click', closeModals);

    el.fileInput.addEventListener('change', function () {
      const file = el.fileInput.files && el.fileInput.files[0];
      if (file) readFile(file);
      el.fileInput.value = '';
    });

    let dragDepth = 0;
    window.addEventListener('dragenter', function (e) {
      if (!e.dataTransfer || Array.from(e.dataTransfer.types).indexOf('Files') === -1) return;
      e.preventDefault();
      dragDepth++;
      el.dropOverlay.hidden = false;
    });
    window.addEventListener('dragover', function (e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', function (e) {
      if (!e.dataTransfer) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) el.dropOverlay.hidden = true;
    });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      dragDepth = 0;
      el.dropOverlay.hidden = true;
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) readFile(file);
    });

    let draggingSplit = false;
    function endSplit(e) {
      if (!draggingSplit) return;
      draggingSplit = false;
      document.body.classList.remove('resizing');
      try { el.splitter.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      saveStateSoon();
    }
    el.splitter.addEventListener('pointerdown', function (e) {
      if (window.innerWidth <= 980) return;
      draggingSplit = true;
      try { el.splitter.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      document.body.classList.add('resizing');
      e.preventDefault();
    });
    el.splitter.addEventListener('pointermove', function (e) {
      if (!draggingSplit) return;
      const rect = el.workspace.getBoundingClientRect();
      setSplit((e.clientX - rect.left) / rect.width, false);
    });
    el.splitter.addEventListener('pointerup', endSplit);
    el.splitter.addEventListener('pointercancel', endSplit);
    el.splitter.addEventListener('dblclick', function () { setSplit(0.5, true); });
    el.splitter.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); setSplit(state.split - 0.03, true); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setSplit(state.split + 0.03, true); }
      else if (e.key === 'Home') { e.preventDefault(); setSplit(0.5, true); }
    });

    window.addEventListener('resize', function () { syncScroll(); });
  }

  let searchTimer = 0;

  /* ------------------------------------------------------------
     Init
     ------------------------------------------------------------ */

  function init() {
    const saved = loadSaved();
    let initialText = SAMPLE_TEXT;
    let initialName = 'aurora-sample.json';
    let restored = false;
    let tooLarge = false;

    if (saved) {
      if (saved.theme === 'dark' || saved.theme === 'light') state.theme = saved.theme;
      if (saved.indent === '2' || saved.indent === '4' || saved.indent === 'tab') state.indent = saved.indent;
      if (typeof saved.lenient === 'boolean') state.lenient = saved.lenient;
      if (typeof saved.split === 'number') state.split = clamp(saved.split, 0.28, 0.72);
      if (['tree', 'stats', 'convert'].indexOf(saved.tab) !== -1) state.activeTab = saved.tab;
      if (['typescript', 'yaml', 'csv', 'python', 'javascript'].indexOf(saved.format) !== -1) state.convertFormat = saved.format;
      if (saved.hasText && typeof saved.text === 'string') {
        initialText = saved.text;
        initialName = saved.fileName || 'untitled.json';
        restored = true;
      }
      tooLarge = !!saved.tooLarge;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      state.theme = 'light';
    }

    el.html.dataset.theme = state.theme;
    el.formatKbd.textContent = isMac ? '⌘↵' : 'Ctrl ↵';
    el.indentSelect.value = state.indent;
    el.lenientToggle.classList.toggle('on', state.lenient);
    el.lenientToggle.setAttribute('aria-pressed', String(state.lenient));
    el.convertSelect.value = state.convertFormat;
    setSplit(state.split, false);
    bindEvents();
    switchTab(state.activeTab);
    setDocument(initialText, initialName);

    if (tooLarge) {
      setTimeout(function () { toast('Your previous document was too large to restore', 'warn'); }, 600);
    } else if (restored && initialText && initialText !== SAMPLE_TEXT) {
      setTimeout(function () { toast('Restored your last session'); }, 500);
    }
  }

  /* toolbar */
  el.themeBtn.addEventListener('click', toggleTheme);
  el.helpBtn.addEventListener('click', function () { openModal(el.shortcutsModal); });
  el.paletteBtn.addEventListener('click', openPalette);
  el.openBtn.addEventListener('click', function () { el.fileInput.click(); });
  el.sampleBtn.addEventListener('click', loadSample);
  el.clearBtn.addEventListener('click', clearAll);
  el.formatBtn.addEventListener('click', doFormat);
  el.minifyBtn.addEventListener('click', doMinify);
  el.sortBtn.addEventListener('click', doSort);
  el.copyBtn.addEventListener('click', doCopy);
  el.downloadBtn.addEventListener('click', doDownload);

  el.indentSelect.addEventListener('change', function () {
    state.indent = el.indentSelect.value;
    saveStateSoon();
    toast('Indent: ' + (state.indent === 'tab' ? 'tabs' : state.indent + ' spaces'));
  });
  el.lenientToggle.addEventListener('click', toggleLenient);

  /* error banner */
  el.revealError.addEventListener('click', revealErrorNow);
  el.dismissError.addEventListener('click', function () {
    const p = state.parse;
    if (p && p.error) {
      state.dismissedErrorIndex = p.error.index;
      updateStatus();
      updateGutterMarks();
      updateBands();
    }
  });

  /* warnings */
  el.warnChip.addEventListener('click', openWarnings);

  /* tabs */
  const tabs = $$('.tab');
  for (const tab of tabs) {
    tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
  }

  /* convert */
  el.convertSelect.addEventListener('change', function () {
    state.convertFormat = el.convertSelect.value;
    renderConvert();
    saveStateSoon();
  });
  el.copyConvert.addEventListener('click', doConvertCopy);
  el.downloadConvert.addEventListener('click', doConvertDownload);

  init();
})();








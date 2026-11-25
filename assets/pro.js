/* ============================================================
   JSON Studio — Pro feature engine
   JSON fingerprint / JSONPath-lite query / JSON Schema /
   mock data generation. Pure functions, no DOM, no network.
   ============================================================ */
(function (global) {
  'use strict';

  const MAX_QUERY_RESULTS = 1000;

  /* ------------------------------------------------------------
     Shared helpers
     ------------------------------------------------------------ */

  function isObjectNode(node) {
    return !!node && (node.type === 'object' || node.type === 'array');
  }

  function joinPath(parent, node) {
    if (node && node.keyKind === 'index') return parent + '[' + node.key + ']';
    const key = String(node && node.key != null ? node.key : '');
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return parent + '.' + key;
    return parent + '[' + JSON.stringify(key) + ']';
  }

  /* ============================================================
     JSONPath-lite query engine
     Supports:
       $.users[0].email        child + index
       $.users[*].name         wildcard
       $..email                recursive descent
       $['odd key']            bracket keys
       $.users[?(@.age > 30)]  filters (== != >= <= > < =~)
       $.items[0,2]            unions
       $.items[1:4]            slices
     ============================================================ */

  function queryError(message, position) {
    const err = new Error(message);
    err.name = 'QueryError';
    err.position = position;
    return err;
  }

  function readName(s, i) {
    let j = i;
    while (j < s.length && s[j] !== '.' && s[j] !== '[') j++;
    return { name: s.slice(i, j).trim(), next: j };
  }

  function readBracket(s, i) {
    // i points just after '['
    let depth = 1;
    let quote = null;
    let j = i;
    for (; j < s.length; j++) {
      const c = s[j];
      if (quote) {
        if (c === '\\') { j++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) return { text: s.slice(i, j), next: j + 1 };
      }
    }
    throw queryError('Unclosed bracket — add a closing ]', i);
  }

  function unquote(token) {
    const t = token.trim();
    if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') {
      try { return JSON.parse(t); } catch (e) { return t.slice(1, -1); }
    }
    if (t.length >= 2 && t[0] === "'" && t[t.length - 1] === "'") {
      let out = '';
      for (let i = 1; i < t.length - 1; i++) {
        if (t[i] === '\\' && i + 1 < t.length - 1) {
          const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\\': '\\', "'": "'", '"': '"', '/': '/' };
          const e = t[++i];
          out += Object.prototype.hasOwnProperty.call(map, e) ? map[e] : e;
        } else {
          out += t[i];
        }
      }
      return out;
    }
    return t;
  }

  function splitTopLevel(text) {
    const parts = [];
    let quote = null;
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === ',' && depth === 0) {
        parts.push(text.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(text.slice(start));
    return parts;
  }

  function findOperator(text) {
    const ops = ['==', '!=', '>=', '<=', '=~', '>', '<'];
    let quote = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") { quote = c; continue; }
      for (const op of ops) {
        if (text.startsWith(op, i)) return { index: i, op: op };
      }
    }
    return null;
  }

  function parseQuery(expr) {
    let s = String(expr == null ? '' : expr).trim();
    if (!s) throw queryError('Enter a query, for example $.users[0].name', 0);
    if (s.charAt(0) === '$') s = s.slice(1);
    const segments = [];
    let i = 0;

    while (i < s.length) {
      const c = s[i];
      if (c === '.') {
        if (s[i + 1] === '.') {
          i += 2;
          const r = readName(s, i);
          i = r.next;
          if (!r.name) throw queryError('Expected a key after ".."', i);
          if (r.name === '*') segments.push({ type: 'recursive' });
          else segments.push({ type: 'recursive', name: r.name });
        } else {
          i++;
          const r = readName(s, i);
          i = r.next;
          if (!r.name) throw queryError('Expected a key after "."', i);
          if (r.name === '*') segments.push({ type: 'wildcard' });
          else segments.push({ type: 'child', name: r.name });
        }
      } else if (c === '[') {
        const b = readBracket(s, i + 1);
        i = b.next;
        segments.push(parseBracket(b.text, i));
      } else if (i === 0) {
        // Allow queries without a leading $: users[0].name
        const r = readName(s, i);
        i = r.next;
        if (!r.name) throw queryError('Expected a key', i);
        segments.push(r.name === '*' ? { type: 'wildcard' } : { type: 'child', name: r.name });
      } else {
        throw queryError('Unexpected character "' + c + '" in query', i);
      }
    }
    return segments;
  }

  function parseBracket(raw, pos) {
    const text = raw.trim();
    if (!text) throw queryError('Empty bracket in query', pos);

    if (text.charAt(0) === '?' || text.slice(0, 2) === '?(') {
      return parseFilter(text, pos);
    }
    if (text === '*') return { type: 'wildcard' };

    if (text.indexOf('[') === -1 && splitTopLevel(text).length > 1) {
      const items = splitTopLevel(text).map(function (part) {
        const t = part.trim();
        if (/^-?\d+$/.test(t)) return { type: 'index', index: Number(t) };
        return { type: 'child', name: unquote(t) };
      });
      return { type: 'union', items: items };
    }

    if (text.indexOf(':') !== -1 && text.indexOf('"') === -1 && text.indexOf("'") === -1) {
      const pieces = text.split(':');
      if (pieces.length < 2 || pieces.length > 3) throw queryError('Invalid slice — use [start:end]', pos);
      const nums = pieces.map(function (piece) {
        const t = piece.trim();
        if (!t) return null;
        if (!/^-?\d+$/.test(t)) throw queryError('Slice bounds must be integers', pos);
        return Number(t);
      });
      return { type: 'slice', start: nums[0], end: nums[1], step: nums[2] };
    }

    if (/^-?\d+$/.test(text)) return { type: 'index', index: Number(text) };
    return { type: 'child', name: unquote(text) };
  }

  function parseFilter(text, pos) {
    let inner = text.slice(1).trim();
    if (inner.charAt(0) === '(') {
      if (inner.charAt(inner.length - 1) !== ')') throw queryError('Filter is missing a closing parenthesis', pos);
      inner = inner.slice(1, -1).trim();
    }
    if (!inner) throw queryError('Empty filter', pos);

    const op = findOperator(inner);
    if (!op) {
      if (inner.charAt(0) !== '@') throw queryError('A filter must start with @', pos);
      return { type: 'filter', left: parseQuery('$' + inner.slice(1)), exists: true };
    }

    const left = inner.slice(0, op.index).trim();
    const right = inner.slice(op.index + op.op.length).trim();
    if (left.charAt(0) !== '@') throw queryError('The left side of a filter must be a path like @.name', pos);
    if (!right) throw queryError('Missing comparison value', pos);

    return {
      type: 'filter',
      left: parseQuery('$' + left.slice(1)),
      op: op.op,
      value: parseLiteral(right)
    };
  }

  function parseLiteral(raw) {
    const t = raw.trim();
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return { kind: 'number', value: Number(t) };
    if (t === 'true') return { kind: 'boolean', value: true };
    if (t === 'false') return { kind: 'boolean', value: false };
    if (t === 'null') return { kind: 'null', value: null };
    if (t.charAt(0) === '/') {
      const end = t.lastIndexOf('/');
      if (end > 0) {
        try { return { kind: 'regex', value: new RegExp(t.slice(1, end), t.slice(end + 1)) }; } catch (e) { /* fall through */ }
      }
    }
    return { kind: 'string', value: unquote(t) };
  }

  function resolveDirect(node, segments) {
    let current = node;
    for (const seg of segments) {
      if (!isObjectNode(current)) return { found: false, node: null };
      if (seg.type === 'child') {
        if (current.type !== 'object') return { found: false, node: null };
        const child = current.children.find(function (c) { return String(c.key) === seg.name; });
        if (!child) return { found: false, node: null };
        current = child;
      } else if (seg.type === 'index') {
        if (current.type !== 'array') return { found: false, node: null };
        const idx = seg.index < 0 ? current.children.length + seg.index : seg.index;
        if (!current.children[idx]) return { found: false, node: null };
        current = current.children[idx];
      } else {
        return { found: false, node: null };
      }
    }
    return { found: true, node: current };
  }

  function matchesFilter(node, filter) {
    const resolved = resolveDirect(node, filter.left);
    if (!resolved.found) return false;
    const actual = resolved.node.value;
    if (filter.exists) return actual !== undefined && actual !== null;

    const expected = filter.value.value;
    switch (filter.op) {
      case '==': return actual === expected;
      case '!=': return actual !== expected;
      case '>': return Number(actual) > Number(expected);
      case '>=': return Number(actual) >= Number(expected);
      case '<': return Number(actual) < Number(expected);
      case '<=': return Number(actual) <= Number(expected);
      case '=~':
        if (expected instanceof RegExp) return expected.test(String(actual));
        try { return new RegExp(String(expected)).test(String(actual)); } catch (e) { return false; }
      default: return false;
    }
  }

  function collectDescendants(item, out) {
    const node = item.node;
    if (!isObjectNode(node)) return;
    for (const child of node.children) {
      const childItem = { node: child, path: joinPath(item.path, child) };
      out.push(childItem);
      collectDescendants(childItem, out);
    }
  }

  function applySegment(current, seg) {
    const next = [];
    for (const item of current) {
      const node = item.node;
      if (!isObjectNode(node)) continue;

      if (seg.type === 'child') {
        if (node.type !== 'object') continue;
        const child = node.children.find(function (c) { return String(c.key) === seg.name; });
        if (child) next.push({ node: child, path: joinPath(item.path, child) });
      } else if (seg.type === 'index') {
        if (node.type !== 'array') continue;
        const idx = seg.index < 0 ? node.children.length + seg.index : seg.index;
        const child = node.children[idx];
        if (child) next.push({ node: child, path: joinPath(item.path, child) });
      } else if (seg.type === 'wildcard') {
        for (const child of node.children) next.push({ node: child, path: joinPath(item.path, child) });
      } else if (seg.type === 'recursive') {
        const all = [];
        collectDescendants(item, all);
        for (const entry of all) {
          if (!seg.name || String(entry.node.key) === seg.name) next.push(entry);
        }
      } else if (seg.type === 'union') {
        for (const part of seg.items) {
          if (part.type === 'index') {
            if (node.type !== 'array') continue;
            const child = node.children[part.index < 0 ? node.children.length + part.index : part.index];
            if (child) next.push({ node: child, path: joinPath(item.path, child) });
          } else {
            if (node.type !== 'object') continue;
            const child = node.children.find(function (c) { return String(c.key) === part.name; });
            if (child) next.push({ node: child, path: joinPath(item.path, child) });
          }
        }
      } else if (seg.type === 'slice') {
        if (node.type !== 'array') continue;
        const len = node.children.length;
        const step = seg.step || 1;
        if (step === 0) continue;
        let start = seg.start == null ? (step > 0 ? 0 : len - 1) : seg.start;
        let end = seg.end == null ? (step > 0 ? len : -1) : seg.end;
        if (start < 0) start += len;
        if (end < 0 && seg.end != null) end += len;
        if (step > 0) {
          start = Math.max(0, start);
          end = Math.min(len, end);
          for (let i = start; i < end; i += step) {
            const child = node.children[i];
            if (child) next.push({ node: child, path: joinPath(item.path, child) });
          }
        } else {
          start = Math.min(len - 1, start);
          end = Math.max(-1, end);
          for (let i = start; i > end; i += step) {
            const child = node.children[i];
            if (child) next.push({ node: child, path: joinPath(item.path, child) });
          }
        }
      } else if (seg.type === 'filter') {
        for (const child of node.children) {
          if (matchesFilter(child, seg)) next.push({ node: child, path: joinPath(item.path, child) });
        }
      }
    }
    return next;
  }

  function query(ast, expression) {
    try {
      const segments = parseQuery(expression);
      let current = [{ node: ast, path: '$' }];
      for (const seg of segments) current = applySegment(current, seg);
      const seen = new Set();
      const matches = [];
      for (const item of current) {
        if (seen.has(item.node)) continue;
        seen.add(item.node);
        matches.push(item);
        if (matches.length >= MAX_QUERY_RESULTS) break;
      }
      return { ok: true, matches: matches, truncated: current.length > matches.length, segments: segments.length };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err), position: err && typeof err.position === 'number' ? err.position : 0 };
    }
  }

  /* ============================================================
     JSON Schema generation (draft-07 flavoured)
     ============================================================ */

  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
  function isUri(v) { return /^https?:\/\/[^\s]+$/i.test(v); }
  function isDateTime(v) { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(v); }
  function isDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v); }
  function isUuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v); }

  function stringSchema(value, key) {
    const schema = { type: 'string' };
    if (isEmail(value) || /e-?mail$/i.test(key || '')) schema.format = 'email';
    else if (isDateTime(value)) schema.format = 'date-time';
    else if (isDate(value)) schema.format = 'date';
    else if (isUri(value)) schema.format = 'uri';
    else if (isUuid(value)) schema.format = 'uuid';
    else if (isDate(value) === false && /(status|state)$/i.test(key || '') && value.length <= 24) {
      // no enum from a single sample — leave plain
    }
    return schema;
  }

  function mergeSchemas(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.anyOf || b.anyOf) {
      const variants = (a.anyOf || [a]).concat(b.anyOf || [b]);
      const seen = new Set();
      const unique = [];
      for (const variant of variants) {
        const key = JSON.stringify(variant);
        if (!seen.has(key)) { seen.add(key); unique.push(variant); }
      }
      return { anyOf: unique };
    }
    if (a.type !== b.type) {
      if (a.type === 'null') return b;
      if (b.type === 'null') return a;
      return { anyOf: [a, b] };
    }
    if (a.type === 'object' && b.type === 'object') {
      const props = Object.assign({}, a.properties, {});
      const bProps = b.properties || {};
      for (const key of Object.keys(bProps)) {
        props[key] = props[key] ? mergeSchemas(props[key], bProps[key]) : bProps[key];
      }
      const aReq = a.required || [];
      const bReq = b.required || [];
      const required = aReq.filter(function (key) { return bReq.indexOf(key) !== -1; });
      const out = { type: 'object', properties: props };
      if (required.length) out.required = required;
      return out;
    }
    if (a.type === 'array') {
      const out = { type: 'array' };
      if (a.items && b.items) out.items = mergeSchemas(a.items, b.items);
      else if (a.items) out.items = a.items;
      else if (b.items) out.items = b.items;
      return out;
    }
    const out = Object.assign({}, a);
    if (a.format === b.format) out.format = a.format;
    else delete out.format;
    return out;
  }

  function schemaFor(value, key, stack) {
    if (value === null) return { type: 'null' };
    const type = typeof value;
    if (type === 'string') return stringSchema(value, key);
    if (type === 'number') {
      const out = { type: Number.isInteger(value) ? 'integer' : 'number' };
      if (/^(id|.*Id)$/.test(key || '') || /(count|total|qty|quantity|size|limit)$/i.test(key || '')) out.minimum = 0;
      return out;
    }
    if (type === 'boolean') return { type: 'boolean' };
    if (Array.isArray(value)) {
      if (!value.length) return { type: 'array', items: {} };
      if (stack.indexOf(value) !== -1) return { type: 'array', items: {} };
      stack.push(value);
      let items = null;
      for (const item of value.slice(0, 200)) items = mergeSchemas(items, schemaFor(item, key, stack));
      stack.pop();
      return { type: 'array', items: items || {} };
    }
    if (type === 'object') {
      if (stack.indexOf(value) !== -1) return { type: 'object' };
      stack.push(value);
      const properties = {};
      const keys = Object.keys(value);
      for (const k of keys) properties[k] = schemaFor(value[k], k, stack);
      stack.pop();
      const out = { type: 'object', properties: properties };
      if (keys.length) out.required = keys.slice();
      return out;
    }
    return {};
  }

  function toSchema(value, title) {
    const schema = schemaFor(value, '', []);
    const out = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: title || 'GeneratedSchema',
      type: schema.type
    };
    if (schema.properties) out.properties = schema.properties;
    if (schema.required) out.required = schema.required;
    if (schema.items) out.items = schema.items;
    if (schema.anyOf) { delete out.type; out.anyOf = schema.anyOf; }
    if (schema.format) out.format = schema.format;
    return JSON.stringify(out, null, 2);
  }

  /* ============================================================
     Mock data generation (deterministic, seeded)
     ============================================================ */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a += 0x6D2B79F5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const MOCK = {
    first: ['Ada', 'Grace', 'Alan', 'Katherine', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Guido', 'Radia', 'Ken', 'Anita'],
    last: ['Lovelace', 'Hopper', 'Turing', 'Johnson', 'Torvalds', 'Hamilton', 'Ritchie', 'Liskov', 'Rossum', 'Perlman', 'Thompson', 'Borg'],
    company: ['Aurora Labs', 'Northwind', 'Acme Corp', 'Harbor Systems', 'Vertex Data', 'Lumen Works'],
    city: ['Berlin', 'Lisbon', 'Toronto', 'Austin', 'Tokyo', 'Bengaluru', 'Cape Town', 'Oslo'],
    country: ['US', 'DE', 'GB', 'CA', 'IN', 'JP', 'BR', 'AU'],
    roles: ['owner', 'admin', 'analyst', 'member', 'viewer'],
    status: ['active', 'pending', 'paused', 'archived'],
    plans: ['free', 'pro', 'team', 'scale'],
    colors: ['#8b5cf6', '#22d3ee', '#34d399', '#fbbf24', '#f472b6', '#fb7185'],
    words: ['alpha', 'bravo', 'delta', 'signal', 'vector', 'stream', 'orbit', 'atlas', 'ember', 'drift', 'nova', 'harbor'],
    tags: ['analytics', 'realtime', 'dashboard', 'billing', 'growth', 'mobile', 'internal', 'beta']
  };

  function pick(rand, arr) { return arr[Math.floor(rand() * arr.length)]; }

  function mockString(rand, key, original, counter) {
    const k = String(key || '').toLowerCase();
    if (/(^|_)id$|^uuid$|^guid$/.test(k)) return 'id_' + String(1000 + counter).slice(-4) + Math.floor(rand() * 900 + 100);
    if (/(first.?name|given.?name)/.test(k)) return pick(rand, MOCK.first);
    if (/(last.?name|surname|family.?name)/.test(k)) return pick(rand, MOCK.last);
    if (/user.?name|handle|nickname/.test(k)) return pick(rand, MOCK.first).toLowerCase() + Math.floor(rand() * 90 + 10);
    if (/name/.test(k)) return pick(rand, MOCK.first) + ' ' + pick(rand, MOCK.last);
    if (/e-?mail/.test(k)) return pick(rand, MOCK.first).toLowerCase() + '.' + pick(rand, MOCK.last).toLowerCase() + '@example.com';
    if (/phone|mobile|tel/.test(k)) return '+1 555 ' + String(Math.floor(rand() * 9000 + 1000)) + ' ' + String(Math.floor(rand() * 9000 + 1000));
    if (/(url|uri|website|homepage|docs?|link)/.test(k)) return 'https://example.com/' + pick(rand, MOCK.words);
    if (/(date|time|created|updated|seen|at)$/.test(k)) {
      const d = new Date(Date.UTC(2026, 10, 9) - Math.floor(rand() * 45) * 86400000);
      return /date$/.test(k) && !/updated|created|at$/.test(k)
        ? d.toISOString().slice(0, 10)
        : d.toISOString();
    }
    if (/(company|org|organization|vendor)/.test(k)) return pick(rand, MOCK.company);
    if (/city|town/.test(k)) return pick(rand, MOCK.city);
    if (/country/.test(k)) return pick(rand, MOCK.country);
    if (/currency|ccy/.test(k)) return 'USD';
    if (/role/.test(k)) return pick(rand, MOCK.roles);
    if (/status|state/.test(k)) return pick(rand, MOCK.status);
    if (/plan|tier/.test(k)) return pick(rand, MOCK.plans);
    if (/color|colour/.test(k)) return pick(rand, MOCK.colors);
    if (/version/.test(k)) return Math.floor(rand() * 3 + 1) + '.' + Math.floor(rand() * 10) + '.' + Math.floor(rand() * 10);
    if (/slug/.test(k)) return pick(rand, MOCK.words) + '-' + pick(rand, MOCK.words);
    if (/token|secret|key|hash/.test(k)) {
      let out = '';
      for (let i = 0; i < 24; i++) out += '0123456789abcdef'[Math.floor(rand() * 16)];
      return out;
    }
    if (/description|summary|note|comment|bio|message|text|label|title/.test(k)) {
      return pick(rand, MOCK.words) + ' ' + pick(rand, MOCK.words) + ' ' + pick(rand, MOCK.words);
    }
    if (original && original.length && original.length < 40 && rand() < 0.35) return original;
    return pick(rand, MOCK.words);
  }

  function mockNumber(rand, key, original, counter) {
    const k = String(key || '').toLowerCase();
    if (/^(id|.*_id|.*Id)$/.test(key || '')) return counter;
    if (/year/.test(k)) return 2019 + Math.floor(rand() * 8);
    if (/(rate|ratio|percent|churn|growth|share)/.test(k)) return Math.round(rand() * 10000) / 10000;
    if (/(price|amount|total|mrr|revenue|cost|balance)/.test(k)) return Math.round(rand() * 90000) / 100;
    if (/(count|qty|quantity|seats|events|limit|days|size)/.test(k)) return Math.floor(rand() * 500 + 1);
    if (Number.isInteger(original)) {
      const base = Math.max(1, Math.abs(original));
      return Math.floor(rand() * base * 2) + 1;
    }
    const base = Math.max(0.01, Math.abs(original || 1));
    return Math.round((rand() * base * 2) * 100) / 100;
  }

  function generateMock(node, key, ctx, depth) {
    if (depth > 9 || ctx.budget <= 0) return null;
    ctx.budget--;
    if (!node) return null;

    switch (node.type) {
      case 'string':
        return mockString(ctx.rand, key, node.value, ctx.counter);
      case 'number':
        return mockNumber(ctx.rand, key, node.value, ctx.counter);
      case 'boolean':
        return ctx.rand() > 0.32;
      case 'null':
        return null;
      case 'array': {
        if (!node.children.length) return [];
        const template = node.children[0];
        const length = 2 + Math.floor(ctx.rand() * 2);
        const out = [];
        for (let i = 0; i < length; i++) {
          ctx.counter++;
          out.push(generateMock(template, key, ctx, depth + 1));
        }
        return out;
      }
      case 'object': {
        const out = {};
        for (const child of node.children.slice(0, 40)) {
          ctx.counter++;
          out[child.key] = generateMock(child, child.key, ctx, depth + 1);
        }
        return out;
      }
      default:
        return null;
    }
  }

  function mockJSON(ast, count) {
    if (!ast) return '';
    const n = Math.max(1, Math.min(50, count || 5));
    const ctx = { rand: mulberry32(20261109), counter: 0, budget: 4000 };
    if (ast.type === 'array') {
      if (!ast.children.length) return '[]';
      const template = ast.children[0];
      const out = [];
      for (let i = 0; i < n; i++) {
        ctx.counter++;
        out.push(generateMock(template, '', ctx, 0));
      }
      return JSON.stringify(out, null, 2);
    }
    if (ast.type === 'object') {
      const out = [];
      for (let i = 0; i < n; i++) {
        ctx.counter++;
        out.push(generateMock(ast, '', ctx, 0));
      }
      return JSON.stringify(out, null, 2);
    }
    return JSON.stringify(generateMock(ast, '', ctx, 0), null, 2);
  }

  /* ============================================================
     Export
     ============================================================ */

  global.JSONStudioPro = {
    query: query,
    parseQuery: parseQuery,
    toSchema: toSchema,
    mockJSON: mockJSON,
    MAX_QUERY_RESULTS: MAX_QUERY_RESULTS
  };
})(typeof window !== 'undefined' ? window : globalThis);

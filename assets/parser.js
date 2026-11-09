/* ============================================================
   JSON Studio — parser core
   A hand-written recursive-descent JSON parser with:
   - exact error locations (line / column / offset)
   - optional lenient mode (comments, trailing commas,
     single quotes, unquoted keys)
   - warnings for duplicate keys, unsafe integers, overflow
   - an AST with source ranges, used for highlighting + tree
   - a serializer that preserves raw number lexemes
   ============================================================ */
(function (global) {
  'use strict';

  const isDigit = (c) => c >= '0' && c <= '9';
  const isHex = (c) => /^[0-9a-fA-F]$/.test(c);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function quoteChar(c) {
    if (c === '\n') return '"\\n"';
    if (c === '\r') return '"\\r"';
    if (c === '\t') return '"\\t"';
    if (c === undefined) return 'end of input';
    const code = c.charCodeAt(0);
    if (code < 0x20) return 'U+' + code.toString(16).toUpperCase().padStart(4, '0');
    return '"' + c + '"';
  }

  function locate(text, index) {
    const i = clamp(index, 0, text.length);
    let line = 1;
    let lineStart = 0;
    for (let k = 0; k < i; k++) {
      if (text.charCodeAt(k) === 10) {
        line++;
        lineStart = k + 1;
      }
    }
    let lineEnd = text.indexOf('\n', i);
    if (lineEnd === -1) lineEnd = text.length;
    return { line, column: i - lineStart + 1, lineStart, lineEnd };
  }

  class JSONParseError extends Error {
    constructor(message, index, length, text) {
      super(message);
      this.name = 'JSONParseError';
      this.index = clamp(index, 0, text.length);
      this.length = Math.max(1, length || 1);
      const loc = locate(text, this.index);
      this.line = loc.line;
      this.column = loc.column;
      this.lineStart = loc.lineStart;
      this.lineEnd = loc.lineEnd;
      this.lineText = text.slice(loc.lineStart, loc.lineEnd);
    }
  }

  class Parser {
    constructor(text, options) {
      this.text = text;
      this.n = text.length;
      this.i = 0;
      this.lenient = !!(options && options.lenient);
      this.warnings = [];
      this.counts = { object: 0, array: 0, string: 0, number: 0, boolean: 0, null: 0 };
      this.nodeCount = 0;
      this.keys = 0;
      this.maxDepth = 0;
    }

    fail(message, index, length) {
      throw new JSONParseError(message, index === undefined ? this.i : index, length, this.text);
    }

    skipWhitespace() {
      const text = this.text;
      while (this.i < this.n) {
        const c = text.charCodeAt(this.i);
        if (c === 32 || c === 9 || c === 10 || c === 13) {
          this.i++;
          continue;
        }
        if (this.lenient && c === 47 /* / */) {
          if (text[this.i + 1] === '/') {
            this.i += 2;
            while (this.i < this.n && text[this.i] !== '\n' && text[this.i] !== '\r') this.i++;
            continue;
          }
          if (text[this.i + 1] === '*') {
            const start = this.i;
            this.i += 2;
            while (this.i < this.n && !(text[this.i] === '*' && text[this.i + 1] === '/')) this.i++;
            if (this.i >= this.n) this.fail('Unterminated block comment', start, this.n - start);
            this.i += 2;
            continue;
          }
        }
        break;
      }
    }

    parse() {
      if (this.n && this.text.charCodeAt(0) === 0xfeff) this.i = 1;
      this.skipWhitespace();
      if (this.i >= this.n) this.fail('Unexpected end of input — expected a JSON value', this.i, 1);
      const ast = this.parseValue(0);
      this.skipWhitespace();
      if (this.i < this.n) {
        const c = this.text[this.i];
        let msg = 'Unexpected character ' + quoteChar(c) + ' after the JSON value';
        if (c === '/' && !this.lenient) msg += ' — comments are not allowed in strict JSON; try Lenient mode';
        else if (c === ',') msg += ' — trailing content after the root value is not allowed';
        else if (c === '}') msg += ' — unexpected closing brace';
        else if (c === ']') msg += ' — unexpected closing bracket';
        this.fail(msg, this.i, 1);
      }
      return {
        ast,
        value: ast.value,
        warnings: this.warnings,
        stats: {
          bytes: byteLength(this.text),
          nodes: this.nodeCount,
          depth: this.maxDepth,
          keys: this.keys,
          counts: this.counts
        }
      };
    }

    parseValue(depth) {
      if (depth > 512) {
        this.fail('Maximum nesting depth of 512 exceeded — the data may be malformed', this.i, 1);
      }
      if (depth + 1 > this.maxDepth) this.maxDepth = depth + 1;
      this.skipWhitespace();
      if (this.i >= this.n) this.fail('Unexpected end of input — expected a value', this.i, 1);
      const c = this.text[this.i];
      switch (c) {
        case '{': return this.parseObject(depth);
        case '[': return this.parseArray(depth);
        case '"': return this.parseStringValue(depth);
        case "'":
          if (this.lenient) return this.parseStringValue(depth);
          this.fail("Unexpected single quote — JSON strings need double quotes; try Lenient mode", this.i, 1);
          break;
        case 't': return this.parseLiteral('true', true, 'boolean');
        case 'f': return this.parseLiteral('false', false, 'boolean');
        case 'n': return this.parseLiteral('null', null, 'null');
        default:
          if (c === '-' || isDigit(c)) return this.parseNumber();
          if (c === '/' && !this.lenient) {
            this.fail('Unexpected "/" — comments are not allowed in strict JSON; try Lenient mode', this.i, 1);
          }
          this.fail('Unexpected character ' + quoteChar(c) + ' — expected a JSON value', this.i, 1);
      }
      return null;
    }

    parseLiteral(word, value, type) {
      const start = this.i;
      if (!this.text.startsWith(word, start)) {
        this.fail('Invalid literal — expected "' + word + '"', start, 1);
      }
      this.i += word.length;
      const next = this.text[this.i];
      if (next !== undefined && /[A-Za-z0-9_$]/.test(next)) {
        this.fail('Invalid literal — did you mean "' + word + '"?', start, word.length + 1);
      }
      this.counts[type]++;
      this.nodeCount++;
      return { type, value, raw: word, start, end: this.i };
    }

    parseNumber() {
      const text = this.text;
      const start = this.i;
      if (text[this.i] === '-') this.i++;
      if (this.i >= this.n) this.fail('Invalid number — expected a digit', start, this.i - start + 1);
      const first = text[this.i];
      if (first === '0') {
        this.i++;
        if (isDigit(text[this.i])) this.fail('Invalid number — leading zeros are not allowed', start, 2);
      } else if (first >= '1' && first <= '9') {
        this.i++;
        while (isDigit(text[this.i])) this.i++;
      } else {
        this.fail('Invalid number — expected a digit', this.i, 1);
      }
      if (text[this.i] === '.') {
        this.i++;
        if (!isDigit(text[this.i])) this.fail('Invalid number — expected a digit after the decimal point', this.i, 1);
        while (isDigit(text[this.i])) this.i++;
      }
      const e = text[this.i];
      if (e === 'e' || e === 'E') {
        this.i++;
        if (text[this.i] === '+' || text[this.i] === '-') this.i++;
        if (!isDigit(text[this.i])) this.fail('Invalid number — expected exponent digits', this.i, 1);
        while (isDigit(text[this.i])) this.i++;
      }
      const raw = text.slice(start, this.i);
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        this.warnings.push({
          kind: 'number-overflow',
          message: 'Number ' + raw + ' overflows to Infinity',
          index: start
        });
      } else if (!/[.eE]/.test(raw) && !Number.isSafeInteger(value)) {
        this.warnings.push({
          kind: 'unsafe-integer',
          message: 'Integer ' + raw + " exceeds JavaScript's safe integer range (2^53 − 1)",
          index: start
        });
      }
      this.counts.number++;
      this.nodeCount++;
      return { type: 'number', value, raw, start, end: this.i };
    }

    parseStringValue() {
      const lit = this.parseStringLiteral();
      this.counts.string++;
      this.nodeCount++;
      return { type: 'string', value: lit.value, raw: lit.raw, start: lit.start, end: lit.end };
    }

    parseStringLiteral() {
      const text = this.text;
      const start = this.i;
      const quote = text[this.i];
      this.i++;
      let value = '';
      while (this.i < this.n) {
        const c = text[this.i];
        if (c === quote) {
          this.i++;
          return { value, raw: text.slice(start, this.i), start, end: this.i };
        }
        if (c === '\\') {
          const escStart = this.i;
          this.i++;
          if (this.i >= this.n) this.fail('Unterminated escape sequence in string', escStart, 2);
          const e = text[this.i];
          switch (e) {
            case '"': value += '"'; this.i++; break;
            case "'":
              if (quote === "'" || this.lenient) { value += "'"; this.i++; break; }
              this.fail("Invalid escape sequence \\' in string", escStart, 2);
              break;
            case '\\': value += '\\'; this.i++; break;
            case '/': value += '/'; this.i++; break;
            case 'b': value += '\b'; this.i++; break;
            case 'f': value += '\f'; this.i++; break;
            case 'n': value += '\n'; this.i++; break;
            case 'r': value += '\r'; this.i++; break;
            case 't': value += '\t'; this.i++; break;
            case 'u': {
              const hex = text.slice(this.i + 1, this.i + 5);
              if (hex.length !== 4 || !isHex(hex[0]) || !isHex(hex[1]) || !isHex(hex[2]) || !isHex(hex[3])) {
                this.fail('Invalid unicode escape — expected \\u followed by 4 hex digits', escStart, 6);
              }
              value += String.fromCharCode(parseInt(hex, 16));
              this.i += 5;
              break;
            }
            default:
              this.fail('Invalid escape sequence \\' + e + ' in string', escStart, 2);
          }
          continue;
        }
        if (c === '\n' || c === '\r') {
          this.fail('Unterminated string — line breaks must be escaped as \\n', start, this.i - start);
        }
        if (c.charCodeAt(0) < 0x20) {
          this.fail('Unescaped control character in string', this.i, 1);
        }
        value += c;
        this.i++;
      }
      this.fail('Unterminated string — expected closing ' + quote, start, Math.min(this.n - start, 80));
      return null;
    }

    readKey() {
      const c = this.text[this.i];
      if (c === '"' || (this.lenient && c === "'")) {
        return this.parseStringLiteral();
      }
      if (this.lenient) {
        const start = this.i;
        if (!/[A-Za-z_$]/.test(c)) {
          this.fail('Expected an object key', this.i, 1);
        }
        this.i++;
        while (this.i < this.n && /[A-Za-z0-9_$]/.test(this.text[this.i])) this.i++;
        const raw = this.text.slice(start, this.i);
        return { value: raw, raw, start, end: this.i };
      }
      if (c === '/') this.fail('Comments are not allowed in strict JSON — try Lenient mode', this.i, 1);
      if (c === "'") this.fail('Object keys must use double quotes — try Lenient mode', this.i, 1);
      if (/[A-Za-z_$]/.test(c || '')) this.fail('Object keys must be quoted — try Lenient mode for unquoted keys', this.i, 1);
      this.fail('Expected a double-quoted object key', this.i, 1);
      return null;
    }

    parseObject(depth) {
      const start = this.i;
      this.i++;
      this.counts.object++;
      this.nodeCount++;
      const obj = {};
      const children = [];
      const seen = new Map();
      this.skipWhitespace();
      if (this.text[this.i] === '}') {
        this.i++;
        return { type: 'object', value: obj, children, start, end: this.i };
      }
      while (true) {
        this.skipWhitespace();
        if (this.i >= this.n) this.fail('Unexpected end of input — expected an object key or "}"', this.i, 1);
        if (this.text[this.i] === '}') {
          if (this.lenient) { this.i++; break; }
          this.fail('Trailing commas are not allowed in strict JSON — enable Lenient mode', this.i, 1);
        }
        const keyInfo = this.readKey();
        this.keys++;
        this.skipWhitespace();
        if (this.text[this.i] !== ':') {
          this.fail('Expected ":" after object key "' + keyInfo.value + '"', this.i, 1);
        }
        this.i++;
        const child = this.parseValue(depth + 1);
        child.key = keyInfo.value;
        child.keyRaw = keyInfo.raw;
        child.keyKind = 'key';
        child.keyStart = keyInfo.start;
        child.keyEnd = keyInfo.end;
        if (seen.has(keyInfo.value)) {
          this.warnings.push({
            kind: 'duplicate-key',
            message: 'Duplicate key "' + keyInfo.value + '" — the last value wins',
            index: keyInfo.start,
            otherIndex: seen.get(keyInfo.value)
          });
        } else {
          seen.set(keyInfo.value, keyInfo.start);
        }
        children.push(child);
        Object.defineProperty(obj, keyInfo.value, {
          value: child.value,
          enumerable: true,
          configurable: true,
          writable: true
        });
        this.skipWhitespace();
        const c = this.text[this.i];
        if (c === ',') {
          this.i++;
          this.skipWhitespace();
          if (this.lenient && this.text[this.i] === '}') { this.i++; break; }
          continue;
        }
        if (c === '}') { this.i++; break; }
        if (this.i >= this.n) this.fail('Unexpected end of input — expected "," or "}"', this.i, 1);
        this.fail('Expected "," or "}" in object', this.i, 1);
      }
      return { type: 'object', value: obj, children, start, end: this.i };
    }

    parseArray(depth) {
      const start = this.i;
      this.i++;
      this.counts.array++;
      this.nodeCount++;
      const arr = [];
      const children = [];
      this.skipWhitespace();
      if (this.text[this.i] === ']') {
        this.i++;
        return { type: 'array', value: arr, children, start, end: this.i };
      }
      while (true) {
        this.skipWhitespace();
        if (this.i >= this.n) this.fail('Unexpected end of input — expected a value or "]"', this.i, 1);
        if (this.text[this.i] === ']') {
          if (this.lenient) { this.i++; break; }
          this.fail('Trailing commas are not allowed in strict JSON — enable Lenient mode', this.i, 1);
        }
        const child = this.parseValue(depth + 1);
        child.key = arr.length;
        child.keyKind = 'index';
        children.push(child);
        arr.push(child.value);
        this.skipWhitespace();
        const c = this.text[this.i];
        if (c === ',') {
          this.i++;
          this.skipWhitespace();
          if (this.lenient && this.text[this.i] === ']') { this.i++; break; }
          continue;
        }
        if (c === ']') { this.i++; break; }
        if (this.i >= this.n) this.fail('Unexpected end of input — expected "," or "]"', this.i, 1);
        this.fail('Expected "," or "]" in array', this.i, 1);
      }
      return { type: 'array', value: arr, children, start, end: this.i };
    }
  }

  function parseJSON(text, options) {
    return new Parser(text, options).parse();
  }

  function byteLength(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
    return unescape(encodeURIComponent(text)).length;
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      c === '&' ? '&amp;' :
      c === '<' ? '&lt;' :
      c === '>' ? '&gt;' :
      c === '"' ? '&quot;' : '&#39;'
    ));
  }

  /* Serialize an AST node. unit is an indent string ('' for minified). */
  function serialize(node, unit, sortKeys) {
    if (typeof unit === 'number') unit = ' '.repeat(unit);
    unit = unit || '';

    function keyText(n) {
      return n.keyRaw && n.keyRaw[0] === '"' ? n.keyRaw : JSON.stringify(n.key);
    }
    function stringText(n) {
      return n.raw && n.raw[0] === '"' ? n.raw : JSON.stringify(n.value);
    }
    function write(n, level) {
      const pad = (l) => unit.repeat(l);
      switch (n.type) {
        case 'object': {
          if (!n.children.length) return '{}';
          const kids = sortKeys
            ? n.children.slice().sort((a, b) => String(a.key).localeCompare(String(b.key), 'en'))
            : n.children;
          if (!unit) return '{' + kids.map((k) => keyText(k) + ':' + write(k, 0)).join(',') + '}';
          return '{\n' +
            kids.map((k) => pad(level + 1) + keyText(k) + ': ' + write(k, level + 1)).join(',\n') +
            '\n' + pad(level) + '}';
        }
        case 'array': {
          if (!n.children.length) return '[]';
          if (!unit) return '[' + n.children.map((k) => write(k, 0)).join(',') + ']';
          return '[\n' +
            n.children.map((k) => pad(level + 1) + write(k, level + 1)).join(',\n') +
            '\n' + pad(level) + ']';
        }
        case 'string': return stringText(n);
        case 'number': return n.raw;
        case 'boolean': return n.value ? 'true' : 'false';
        case 'null': return 'null';
        default: return 'null';
      }
    }
    return write(node, 0);
  }

  /* Lightweight lexical highlighter, tolerant of invalid input. */
  function highlight(text, lenient) {
    let out = '';
    let i = 0;
    const n = text.length;
    const numRe = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

    const push = (cls, str) => {
      if (!str) return;
      out += cls ? '<span class="tok-' + cls + '">' + escapeHTML(str) + '</span>' : escapeHTML(str);
    };

    while (i < n) {
      const c = text[i];
      if (c === '"' || (lenient && c === "'")) {
        const quote = c;
        const start = i;
        i++;
        while (i < n) {
          if (text[i] === '\\') { i += 2; continue; }
          if (text[i] === quote) { i++; break; }
          if (text[i] === '\n' || text[i] === '\r') break;
          i++;
        }
        const raw = text.slice(start, i);
        let j = i;
        while (j < n && /\s/.test(text[j])) j++;
        push(text[j] === ':' ? 'key' : 'string', raw);
        continue;
      }
      if (c === '/' && lenient && text[i + 1] === '/') {
        const start = i;
        while (i < n && text[i] !== '\n' && text[i] !== '\r') i++;
        push('comment', text.slice(start, i));
        continue;
      }
      if (c === '/' && lenient && text[i + 1] === '*') {
        const start = i;
        i += 2;
        while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
        if (i < n) i += 2;
        push('comment', text.slice(start, i));
        continue;
      }
      if (c === '-' || isDigit(c)) {
        numRe.lastIndex = i;
        const m = numRe.exec(text);
        if (m && m[0].length) {
          push('number', m[0]);
          i += m[0].length;
          continue;
        }
      }
      if (c === 't' && text.startsWith('true', i)) { push('boolean', 'true'); i += 4; continue; }
      if (c === 'f' && text.startsWith('false', i)) { push('boolean', 'false'); i += 5; continue; }
      if (c === 'n' && text.startsWith('null', i)) { push('null', 'null'); i += 4; continue; }
      if (c === '{' || c === '}' || c === '[' || c === ']' || c === ',' || c === ':') {
        push('punct', c);
        i++;
        continue;
      }
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        let j = i + 1;
        while (j < n && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n' || text[j] === '\r')) j++;
        out += escapeHTML(text.slice(i, j));
        i = j;
        continue;
      }
      // Coalesce runs of unexpected characters so a large malformed document
      // cannot balloon into one <span> per character.
      let j = i + 1;
      while (j < n) {
        const d = text[j];
        if (d === '"' || (lenient && d === "'") || (lenient && d === '/') ||
            d === '-' || isDigit(d) || d === 't' || d === 'f' || d === 'n' ||
            d === '{' || d === '}' || d === '[' || d === ']' || d === ',' || d === ':' ||
            d === ' ' || d === '\t' || d === '\n' || d === '\r') break;
        j++;
      }
      push('invalid', text.slice(i, j));
      i = j;
    }
    return out;
  }

  global.JSONStudio = Object.assign(global.JSONStudio || {}, {
    parseJSON,
    JSONParseError,
    locate,
    serialize,
    highlight,
    byteLength,
    escapeHTML
  });
})(window);

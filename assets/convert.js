/* ============================================================
   JSON Studio — converters
   TypeScript interface inference, YAML, CSV, Python, JavaScript.
   ============================================================ */
(function (global) {
  'use strict';

  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isIdentifier = (key) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);

  function pascal(key) {
    const cleaned = String(key).replace(/[^A-Za-z0-9]+/g, ' ').trim();
    if (!cleaned) return 'Value';
    let name = cleaned.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    if (/^[0-9]/.test(name)) name = 'N' + name;
    return name;
  }

  function singular(name) {
    if (!name) return 'Item';
    if (/(ss|us|is)$/i.test(name)) return name;
    if (/ies$/i.test(name)) return name.slice(0, -3) + 'y';
    if (/(ses|xes|zes|ches|shes)$/i.test(name)) return name.slice(0, -2);
    if (/s$/i.test(name)) return name.slice(0, -1);
    return name;
  }

  /* ------------------------------------------------------------
     TypeScript
     ------------------------------------------------------------ */

  function toTypeScript(root) {
    const defs = [];
    const used = new Set();

    function uniqueName(base) {
      const clean = pascal(base || 'Type') || 'Type';
      let candidate = clean;
      let n = 2;
      while (used.has(candidate)) candidate = clean + n++;
      used.add(candidate);
      return candidate;
    }

    function union(types) {
      const flat = [];
      for (const t of types) {
        if (!t) continue;
        for (const part of String(t).split(' | ')) {
          const p = part.trim();
          if (p && !flat.includes(p)) flat.push(p);
        }
      }
      return flat.join(' | ') || 'unknown';
    }

    function inferArray(arr, nameHint) {
      if (!arr.length) return 'unknown[]';
      const elemHint = singular(nameHint || 'Item');
      const inner = inferValues(arr, elemHint);
      return (inner.includes(' | ') ? '(' + inner + ')' : inner) + '[]';
    }

    function inferValues(values, nameHint) {
      const objects = [];
      const arrays = [];
      const primitives = [];
      for (const v of values) {
        if (v === null) primitives.push('null');
        else if (Array.isArray(v)) arrays.push(v);
        else if (typeof v === 'object') objects.push(v);
        else primitives.push(typeof v);
      }
      const types = [];
      if (objects.length) types.push(inferObjectMerged(objects, nameHint));
      if (arrays.length) {
        const flat = [].concat.apply([], arrays);
        types.push(flat.length ? inferArray(flat, nameHint) : 'unknown[]');
      }
      for (const p of primitives) types.push(p);
      return union(types);
    }

    function inferObjectMerged(objects, nameHint) {
      const keys = [];
      const seen = new Set();
      for (const obj of objects) {
        for (const key of Object.keys(obj)) {
          if (!seen.has(key)) {
            seen.add(key);
            keys.push(key);
          }
        }
      }
      if (!keys.length) return 'Record<string, unknown>';

      const name = uniqueName(nameHint || 'Object');
      const lines = [];
      for (const key of keys) {
        const present = objects.filter((o) => hasOwn(o, key));
        const optional = present.length !== objects.length;
        const type = inferValues(present.map((o) => o[key]), pascal(key));
        const prop = isIdentifier(key) ? key : JSON.stringify(key);
        lines.push('  ' + prop + (optional ? '?' : '') + ': ' + type + ';');
      }
      defs.push('export interface ' + name + ' {\n' + lines.join('\n') + '\n}');
      return name;
    }

    function inferValue(value, nameHint) {
      if (value === null) return 'null';
      const t = typeof value;
      if (t === 'string' || t === 'number' || t === 'boolean') return t;
      if (Array.isArray(value)) return inferArray(value, nameHint);
      if (t === 'object') return inferObjectMerged([value], nameHint);
      return 'unknown';
    }

    let rootType = null;
    if (Array.isArray(root)) {
      rootType = inferArray(root, 'RootItem');
    } else if (isPlainObject(root)) {
      const t = inferObjectMerged([root], 'Root');
      if (t !== 'Root') rootType = t;
    } else {
      rootType = inferValue(root, 'Root');
    }

    const out = defs.join('\n\n');
    if (rootType) {
      return (out ? out + '\n\n' : '') + 'export type Root = ' + rootType + ';';
    }
    return out || 'export type Root = unknown;';
  }

  /* ------------------------------------------------------------
     YAML
     ------------------------------------------------------------ */

  function toYAML(value) {
    const lines = [];

    function yamlString(s) {
      if (s === '') return '""';
      const reserved = /^(?:true|false|null|yes|no|on|off|~)$/i.test(s);
      const numberLike = /^[-+]?(?:\d|\.\d)/.test(s);
      const badStart = /^[!&*?|>@`"'{[\]},#%-]/.test(s);
      const badInside = /: | #|:$|\s$|^\s/.test(s);
      const control = /[\x00-\x1f\x7f]/.test(s);
      const safePlain = /^[A-Za-z0-9_./][A-Za-z0-9_./ -]*$/.test(s);
      if (!reserved && !numberLike && !badStart && !badInside && !control && safePlain) return s;
      return JSON.stringify(s);
    }

    function scalar(v) {
      if (v === null) return 'null';
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      if (typeof v === 'number') {
        if (Number.isNaN(v)) return '.nan';
        if (v === Infinity) return '.inf';
        if (v === -Infinity) return '-.inf';
        return String(v);
      }
      return yamlString(String(v));
    }

    function multiline(s, indent) {
      const pad = ' '.repeat(indent);
      const parts = s.split('\n');
      for (const line of parts) lines.push(line === '' ? '' : pad + line);
    }

    function emitEntries(obj, keyIndent, firstPad, restPad) {
      const keys = Object.keys(obj);
      keys.forEach((key, index) => {
        const pad = index === 0 ? firstPad : restPad;
        const v = obj[key];
        const k = yamlString(key);
        if (isPlainObject(v)) {
          if (!Object.keys(v).length) {
            lines.push(pad + k + ': {}');
          } else {
            lines.push(pad + k + ':');
            emit(v, keyIndent + 2);
          }
        } else if (Array.isArray(v)) {
          if (!v.length) {
            lines.push(pad + k + ': []');
          } else {
            lines.push(pad + k + ':');
            emit(v, keyIndent + 2);
          }
        } else if (typeof v === 'string' && v.includes('\n')) {
          lines.push(pad + k + ': |');
          multiline(v, keyIndent + 2);
        } else {
          lines.push(pad + k + ': ' + scalar(v));
        }
      });
    }

    function emit(v, indent) {
      const pad = ' '.repeat(indent);
      if (Array.isArray(v)) {
        if (!v.length) { lines.push(pad + '[]'); return; }
        for (const item of v) {
          if (isPlainObject(item)) {
            if (!Object.keys(item).length) {
              lines.push(pad + '- {}');
            } else {
              emitEntries(item, indent + 2, pad + '- ', pad + '  ');
            }
          } else if (Array.isArray(item)) {
            if (!item.length) {
              lines.push(pad + '- []');
            } else {
              lines.push(pad + '-');
              emit(item, indent + 2);
            }
          } else if (typeof item === 'string' && item.includes('\n')) {
            lines.push(pad + '- |');
            multiline(item, indent + 2);
          } else {
            lines.push(pad + '- ' + scalar(item));
          }
        }
        return;
      }
      if (isPlainObject(v)) {
        if (!Object.keys(v).length) { lines.push(pad + '{}'); return; }
        emitEntries(v, indent, pad, pad);
        return;
      }
      if (typeof v === 'string' && v.includes('\n')) {
        lines.push(pad + '|');
        multiline(v, indent + 2);
        return;
      }
      lines.push(pad + scalar(v));
    }

    emit(value, 0);
    return lines.join('\n') + '\n';
  }

  /* ------------------------------------------------------------
     CSV
     ------------------------------------------------------------ */

  function toCSV(value) {
    function flatten(obj, prefix, out) {
      for (const key of Object.keys(obj)) {
        const full = prefix ? prefix + '.' + key : key;
        const v = obj[key];
        if (isPlainObject(v)) {
          if (!Object.keys(v).length) out[full] = '{}';
          else flatten(v, full, out);
        } else if (Array.isArray(v)) {
          out[full] = JSON.stringify(v);
        } else if (v === null) {
          out[full] = '';
        } else {
          out[full] = String(v);
        }
      }
    }

    function cell(v) {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    let columns = [];
    let rows = [];

    if (Array.isArray(value)) {
      if (!value.length) return '';
      const allObjects = value.every((v) => isPlainObject(v));
      if (allObjects) {
        const keys = new Set();
        for (const obj of value) {
          const flat = {};
          flatten(obj, '', flat);
          Object.keys(flat).forEach((k) => keys.add(k));
        }
        columns = Array.from(keys);
        rows = value.map((obj) => {
          const flat = {};
          flatten(obj, '', flat);
          return columns.map((c) => flat[c] === undefined ? '' : flat[c]);
        });
      } else {
        columns = ['value'];
        rows = value.map((v) => [cell(v)]);
      }
    } else if (isPlainObject(value)) {
      const flat = {};
      flatten(value, '', flat);
      columns = Object.keys(flat);
      rows = [columns.map((c) => flat[c])];
    } else {
      columns = ['value'];
      rows = [[cell(value)]];
    }

    if (!columns.length) return '';
    return [columns.map(cell).join(',')]
      .concat(rows.map((row) => row.map(cell).join(',')))
      .join('\n');
  }

  /* ------------------------------------------------------------
     Python
     ------------------------------------------------------------ */

  function toPython(value) {
    const unit = '    ';

    function ser(v, level) {
      const pad = (l) => unit.repeat(l);
      if (v === null) return 'None';
      if (typeof v === 'boolean') return v ? 'True' : 'False';
      if (typeof v === 'number') {
        if (Number.isNaN(v)) return 'float("nan")';
        if (v === Infinity) return 'float("inf")';
        if (v === -Infinity) return 'float("-inf")';
        return String(v);
      }
      if (typeof v === 'string') return JSON.stringify(v);
      if (Array.isArray(v)) {
        if (!v.length) return '[]';
        return '[\n' +
          v.map((item) => pad(level + 1) + ser(item, level + 1)).join(',\n') +
          '\n' + pad(level) + ']';
      }
      const keys = Object.keys(v);
      if (!keys.length) return '{}';
      return '{\n' +
        keys.map((k) => pad(level + 1) + JSON.stringify(k) + ': ' + ser(v[k], level + 1)).join(',\n') +
        '\n' + pad(level) + '}';
    }

    return 'data = ' + ser(value, 0) + '\n';
  }

  /* ------------------------------------------------------------
     JavaScript
     ------------------------------------------------------------ */

  function toJavaScript(ast) {
    const body = global.JSONStudio.serialize(ast, '  ', false);
    return 'const data = ' + body + ';\n\nexport default data;\n';
  }

  global.JSONStudio = Object.assign(global.JSONStudio || {}, {
    toTypeScript,
    toYAML,
    toCSV,
    toPython,
    toJavaScript
  });
})(window);

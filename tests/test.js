'use strict';

const assert = require('assert');
global.window = global;
require('../assets/parser.js');
require('../assets/convert.js');

const J = global.JSONStudio;
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (err) {
    console.error('FAIL  ' + name);
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  }
}

console.log('parser');

test('parses nested values and computes stats', () => {
  const r = J.parseJSON('{"a":1,"b":[true,null,"x"]}');
  assert.strictEqual(r.value.a, 1);
  assert.deepStrictEqual(r.value.b, [true, null, 'x']);
  assert.strictEqual(r.stats.nodes, 6);
  assert.strictEqual(r.stats.depth, 3);
  assert.strictEqual(r.stats.counts.object, 1);
  assert.strictEqual(r.stats.counts.array, 1);
  assert.strictEqual(r.stats.counts.string, 1);
  assert.strictEqual(r.stats.counts.number, 1);
  assert.strictEqual(r.stats.counts.boolean, 1);
  assert.strictEqual(r.stats.counts.null, 1);
});

test('reports trailing comma with line and column', () => {
  let err = null;
  try { J.parseJSON('{\n  "a": 1,\n}'); } catch (e) { err = e; }
  assert.ok(err, 'expected an error');
  assert.strictEqual(err.line, 3);
  assert.strictEqual(err.column, 1);
  assert.ok(/trailing commas/i.test(err.message));
});

test('reports unterminated string location', () => {
  let err = null;
  try { J.parseJSON('{"a": "oops}'); } catch (e) { err = e; }
  assert.ok(err);
  assert.ok(/Unterminated string/i.test(err.message));
});

test('lenient mode accepts comments, single quotes, unquoted keys and trailing commas', () => {
  const src = "{\n  // a comment\n  name: 'Ada',\n  tags: ['a', 'b',],\n  /* block */\n}";
  const r = J.parseJSON(src, { lenient: true });
  assert.strictEqual(r.value.name, 'Ada');
  assert.deepStrictEqual(r.value.tags, ['a', 'b']);
});

test('strict mode rejects comments', () => {
  let err = null;
  try { J.parseJSON('{ /* nope */ "a": 1 }'); } catch (e) { err = e; }
  assert.ok(err);
  assert.ok(/comment/i.test(err.message));
});

test('duplicate keys warn and last value wins', () => {
  const r = J.parseJSON('{"a":1,"a":2}');
  assert.strictEqual(r.value.a, 2);
  assert.strictEqual(r.warnings.length, 1);
  assert.strictEqual(r.warnings[0].kind, 'duplicate-key');
});

test('unsafe integer warns', () => {
  const r = J.parseJSON('{"n":9007199254740993}');
  assert.strictEqual(r.warnings.length, 1);
  assert.strictEqual(r.warnings[0].kind, 'unsafe-integer');
});

test('serializer preserves number lexemes', () => {
  const r = J.parseJSON('{"n":1e3,"m":-0,"f":1.50}');
  assert.strictEqual(J.serialize(r.ast, '', false), '{"n":1e3,"m":-0,"f":1.50}');
});

test('serializer sorts keys recursively', () => {
  const r = J.parseJSON('{"b":{"z":1,"a":2},"a":3}');
  assert.strictEqual(J.serialize(r.ast, '', true), '{"a":3,"b":{"a":2,"z":1}}');
});

test('rejects leading zeros, bare decimal and exponents', () => {
  ['01', '1.', '1e', '-'].forEach((src) => {
    let err = null;
    try { J.parseJSON(src); } catch (e) { err = e; }
    assert.ok(err, 'expected error for ' + src);
    assert.ok(/Invalid number/i.test(err.message), 'wrong message for ' + src + ': ' + (err && err.message));
  });
});

test('accepts a BOM', () => {
  const r = J.parseJSON('\uFEFF{"ok":true}');
  assert.strictEqual(r.value.ok, true);
});

test('highlighter marks keys, strings and numbers', () => {
  const html = J.highlight('{"a": 1, "b": "x", "c": true, "d": null}', false);
  assert.ok(html.indexOf('tok-key') !== -1);
  assert.ok(html.indexOf('tok-number') !== -1);
  assert.ok(html.indexOf('tok-string') !== -1);
  assert.ok(html.indexOf('tok-boolean') !== -1);
  assert.ok(html.indexOf('tok-null') !== -1);
});

test('highlighter coalesces runs of invalid characters', () => {
  const html = J.highlight('x'.repeat(10000), false);
  assert.strictEqual((html.match(/tok-invalid/g) || []).length, 1, 'expected a single invalid span');
  assert.ok(html.length < 10100, 'invalid run should not expand per character: ' + html.length);
});

console.log('converters');

const sample = {
  name: 'Ada',
  active: true,
  score: 9.5,
  tags: ['a', 'b'],
  address: { city: 'London', zip: null },
  users: [
    { id: 1, name: 'Ada', admin: true },
    { id: 2, name: 'Grace' }
  ],
  notes: 'line one\nline two'
};

test('TypeScript infers interfaces and optional properties', () => {
  const out = J.toTypeScript(sample);
  assert.ok(out.indexOf('export interface Root') !== -1, out);
  assert.ok(out.indexOf('users: User[];') !== -1, out);
  assert.ok(out.indexOf('export interface User') !== -1, out);
  assert.ok(out.indexOf('admin?: boolean;') !== -1, out);
  assert.ok(out.indexOf('zip: null;') !== -1, out);
});

test('YAML output has correct nesting', () => {
  const out = J.toYAML({ a: { b: 1 }, list: [1, 2], items: [{ x: 1 }, { y: 2 }] });
  assert.ok(out.indexOf('a:\n  b: 1') !== -1, out);
  assert.ok(out.indexOf('list:\n  - 1\n  - 2') !== -1, out);
  assert.ok(out.indexOf('items:\n  - x: 1\n  - y: 2') !== -1, out);
});

test('YAML multiline strings are indented under their key', () => {
  const out = J.toYAML({ text: 'line one\nline two' });
  assert.strictEqual(out, 'text: |\n  line one\n  line two\n');
});

test('CSV flattens arrays of objects', () => {
  const out = J.toCSV([{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }]);
  assert.strictEqual(out, 'id,name\n1,Ada\n2,Grace');
});

test('CSV quotes commas and quotes', () => {
  const out = J.toCSV([{ text: 'a,b', quote: 'say "hi"' }]);
  assert.strictEqual(out, 'text,quote\n"a,b","say ""hi"""');
});

test('Python output uses Python literals', () => {
  const out = J.toPython({ ok: true, no: false, none: null, list: [1] });
  assert.ok(out.indexOf('data = {') === 0, out);
  assert.ok(out.indexOf('"ok": True') !== -1, out);
  assert.ok(out.indexOf('"none": None') !== -1, out);
});

test('JavaScript output is a module', () => {
  const r = J.parseJSON('{"a":1}');
  const out = J.toJavaScript(r.ast);
  assert.ok(out.indexOf('const data = {') === 0, out);
  assert.ok(out.indexOf('export default data;') !== -1, out);
});

console.log('\n' + passed + ' tests passed');

# JSON Studio

A local-first JSON workbench: paste, parse, explore, and transform JSON with a fast hand-written parser and a polished split-pane UI. No build step, no dependencies, no network calls.

## Run it

Open `index.html` directly in a browser, or serve the folder:

```powershell
node serve.js
# JSON Studio running at http://127.0.0.1:8123
```

`serve.js` is a zero-dependency static server (pass a port as the first argument to change it). The app also works from `file://`. Everything runs in the browser; documents never leave the machine.

## Features

### Parsing

- Hand-written recursive-descent JSON parser — not `JSON.parse` — so errors are precise.
- Error banner with line/column, the offending snippet, and a **Reveal** button that selects the exact character.
- Line/column status, live parse timing, character count, byte size, node count, and max depth.
- Warning system for duplicate keys, unsafe integers (`> 2^53 − 1`), and numbers that overflow to `Infinity`.
- Raw number lexemes are preserved through format/minify/sort, so large integers are not silently rounded.
- **Lenient mode** accepts:
  - `//` and `/* … */` comments
  - trailing commas
  - single-quoted strings
  - unquoted object keys
- Lenient mode still reports genuine syntax errors with the same precise locations.

### Exploring

- Collapsible tree with object/array badges, inline previews, and per-row copy actions.
- Large collections are paginated (300 rows at a time) instead of freezing the page.
- Search across keys and scalar values, with match highlighting, next/previous navigation, and auto-expansion of matches.
- JSONPath-style bar (`$.users[0].email`) with Enter-to-jump, validation, and copy-path.
- Stats tab: size, minified size, value counts, depth, parse time, type distribution, and clickable top-level entries.
- Expand all / collapse all.

### Transforming

- Format with 2 spaces, 4 spaces, or tabs.
- Minify, and sort object keys recursively.
- Convert the current document to:
  - TypeScript interfaces/types (merged shapes become optional properties)
  - YAML (quoted when needed, block scalars for multi-line strings)
  - CSV (nested objects flattened, arrays serialized, proper quoting)
  - Python literals (`True` / `False` / `None`, `float("inf")`, etc.)
  - JavaScript ES module (`const data = …; export default data;`)
- Copy or download any conversion.

### Workspace

- Split editor/tree view with a draggable divider (double-click or `Home` to reset).
- Syntax-highlighted editor with a transparent textarea overlay, line numbers, active-line band, and error-line band.
- Auto-indent, Tab/Shift+Tab line indentation, and bracket-aware newlines.
- Drag and drop `.json` files anywhere on the page, or use **Open**.
- Light/dark theme, persisted with the rest of the session.
- Command palette for every action.
- Session restore: text, file name, theme, indentation, lenient mode, split position, active tab, and conversion format.
- Documents of 300,000+ characters are intentionally not persisted; the app warns and restores the sample instead of risking a huge `localStorage` write.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Format JSON | `Ctrl`/`⌘` + `Enter` |
| Minify JSON | `Ctrl`/`⌘` + `M` |
| Sort keys | `Ctrl`/`⌘` + `Shift` + `S` |
| Download JSON | `Ctrl`/`⌘` + `S` |
| Open file | `Ctrl`/`⌘` + `O` |
| Search tree | `Ctrl`/`⌘` + `F` |
| Command palette | `Ctrl`/`⌘` + `K` |
| Toggle theme | `Ctrl`/`⌘` + `J` |
| Copy JSON | `Alt` + `C` |
| Next / previous search match | `Enter` / `Shift` + `Enter` |
| Indent / outdent selected lines | `Tab` / `Shift` + `Tab` |
| Close dialog | `Esc` |

## Project layout

```
index.html          App shell, icon sprite, dialogs
assets/styles.css   Theme, layout, editor chrome, responsive rules
assets/parser.js    Parser, errors, locator, serializer, highlighter
assets/convert.js   TypeScript / YAML / CSV / Python / JavaScript converters
assets/app.js       UI state, tree, stats, editor behavior, events
serve.js            Optional zero-dependency static server
tests/test.js       Node assertion suite for parser and converters
```

The parser and converters attach to `window.JSONStudio`; the tests set `global.window = global` and `require` the files directly.

## Tests

```powershell
node tests/test.js
```

Covers nested parsing, error locations, strict vs. lenient behavior, duplicate keys, unsafe integers, number preservation, sorting, invalid number forms, BOM handling, highlighter output, and all five converters.

## Notes

- Requires a modern browser (Chromium, Firefox, or Safari) for `color-mix()`, custom modals, and CSS custom properties.
- The editor's `LINE_HEIGHT` (22 px) and `PAD_TOP` (14 px) constants in `assets/app.js` must stay in sync with `--line-height` and the editor padding in `assets/styles.css`.
- The app is deliberately dependency-free and has no build output; edit the source files and reload.

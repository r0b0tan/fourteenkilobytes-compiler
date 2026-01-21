# fourteenkilobytes

A constraint-driven static page compiler that enforces a 14KB limit per page.

This is not a CMS. This is not a static site generator. This is a compiler that makes structural and content costs explicit and enforces discipline through hard constraints.

## Constraints

- **14,336 bytes** maximum per page (UTF-8, ungzipped)
- **Single HTTP request** — no external resources
- **No JavaScript** — static HTML only
- **No external CSS** — styles must be inlined
- **No images, fonts, or CDNs**
- **Deterministic output** — identical input produces identical output

## Installation

```bash
npm install @fourteenkilobytes/compiler
```

## Usage

```typescript
import { compile, dryRun } from '@fourteenkilobytes/compiler';

const input = {
  slug: 'hello-world',
  title: 'Hello World',
  content: [
    {
      type: 'heading',
      level: 1,
      children: [{ type: 'text', text: 'Hello World' }]
    },
    {
      type: 'paragraph',
      children: [{ type: 'text', text: 'Welcome to my page.' }]
    }
  ],
  navigation: null,
  footer: null,
  css: null,
  icons: [],
  allowPagination: false,
  buildId: 'build-001',
};

// Preview without writing
const preview = dryRun(input);
if (preview.wouldSucceed) {
  console.log(`Size: ${preview.measurements[0].total} bytes`);
  console.log(`Remaining: ${preview.measurements[0].remaining} bytes`);
}

// Compile
const result = compile(input);
if (result.success) {
  console.log(result.pages[0].html);
} else {
  console.error(result.error);
}
```

## Input Format

```json
{
  "slug": "hello-world",
  "title": "Hello World",
  "content": [
    {
      "type": "heading",
      "level": 1,
      "children": [{ "type": "text", "text": "Hello World" }]
    },
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "text": "This is " },
        { "type": "bold", "children": [{ "type": "text", "text": "bold" }] },
        { "type": "text", "text": " and " },
        { "type": "italic", "children": [{ "type": "text", "text": "italic" }] },
        { "type": "text", "text": " text." }
      ]
    }
  ],
  "navigation": {
    "items": [
      { "text": "Home", "href": "/index.html" },
      { "text": "About", "href": "/about.html" }
    ]
  },
  "footer": {
    "content": "Copyright 2024"
  },
  "css": {
    "rules": "body{max-width:40em;margin:2em auto}"
  },
  "icons": [],
  "allowPagination": false
}
```

### Content Elements

| Element | Description |
|---------|-------------|
| `heading` | Levels 1-6 |
| `paragraph` | Block of text |
| `text` | Plain text |
| `bold` | `<b>` |
| `italic` | `<i>` |
| `link` | `<a href="...">` |

### Optional Modules

| Module | Description |
|--------|-------------|
| `navigation` | Renders as `<nav>` with links |
| `footer` | Renders as `<footer>` with plain text |
| `css` | Inlined as `<style>` in head |
| `icons` | Inline SVGs from whitelist |

## Output

### Dry Run Success

```json
{
  "wouldSucceed": true,
  "measurements": [
    {
      "slug": "hello-world",
      "breakdown": {
        "base": 269,
        "title": 26,
        "css": 145,
        "navigation": 75,
        "footer": 52,
        "pagination": 0,
        "icons": 0,
        "content": 439
      },
      "total": 1006,
      "remaining": 13330,
      "utilizationRatio": 0.07
    }
  ]
}
```

### Dry Run Failure

```json
{
  "wouldSucceed": false,
  "error": {
    "code": "SIZE_LIMIT_EXCEEDED",
    "measured": 15000,
    "limit": 14336,
    "breakdown": {...}
  }
}
```

### Compile Success

```json
{
  "success": true,
  "buildId": "build-001",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "pages": [
    {
      "slug": "hello-world",
      "pageNumber": 1,
      "totalPages": 1,
      "bytes": 1006,
      "hash": "4b329fae..."
    }
  ],
  "measurements": [...],
  "totals": {
    "pageCount": 1,
    "totalBytes": 1006,
    "largestPage": 1006,
    "smallestPage": 1006
  }
}
```

## Pagination

If `allowPagination` is `true` and content exceeds the limit, the compiler splits content across multiple pages.

- Splitting occurs at block boundaries only
- Each page includes pagination navigation
- Pagination overhead is measured and accounted for
- Slugs are suffixed: `post.html`, `post-2.html`, `post-3.html`

If `allowPagination` is `false` and content exceeds the limit, compilation fails.

## Manifest

The compiler maintains an append-only manifest:

```json
{
  "version": 1,
  "entries": [
    {
      "slug": "hello-world",
      "status": "published",
      "publishedAt": "2024-01-15T10:30:00.000Z",
      "hash": "4b329fae...",
      "title": "Hello World"
    }
  ]
}
```

### Rules

- New pages are appended
- Published pages cannot be recompiled
- Tombstoned slugs cannot be reused
- Entry order is immutable

## Tombstones

Deleted pages are replaced with a static tombstone:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Page Removed</title>
</head>
<body>
<p>This page has been removed.</p>
</body>
</html>
```

The manifest entry is updated to `status: "tombstone"`. The URL remains addressable.

## Icons

16 whitelisted inline SVGs:

```
arrow-down    arrow-left    arrow-right   arrow-up
calendar      check         close         error
external-link home          info          mail
menu          rss           tag           warning
```

Each icon has a pre-measured byte cost.

## Design Principles

**The compiler reveals costs. It does not hide them.**

- No automatic optimization
- No rewriting or suggestion logic
- No heuristics or guesses
- No "helpful" features that obscure trade-offs

**Hard failures over soft warnings.**

- Exceeding the limit is a compilation error
- Invalid input is rejected, not coerced
- Determinism is verified, not assumed

## License

MIT

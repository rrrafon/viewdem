# Security

## Reporting

Please report suspected vulnerabilities through a GitHub security advisory
("Security" → "Report a vulnerability") or open an issue if the report does
not need to stay private. Include the URL, browser, and reproduction steps.

## Scope

This repository is a static site (HTML/JS/GLB/WebP served by GitHub Pages).
There is no server-side code, no database, and no user accounts.

- **No secrets are stored here.** The Google Analytics measurement ID
  (`G-LCWXX40NVT`) is public by design. Dataset exports contain public DEM,
  Sentinel-2, and OpenStreetMap data only.
- **No user input is persisted.** Viewer settings live in `localStorage` on
  the visitor's own browser.

## Third-party script: Google Analytics (gtag.js)

`index.html` and `landing.html` load
`https://www.googletagmanager.com/gtag/js?id=G-LCWXX40NVT`. This script runs
with full page privileges. Google serves it dynamically, so **Subresource
Integrity (SRI) cannot be used** — a pinned hash would break whenever Google
updates the script.

Mitigations in place:

- Served over HTTPS only (GitHub Pages).
- A `Content-Security-Policy` meta tag restricts scripts, connections, and
  images to this origin plus the Google Analytics / Tag Manager origins.
  It also disables `eval` (`unsafe-eval` is not allowed), plugins, framing,
  and form submission.
- The analytics use is disclosed in `privacy.html`.

Residual risk: if Google's script, DNS, or TLS were compromised, visitors
would run attacker-controlled JavaScript. The only way to eliminate that risk
is to remove the two gtag `<script>` blocks from `index.html` and
`landing.html` (the site works without them).

## XSS hardening

- Manifest-supplied strings (`crs`, `attribution`) are HTML-escaped before
  being placed in the info panel (`main.js`).
- `site_info.json` note text is escaped; reference URLs are restricted to
  `http(s)` and relative/anchor targets, so `javascript:` / `data:` links are
  neutralised (`siteinfo.js`).
- Dataset, manifest, tileset, and thumbnail paths are validated as plain
  relative paths: absolute paths, URL schemes, backslashes, and `..`
  segments are rejected (`main.js`, `stream.js`, `landing.html`).

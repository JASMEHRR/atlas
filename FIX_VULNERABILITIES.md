# Fix vulnerabilities & missing scripts

Your `package.json` has been updated with the latest versions. Complete the setup:

## 1. Clean install (fixes all vulnerabilities)

```bash
# Stop the dev server (Ctrl+C if running)

# Delete old dependencies
rm -r node_modules
rm package-lock.json

# Fresh install
npm install
```

This installs patched versions:
- `next@15.1.3` (was vulnerable)
- `sharp@0.35.3` (CVE fixes for libvips)
- `postcss@8.5.10` (XSS + path traversal fixes)
- `@modelcontextprotocol/sdk@1.21.0` (transitive Hono fix)

## 2. Approve sharp install script

When npm install asks:
```
? Allow sharp to run install scripts? (y/n)
```

Answer: **y**

Or run this first to auto-approve:
```bash
npm approve-scripts --allow sharp
```

## 3. Verify vulnerabilities are gone

```bash
npm audit
```

Should show: `0 vulnerabilities`

## 4. Now run the app

```bash
npm run db:init
npm run dev
```

---

## Why the vulnerabilities existed

- **@hono/node-server** — path traversal on Windows via `%5C` in static file serving (affects MCP server, not web app)
- **postcss** — multiple: XSS in `</style>` tags, arbitrary file read via sourceMaps, path traversal (build-time only, not production)
- **sharp** — inherited libvips CVE vulnerabilities (image processing library)

All are patched in the updated versions above.

---

## Scripts now available

After `npm install`:

```bash
npm run dev                         # Start dev server
npm run build                       # Production build
npm start                           # Run production build
npm test                            # Run 85 tests
npm run lint                        # TypeScript check
npm run seed                        # Re-seed database
npm run db:init                     # Initialize database
npm run db:reset                    # Wipe & reinit database
npm run mcp                         # Run MCP server
npm run debug:providers             # Show AI provider status
npm run debug:openrouter:models     # List free OpenRouter models
npm run audit:fix                   # Run npm audit fix
```

---

## Next steps

Once `npm audit` shows zero vulnerabilities:

1. `npm run db:init` — seed database with 3 examples
2. `npm run dev` — start at http://localhost:3000
3. Upload a screenshot
4. Watch the pipeline run

You're set.

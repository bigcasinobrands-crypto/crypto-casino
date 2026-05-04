# Player UI i18n + Language selector (revised)

## Non-goals / anti-patterns (explicit)

- **No “language overlay”**: Do not use a third‑party translate overlay, browser translate UI, or a full-screen “pick your language” gate that sits on top of the product. The site is **not** masked by a translation layer.
- **Real brand language change**: Locale switching uses **in-app i18n** (`react-i18next` + `t()`). Components **re-render** with French copy from bundled resources. Catalog game **titles/thumbnails from APIs stay provider-sourced** (unchanged).

## Performance (must feel instant)

- **Pre-bundle locales**: Import `en.json` and `fr-CA.json` as static ES modules so both languages ship in the JS bundle. **No network round-trip** to load translations on switch.
- **Synchronous switch**: `i18n.changeLanguage('fr-CA')` with preloaded resources updates strings in one React pass—no async “loading translation…” state for these two locales.
- **Persist without blocking**: Read `localStorage` once at i18n init to set `lng` before first paint where practical; write on change. Avoid lazy `import()` of namespaces for MVP (prevents first-click delay).

## Brand safety (must not “break” layout)

- **Inline control only**: The Language entry stays in [`CasinoSidebar`](frontend/player-ui/src/components/CasinoSidebar.tsx) / [`MobileCasinoMenuOverlay`](frontend/player-ui/src/components/MobileCasinoMenuOverlay.tsx)—a compact **popover** for locale list (fixed positioning), not a separate full-page modal over the brand.
- **Long-string QA**: French strings are often longer—verify sidebar/drawer rows, buttons, and footer don’t overflow or wrap badly (`min-w-0`, `truncate`/`line-clamp` where appropriate).
- **No CLS**: Same DOM structure; only text and `lang` attribute change.

## Technical summary (unchanged core)

- Stack: `i18next` + `react-i18next`; init in [`main.tsx`](frontend/player-ui/src/main.tsx); `document.documentElement.lang`.
- Keys for nav by `CasinoNavCategory.id` with `defaultValue` from CMS/`item.label`.
- Locales: `en` + `fr-CA` only for now.

## Implementation todos

1. Add deps; `src/i18n/index.ts` with **static** resource imports and stored `lng`.
2. `LanguageMenu`: small dropdown (brand tokens), not a full-screen overlay; stop propagation in mobile drawer.
3. Wire existing Language placeholders; translate nav + high-visibility shell strings.
4. Smoke test: switch is immediate; layout intact; game tiles unchanged.

# Vendored libraries

Vendored 2026-07-10 from the last known-clean releases after the upstream
maintainer's npm account shipped compromised versions (see CLAUDE.md security
section). These are now OURS to maintain — do not reinstall the npm packages.

- `phone-input/` ← react-native-international-phone-number@0.11.6 (ISC)
- `country-select/` ← react-native-country-select@0.3.8 (ISC)

Both depend only on `libphonenumber-js` (kept as a real npm dependency — it is
actively maintained and trusted) and react / react-native peers.

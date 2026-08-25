# Code style — minimalcnx

- Match existing patterns in `app/`, `lib/`, `components/` (JS not TS unless already present).
- Use design tokens from `app/globals.css` (`--radius-*`, `--color-*`). Never hardcode `borderRadius` numbers.
- Money/quantity/points inputs: always `components/number-input.js` (`NumberInput`) — never a raw `<input type="number">` (spinner mis-clicks + mouse-wheel silently changing amounts). It sanitizes via `sanitizeNumberString()` for you; `onChange` receives a string, not an event.
- Person-name fields: `stripDigits()`. ID/account/taxid: `digitsOnly()`.
- Date/month pickers: always use `components/date-field.js` — never raw `<input type="date|month">`.
- `business_config` writes: always `lib/config-store.js` `upsertBusinessConfig()` (detect silent RLS failures).
- Icons: `<Icon name="ti-xxx" />` from `components/icon.js` (add to MAP if new). No webfont / CDN icon links.
- Keep comments minimal; no drive-by refactors outside the task.

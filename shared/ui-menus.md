# Floating menus

Both applications bind `bindDismissibleDetails(document)` once. Use this controller
for every floating action menu or filter. Do not use it for inline expandable
sections such as history, reports, or backup comparisons.

```html
<details data-dismiss-on-outside>
  <summary aria-label="Actions">…</summary>
  <div data-menu-panel>
    <button data-action="existing-action">Action</button>
  </div>
</details>
```

Existing button-based controls may use a `data-floating-menu` host, a direct child
`data-menu-trigger`, and a direct child `data-menu-panel`. Their open state is the
host's `open` class. Put `data-menu-keep-open` on form controls that include picker
buttons and should stay open during editing. Ordinary action buttons close after
their delegated action runs.

Style the panel's width, colors, border and internal layout. The shared controller
owns positioning, available height, scrolling, focus, dismissal, and exclusivity.
It uses the browser's native popover top layer, retaining the original DOM parents
so `closest()`, form fields, RTL styles, and delegated actions continue to work.
Do not add per-screen outside-click listeners, upward-placement classes, portal
copies, or ancestor overflow overrides.

`tests/runtime_events.py` runs the popup regression cases in both applications at
desktop and mobile sizes. The tests cover clipping ancestors, bottom-edge menus,
outside clicks, keyboard dismissal, single-menu behavior, actions and rerenders.

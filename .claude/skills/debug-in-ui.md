# Debug-in-UI

When building UI features, render relevant debug state **visually in the page** — not just in console.log. This gives immediate feedback during development and makes state bugs visible at a glance.

## Principle

Debug information should be:
- **Visible** — rendered in the actual UI, not hidden in devtools
- **Organized** — grouped in a single container per feature/screen
- **Removable** — structured for clean deletion when the feature stabilizes

## Implementation Pattern

### HTML
Wrap all debug elements in a single container with a predictable ID:

    <!-- DEBUG: Remove before release -->
    <div id="feature-debug" class="feature-debug">
      <h3 class="debug-heading">DEBUG</h3>
      <pre id="debug-output" class="debug-output"></pre>
    </div>

Use data-debug attributes on individual items when scattered across the page:

    <span data-debug="sync-status">connected</span>

### CSS
Group all debug styles in one clearly marked block:

    /* DEBUG STYLES — REMOVE BEFORE RELEASE */
    .feature-debug { border: 1px dashed var(--muted); padding: 16px; opacity: 0.7; }
    .debug-heading { /* ... */ }
    .debug-output { /* ... */ }
    /* END DEBUG STYLES */

### JavaScript
Isolate debug population in clearly named functions:

    /** DEBUG: Remove before release */
    function populateDebugInfo() {
      const output = document.getElementById('debug-output');
      if (!output) return;
      output.textContent = JSON.stringify({ key: 'value' }, null, 2);
    }

## Removal Checklist

When the feature is stable:
1. Delete the HTML debug container
2. Delete the CSS block between DEBUG STYLES markers
3. Delete the JS populateDebugInfo() function and call sites
4. Remove any data-debug attributes
5. Grep for "debug" to verify clean removal

## When to Use

- Always when building new UI screens or features
- Always when implementing state sync, caching, or offline features
- Always when the feature has complex state that could silently break

## When NOT to Use

- Simple styling changes with no state
- Backend-only changes
- Changes where automated tests provide sufficient coverage

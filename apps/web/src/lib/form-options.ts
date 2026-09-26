/**
 * Ignore options sent with a file comparison.
 *
 * The browser names an option in its own words ("ignoreCase"); the engine in
 * its own ("ignore_case"). Only an explicit "true" or "false" is passed on —
 * anything else is left out, and the engine uses its default.
 *
 * Server-side, in the comparison routes.
 */
export function forwardOptions(from: FormData, to: FormData, fields: readonly (readonly [string, string])[]): void {
  for (const [field, engineField] of fields) {
    const value = from.get(field);
    if (value === "true" || value === "false") to.append(engineField, value);
  }
}

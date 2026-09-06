/**
 * Client-side preview of the slug the server will generate from a label
 * (lowercase, `[a-z0-9_]`, collisions get a numeric suffix server-side). This
 * is a *preview only* — the authoritative slug is assigned by the backend at
 * create time. Returns `''` when the label has no slug-able characters (e.g. a
 * purely Thai label); the UI shows a "generated on save" hint in that case.
 */
export function slugPreview(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

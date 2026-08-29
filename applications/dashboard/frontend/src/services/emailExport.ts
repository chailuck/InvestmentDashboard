import { apiClient } from './api'

// ── Email Dashboard export ───────────────────────────────────────────────────
// `POST /api/v1/email/send-export` on the MAIN backend (routed through the
// same `/api/proxy` Next.js proxy every other service call in this app uses
// — `apiClient`'s baseURL already resolves to `/api/proxy/api/v1`, so this
// hits `/api/proxy/api/v1/email/send-export`).
//
// Kept as its own module rather than folded into `emailDigest.ts`: that
// file's existing `sendNow`/settings calls pass snake_case field names
// through UNTRANSLATED (its `EmailDigestSettings` interface's own fields
// ARE `schedule_time`, and `sendNow`'s response type is typed with
// `sent_at` directly) — it has no camelCase<->snake_case translation layer
// at all. This endpoint's request body is intentionally snake_case (a
// pre-existing, documented convention difference from every OTHER
// main-backend endpoint this app calls, which are camelCase) while its
// call site (the Dashboard page) should still work with this app's normal
// camelCase convention — so this module exists specifically to do that
// one translation, rather than teaching `emailDigest.ts` two different
// conventions for two unrelated features.

/** camelCase params as used by the rest of this app — translated to the wire's snake_case body inside `sendExportEmail`. */
export interface SendExportEmailPayload {
  subject: string
  htmlBody: string
  /** Must end in ".json" and contain no path separators — enforced server-side (422 on violation). */
  attachmentFilename: string
  /** Base64-encoded UTF-8 bytes of the export JSON. */
  attachmentContent: string
}

/** The wire (snake_case) request body actually sent to `POST /email/send-export`. */
interface SendExportEmailWireRequest {
  subject: string
  html_body: string
  attachment_filename: string
  attachment_content: string
}

/** camelCase response shape this app's callers consume — translated from the wire's snake_case response. */
export interface SendExportEmailResult {
  success: boolean
  recipient: string
  sentAt: string | null
  error: string | null
}

/** The wire (snake_case) response shape actually returned by `POST /email/send-export`. */
interface SendExportEmailWireResponse {
  success: boolean
  recipient: string
  sent_at: string | null
  error: string | null
}

/**
 * Sends the dashboard HTML body + a full backup JSON attachment via email.
 *
 * Translates this app's normal camelCase convention to/from the wire's
 * snake_case convention on both the request and response — see the module
 * docblock for why this isn't just `emailDigest.ts`.
 *
 * Propagates axios errors as-is (401 is handled automatically by
 * `apiClient`'s interceptor; 503/502/422 are left for the caller to
 * distinguish via `err.response?.status`, since each maps to a different
 * user-facing message on the Dashboard page).
 */
export async function sendExportEmail(payload: SendExportEmailPayload): Promise<SendExportEmailResult> {
  const body: SendExportEmailWireRequest = {
    subject: payload.subject,
    html_body: payload.htmlBody,
    attachment_filename: payload.attachmentFilename,
    attachment_content: payload.attachmentContent,
  }
  const { data } = await apiClient.post<SendExportEmailWireResponse>('/email/send-export', body)
  return {
    success: data.success,
    recipient: data.recipient,
    sentAt: data.sent_at,
    error: data.error,
  }
}

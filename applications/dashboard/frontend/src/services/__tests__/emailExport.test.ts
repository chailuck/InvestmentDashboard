import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendExportEmail } from '@/services/emailExport'
import { apiClient } from '@/services/api'

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return {
    apiClient: { post: vi.fn() },
    extractApiError: actual.extractApiError,
  }
})

const mockedPost = vi.mocked(apiClient.post)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sendExportEmail', () => {
  const payload = {
    subject: 'Financial Tracker Export - 2026-08-24',
    htmlBody: '<div>hello</div>',
    attachmentFilename: 'tracking-backup-set-1-2026-08-24T00-00-00.json',
    attachmentContent: 'eyJhIjoxfQ==',
  }

  it('POSTs to /email/send-export with the camelCase payload translated to the snake_case wire body', async () => {
    mockedPost.mockResolvedValueOnce({
      data: { success: true, recipient: 'user@example.com', sent_at: '2026-08-24T00:00:01Z', error: null },
    })

    await sendExportEmail(payload)

    expect(mockedPost).toHaveBeenCalledWith('/email/send-export', {
      subject: payload.subject,
      html_body: payload.htmlBody,
      attachment_filename: payload.attachmentFilename,
      attachment_content: payload.attachmentContent,
    })
  })

  it('translates the snake_case wire response back to camelCase on success', async () => {
    mockedPost.mockResolvedValueOnce({
      data: { success: true, recipient: 'user@example.com', sent_at: '2026-08-24T00:00:01Z', error: null },
    })

    const result = await sendExportEmail(payload)

    expect(result).toEqual({
      success: true,
      recipient: 'user@example.com',
      sentAt: '2026-08-24T00:00:01Z',
      error: null,
    })
  })

  it('propagates a 503 (SMTP not configured) as an axios error for the caller to distinguish', async () => {
    const err = { isAxiosError: true, response: { status: 503, data: { detail: 'SMTP not configured' } } }
    mockedPost.mockRejectedValueOnce(err)
    await expect(sendExportEmail(payload)).rejects.toEqual(err)
  })

  it('propagates a 502 (SMTP send failed) as an axios error distinct from 503', async () => {
    const err = { isAxiosError: true, response: { status: 502, data: { detail: 'SMTP send failed' } } }
    mockedPost.mockRejectedValueOnce(err)
    await expect(sendExportEmail(payload)).rejects.toEqual(err)
  })

  it('propagates a 422 validation error as-is', async () => {
    const err = { isAxiosError: true, response: { status: 422, data: { detail: 'attachment_filename must end in .json' } } }
    mockedPost.mockRejectedValueOnce(err)
    await expect(sendExportEmail(payload)).rejects.toEqual(err)
  })
})

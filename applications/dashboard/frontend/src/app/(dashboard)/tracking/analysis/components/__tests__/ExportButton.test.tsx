import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import { ExportButton, type CsvFile } from '../ExportButton'

describe('ExportButton', () => {
  let createSpy: ReturnType<typeof vi.fn>
  let revokeSpy: ReturnType<typeof vi.fn>
  let clickSpy: ReturnType<typeof vi.spyOn>
  let blobParts: unknown[][]
  const RealBlob = global.Blob

  beforeEach(() => {
    let n = 0
    blobParts = []
    createSpy = vi.fn(() => `blob:mock/${++n}`)
    revokeSpy = vi.fn()
    ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = createSpy
    ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeSpy
    global.Blob = vi.fn((parts: unknown[], opts?: BlobPropertyBag) => {
      blobParts.push(parts)
      return new RealBlob(parts as BlobPart[], opts)
    }) as unknown as typeof Blob
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    clickSpy.mockRestore()
    global.Blob = RealBlob
    vi.useRealTimers()
  })

  const oneFile: CsvFile[] = [{ filename: 'analysis_x_grandTotal_category_quarterly_20260830.csv', content: 'a,b\r\n1,2\r\n' }]

  it('saves a single file via a transient <a download> with the given filename', async () => {
    render(<ExportButton getFiles={() => oneFile} />)
    await userEvent.click(screen.getByRole('button', { name: /export view \(csv\)/i }))
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe(oneFile[0].filename)
    expect(anchor.href).toContain('blob:mock/1')
  })

  it('prepends a UTF-8 BOM to the blob content', async () => {
    render(<ExportButton getFiles={() => oneFile} />)
    await userEvent.click(screen.getByRole('button', { name: /export view \(csv\)/i }))
    const parts = blobParts[0][0] as string
    expect(parts.charCodeAt(0)).toBe(0xfeff)
    expect(parts.slice(1)).toBe('a,b\r\n1,2\r\n')
    const opts = (global.Blob as unknown as { mock: { calls: [unknown, BlobPropertyBag][] } }).mock.calls[0][1]
    expect(opts.type).toContain('text/csv')
  })

  it('defers URL.revokeObjectURL past the click tick (Firefox/Safari abort save otherwise)', async () => {
    vi.useFakeTimers()
    render(<ExportButton getFiles={() => oneFile} />)
    fireEvent.click(screen.getByRole('button', { name: /export view \(csv\)/i }))
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeSpy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock/1')
  })

  it('saves TWO distinct files, spaced apart, when a comparison export is active', async () => {
    vi.useFakeTimers()
    const files: CsvFile[] = [
      { filename: 'analysis_set_grandTotal_category_quarterly_20260830.csv', content: 'main\r\n' },
      { filename: 'analysis_set_grandTotal_category_quarterly_20260830_comparison.csv', content: 'cmp\r\n' },
    ]
    render(<ExportButton getFiles={() => files} />)
    fireEvent.click(screen.getByRole('button', { name: /export view \(csv\)/i }))

    expect(createSpy).toHaveBeenCalledTimes(1) // first immediately
    await vi.advanceTimersByTimeAsync(350)
    expect(createSpy).toHaveBeenCalledTimes(2) // second deferred

    const downloads = clickSpy.mock.instances.map(a => (a as HTMLAnchorElement).download)
    expect(downloads).toEqual([files[0].filename, files[1].filename])
    expect(createSpy.mock.results[0].value).not.toBe(createSpy.mock.results[1].value)
    expect((blobParts[1][0] as string).slice(1)).toBe('cmp\r\n')
  })

  it('is disabled when explicitly disabled', () => {
    render(<ExportButton getFiles={() => []} disabled />)
    expect(screen.getByRole('button', { name: /export view \(csv\)/i })).toBeDisabled()
  })
})

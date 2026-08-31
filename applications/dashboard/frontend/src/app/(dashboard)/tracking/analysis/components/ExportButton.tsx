'use client'

import { useRef, useState } from 'react'
import { Download } from 'lucide-react'

export interface CsvFile {
  filename: string
  content: string
}

/** Space multi-file programmatic downloads so browsers do not suppress the 2nd+ click. */
const MULTI_FILE_GAP_MS = 300

/**
 * §4.8 / ADR-019 #4 — client-side CSV download only. Each file's content is
 * wrapped in a UTF-8 BOM (Excel + Thai text), turned into an object URL, and
 * saved via a transient `<a download>`.
 *
 * Two browser gotchas handled here:
 *  - Revoking the object URL in the same tick as `.click()` aborts the save in
 *    Firefox/Safari → the revoke is deferred (`setTimeout(…, 0)`).
 *  - Two back-to-back programmatic `.click()` downloads get suppressed → when a
 *    comparison is active the files are spaced by `MULTI_FILE_GAP_MS`.
 * Dependency-free (no zip lib).
 */
export function ExportButton({ getFiles, disabled }: { getFiles: () => CsvFile[]; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const saveOne = (file: CsvFile) => {
    const blob = new Blob(['﻿' + file.content], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.filename
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Defer the revoke: revoking synchronously aborts the save in Firefox/Safari.
    const t = setTimeout(() => URL.revokeObjectURL(url), 0)
    timers.current.push(t)
  }

  const run = () => {
    if (typeof window === 'undefined') return
    const files = getFiles()
    if (files.length === 0) return
    setBusy(true)
    try {
      files.forEach((file, i) => {
        if (i === 0) {
          saveOne(file)
        } else {
          const t = setTimeout(() => saveOne(file), i * MULTI_FILE_GAP_MS)
          timers.current.push(t)
        }
      })
    } finally {
      // re-enable after the last scheduled save has been dispatched
      const t = setTimeout(() => setBusy(false), Math.max(0, (files.length - 1) * MULTI_FILE_GAP_MS))
      timers.current.push(t)
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={disabled || busy}
      className="btn-ghost text-xs px-2.5 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
      aria-busy={busy}
    >
      <Download className="w-3.5 h-3.5" /> Export view (CSV)
    </button>
  )
}

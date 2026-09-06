import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/test-utils'
import BackupPage from '../page'
import { apiClient } from '@/services/api'

// ---------------------------------------------------------------------------
// Mock the API client so no real HTTP requests are made
// ---------------------------------------------------------------------------

vi.mock('@/services/api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    defaults: { headers: {} },
  },
  extractApiError: (e: any) => e?.response?.data?.detail ?? 'error',
}))

const mockedGet = vi.mocked(apiClient.get)
const mockedPost = vi.mocked(apiClient.post)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TABLES_DATA = {
  database: 'investdb',
  generated_at: '2026-08-30T10:00:00Z',
  total_tables: 5,
  insert_order: ['users', 'action_plans', 'tracking_items', 'alembic_version', 'ft_alembic_version'],
  tables: [
    { name: 'users', row_count: 3, owner_service: 'backend', restorable: true, in_conflict_check: true },
    { name: 'action_plans', row_count: 12, owner_service: 'backend', restorable: true, in_conflict_check: true },
    { name: 'tracking_items', row_count: 7, owner_service: 'tracking-backend', restorable: true, in_conflict_check: true },
    {
      name: 'alembic_version', row_count: 1, owner_service: 'backend',
      restorable: false, in_conflict_check: false,
      note: 'Schema-managed by Alembic; never restored.',
    },
    {
      name: 'ft_alembic_version', row_count: 1, owner_service: 'tracking-backend',
      restorable: false, in_conflict_check: false,
      note: 'Schema-managed by Alembic (tracking-backend); never restored.',
    },
  ],
}

const BACKUP_LIST = [
  { filename: 'backup_2026-08-30.json.gz', size_kb: 42, created_at: '2026-08-30T09:00:00Z' },
]

function stdGet(url: string) {
  if (url === '/backup/list') return Promise.resolve({ data: BACKUP_LIST })
  if (url === '/backup/tables') return Promise.resolve({ data: TABLES_DATA })
  return Promise.reject(new Error(`unexpected GET ${url}`))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedGet.mockImplementation(stdGet as any)
})

const openCoverageLoaded = () =>
  screen.findByRole('button', { name: /Covers 5 tables/i })

// ---------------------------------------------------------------------------
// Coverage card
// ---------------------------------------------------------------------------

describe('BackupPage — coverage card', () => {
  it('renders "Covers N tables" from /backup/tables, with owner badge and the non-restorable note', async () => {
    const user = userEvent.setup()
    render(<BackupPage />)

    await user.click(await openCoverageLoaded())

    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('action_plans')).toBeInTheDocument()
    expect(screen.getByText('tracking_items')).toBeInTheDocument()
    // owner_service badge — amber tracking-backend variant (>=1: tracking_items + ft_alembic_version)
    expect(screen.getAllByText('tracking-backend').length).toBeGreaterThan(0)
    // note only rendered for restorable === false rows (the alembic tables)
    expect(screen.getByText('Schema-managed by Alembic; never restored.')).toBeInTheDocument()
    expect(screen.getByText('3 rows')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// PSV table selector
// ---------------------------------------------------------------------------

describe('BackupPage — PSV table selector', () => {
  it('populates options from the fetched /backup/tables list, not a hardcoded array', async () => {
    const user = userEvent.setup()
    render(<BackupPage />)
    await openCoverageLoaded()

    await user.click(screen.getByRole('button', { name: /Per-Table Export \/ Import/i }))

    const select = await screen.findByLabelText('Table')
    const values = within(select).getAllByRole('option').map(o => (o as HTMLOptionElement).value)
    expect(values).toEqual(['users', 'action_plans', 'tracking_items'])
    // portfolio_positions_db was in the OLD hardcoded TABLES const — must be gone.
    expect(values).not.toContain('portfolio_positions_db')
  })

  it('excludes schema-version tables (alembic_version / ft_alembic_version) from the PSV selector, but the coverage card still lists them', async () => {
    const user = userEvent.setup()
    render(<BackupPage />)

    // Coverage card shows the FULL list, alembic rows included (with their note).
    await user.click(await openCoverageLoaded())
    const coverage = screen.getByRole('list')
    expect(within(coverage).getByText('alembic_version')).toBeInTheDocument()
    expect(within(coverage).getByText('ft_alembic_version')).toBeInTheDocument()
    expect(
      within(coverage).getByText('Schema-managed by Alembic (tracking-backend); never restored.'),
    ).toBeInTheDocument()

    // The PSV import/export selector must NOT offer the alembic tables — the
    // backend 400s on PSV against them.
    await user.click(screen.getByRole('button', { name: /Per-Table Export \/ Import/i }))
    const select = await screen.findByLabelText('Table')
    const values = within(select).getAllByRole('option').map(o => (o as HTMLOptionElement).value)
    expect(values).not.toContain('alembic_version')
    expect(values).not.toContain('ft_alembic_version')
    expect(values).toEqual(['users', 'action_plans', 'tracking_items'])
    // Default selection lands on the first non-filtered table.
    expect((select as HTMLSelectElement).value).toBe('users')
  })
})

// ---------------------------------------------------------------------------
// Restore modal — replaces window.confirm
// ---------------------------------------------------------------------------

describe('BackupPage — restore modal', () => {
  it('opens the modal, defaults to skip_if_conflict, and posts {mode:"skip_if_conflict"} with no confirm phrase', async () => {
    const user = userEvent.setup()
    mockedPost.mockResolvedValueOnce({ data: { total_rows: 5, restored: { users: 5 } } })
    render(<BackupPage />)
    await openCoverageLoaded()

    await user.click(await screen.findByRole('button', { name: /Restore from this backup/i }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /Safe restore/i })).toBeChecked()

    await user.click(within(dialog).getByRole('button', { name: /^Restore$/ }))

    expect(mockedPost).toHaveBeenCalledWith(
      '/backup/restore/backup_2026-08-30.json.gz',
      { mode: 'skip_if_conflict', confirm: undefined },
    )
  })

  it('keeps the confirm button disabled in replace_all until "REPLACE ALL DATA" is typed exactly', async () => {
    const user = userEvent.setup()
    mockedPost.mockResolvedValueOnce({ data: { total_rows: 9 } })
    render(<BackupPage />)
    await openCoverageLoaded()

    await user.click(await screen.findByRole('button', { name: /Restore from this backup/i }))
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('radio', { name: /Replace all data/i }))

    // Wipe preview: only in_conflict_check && row_count > 0 tables.
    expect(within(dialog).getByText(/users/)).toBeInTheDocument()
    expect(within(dialog).getByText(/action_plans/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/alembic_version/)).not.toBeInTheDocument()

    const confirmBtn = within(dialog).getByRole('button', { name: /Replace all data/i })
    expect(confirmBtn).toBeDisabled()

    const input = within(dialog).getByLabelText(/Type REPLACE ALL DATA to confirm/i)
    await user.type(input, 'replace all data')
    expect(confirmBtn).toBeDisabled()

    await user.clear(input)
    await user.type(input, 'REPLACE ALL DATA')
    expect(confirmBtn).toBeEnabled()

    await user.click(confirmBtn)
    expect(mockedPost).toHaveBeenCalledWith(
      '/backup/restore/backup_2026-08-30.json.gz',
      { mode: 'replace_all', confirm: 'REPLACE ALL DATA' },
    )
  })

  it('renders conflicting tables and the hint on an HTTP 409 response', async () => {
    const user = userEvent.setup()
    mockedPost.mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          detail: 'Restore blocked: 2 tables already contain data.',
          conflicting_tables: [
            { table: 'users', row_count: 3 },
            { table: 'action_plans', row_count: 12 },
          ],
        },
      },
    })
    render(<BackupPage />)
    await openCoverageLoaded()

    await user.click(await screen.findByRole('button', { name: /Restore from this backup/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^Restore$/ }))

    expect(await within(dialog).findByText('Restore blocked: 2 tables already contain data.')).toBeInTheDocument()
    expect(
      within(dialog).getByText(/These tables already contain data\. Switch to Replace all data, or restore into a fresh database\./i),
    ).toBeInTheDocument()
    expect(within(dialog).getByText(/action_plans/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Restore modal — upload path (local file → modal, not window.confirm)
// ---------------------------------------------------------------------------

describe('BackupPage — upload restore through the modal', () => {
  const jsonInput = (container: HTMLElement) =>
    container.querySelector('input[type="file"][accept*=".json"]') as HTMLInputElement

  it('opens the RestoreModal (not window.confirm) and, in the default skip_if_conflict mode, POSTs /backup/restore/upload?mode=skip_if_conflict with a FormData body and no confirm param', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockedPost.mockResolvedValueOnce({ data: { total_rows: 5, restored: { users: 5 } } })

    const { container } = render(<BackupPage />)
    await openCoverageLoaded()

    await user.click(screen.getByRole('button', { name: /Upload & Restore/i }))
    const file = new File(['{"v":"1.2"}'], 'my-backup.json.gz', { type: 'application/gzip' })
    fireEvent.change(jsonInput(container), { target: { files: [file] } })

    // Modal, not a blocking confirm dialog.
    const dialog = await screen.findByRole('dialog')
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('radio', { name: /Safe restore/i })).toBeChecked()

    await user.click(within(dialog).getByRole('button', { name: /^Restore$/ }))

    await waitFor(() => expect(mockedPost).toHaveBeenCalled())
    const [url, body] = mockedPost.mock.calls[0]
    expect(url).toBe('/backup/restore/upload?mode=skip_if_conflict')
    expect(url).not.toContain('confirm=')
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get('file')).toBeInstanceOf(File)
    expect(((body as FormData).get('file') as File).name).toBe('my-backup.json.gz')

    confirmSpy.mockRestore()
  })

  it('in replace_all mode carries mode=replace_all&confirm=REPLACE%20ALL%20DATA on the upload URL once the phrase is typed', async () => {
    const user = userEvent.setup()
    mockedPost.mockResolvedValueOnce({ data: { total_rows: 9 } })

    const { container } = render(<BackupPage />)
    await openCoverageLoaded()

    await user.click(screen.getByRole('button', { name: /Upload & Restore/i }))
    const file = new File(['{"v":"1.2"}'], 'full.json.gz', { type: 'application/gzip' })
    fireEvent.change(jsonInput(container), { target: { files: [file] } })

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: /Replace all data/i }))

    const confirmBtn = within(dialog).getByRole('button', { name: /Replace all data/i })
    expect(confirmBtn).toBeDisabled()

    await user.type(within(dialog).getByLabelText(/Type REPLACE ALL DATA to confirm/i), 'REPLACE ALL DATA')
    expect(confirmBtn).toBeEnabled()

    await user.click(confirmBtn)

    await waitFor(() => expect(mockedPost).toHaveBeenCalled())
    const [url, body] = mockedPost.mock.calls[0]
    expect(url).toBe('/backup/restore/upload?mode=replace_all&confirm=REPLACE%20ALL%20DATA')
    expect(body).toBeInstanceOf(FormData)
    expect(((body as FormData).get('file') as File).name).toBe('full.json.gz')
  })
})

// ---------------------------------------------------------------------------
// PSV replace-mode guard
// ---------------------------------------------------------------------------

describe('BackupPage — PSV replace guard', () => {
  it('requires "REPLACE <table>" before enabling import, and sends it as confirm=REPLACE%20<table>', async () => {
    const user = userEvent.setup()
    mockedPost.mockResolvedValueOnce({ data: { imported: 4 } })
    const { container } = render(<BackupPage />)
    await openCoverageLoaded()

    await user.click(screen.getByRole('button', { name: /Per-Table Export \/ Import/i }))
    await user.selectOptions(await screen.findByLabelText('Mode:'), 'replace')

    const importBtn = screen.getByRole('button', { name: /Import into users/i })
    expect(importBtn).toBeDisabled()

    await user.type(screen.getByLabelText(/Type REPLACE users to confirm truncate/i), 'REPLACE users')
    expect(importBtn).toBeEnabled()

    const fileInput = container.querySelector('input[type="file"][accept*=".psv"]') as HTMLInputElement
    const file = new File(['a|b\n1|2'], 'users.psv', { type: 'text/plain' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(mockedPost).toHaveBeenCalled())
    const [url] = mockedPost.mock.calls[0]
    expect(url).toContain('mode=replace')
    expect(url).toContain('confirm=REPLACE%20users')
  })

  it('append mode imports without any confirm phrase', async () => {
    const user = userEvent.setup()
    mockedPost.mockResolvedValueOnce({ data: { imported: 2 } })
    const { container } = render(<BackupPage />)
    await openCoverageLoaded()

    await user.click(screen.getByRole('button', { name: /Per-Table Export \/ Import/i }))

    const fileInput = container.querySelector('input[type="file"][accept*=".psv"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['a|b\n1|2'], 'users.psv')] } })

    await waitFor(() => expect(mockedPost).toHaveBeenCalled())
    const [url] = mockedPost.mock.calls[0]
    expect(url).toBe('/backup/import-table/users?mode=append')
  })
})

// ---------------------------------------------------------------------------
// ResultBox — extended diagnostics
// ---------------------------------------------------------------------------

describe('BackupPage — ResultBox extended fields', () => {
  it('shows checksum chips, a schema-drift warning, and the legacy-format banner', async () => {
    const user = userEvent.setup()
    mockedPost.mockResolvedValueOnce({
      data: {
        filename: 'backup_x.json.gz',
        checksum_verification: { users: 'ok', action_plans: 'mismatch' },
        schema_version_drift: { users: { file: '1.0', live: '1.1', match: false } },
        legacy_backup: true,
        uncovered_tables: ['legacy_notes'],
      },
    })
    render(<BackupPage />)
    await openCoverageLoaded()

    await user.click(screen.getByRole('button', { name: /Create Backup/i }))

    expect(await screen.findByText('action_plans: mismatch')).toBeInTheDocument()
    expect(screen.getByText('users: ok')).toBeInTheDocument()
    expect(screen.getByText(/Schema version drift detected:/i)).toBeInTheDocument()
    expect(screen.getByText('Legacy backup format (v1.1)')).toBeInTheDocument()
    expect(screen.getByText(/legacy_notes/)).toBeInTheDocument()
  })
})

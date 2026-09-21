import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SortableHeader, toggleSortState, type SortState } from '@/components/tracking/SortableHeader'

type Col = 'a' | 'b'

function Table({ sort, onSort }: { sort: SortState<Col>; onSort: (c: Col) => void }) {
  return (
    <table>
      <thead>
        <tr>
          <SortableHeader column="a" label="Alpha" align="left" sort={sort} onSort={onSort} />
          <SortableHeader column="b" label="Beta" align="right" sort={sort} onSort={onSort} />
        </tr>
      </thead>
    </table>
  )
}

describe('SortableHeader', () => {
  it('marks the active column with aria-sort and the inactive column as none', () => {
    render(<Table sort={{ column: 'a', direction: 'asc' }} onSort={vi.fn()} />)

    expect(screen.getByRole('columnheader', { name: 'Alpha' })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('columnheader', { name: 'Beta' })).toHaveAttribute('aria-sort', 'none')
  })

  it('reflects descending direction on the active column', () => {
    render(<Table sort={{ column: 'b', direction: 'desc' }} onSort={vi.fn()} />)

    expect(screen.getByRole('columnheader', { name: 'Beta' })).toHaveAttribute('aria-sort', 'descending')
  })

  it('exposes the click target as a real, keyboard-operable button', async () => {
    const user = userEvent.setup()
    const onSort = vi.fn()
    render(<Table sort={{ column: 'a', direction: 'asc' }} onSort={onSort} />)

    const button = screen.getByRole('button', { name: 'Alpha' })
    expect(button).toBeInstanceOf(HTMLButtonElement)
    await user.click(button)
    expect(onSort).toHaveBeenCalledWith('a')
  })

  it('only renders a chevron icon on the active column', () => {
    render(<Table sort={{ column: 'a', direction: 'asc' }} onSort={vi.fn()} />)

    const activeButton = screen.getByRole('button', { name: 'Alpha' })
    const inactiveButton = screen.getByRole('button', { name: 'Beta' })
    expect(activeButton.querySelector('svg')).not.toBeNull()
    expect(inactiveButton.querySelector('svg')).toBeNull()
  })
})

describe('toggleSortState', () => {
  it('flips direction when the same column is clicked again', () => {
    expect(toggleSortState<Col>({ column: 'a', direction: 'asc' }, 'a')).toEqual({ column: 'a', direction: 'desc' })
    expect(toggleSortState<Col>({ column: 'a', direction: 'desc' }, 'a')).toEqual({ column: 'a', direction: 'asc' })
  })

  it('resets to ascending when a new column is clicked', () => {
    expect(toggleSortState<Col>({ column: 'a', direction: 'desc' }, 'b')).toEqual({ column: 'b', direction: 'asc' })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, within } from '@testing-library/react'
import { render } from '@/test/test-utils'
import { Sidebar } from '../Sidebar'

// ---------------------------------------------------------------------------
// Mocks — Sidebar pulls in several services for its bottom widgets and the
// portfolio-mode query. None of that is under test here, so everything
// resolves to an empty/neutral state.
// ---------------------------------------------------------------------------

vi.mock('@/store/auth', () => ({
  useAuthStore: () => ({
    user: { name: 'Test User', email: 'test@example.com', role: 'user' },
    clearAuth: vi.fn(),
  }),
}))

vi.mock('@/services/portfolioDb', () => ({
  portfolioDbService: {
    getMode: vi.fn().mockResolvedValue('excel'),
    getPositions: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('@/services/actionPlan', () => ({
  actionPlanService: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    getStockPrice: vi.fn(),
  },
}))

vi.mock('@/services/weeklyScan', () => ({
  weeklyScanService: {
    listScans: vi.fn().mockResolvedValue([]),
    getScan: vi.fn(),
  },
}))

const defaultProps = {
  collapsed: false,
  onToggle: vi.fn(),
  mobileOpen: false,
  onMobileClose: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
})

// NOTE: the toggle click below uses fireEvent (a single synchronous DOM
// event) rather than userEvent. NavLink/SubLink/AccordionGroup/SidebarContent
// are all defined as inline closures inside Sidebar() and are therefore
// re-created on every Sidebar render (pre-existing pattern, also used by the
// Analytics/Settings groups — not introduced by this change). userEvent.click
// spaces its pointerdown/mouseup/click steps with real async gaps, which can
// let an in-flight query (e.g. portfolioDbService.getMode) resolve and force
// a Sidebar re-render — and therefore a fresh AccordionGroup identity — in
// between those steps, detaching the button userEvent is mid-click on and
// silently swallowing the click. fireEvent.click dispatches one event
// synchronously, avoiding that window. Flagged for Lead Engineer review —
// see PR notes.

describe('Sidebar — Tracking navigation entry', () => {
  it('renders a "Tracking" group positioned after "Action Plan" and before "Analytics"', async () => {
    render(<Sidebar {...defaultProps} />)

    const nav = screen.getByRole('navigation')
    await screen.findByText('Action Plan')

    const actionPlanIdx = nav.textContent!.indexOf('Action Plan')
    const trackingIdx = nav.textContent!.indexOf('Tracking')
    const analyticsIdx = nav.textContent!.indexOf('Analytics')

    expect(actionPlanIdx).toBeGreaterThanOrEqual(0)
    expect(trackingIdx).toBeGreaterThan(actionPlanIdx)
    expect(analyticsIdx).toBeGreaterThan(trackingIdx)
  })

  it('does not render the Category sublink until the Tracking group is expanded', async () => {
    render(<Sidebar {...defaultProps} />)
    await screen.findByText('Action Plan')

    expect(screen.queryByRole('link', { name: 'Category' })).not.toBeInTheDocument()
  })

  it('reveals "Dashboard", "Updates", and "Category" sublinks, in that order, once expanded', async () => {
    render(<Sidebar {...defaultProps} />)
    await screen.findByText('Action Plan')

    fireEvent.click(screen.getByRole('button', { name: /Tracking/i }))

    const categoryLink = await screen.findByRole('link', { name: 'Category' })
    expect(categoryLink).toHaveAttribute('href', '/tracking/category')

    const updatesLink = await screen.findByRole('link', { name: 'Updates' })
    expect(updatesLink).toHaveAttribute('href', '/tracking/updates')

    // "Dashboard" also names the top-level `/dashboard` NavLink, so scope
    // this lookup to the Tracking accordion's own nested list.
    const trackingButton = screen.getByRole('button', { name: /Tracking/i })
    const trackingGroup = trackingButton.parentElement!
    const dashboardLink = within(trackingGroup).getByRole('link', { name: 'Dashboard' })
    expect(dashboardLink).toHaveAttribute('href', '/tracking/dashboard')

    // Dashboard, Updates, Category render in that order in the accordion.
    const linkTexts = Array.from(trackingGroup.querySelectorAll('a')).map(a => a.textContent)
    expect(linkTexts.indexOf('Dashboard')).toBeLessThan(linkTexts.indexOf('Updates'))
    expect(linkTexts.indexOf('Updates')).toBeLessThan(linkTexts.indexOf('Category'))
  })

  it('does not render extra sublinks under Tracking beyond Dashboard, Updates, and Category', async () => {
    render(<Sidebar {...defaultProps} />)
    await screen.findByText('Action Plan')

    fireEvent.click(screen.getByRole('button', { name: /Tracking/i }))
    await screen.findByRole('link', { name: 'Category' })

    // The Tracking group's nested list should contain exactly three links.
    const trackingButton = screen.getByRole('button', { name: /Tracking/i })
    const trackingGroup = trackingButton.parentElement!
    const links = trackingGroup.querySelectorAll('a')
    expect(links).toHaveLength(3)
    expect(links[0]).toHaveTextContent('Dashboard')
    expect(links[1]).toHaveTextContent('Updates')
    expect(links[2]).toHaveTextContent('Category')
  })
})

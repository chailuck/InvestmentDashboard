'use client'

import { PortfolioDbManager } from '@/components/portfolio-db/PortfolioDbManager'

export default function PortfolioDbPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-ink-primary">Portfolio Manager</h1>
        <p className="text-xs text-ink-muted mt-0.5">Add, edit, and sell positions directly in the database.</p>
      </div>
      <PortfolioDbManager />
    </div>
  )
}

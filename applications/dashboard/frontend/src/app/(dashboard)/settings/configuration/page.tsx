'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  SlidersHorizontal, Settings2, Save, Loader2,
} from 'lucide-react'
import { appConfigService } from '@/services/appConfig'
import { INDICATOR_CONFIG } from '@/config/indicators'
import toast from 'react-hot-toast'

function Section({ title, icon: Icon, description, children }: {
  title: string
  icon: React.ElementType
  description?: string
  children: React.ReactNode
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-6 space-y-5">
      <div>
        <h2 className="text-base font-semibold text-ink-primary flex items-center gap-2">
          <Icon className="w-4 h-4 text-brand-400" />{title}
        </h2>
        {description && <p className="text-xs text-ink-muted mt-1">{description}</p>}
      </div>
      {children}
    </motion.div>
  )
}

function IndicatorThresholdsSection() {
  const queryClient = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['app-config'], queryFn: appConfigService.get })

  const [peThreshold,    setPeThreshold]    = useState<string>('')
  const [priceThreshold, setPriceThreshold] = useState<string>('')
  const [initialized,    setInitialized]    = useState(false)
  const [saving,         setSaving]         = useState(false)

  useEffect(() => {
    if (cfg && !initialized) {
      setPeThreshold(String(cfg.pe_threshold ?? INDICATOR_CONFIG.peThreshold))
      setPriceThreshold(String(cfg.price_threshold ?? INDICATOR_CONFIG.priceThreshold))
      setInitialized(true)
    }
  }, [cfg, initialized])

  const save = async () => {
    const pe    = parseFloat(peThreshold)
    const price = parseFloat(priceThreshold)
    if (isNaN(pe) || isNaN(price) || pe <= 0 || price <= 0) {
      toast.error('Thresholds must be positive numbers')
      return
    }
    setSaving(true)
    try {
      await appConfigService.update({ pe_threshold: pe, price_threshold: price })
      queryClient.invalidateQueries({ queryKey: ['app-config'] })
      toast.success('Indicator thresholds saved')
    } catch {
      toast.error('Failed to save thresholds')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title="Indicator Thresholds"
      icon={Settings2}
      description="Minimum % change (intra-week) to classify PE or price direction as Up/Down vs Stable. Applies to all users."
    >
      <div className="grid grid-cols-2 gap-4">
        {[
          {
            label: 'PE Threshold (%)',
            value: peThreshold,
            onChange: setPeThreshold,
            hint: `default ${INDICATOR_CONFIG.peThreshold}`,
            help: 'Intra-week PE change required to classify as Rising or Falling.',
          },
          {
            label: 'Price Threshold (%)',
            value: priceThreshold,
            onChange: setPriceThreshold,
            hint: `default ${INDICATOR_CONFIG.priceThreshold}`,
            help: 'Intra-week price change required to classify as Up or Down.',
          },
        ].map(({ label, value, onChange, hint, help }) => (
          <div key={label} className="space-y-1.5">
            <label className="text-xs font-medium text-ink-secondary">{label}</label>
            <input
              type="number" step="0.1" min="0.1"
              value={value}
              onChange={e => onChange(e.target.value)}
              placeholder={hint}
              className="w-full bg-surface-elevated border border-border/60 rounded-lg px-3 py-2 text-sm
                         text-ink-primary outline-none focus:border-brand-500/60 transition-colors"
            />
            <p className="text-[11px] text-ink-disabled">{help}</p>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
                     bg-brand-500/15 text-brand-400 border border-brand-500/20
                     hover:bg-brand-500/25 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Thresholds
        </button>
      </div>
    </Section>
  )
}

export default function ConfigurationPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-primary flex items-center gap-2.5">
          <SlidersHorizontal className="w-6 h-6 text-brand-400" />
          Configuration
        </h1>
        <p className="text-ink-muted text-sm mt-0.5">
          Application-level settings shared across all users
        </p>
      </div>

      <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-500/8 border border-amber-500/20 text-amber-400 text-xs">
        <Settings2 className="w-3.5 h-3.5 shrink-0" />
        <span>Changes here take effect for all users immediately.</span>
      </div>

      <IndicatorThresholdsSection />
    </div>
  )
}

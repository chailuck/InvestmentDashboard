'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Mail, TrendingUp, ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react'
import { usersService } from '@/services/users'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ message: string; reset_token?: string } | null>(null)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await usersService.forgotPassword(email)
      setResult(res)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-surface-base flex items-center justify-center p-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-brand-500/5 blur-3xl" />
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }} className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-500/10 border border-brand-500/20 mb-4">
            <TrendingUp className="w-7 h-7 text-brand-400" />
          </div>
          <h1 className="text-2xl font-bold text-ink-primary">Forgot Password</h1>
          <p className="text-ink-muted text-sm mt-1">Enter your email to receive a reset link</p>
        </div>

        <div className="card p-8">
          {result ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-lg bg-gain/10 border border-gain/20">
                <CheckCircle2 className="w-5 h-5 text-gain shrink-0 mt-0.5" />
                <p className="text-sm text-ink-secondary">{result.message}</p>
              </div>

              {/* In dev mode — show token so user can use reset-password page directly */}
              {result.reset_token && (
                <div className="p-4 rounded-lg bg-brand-500/10 border border-brand-500/20 space-y-2">
                  <p className="text-xs font-semibold text-brand-400 uppercase tracking-wider">Dev Mode — Reset Token</p>
                  <p className="text-xs text-ink-muted break-all font-mono bg-surface-base rounded p-2">
                    {result.reset_token}
                  </p>
                  <Link href={`/reset-password?token=${result.reset_token}`}
                    className="btn-primary block text-center text-sm py-2 mt-2">
                    Go to Reset Password →
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <>
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-loss/10 border border-loss/20 text-loss text-sm mb-4">
                  <AlertCircle className="w-4 h-4 shrink-0" />{error}
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-ink-secondary mb-1.5">Email address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
                    <input type="email" className="input pl-9" value={email}
                      onChange={e => setEmail(e.target.value)} required placeholder="you@company.com" />
                  </div>
                </div>
                <button type="submit" disabled={loading || !email}
                  className="btn-primary w-full py-2.5 text-sm font-semibold">
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Sending…
                    </span>
                  ) : 'Send Reset Link'}
                </button>
              </form>
            </>
          )}

          <div className="mt-6 pt-5 border-t border-border/50 text-center">
            <Link href="/login" className="text-xs text-brand-400 hover:text-brand-300 transition-colors flex items-center justify-center gap-1">
              <ArrowLeft className="w-3 h-3" /> Back to sign in
            </Link>
          </div>
        </div>
      </motion.div>
    </main>
  )
}

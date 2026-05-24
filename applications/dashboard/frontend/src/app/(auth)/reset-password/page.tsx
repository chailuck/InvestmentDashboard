'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Lock, TrendingUp, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react'
import { usersService } from '@/services/users'

function ResetPasswordForm() {
  const router = useRouter()
  const params = useSearchParams()
  const tokenFromUrl = params.get('token') ?? ''

  const [token, setToken] = useState(tokenFromUrl)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      await usersService.resetPassword(token, password)
      setSuccess(true)
      setTimeout(() => router.push('/login'), 2500)
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Invalid or expired token. Request a new one.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card p-8">
      {success ? (
        <div className="text-center space-y-3 py-4">
          <CheckCircle2 className="w-12 h-12 text-gain mx-auto" />
          <p className="font-semibold text-ink-primary">Password reset successfully!</p>
          <p className="text-sm text-ink-muted">Redirecting to sign in…</p>
        </div>
      ) : (
        <>
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-loss/10 border border-loss/20 text-loss text-sm mb-4">
              <AlertCircle className="w-4 h-4 shrink-0" />{error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            {!tokenFromUrl && (
              <div>
                <label className="block text-xs font-medium text-ink-secondary mb-1.5">Reset Token</label>
                <input className="input font-mono text-xs" value={token}
                  onChange={e => setToken(e.target.value)} required placeholder="Paste your reset token" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1.5">New Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
                <input type={showPassword ? 'text' : 'password'} className="input pl-9 pr-10"
                  value={password} onChange={e => setPassword(e.target.value)}
                  minLength={8} required placeholder="Min. 8 characters" />
                <button type="button" onClick={() => setShowPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink-secondary transition-colors">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1.5">Confirm New Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
                <input type={showPassword ? 'text' : 'password'} className="input pl-9"
                  value={confirm} onChange={e => setConfirm(e.target.value)} required />
              </div>
            </div>
            <button type="submit" disabled={loading || !token || !password || !confirm}
              className="btn-primary w-full py-2.5 text-sm font-semibold">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Resetting…
                </span>
              ) : 'Reset Password'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-border/50 text-center">
            <Link href="/forgot-password" className="text-xs text-brand-400 hover:text-brand-300 transition-colors">
              Need a new reset token?
            </Link>
          </div>
        </>
      )}
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen bg-surface-base flex items-center justify-center p-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-brand-500/5 blur-3xl" />
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }} className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-500/10 border border-brand-500/20 mb-4">
            <TrendingUp className="w-7 h-7 text-brand-400" />
          </div>
          <h1 className="text-2xl font-bold text-ink-primary">Reset Password</h1>
          <p className="text-ink-muted text-sm mt-1">Choose a strong new password</p>
        </div>

        <Suspense fallback={<div className="card p-8 text-center text-ink-muted">Loading…</div>}>
          <ResetPasswordForm />
        </Suspense>
      </motion.div>
    </main>
  )
}

import type { Config } from 'tailwindcss'
import { fontFamily } from 'tailwindcss/defaultTheme'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', ...fontFamily.sans],
        mono: ['var(--font-jetbrains-mono)', ...fontFamily.mono],
      },
      colors: {
        // Base surfaces
        surface: {
          base: '#0B0F1A',
          card: '#131929',
          elevated: '#1C2333',
          overlay: '#232D45',
        },
        // Borders
        border: {
          DEFAULT: '#2A3450',
          muted: '#1E2940',
          focus: '#3B82F6',
        },
        // Brand
        brand: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
          900: '#1E3A8A',
        },
        // Gain / Loss
        gain: {
          DEFAULT: '#22C55E',
          muted: '#166534',
          bg: 'rgba(34,197,94,0.1)',
        },
        loss: {
          DEFAULT: '#EF4444',
          muted: '#991B1B',
          bg: 'rgba(239,68,68,0.1)',
        },
        // Neutrals
        ink: {
          primary: '#E2E8F0',
          secondary: '#94A3B8',
          muted: '#64748B',
          disabled: '#334155',
        },
        // Status
        warning: { DEFAULT: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
        info: { DEFAULT: '#06B6D4', bg: 'rgba(6,182,212,0.1)' },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-card': 'linear-gradient(135deg, #131929 0%, #1C2333 100%)',
        'glow-blue': 'radial-gradient(circle at 50% 0%, rgba(59,130,246,0.15) 0%, transparent 70%)',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px rgba(42,52,80,0.6)',
        'card-hover': '0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(59,130,246,0.3)',
        glow: '0 0 20px rgba(59,130,246,0.25)',
        'glow-gain': '0 0 15px rgba(34,197,94,0.2)',
        'glow-loss': '0 0 15px rgba(239,68,68,0.2)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-in-left': 'slideInLeft 0.3s ease-out',
        'slide-in-up': 'slideInUp 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'ticker': 'ticker 20s linear infinite',
        'shimmer': 'shimmer 1.5s infinite',
        'number-up': 'numberUp 0.4s ease-out',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideInLeft: { from: { transform: 'translateX(-100%)', opacity: '0' }, to: { transform: 'translateX(0)', opacity: '1' } },
        slideInUp: { from: { transform: 'translateY(20px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        ticker: { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(-100%)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        numberUp: { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
      },
      transitionDuration: { '50': '50ms', '150': '150ms' },
      backdropBlur: { xs: '2px' },
      borderRadius: { xl2: '1rem', xl3: '1.5rem' },
      zIndex: { 60: '60', 70: '70', 80: '80', 90: '90', 100: '100' },
    },
  },
  plugins: [],
}

export default config

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0B1F3A',
          950: '#061426',
          900: '#0B1F3A',
          800: '#12294A',
          700: '#1A3560',
          600: '#254578',
          500: '#335B97',
        },
        gold: {
          DEFAULT: '#D4AF37',
          light: '#E6C86A',
          dark: '#B8912A',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 4px 24px -8px rgba(0, 0, 0, 0.5)',
        gold: '0 0 0 1px rgba(212, 175, 55, 0.25), 0 8px 30px -12px rgba(212, 175, 55, 0.35)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'slide-in': { '0%': { opacity: '0', transform: 'translateX(20px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
        'pulse-ring': { '0%': { boxShadow: '0 0 0 0 rgba(212,175,55,0.5)' }, '70%': { boxShadow: '0 0 0 8px rgba(212,175,55,0)' }, '100%': { boxShadow: '0 0 0 0 rgba(212,175,55,0)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-in': 'slide-in 0.3s ease-out',
        'pulse-ring': 'pulse-ring 2s infinite',
      },
    },
  },
  plugins: [],
}

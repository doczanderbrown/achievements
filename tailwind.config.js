/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        body: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: 'rgb(var(--ink-rgb) / <alpha-value>)',
        muted: 'rgb(var(--muted-rgb) / <alpha-value>)',
        canvas: 'rgb(var(--canvas-rgb) / <alpha-value>)',
        panel: 'rgb(var(--panel-rgb) / <alpha-value>)',
        surface: 'rgb(var(--canvas-rgb) / <alpha-value>)',
        card: 'rgb(var(--panel-rgb) / <alpha-value>)',
        stroke: 'rgb(var(--stroke-rgb) / <alpha-value>)',
        brand: 'rgb(var(--brand-rgb) / <alpha-value>)',
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
        'accent-2': 'rgb(var(--accent-2-rgb) / <alpha-value>)',
        'accent-3': 'rgb(var(--accent-3-rgb) / <alpha-value>)',
        warning: 'rgb(var(--warning-rgb) / <alpha-value>)',
        success: 'rgb(var(--success-rgb) / <alpha-value>)',
      },
      boxShadow: {
        glow: '0 20px 60px -40px rgba(15, 118, 110, 0.5)',
        soft: '0 12px 28px -18px rgba(80, 57, 20, 0.35)',
        lift: '0 20px 38px -20px rgba(80, 57, 20, 0.45)',
      },
    },
  },
  plugins: [],
}

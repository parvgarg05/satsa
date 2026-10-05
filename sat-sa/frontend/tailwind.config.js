/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', '"Liberation Mono"', '"Courier New"', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '5px',
        sm: '4px',
        md: '6px',
        lg: '8px',
      },
      colors: {
        app: {
          bg: 'var(--bg-page)',
          sidebar: 'var(--bg-sidebar)',
          header: 'var(--bg-header)',
          surface: 'var(--surface-primary)',
          surface2: 'var(--surface-secondary)',
          surfaceElevated: 'var(--surface-elevated)',
          surfaceHover: 'var(--surface-hover)',
          navActiveBg: 'var(--nav-active-bg)',
          navActiveText: 'var(--nav-active-text)',
          navActiveIndicator: 'var(--nav-active-indicator)',
          navInactiveText: 'var(--nav-inactive-text)',
          border: 'var(--border-main)',
          borderSubtle: 'var(--border-subtle)',
          borderStrong: 'var(--border-strong)',
          borderBtn: 'var(--border-button)',
          borderDivider: 'var(--border-divider)',
          heading: 'var(--text-heading)',
          text: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          disabled: 'var(--text-disabled)',
          accent: 'var(--accent-color)',
          btnPrimary: 'var(--btn-primary-bg)',
          btnPrimaryText: 'var(--btn-primary-text)',
          btnPrimaryHover: 'var(--btn-primary-hover)',
          btnSecondary: 'var(--btn-secondary-bg)',
          btnSecondaryText: 'var(--btn-secondary-text)',
          btnSecondaryHover: 'var(--btn-secondary-hover)',
        },
        severity: {
          critical: 'var(--sev-critical)',
          high: 'var(--sev-high)',
          medium: 'var(--sev-medium)',
          low: 'var(--sev-low)',
        }
      }
    },
  },
  plugins: [],
}

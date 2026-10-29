export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'], sans: ['Inter', 'ui-sans-serif', 'system-ui'] },
      colors: { ink: { 950: '#07090d', 900: '#0b0f15', 800: '#111722', 700: '#1a2230', 600: '#263042', 500: '#3a4659' } },
    },
  },
  plugins: [],
};

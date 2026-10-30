export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui'],
        cond: ['"IBM Plex Sans Condensed"', '"IBM Plex Sans"', 'sans-serif'],
      },
      colors: {
        g: {
          950: '#000000', 900: '#000000', 850: '#050505', 800: '#0a0a0a', 750: '#111111',
          700: '#1a1a1a', 600: '#242424', 500: '#4a4a4a', 400: '#707070', 300: '#9c9c9c', 200: '#c2c2c2', 100: '#ececec',
        },
        friendly: '#7aa2ff',
        hostile: '#ff5f56',
        caution: '#e5a443',
        clear: '#3fcf8e',
        intel: '#a58bff',
      },
    },
  },
  plugins: [],
};

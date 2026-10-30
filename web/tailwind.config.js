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
          950: '#07090c', 900: '#0b0e12', 850: '#0e1217', 800: '#121820', 750: '#161d27',
          700: '#1c2430', 600: '#26303d', 500: '#36414f', 400: '#56626f', 300: '#7f8b97', 200: '#a9b3bd', 100: '#d3dae0',
        },
        friendly: '#3d9df3',
        hostile: '#ff4d4d',
        caution: '#f2a93b',
        clear: '#35c48a',
        intel: '#a77bf3',
      },
    },
  },
  plugins: [],
};

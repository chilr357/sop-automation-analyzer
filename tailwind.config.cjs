/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './types.ts',
  ],
  theme: {
    extend: {
      colors: {
        'brand-blue': '#0052FF',
        'brand-dark': '#0D1117',
        'brand-light': '#161B22',
        'brand-gray': '#8B949E',
        'brand-border': '#30363D',
      },
    },
  },
  plugins: [],
};



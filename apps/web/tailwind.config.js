/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#2a78d6', dark: '#1c5cab', light: '#86b6ef' },
      },
    },
  },
  plugins: [],
};

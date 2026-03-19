import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        warm: {
          bg: '#FFFDF7',
          card: '#FFFFFF',
          sidebar: '#F5F0E8',
          border: '#E8E2D9',
          text: '#1D1D1D',
          'text-secondary': '#6B6B6B',
        },
        brand: {
          DEFAULT: '#1D6CE0',
          hover: '#1557B8',
        },
      },
      borderRadius: {
        card: '12px',
        btn: '8px',
        badge: '6px',
      },
    },
  },
  plugins: [],
};

export default config;

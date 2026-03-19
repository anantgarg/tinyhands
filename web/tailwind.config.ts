import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        warm: {
          bg: '#F6F6F3',
          card: '#FFFFFF',
          sidebar: '#FFFFFF',
          border: '#E0DED9',
          text: '#1A1A1A',
          'text-secondary': '#787774',
        },
        brand: {
          DEFAULT: '#1E8B5E',
          hover: '#176B49',
          light: '#E7F5EE',
        },
      },
      borderRadius: {
        card: '16px',
        btn: '10px',
        badge: '6px',
      },
      fontSize: {
        'page-title': ['32px', { lineHeight: '1.2', fontWeight: '800' }],
        'section-title': ['18px', { lineHeight: '1.3', fontWeight: '700' }],
      },
      boxShadow: {
        'overlay': '0 4px 16px rgba(0, 0, 0, 0.12)',
      },
    },
  },
  plugins: [],
};

export default config;

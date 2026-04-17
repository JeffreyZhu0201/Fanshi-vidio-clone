import forms from '@tailwindcss/forms';

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          500: '#6366f1',
          600: '#5457df',
          700: '#4338ca',
          900: '#312e81'
        },
        accent: {
          50: '#fdf2f8',
          100: '#fce7f3',
          200: '#fbcfe8',
          500: '#ec4899',
          600: '#db2777',
          700: '#be185d'
        },
        ink: {
          100: '#f1f5f9',
          700: '#334155',
          900: '#1e293b'
        }
      },
      boxShadow: {
        glow: '0 24px 80px rgba(37, 99, 235, 0.10)'
      },
      fontFamily: {
        sans: ['Space Grotesk', 'Noto Sans SC', 'PingFang SC', 'sans-serif']
      }
    }
  },
  plugins: [forms]
};

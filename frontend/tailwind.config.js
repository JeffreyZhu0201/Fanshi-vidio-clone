import forms from '@tailwindcss/forms';

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eefcf7',
          100: '#d7f7ec',
          500: '#16a16f',
          700: '#0f7a55',
          900: '#0d3d31'
        },
        accent: {
          100: '#fff0d8',
          400: '#f59e0b',
          600: '#d97706'
        },
        ink: {
          100: '#f4f5f7',
          700: '#334155',
          900: '#10212b'
        }
      },
      boxShadow: {
        glow: '0 24px 70px rgba(16, 33, 43, 0.14)'
      },
      fontFamily: {
        sans: ['Manrope', 'Noto Sans SC', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: [forms]
};


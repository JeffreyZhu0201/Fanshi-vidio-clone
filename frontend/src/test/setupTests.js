import '@testing-library/jest-dom';

process.env.VITE_API_BASE_URL = 'https://localhost:5443/api';
process.env.VITE_API_TIMEOUT = '30000';
process.env.VITE_UPLOAD_LIMIT = '524288000';

if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
}

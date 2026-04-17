import React from 'react';
import ReactDOM from 'react-dom/client';

import './styles/theme.css';
import './index.css';
import App from './App.jsx';
import { initializePerformanceMonitoring } from './utils/performanceMonitor.js';

initializePerformanceMonitoring();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

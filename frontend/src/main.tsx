import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import './styles/index.css';
import { apiClient } from './services/api';

// Restore auth token (if present) so API client sends Authorization on page load
const savedToken = localStorage.getItem('authToken');
if (savedToken) {
  apiClient.setToken(savedToken);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

import React from 'react';
import { createRoot } from 'react-dom/client';
// Vite + React, so this is the `/react` entry — not the `/next` one Vercel's
// setup page shows by default. Page-view counts only: the script is served from
// our own origin (`/_vercel/insights`), sets no cookies, and never sees the
// document being converted, which stays in the tab. Disclosed in the colophon.
import { Analytics } from '@vercel/analytics/react';
import App from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <React.StrictMode>
    <App />
    <Analytics />
  </React.StrictMode>,
);

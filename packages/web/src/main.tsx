import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import { applyBrandToDocument } from './config';
import './styles/index.css';

applyBrandToDocument();

const container = document.getElementById('root');
if (!container) {
  throw new Error('The page is missing its root element.');
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

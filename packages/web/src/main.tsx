import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import { LoadGuard } from './components/LoadGuard';
import { applyBrandToDocument } from './config';
import { keepUpToDate, watchForBrokenLoads } from './lib/updates';
import './styles/index.css';

applyBrandToDocument();
// A file of this build that will not load is healed once, then the page reloads (ruling 95).
watchForBrokenLoads();
keepUpToDate();

const container = document.getElementById('root');
if (!container) {
  throw new Error('The page is missing its root element.');
}

createRoot(container).render(
  <StrictMode>
    <LoadGuard>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </LoadGuard>
  </StrictMode>,
);

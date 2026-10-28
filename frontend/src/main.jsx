import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import DialogHost from './components/DialogHost.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { PortfolioProvider } from './context/PortfolioContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { GigwProvider } from './gigw/GigwContext.jsx';
import './styles.css';
import './gigw/gigw.css';
import { installChartA11y } from './gigw/chartA11y.js';
import { REIA_BETA, REIA_BETA_TITLE } from './reiaBeta.js';

// The REIA beta build names the REIA desk alone, in the tab title too.
if (REIA_BETA) {
  document.title = REIA_BETA_TITLE;
  document.querySelector('meta[name="description"]')?.setAttribute('content', 'SJVN Limited (Ministry of Power, Government of India) — REIA Commercial Portal for renewable power bought from generators and sold to discoms.');
}
import { registerServiceWorker } from './pwa.js';

installChartA11y();
registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <GigwProvider>
      <BrowserRouter>
        <AuthProvider>
          {/* Inside AuthProvider: the portfolio list is an authenticated call. */}
          <PortfolioProvider>
            <App />
            <DialogHost />
          </PortfolioProvider>
        </AuthProvider>
      </BrowserRouter>
      </GigwProvider>
    </ThemeProvider>
  </React.StrictMode>
);

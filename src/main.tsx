import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { RadarOfertas } from './pages/RadarOfertas';

const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/';
const isRadarOfertasRoute = normalizedPath === '/radar-ofertas';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isRadarOfertasRoute ? <RadarOfertas /> : <App />}</StrictMode>
);

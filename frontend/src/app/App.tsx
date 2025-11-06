import { BrowserRouter } from 'react-router-dom';
import { Suspense } from 'react';
import AppRoutes from './routes';
import { ErrorBoundary } from '../components/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<div style={{ background: '#000', color: '#0f0', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading App...</div>}>
          <AppRoutes />
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;

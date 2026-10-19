import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import { connect, useHaven } from './lib/store';
import { IS_REPLAY } from './lib/api';
import { Shell } from './components/Shell';
import MissionControl from './pages/MissionControl';
import Community from './pages/Community';
import Incidents from './pages/Incidents';
import IncidentRoom from './pages/IncidentRoom';
import Workforce from './pages/Workforce';
import EmployeeProfile from './pages/EmployeeProfile';
import Audits from './pages/Audits';
import Ask from './pages/Ask';
import Automations from './pages/Automations';
import Briefing from './pages/Briefing';
import Stack from './pages/Stack';

function Boot() {
  const ready = useHaven((s) => s.ready);
  useEffect(() => { connect(); }, []);
  if (!ready) {
    return (
      <div className="haven-bg h-full grid place-items-center">
        <div className="flex flex-col items-center gap-4">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} className="w-14 h-14 animate-pulse" alt="" />
          <div className="text-sm text-muted">Waking up the Haven workforce…</div>
        </div>
      </div>
    );
  }
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<MissionControl />} />
        <Route path="/community" element={<Community />} />
        <Route path="/incidents" element={<Incidents />} />
        <Route path="/incidents/:id" element={<IncidentRoom />} />
        <Route path="/workforce" element={<Workforce />} />
        <Route path="/workforce/:id" element={<EmployeeProfile />} />
        <Route path="/security" element={<Audits />} />
        <Route path="/ask" element={<Ask />} />
        <Route path="/automations" element={<Automations />} />
        <Route path="/briefing" element={<Briefing />} />
        <Route path="/stack" element={<Stack />} />
        <Route path="*" element={<MissionControl />} />
      </Routes>
    </Shell>
  );
}

const Router = IS_REPLAY ? HashRouter : BrowserRouter;
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <Boot />
    </Router>
  </StrictMode>,
);

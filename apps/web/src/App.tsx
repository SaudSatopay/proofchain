import { Navigate, Route, Routes } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { AppLayout } from './pages/AppLayout';
import { Overview } from './pages/Overview';
import { ArtifactsList } from './pages/ArtifactsList';
import { ArtifactDetail } from './pages/ArtifactDetail';
import { RegisterPage } from './pages/RegisterPage';
import { VerifyPage } from './pages/VerifyPage';
import { ProvenancePage } from './pages/ProvenancePage';
import { BlockchainPage } from './pages/BlockchainPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/app" element={<AppLayout />}>
        <Route index element={<Overview />} />
        <Route path="artifacts" element={<ArtifactsList />} />
        <Route path="artifacts/:chainId" element={<ArtifactDetail />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="verify" element={<VerifyPage />} />
        <Route path="provenance" element={<ProvenancePage />} />
        <Route path="blockchain" element={<BlockchainPage />} />
        <Route path="analysis" element={<AnalysisPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

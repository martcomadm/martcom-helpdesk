import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { pb } from './lib/pocketbase';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import CreateTicket from './pages/CreateTicket';
import MyTickets from './pages/MyTickets';
import TicketDetail from './pages/TicketDetail';
import SupportPanel from './pages/SupportPanel';
import Reports from './pages/Reports';
import Assets from './pages/Assets';
import AssetDetail from './pages/AssetDetail';
import NotificationBell from './components/NotificationBell';
import ReopenHistoryPanel from './components/ReopenHistoryPanel';

function ProtectedRoute({ children }) {
  const [checkingAuth, setCheckingAuth] = useState(pb.authStore.isValid);
  const [, setAuthVersion] = useState(0);

  useEffect(() => {
    let active = true;

    async function refreshAuth() {
      if (!pb.authStore.isValid) {
        if (active) setCheckingAuth(false);
        return;
      }

      try {
        await pb.collection('hd_users').authRefresh();
        if (active) setAuthVersion((value) => value + 1);
      } catch (err) {
        console.warn('No fue posible refrescar la sesión:', err);
        pb.authStore.clear();
      } finally {
        if (active) setCheckingAuth(false);
      }
    }

    refreshAuth();
    return () => { active = false; };
  }, []);

  if (checkingAuth) {
    return <main className="app-shell"><section className="content"><article className="card"><p>Validando sesión…</p></article></section></main>;
  }

  if (!pb.authStore.isValid) return <Navigate to="/login" replace />;
  return <><NotificationBell />{children}</>;
}

function TicketDetailRoute() {
  return <ProtectedRoute><TicketDetail /><ReopenHistoryPanel /></ProtectedRoute>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/tickets/new" element={<ProtectedRoute><CreateTicket /></ProtectedRoute>} />
      <Route path="/tickets/mine" element={<ProtectedRoute><MyTickets /></ProtectedRoute>} />
      <Route path="/tickets/:id" element={<TicketDetailRoute />} />
      <Route path="/support" element={<ProtectedRoute><SupportPanel /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
      <Route path="/assets" element={<ProtectedRoute><Assets /></ProtectedRoute>} />
      <Route path="/assets/:id" element={<ProtectedRoute><AssetDetail /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

import { Navigate, Route, Routes } from 'react-router-dom';
import { pb } from './lib/pocketbase';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import CreateTicket from './pages/CreateTicket';
import MyTickets from './pages/MyTickets';
import TicketDetail from './pages/TicketDetail';
import SupportPanel from './pages/SupportPanel';
import Reports from './pages/Reports';
import NotificationBell from './components/NotificationBell';
import ReopenHistoryPanel from './components/ReopenHistoryPanel';

function ProtectedRoute({ children }) {
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

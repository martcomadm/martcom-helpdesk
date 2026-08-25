import { Navigate, Route, Routes } from 'react-router-dom';
import { currentUser, pb } from './lib/pocketbase';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import CreateTicket from './pages/CreateTicket';
import MyTickets from './pages/MyTickets';
import TicketDetail from './pages/TicketDetail';
import SupportPanel from './pages/SupportPanel';
import NotificationBell from './components/NotificationBell';
import ReopenHistoryPanel from './components/ReopenHistoryPanel';

function ProtectedRoute({ children }) {
  if (!pb.authStore.isValid) return <Navigate to="/login" replace />;
  return <><NotificationBell />{children}</>;
}

function HomeRoute() {
  if (!pb.authStore.isValid) return <Navigate to="/login" replace />;
  const user = currentUser();
  if (user?.role === 'soporte') return <Navigate to="/support" replace />;
  return <ProtectedRoute><Dashboard /></ProtectedRoute>;
}

function TicketDetailRoute() {
  return <ProtectedRoute><TicketDetail /><ReopenHistoryPanel /></ProtectedRoute>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<HomeRoute />} />
      <Route path="/tickets/new" element={<ProtectedRoute><CreateTicket /></ProtectedRoute>} />
      <Route path="/tickets/mine" element={<ProtectedRoute><MyTickets /></ProtectedRoute>} />
      <Route path="/tickets/:id" element={<TicketDetailRoute />} />
      <Route path="/support" element={<ProtectedRoute><SupportPanel /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

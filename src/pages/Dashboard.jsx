import { useNavigate } from 'react-router-dom';
import { currentUser, logout } from '../lib/pocketbase';

export default function Dashboard() {
  const navigate = useNavigate();
  const user = currentUser();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">MARTCOM</p>
          <h2>Soporte IT</h2>
        </div>
        <nav>
          <a className="active" onClick={() => navigate('/')}>Dashboard</a>
          <a onClick={() => navigate('/tickets/new')}>Crear ticket</a>
          <a onClick={() => navigate('/tickets/mine')}>Mis tickets</a>
          {(user?.role === 'admin' || user?.role === 'supervisor') && <a onClick={() => navigate('/support')}>Panel de soporte</a>}
        </nav>
        <button className="secondary" onClick={handleLogout}>Cerrar sesión</button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="muted">Bienvenido</p>
            <h1>{user?.name || user?.email}</h1>
          </div>
          <span className="role-badge">{user?.role || 'empleado'}</span>
        </header>

        <div className="stats-grid">
          <article className="card"><span>Nuevos</span><strong>0</strong></article>
          <article className="card"><span>En proceso</span><strong>0</strong></article>
          <article className="card"><span>Esperando</span><strong>0</strong></article>
          <article className="card"><span>Resueltos hoy</span><strong>0</strong></article>
        </div>

        <article className="card empty-state">
          <h2>Base lista</h2>
          <p>La autenticación ya está preparada. Ya puedes comenzar a registrar tickets.</p>
          <button onClick={() => navigate('/tickets/new')}>Crear primer ticket</button>
        </article>
      </section>
    </main>
  );
}

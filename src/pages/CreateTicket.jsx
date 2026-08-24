import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { currentUser, logout, pb } from '../lib/pocketbase';

function makeFolio() {
  const now = new Date();
  const year = now.getFullYear();
  const stamp = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const random = Math.floor(100 + Math.random() * 900);
  return `TK-${year}-${stamp}-${random}`;
}

export default function CreateTicket() {
  const navigate = useNavigate();
  const user = currentUser();
  const [categories, setCategories] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [equipment, setEquipment] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadCategories() {
      try {
        const records = await pb.collection('hd_categories').getFullList({ filter: 'active = true', sort: 'order,name' });
        setCategories(records);
      } catch (err) {
        setError(err?.message || 'No fue posible cargar las categorías.');
      } finally {
        setLoadingCategories(false);
      }
    }
    loadCategories();
  }, []);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!category) return setError('Selecciona una categoría.');

    setLoading(true);
    try {
      const data = new FormData();
      data.append('folio', makeFolio());
      data.append('title', title.trim());
      data.append('description', description.trim());
      data.append('requester', user.id);
      data.append('department', user.department || 'Sin departamento');
      data.append('category', category);
      data.append('priority', 'media');
      data.append('status', 'nuevo');
      if (equipment.trim()) data.append('equipment', equipment.trim());
      Array.from(attachments).slice(0, 5).forEach((file) => data.append('attachments', file));

      await pb.collection('hd_tickets').create(data);
      navigate('/tickets/mine', { replace: true });
    } catch (err) {
      console.error(err);
      setError(err?.response?.message || err?.message || 'No fue posible crear el ticket.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div><p className="eyebrow">MARTCOM</p><h2>Soporte IT</h2></div>
        <nav>
          <a onClick={() => navigate('/')}>Dashboard</a>
          <a className="active">Crear ticket</a>
          <a onClick={() => navigate('/tickets/mine')}>Mis tickets</a>
          {(user?.role === 'admin' || user?.role === 'supervisor') && <a onClick={() => navigate('/support')}>Panel de soporte</a>}
        </nav>
        <button className="secondary" onClick={handleLogout}>Cerrar sesión</button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div><p className="muted">Mesa de ayuda</p><h1>Crear ticket</h1><p className="muted">Describe el problema con el mayor detalle posible.</p></div>
          <span className="role-badge">{user?.name || user?.email}</span>
        </header>

        <form className="card ticket-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label className="form-wide">Asunto<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength="200" placeholder="Ej. No puedo ingresar a Chatwoot" required /></label>
            <label>Categoría<select value={category} onChange={(e) => setCategory(e.target.value)} disabled={loadingCategories} required><option value="">{loadingCategories ? 'Cargando categorías…' : 'Selecciona una categoría'}</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Equipo / estación (opcional)<input value={equipment} onChange={(e) => setEquipment(e.target.value)} placeholder="Ej. PC Ventas 08" /></label>
            <label className="form-wide">Descripción<textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength="5000" rows="8" placeholder="¿Qué estabas haciendo? ¿Qué error aparece? ¿Desde cuándo ocurre?" required /></label>
            <label className="form-wide">Evidencias (opcional, máximo 5 archivos)<input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setAttachments(e.target.files)} /><span className="field-help">Puedes adjuntar capturas JPG, PNG, WEBP o PDF.</span></label>
          </div>
          <div className="ticket-meta"><span>Solicitante: <strong>{user?.name || user?.email}</strong></span><span>Departamento: <strong>{user?.department || 'Sin departamento'}</strong></span><span>Prioridad inicial: <strong>Media</strong></span></div>
          {error && <div className="error">{error}</div>}
          <div className="form-actions"><button type="button" className="secondary" onClick={() => navigate('/')}>Cancelar</button><button type="submit" disabled={loading || loadingCategories}>{loading ? 'Creando ticket…' : 'Crear ticket'}</button></div>
        </form>
      </section>
    </main>
  );
}

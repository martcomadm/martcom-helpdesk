import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { pb } from '../lib/pocketbase';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const auth = await pb.collection('users').authWithPassword(email, password);
      if (auth.record.active === false) {
        pb.authStore.clear();
        throw new Error('Usuario desactivado');
      }
      navigate('/');
    } catch (err) {
      setError(err?.message || 'No fue posible iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <form className="card login-card" onSubmit={handleSubmit}>
        <div>
          <p className="eyebrow">MARTCOM</p>
          <h1>Soporte IT</h1>
          <p className="muted">Ingresa con tu cuenta interna.</p>
        </div>

        <label>
          Correo
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label>
          Contraseña
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>

        {error && <div className="error">{error}</div>}

        <button disabled={loading}>{loading ? 'Entrando…' : 'Iniciar sesión'}</button>
      </form>
    </main>
  );
}

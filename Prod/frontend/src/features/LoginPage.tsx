import { useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../app/AuthContext';

export function LoginPage() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  if (user) return <Navigate to="/" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try { await login(username, password); }
    catch (reason) { setError(reason instanceof ApiError ? 'Проверьте логин и пароль.' : 'Сервер временно недоступен.'); }
    finally { setSubmitting(false); }
  }

  return <main className="login-page">
    <section className="login-center">
      <h1>ХозУчёт</h1>
      <p>Вход в систему</p>
      <form className="login-form" onSubmit={submit}>
        <label>Адрес сервера<input value="http://127.0.0.1:8000" readOnly /></label>
        <label>Логин<input autoFocus autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
        <label>Пароль<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <div className="form-error">{error}</div>}
        <button className="button primary full" disabled={submitting}>{submitting ? 'Проверяем…' : <>Войти <ArrowRight size={16} /></>}</button>
      </form>
    </section>
  </main>;
}


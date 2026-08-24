'use client';

import Link from 'next/link';
import { ArrowRight, Check, LogIn, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, login, logout, refreshSession, register } from '@/lib/api';
import type { AuthSession } from '@/lib/auth';
import { ErrorNotice } from '@/components/ui';

type Mode = 'login' | 'register';

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { getSession().then(setSession); }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const nextSession = mode === 'login'
        ? await login({ email, password })
        : await register({ email, password, nickname });
      setSession(nextSession);
      window.dispatchEvent(new Event('auth-updated'));
      router.push('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '认证请求失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      const nextSession = await refreshSession();
      setSession(nextSession);
      window.dispatchEvent(new Event('auth-updated'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '会话刷新失败，请重新登录');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setError('');
    try {
      await logout();
      setSession(null);
      window.dispatchEvent(new Event('auth-updated'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登出失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <div className="page-heading"><div><span className="eyebrow">account / session</span><h1>Know who is here.</h1></div><p>One customer session follows the basket, checkout, orders and every handoff that comes after.</p></div>
    {error && <ErrorNotice message={error} />}
    {session ? <div className="auth-layout reveal">
      <section className="surface session-panel"><span className="session-mark"><Check size={19} /></span><span className="eyebrow">session active</span><h2>Welcome back.</h2><p>This browser is signed in as customer <strong>{session.nickname ?? session.email ?? `#${session.userId}`}</strong>{session.nickname && session.email ? <> ({session.email})</> : null}. Your session token stays in an HttpOnly cookie and is never exposed to page JavaScript.</p><div className="session-actions"><button className="btn light" onClick={refresh} disabled={busy}><RefreshCw size={15} /> {busy ? 'Working' : 'Refresh session'}</button><button className="btn danger" onClick={signOut} disabled={busy}><LogOut size={15} /> Sign out</button></div></section>
      <aside className="surface auth-side"><ShieldCheck size={22} color="var(--acid-deep)" /><h2>Private by default.</h2><p>The browser talks to the Shopfront BFF. The BFF forwards the short-lived access token to the Gateway and keeps the refresh credential server-side.</p><Link className="btn ghost" href="/account/addresses">Manage addresses <ArrowRight size={14} /></Link></aside>
    </div> : <div className="auth-layout reveal">
      <form className="surface auth-form" onSubmit={submit}>
        <div className="auth-tabs" role="tablist" aria-label="认证模式"><button className={mode === 'login' ? 'active' : ''} type="button" onClick={() => { setMode('login'); setError(''); }} role="tab" aria-selected={mode === 'login'}>Sign in</button><button className={mode === 'register' ? 'active' : ''} type="button" onClick={() => { setMode('register'); setError(''); }} role="tab" aria-selected={mode === 'register'}>Create account</button></div>
        <div className="auth-form-heading"><LogIn size={21} /><div><span className="eyebrow">{mode === 'login' ? 'returning customer' : 'new customer'}</span><h2>{mode === 'login' ? 'Pick up where you left off.' : 'Make a place here.'}</h2></div></div>
        {mode === 'register' && <div className="field"><label htmlFor="nickname">Nickname</label><input className="input" id="nickname" autoComplete="nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} required /></div>}
        <div className="field"><label htmlFor="email">Email</label><input className="input" id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
        <div className="field"><label htmlFor="password">Password</label><input className="input" id="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} /></div>
        <button className="btn full" type="submit" disabled={busy}><LogIn size={15} /> {busy ? 'Working' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <aside className="surface auth-side"><ShieldCheck size={22} color="var(--acid-deep)" /><h2>A quieter handoff.</h2><p>After signing in, your cart and customer-owned resources are resolved through the trusted Gateway identity. No user ID fields are accepted from the browser.</p><span className="detail-label">customer flow / 01</span><div className="auth-flow"><span>identity</span><span>basket</span><span>checkout</span><span>delivery</span></div></aside>
    </div>}
  </>;
}
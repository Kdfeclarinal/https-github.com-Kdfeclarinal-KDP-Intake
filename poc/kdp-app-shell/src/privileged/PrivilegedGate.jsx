import React from 'react';
import { BrandLogo } from '../bookshelf/BrandLogo.jsx';
import { callPrivilegedFunction, createPrivilegedAuthClient, loadPrivilegedContext, privilegedConfig } from './privilegedAuth.js';

const h = React.createElement;

function AuthState({ title, message, action, actionLabel }) {
  return h('main', { className: 'kdp-app kdp-app--privileged kdp-privileged-auth' },
    h('section', { className: 'kdp-privileged-auth__card' },
      h(BrandLogo),
      h('h1', null, title),
      h('p', null, message),
      action ? h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary', onClick: action }, actionLabel) : null
    )
  );
}

export function PrivilegedGate({ children }) {
  const config = React.useMemo(() => privilegedConfig(), []);
  const auth = React.useMemo(() => createPrivilegedAuthClient(config), [config]);
  const [state, setState] = React.useState(auth ? 'loading' : 'configuration');
  const [context, setContext] = React.useState(null);
  const [message, setMessage] = React.useState('');
  const lastSessionToken = React.useRef(null);
  const activeSessionToken = React.useRef(null);

  const loadContext = React.useCallback(async (accessToken) => {
    const next = await loadPrivilegedContext({ accessToken, config });
    setContext(next);
    setState('authorized');
    return next;
  }, [config]);

  React.useEffect(() => {
    if (!auth) return undefined;
    let cancelled = false;
    async function resolve(session) {
      if (!session?.access_token) { lastSessionToken.current = null; activeSessionToken.current = null; setContext(null); setState('signed-out'); return; }
      if (lastSessionToken.current === session.access_token) return;
      lastSessionToken.current = session.access_token;
      activeSessionToken.current = session.access_token;
      setState('loading');
      try {
        if (!cancelled) await loadContext(session.access_token);
      } catch (error) {
        if (!cancelled) {
          setMessage(error.message);
          setState(error.status === 401 ? 'signed-out' : error.status === 403 ? 'denied' : 'error');
        }
      }
    }
    auth.auth.getSession().then(({ data }) => resolve(data.session)).catch(() => setState('error'));
    const { data: listener } = auth.auth.onAuthStateChange((_event, session) => resolve(session));
    return () => { cancelled = true; listener.subscription.unsubscribe(); };
  }, [auth, loadContext]);

  const signIn = () => auth.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href.split('#')[0] },
  });
  const signOut = async () => { await auth.auth.signOut(); setContext(null); setState('signed-out'); };
  const actions = React.useMemo(() => ({
    call: (functionName, body) => callPrivilegedFunction({ functionName, body, accessToken: activeSessionToken.current, config }),
    refresh: () => {
      if (!activeSessionToken.current) throw new Error('Authentication is required.');
      return loadContext(activeSessionToken.current);
    },
  }), [config, loadContext]);

  if (state === 'configuration') return h(AuthState, { title: 'Privileged access is not configured', message: 'The public Supabase browser key is missing. No privileged data was requested.' });
  if (state === 'loading') return h(AuthState, { title: 'Verifying access…', message: 'Checking your current identity and application permissions.' });
  if (state === 'signed-out') return h(AuthState, { title: 'Sign in to Bookshelf', message: 'Use your authorized Google account. A valid Google sign-in alone does not grant application access.', action: signIn, actionLabel: 'Sign in with Google' });
  if (state === 'denied') return h(AuthState, { title: 'Access denied', message: message || 'This Google identity has no active Bookshelf capability.', action: signOut, actionLabel: 'Sign out' });
  if (state === 'error') return h(AuthState, { title: 'Bookshelf unavailable', message: message || 'Access could not be verified. Try again later.' });
  return children(context, signOut, actions);
}

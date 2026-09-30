import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLogout, useMe } from '../api/hooks';

/** Display name with "Profile" and "Sign out". Without auth, just a link to the profile. */
export function UserMenu() {
  const me = useMe().data;
  const logout = useLogout();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!me) return null;
  // Without login there is no menu (nothing to sign out of): a compact initial that links to the
  // name form, so the header keeps its room on phones.
  if (!me.authRequired)
    return (
      <Link
        to="/profile"
        aria-label={`Profile (${me.user.displayName})`}
        title={me.user.displayName}
        className="btn-secondary ml-auto h-9 w-9 shrink-0 justify-center !px-0"
      >
        <span aria-hidden>{[...me.user.displayName][0]?.toUpperCase() ?? '?'}</span>
      </Link>
    );

  const signOut = () => {
    setOpen(false);
    logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) });
  };
  const item =
    'block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800';

  return (
    <div ref={root} className="relative ml-auto">
      <button
        type="button"
        className="btn-secondary max-w-[12rem]"
        aria-expanded={open}
        aria-controls="user-menu"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">{me.user.displayName}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div
          id="user-menu"
          className="absolute right-0 z-40 mt-1 w-48 rounded-lg border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-700 dark:bg-stone-900"
        >
          {me.user.email && (
            <p className="truncate px-3 py-2 text-xs text-stone-500 dark:text-stone-400">
              {me.user.email}
            </p>
          )}
          <Link to="/profile" className={item} onClick={() => setOpen(false)}>
            Profile
          </Link>
          <button type="button" className={item} onClick={signOut} disabled={logout.isPending}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

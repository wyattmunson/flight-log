import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useConfig } from '../api/hooks';
import { UserMenu } from './UserMenu';

const NAV = [
  { to: '/', label: 'Map', end: true },
  { to: '/flights', label: 'Flights' },
  { to: '/stats', label: 'Stats' },
  { to: '/flights/new', label: 'Add flight' },
  { to: '/import', label: 'Import' },
];

export function Layout() {
  const { pathname } = useLocation();
  const fullBleed = pathname === '/';
  const apiDocsUrl = useConfig().data?.apiDocsUrl;
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2 text-lg font-semibold">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            Flight Log
          </NavLink>
          <nav aria-label="Main" className="-mx-1 flex flex-1 gap-1 overflow-x-auto">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end ?? item.to === '/flights'}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${
                    isActive
                      ? 'bg-brand/10 text-brand-dark dark:bg-brand/20 dark:text-brand-light'
                      : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <UserMenu />
        </div>
      </header>
      <main
        id="main"
        className={
          fullBleed ? 'relative flex flex-1 flex-col' : 'mx-auto w-full max-w-7xl flex-1 px-4 py-6'
        }
      >
        <Outlet />
      </main>
      <footer className="border-t border-stone-200 bg-white px-4 py-2 text-xs text-stone-500 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400">
        <div className="mx-auto max-w-7xl">
          Airport data:{' '}
          <a
            className="underline"
            href="https://ourairports.com/data/"
            target="_blank"
            rel="noreferrer"
          >
            OurAirports
          </a>{' '}
          (public domain). Airline data:{' '}
          <a
            className="underline"
            href="https://openflights.org/data.html"
            target="_blank"
            rel="noreferrer"
          >
            OpenFlights
          </a>{' '}
          (
          <a
            className="underline"
            href="https://opendatacommons.org/licenses/odbl/1-0/"
            target="_blank"
            rel="noreferrer"
          >
            ODbL
          </a>
          ). Map: ©{' '}
          <a className="underline" href="https://openfreemap.org" target="_blank" rel="noreferrer">
            OpenFreeMap
          </a>{' '}
          ©{' '}
          <a
            className="underline"
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            OpenStreetMap contributors
          </a>
          .
          {apiDocsUrl && (
            <>
              {' '}
              <a className="underline" href={apiDocsUrl} target="_blank" rel="noreferrer">
                API docs
              </a>
            </>
          )}
          <span className="float-right" title="App version">
            v{__APP_VERSION__}
          </span>
        </div>
      </footer>
    </div>
  );
}

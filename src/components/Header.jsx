import { useLocation } from 'react-router-dom';
import { Menu, Bell } from 'lucide-react';
import { useApp } from '../context/AppContext';

const pageTitles = {
  '/': { title: 'Dashboard', subtitle: 'Your business at a glance' },
  '/clients': { title: 'Clients', subtitle: 'Manage your client profiles' },
  '/bills': { title: 'Bills', subtitle: 'Manage invoices and payments' },
  '/entries': { title: 'Work Entries', subtitle: 'Log your work across bills' },
  '/todos': { title: 'To-Do / Tasks', subtitle: 'Track commitments and deadlines' },
  '/grid': { title: 'Bill Grid View', subtitle: 'Visual comparison of all bills' },
  '/settings': { title: 'Settings', subtitle: 'Profile and app preferences' },
};

export default function Header({ overdueCount = 0 }) {
  const { setSidebarOpen } = useApp();
  const location = useLocation();

  // Match dynamic routes
  const pathKey = Object.keys(pageTitles).find(k =>
    k === location.pathname || location.pathname.startsWith(k + '/')
  ) || '/';

  const { title, subtitle } = pageTitles[pathKey] || { title: 'FreelanceTrack', subtitle: '' };

  return (
    <header className="header">
      <div className="header-left">
        <button
          className="hamburger-btn"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
        >
          <Menu size={22} />
        </button>
        <div>
          <div className="header-title">{title}</div>
          {subtitle && <div className="header-subtitle">{subtitle}</div>}
        </div>
      </div>

      <div className="header-right">
        {overdueCount > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--danger-bg)', border: '1px solid var(--danger-border)',
            borderRadius: 'var(--radius-full)', padding: '4px 12px',
            fontSize: 12, color: 'var(--danger)', fontWeight: 600
          }}>
            <Bell size={13} />
            {overdueCount} overdue
          </div>
        )}
      </div>
    </header>
  );
}

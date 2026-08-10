import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, FileText, ClipboardList,
  Settings, LogOut, Briefcase, ChevronRight, CheckSquare
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { useToast } from './Toast';

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/' },
  { label: 'Clients', icon: Users, to: '/clients' },
  { label: 'Bills', icon: FileText, to: '/bills' },
  { label: 'Work Entries', icon: ClipboardList, to: '/entries' },
  { label: 'To-Do / Tasks', icon: CheckSquare, to: '/todos' },
  { label: 'Bill Grid View', icon: Briefcase, to: '/grid' },
];

const bottomItems = [
  { label: 'Settings', icon: Settings, to: '/settings' },
];

export default function Sidebar({ overdueCount = 0 }) {
  const { logout } = useAuth();
  const { profile, sidebarOpen, setSidebarOpen } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    toast('Logged out successfully', 'info');
    navigate('/login');
  };

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
        onClick={closeSidebar}
      />

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">💼</div>
          <div className="sidebar-logo-text">
            <h1>{profile?.businessName || 'FreelanceTrack'}</h1>
            <span>Work & Payment Manager</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          <span className="nav-section-label">Main Menu</span>

          {navItems.map(({ label, icon: Icon, to }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={closeSidebar}
            >
              <Icon className="nav-icon" size={18} />
              {label}
              {label === 'To-Do / Tasks' && overdueCount > 0 && (
                <span className="nav-badge">{overdueCount}</span>
              )}
            </NavLink>
          ))}

          <span className="nav-section-label" style={{ marginTop: 8 }}>Account</span>

          {bottomItems.map(({ label, icon: Icon, to }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={closeSidebar}
            >
              <Icon className="nav-icon" size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer / Logout */}
        <div className="sidebar-footer">
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, paddingLeft: 4 }}>
            {profile?.name || 'User'}
          </div>
          <button className="nav-item w-full" onClick={handleLogout} style={{ color: 'var(--danger)' }}>
            <LogOut size={18} />
            Log Out
          </button>
        </div>
      </aside>
    </>
  );
}

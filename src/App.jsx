import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { useApp } from './context/AppContext';
import { db } from './firebase/config';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { isOverdue } from './utils/helpers';

import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import Bills from './pages/Bills';
import BillDetail from './pages/BillDetail';
import WorkEntries from './pages/WorkEntries';
import Todos from './pages/Todos';
import Settings from './pages/Settings';
import BillGrid from './pages/BillGrid';
import EntryManager from './pages/EntryManager';

function ProtectedLayout() {
  const { user } = useAuth();
  const [overdueCount, setOverdueCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    const fetchOverdue = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'tasks'), where('userId', '==', user.uid), where('status', '==', 'Pending')));
        const count = snap.docs.filter(d => {
          const dl = d.data().deadline;
          return dl && isOverdue(dl);
        }).length;
        setOverdueCount(count);
      } catch (e) {}
    };
    fetchOverdue();
  }, [user]);

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="app-layout">
      <Sidebar overdueCount={overdueCount} />
      <div className="main-content">
        <Header overdueCount={overdueCount} />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:clientId" element={<Clients />} />
          <Route path="/bills" element={<Bills />} />
          <Route path="/bills/:billId" element={<BillDetail />} />
          <Route path="/bills/:billId/entries" element={<EntryManager />} />
          <Route path="/entries" element={<WorkEntries />} />
          <Route path="/todos" element={<Todos />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/grid" element={<BillGrid />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner" style={{ width: 40, height: 40 }} />
    </div>
  );

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/*" element={<ProtectedLayout />} />
    </Routes>
  );
}

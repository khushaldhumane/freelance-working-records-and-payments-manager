import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useNavigate } from 'react-router-dom';
import { formatCurrency, formatDate, getBillStatusBadge } from '../utils/helpers';
import { Search, Filter } from 'lucide-react';

const STATUS_COLORS = {
  Paid: '#22c55e', Partial: '#f59e0b', Unpaid: '#ef4444',
  Overdue: '#ef4444', Draft: '#8b90a7', Sent: '#38bdf8'
};

export default function BillGrid() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [bills, setBills] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clientFilter, setClientFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [billsSnap, clientsSnap] = await Promise.all([
        getDocs(query(collection(db, 'bills'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'clients'), where('userId', '==', user.uid))),
      ]);
      const billsData = billsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      billsData.sort((a, b) => (b.billDate?.seconds || 0) - (a.billDate?.seconds || 0));
      setBills(billsData);
      setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); toast('Failed to load', 'error'); }
    setLoading(false);
  };

  const clientName = (id) => clients.find(c => c.id === id)?.name || '—';

  const filtered = bills.filter(b => {
    const matchSearch = b.billNumber?.toLowerCase().includes(search.toLowerCase()) ||
      clientName(b.clientId).toLowerCase().includes(search.toLowerCase());
    const matchClient = clientFilter === 'All' || b.clientId === clientFilter;
    const matchStatus = statusFilter === 'All' || b.status === statusFilter;
    return matchSearch && matchClient && matchStatus;
  });

  const balance = (b) => (b.billTotal || 0) - (b.totalPaymentsReceived || 0);

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header">
        <div className="page-header-left">
          <h2>Bill Grid View</h2>
          <p>Visual overview of all bills side by side</p>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar" style={{ marginBottom: 24 }}>
        <div className="search-input-wrap" style={{ maxWidth: 280 }}>
          <Search size={15} />
          <input className="form-input" placeholder="Search bills…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="form-select" style={{ width: 'auto' }} value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
          <option value="All">All Clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="form-select" style={{ width: 'auto' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="All">All Status</option>
          {['Paid', 'Partial', 'Unpaid', 'Draft', 'Sent', 'Overdue'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-muted)' }}>
          {filtered.length} bill{filtered.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
            {status}
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" style={{ width: 36, height: 36 }} /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <h3>No bills to display</h3>
          <p>Create bills to see them in grid view</p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 16,
        }}>
          {filtered.map(b => {
            const bal = balance(b);
            const statusColor = STATUS_COLORS[b.status] || '#8b90a7';
            const progress = b.billTotal > 0 ? Math.min(100, ((b.totalPaymentsReceived || 0) / b.billTotal) * 100) : 0;

            return (
              <div
                key={b.id}
                onClick={() => navigate(`/bills/${b.id}`)}
                className="bill-grid-card"
                style={{
                  background: 'var(--bg-card)',
                  border: `1px solid var(--border-color)`,
                  borderTop: `3px solid ${statusColor}`,
                  borderRadius: 'var(--radius-lg)',
                  padding: 20,
                  cursor: 'pointer',
                  transition: 'all var(--transition-md)',
                  boxShadow: 'var(--shadow-card)',
                }}
              >
                {/* Bill # and Status */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{
                    fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 15,
                    color: 'var(--accent-light)',
                  }}>
                    {b.billNumber}
                  </span>
                  <span className={`badge ${getBillStatusBadge(b.status)}`}>{b.status}</span>
                </div>

                {/* Client */}
                <div style={{ marginBottom: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{clientName(b.clientId)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatDate(b.billDate)}</div>
                </div>

                <div style={{ height: 1, background: 'var(--border-color)', margin: '14px 0' }} />

                {/* Amounts */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Total</span>
                    <span style={{ fontWeight: 600, fontFamily: 'Space Grotesk' }}>{formatCurrency(b.billTotal || 0)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Received</span>
                    <span style={{ color: 'var(--success)', fontWeight: 500 }}>{formatCurrency(b.totalPaymentsReceived || 0)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{bal > 0 ? 'Due' : bal < 0 ? 'Credit' : 'Balance'}</span>
                    <span style={{ color: bal > 0 ? 'var(--danger)' : bal < 0 ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>
                      {bal === 0 ? '✓' : formatCurrency(Math.abs(bal))}
                    </span>
                  </div>
                </div>

                {/* Progress Bar - BUG fix: show for all bills, 100% when billTotal <= 0 */}
                {(() => {
                  const pct = b.billTotal > 0
                    ? Math.min(100, ((b.totalPaymentsReceived || 0) / b.billTotal) * 100)
                    : 100; // zero/negative bill = fully covered
                  return (
                    <div style={{ marginTop: 14 }}>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{
                          width: `${pct}%`,
                          background: pct >= 100 ? 'var(--success)' : pct > 0 ? 'var(--warning)' : 'var(--danger)',
                        }} />
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>
                        {Math.round(pct)}% paid
                      </div>
                    </div>
                  );
                })()}

                {/* BUG-23 fix: show BOTH carry-forward due and advance credit badges */}
                {b.carriedForwardDue > 0 && (
                  <div style={{
                    marginTop: 10, fontSize: 11, color: 'var(--warning)',
                    background: 'rgba(245,158,11,0.08)', borderRadius: 'var(--radius-sm)',
                    padding: '3px 8px', textAlign: 'center',
                  }}>
                    ↑ {formatCurrency(b.carriedForwardDue)} due carried in
                  </div>
                )}
                {b.carriedForwardAdvance > 0 && (
                  <div style={{
                    marginTop: 6, fontSize: 11, color: 'var(--success)',
                    background: 'rgba(34,197,94,0.08)', borderRadius: 'var(--radius-sm)',
                    padding: '3px 8px', textAlign: 'center',
                  }}>
                    ↓ {formatCurrency(b.carriedForwardAdvance)} advance credit
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

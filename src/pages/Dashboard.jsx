import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import {
  IndianRupee, TrendingUp, Clock, CheckCircle,
  AlertCircle, Calendar, ArrowRight, Users, FileText
} from 'lucide-react';
import { formatCurrency, formatDate, isOverdue, isToday, daysUntil, monthName, priorityBadge } from '../utils/helpers';
import { exportToExcel } from '../utils/excelExporter';

const CHART_COLORS = ['#6366f1', '#a855f7', '#22c55e', '#f59e0b', '#38bdf8', '#ef4444', '#06b6d4', '#ec4899'];

export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState([]);
  const [clients, setClients] = useState([]);
  const [entries, setEntries] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [dateFilter, setDateFilter] = useState('thisMonth');

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [billsSnap, clientsSnap, entriesSnap, tasksSnap] = await Promise.all([
        getDocs(query(collection(db, 'bills'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'clients'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'workEntries'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'tasks'), where('userId', '==', user.uid))),
      ]);
      const billsData = billsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const tasksData = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      billsData.sort((a, b) => (b.billDate?.seconds || 0) - (a.billDate?.seconds || 0));
      tasksData.sort((a, b) => (a.deadline?.seconds || 9999999999) - (b.deadline?.seconds || 9999999999));
      setBills(billsData);
      setClients(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setEntries(entriesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setTasks(tasksData);
    } catch (e) { console.error(e); toast('Failed to load dashboard: ' + e.message, 'error'); }
    setLoading(false);
  };

  // Filter bills by date range
  const getFilteredBills = () => {
    const now = new Date();
    return bills.filter(b => {
      const date = b.billDate?.toDate ? b.billDate.toDate() : new Date(b.billDate);
      switch (dateFilter) {
        case 'thisMonth': return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
        case 'lastMonth': {
          const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          return date.getMonth() === lm.getMonth() && date.getFullYear() === lm.getFullYear();
        }
        case 'thisYear': return date.getFullYear() === now.getFullYear();
        default: return true; // All time
      }
    });
  };

  const filteredBills = getFilteredBills();
  const clientName = (id) => clients.find(c => c.id === id)?.name || 'Unknown';

  // BUG-10 fix: Use entriesTotal (actual work done) not billTotal (which includes carry-forward)
  // to avoid double-counting when summing across bills
  const totalBilled = filteredBills.reduce((s, b) => s + (b.entriesTotal || 0), 0);
  const totalReceived = filteredBills.reduce((s, b) => s + (b.totalPaymentsReceived || 0), 0);
  const totalPending = filteredBills.reduce((s, b) => {
    const bal = (b.billTotal || 0) - (b.totalPaymentsReceived || 0);
    return s + (bal > 0 ? bal : 0);
  }, 0);
  const totalAdvance = filteredBills.reduce((s, b) => {
    const bal = (b.billTotal || 0) - (b.totalPaymentsReceived || 0);
    return s + (bal < 0 ? Math.abs(bal) : 0);
  }, 0);

  // Client-wise stats - also use entriesTotal to avoid double-counting
  const clientStats = clients.map(c => {
    const cBills = filteredBills.filter(b => b.clientId === c.id);
    const billed = cBills.reduce((s, b) => s + (b.entriesTotal || 0), 0);
    const received = cBills.reduce((s, b) => s + (b.totalPaymentsReceived || 0), 0);
    const pending = cBills.reduce((s, b) => {
      const bal = (b.billTotal || 0) - (b.totalPaymentsReceived || 0);
      return s + (bal > 0 ? bal : 0);
    }, 0);
    return { ...c, billed, received, pending, billCount: cBills.length };
  }).filter(c => c.billed > 0).sort((a, b) => b.billed - a.billed);

  // BUG-14 fix: Filter entries by date range for category chart
  const filteredEntries = entries.filter(e => {
    if (dateFilter === 'all') return true;
    const date = e.date?.toDate ? e.date.toDate() : new Date(e.date);
    const now = new Date();
    if (dateFilter === 'thisMonth') return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    if (dateFilter === 'lastMonth') {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return date.getMonth() === lm.getMonth() && date.getFullYear() === lm.getFullYear();
    }
    if (dateFilter === 'thisYear') return date.getFullYear() === now.getFullYear();
    return true;
  });

  // Category pie chart data — now respects date filter
  const categoryMap = {};
  filteredEntries.forEach(e => {
    if (!e.category) return;
    categoryMap[e.category] = (categoryMap[e.category] || 0) + (e.amount || 0);
  });
  const categoryData = Object.entries(categoryMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  // BUG-08 fix: Sort monthly keys chronologically before slicing last 6
  const monthlyMap = {};
  bills.forEach(b => {
    const date = b.billDate?.toDate ? b.billDate.toDate() : new Date(b.billDate);
    if (isNaN(date.getTime())) return; // skip invalid dates
    const key = `${date.getFullYear()}-${String(date.getMonth()).padStart(2, '0')}`;
    if (!monthlyMap[key]) monthlyMap[key] = {
      month: monthName(date.getMonth()) + ' ' + date.getFullYear().toString().slice(-2),
      billed: 0, received: 0
    };
    monthlyMap[key].billed += b.entriesTotal || 0; // use entriesTotal to avoid double-count
    monthlyMap[key].received += b.totalPaymentsReceived || 0;
  });
  // Sort keys ascending, take last 6 months
  const monthlyData = Object.keys(monthlyMap)
    .sort()
    .slice(-6)
    .map(k => monthlyMap[k]);

  // Upcoming tasks
  const upcomingTasks = tasks
    .filter(t => t.status === 'Pending')
    .sort((a, b) => {
      const da = a.deadline?.toDate ? a.deadline.toDate() : new Date(a.deadline || '2099-01-01');
      const db2 = b.deadline?.toDate ? b.deadline.toDate() : new Date(b.deadline || '2099-01-01');
      return da - db2;
    })
    .slice(0, 5);

  const overdueTaskCount = tasks.filter(t => t.status === 'Pending' && t.deadline && isOverdue(t.deadline)).length;

  // Recent bills
  const recentBills = [...bills].slice(0, 5);

  const customTooltip = ({ active, payload, label }) => {
    if (active && payload?.length) {
      return (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>{label}</p>
          {payload.map((p, i) => (
            <p key={i} style={{ color: p.color }}>{p.name}: {formatCurrency(p.value)}</p>
          ))}
        </div>
      );
    }
    return null;
  };

  if (loading) return (
    <div className="page-content loading-screen">
      <div className="spinner" style={{ width: 40, height: 40 }} />
      <p style={{ color: 'var(--text-muted)' }}>Loading dashboard…</p>
    </div>
  );

  return (
    <div className="page-content animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <h2>Dashboard</h2>
          <p>Your business overview at a glance</p>
        </div>
        <div className="page-header-actions">
          <select className="form-select" style={{ width: 'auto' }} value={dateFilter} onChange={e => setDateFilter(e.target.value)}>
            <option value="thisMonth">This Month</option>
            <option value="lastMonth">Last Month</option>
            <option value="thisYear">This Year</option>
            <option value="all">All Time</option>
          </select>
          <button className="btn btn-secondary" onClick={() => exportToExcel(filteredBills, clients, filteredEntries)}>
            ⬇ Export Excel
          </button>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid-4" style={{ marginBottom: 28 }}>
        <div className="stat-card" style={{ '--stat-color': 'var(--accent)', '--stat-bg': 'var(--accent-glow)', '--stat-border': 'rgba(99,102,241,0.2)' }}>
          <div className="stat-icon-wrap"><IndianRupee size={20} color="var(--accent-light)" /></div>
          <div className="stat-label">Total Billed</div>
          <div className="stat-value">{formatCurrency(totalBilled)}</div>
          <div className="stat-sub">{filteredBills.length} bills</div>
        </div>
        <div className="stat-card" style={{ '--stat-color': 'var(--success)', '--stat-bg': 'var(--success-bg)', '--stat-border': 'var(--success-border)' }}>
          <div className="stat-icon-wrap"><CheckCircle size={20} color="var(--success)" /></div>
          <div className="stat-label">Total Received</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(totalReceived)}</div>
          <div className="stat-sub">{totalBilled > 0 ? Math.round((totalReceived / totalBilled) * 100) : 0}% collected</div>
        </div>
        <div className="stat-card" style={{ '--stat-color': 'var(--danger)', '--stat-bg': 'var(--danger-bg)', '--stat-border': 'var(--danger-border)' }}>
          <div className="stat-icon-wrap"><AlertCircle size={20} color="var(--danger)" /></div>
          <div className="stat-label">Pending Amount</div>
          <div className="stat-value" style={{ color: totalPending > 0 ? 'var(--danger)' : 'var(--success)' }}>{formatCurrency(totalPending)}</div>
          <div className="stat-sub">{filteredBills.filter(b => (b.billTotal || 0) - (b.totalPaymentsReceived || 0) > 0).length} unpaid bills</div>
        </div>
        <div className="stat-card" style={{ '--stat-color': 'var(--purple)', '--stat-bg': 'var(--purple-bg)', '--stat-border': 'var(--purple-border)' }}>
          <div className="stat-icon-wrap"><TrendingUp size={20} color="var(--purple)" /></div>
          <div className="stat-label">Advance Credit</div>
          <div className="stat-value" style={{ color: 'var(--purple)' }}>{formatCurrency(totalAdvance)}</div>
          <div className="stat-sub">{clients.length} clients</div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid-2" style={{ marginBottom: 24, gap: 24 }}>
        {/* Monthly Revenue Bar Chart */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Monthly Revenue</span>
          </div>
          <div className="card-body" style={{ padding: '16px 20px' }}>
            {monthlyData.length === 0 ? (
              <div className="empty-state" style={{ padding: '30px 0' }}><p>No data yet</p></div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={monthlyData} barGap={4}>
                  <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={customTooltip} />
                  <Bar dataKey="billed" name="Billed" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="received" name="Received" fill="var(--success)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Category Pie Chart */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Earnings by Category</span>
          </div>
          <div className="card-body" style={{ padding: '16px 20px' }}>
            {categoryData.length === 0 ? (
              <div className="empty-state" style={{ padding: '30px 0' }}><p>No data yet</p></div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={categoryData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" nameKey="name">
                    {categoryData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13 }} />
                  <Legend formatter={(v) => <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Client Insights + Upcoming Tasks */}
      <div className="grid-2" style={{ gap: 24, marginBottom: 24 }}>
        {/* Client Insights */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Client Insights</span>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/clients')} style={{ fontSize: 12 }}>
              View All <ArrowRight size={13} />
            </button>
          </div>
          {clientStats.length === 0 ? (
            <div className="empty-state" style={{ padding: 30 }}>
              <Users size={24} /><p>No client data yet</p>
            </div>
          ) : (
            <div>
              {clientStats.slice(0, 6).map((c, i) => (
                <div key={c.id} style={{
                  padding: '14px 20px',
                  borderBottom: i < Math.min(clientStats.length, 6) - 1 ? '1px solid var(--border-color)' : 'none',
                  cursor: 'pointer',
                }} onClick={() => navigate(`/clients/${c.id}`)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                      background: `linear-gradient(135deg, ${CHART_COLORS[i % CHART_COLORS.length]}, ${CHART_COLORS[(i + 1) % CHART_COLORS.length]})`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 700, color: 'white',
                    }}>
                      {c.name?.charAt(0)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }} className="truncate">{c.name}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 700, fontFamily: 'Space Grotesk', fontSize: 14 }}>{formatCurrency(c.billed)}</div>
                      {c.pending > 0 && <div style={{ fontSize: 11, color: 'var(--danger)' }}>Due: {formatCurrency(c.pending)}</div>}
                    </div>
                  </div>
                  {/* Mini progress bar */}
                  <div className="progress-bar">
                    <div className="progress-fill" style={{
                      width: `${c.billed > 0 ? Math.min(100, (c.received / c.billed) * 100) : 0}%`,
                      background: c.pending > 0 ? 'var(--warning)' : 'var(--success)',
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    <span>Received: {formatCurrency(c.received)}</span>
                    <span>{c.billed > 0 ? Math.round((c.received / c.billed) * 100) : 0}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Tasks + Recent Bills */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Upcoming Tasks */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">
                Upcoming Tasks
                {overdueTaskCount > 0 && (
                  <span style={{ marginLeft: 8, background: 'var(--danger)', color: 'white', borderRadius: 'var(--radius-full)', padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>
                    {overdueTaskCount} overdue
                  </span>
                )}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/todos')} style={{ fontSize: 12 }}>
                View All <ArrowRight size={13} />
              </button>
            </div>
            {upcomingTasks.length === 0 ? (
              <div style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                🎉 No pending tasks!
              </div>
            ) : (
              <div>
                {upcomingTasks.map((task, i) => {
                  const overdue = task.deadline && isOverdue(task.deadline);
                  const dueToday = task.deadline && isToday(task.deadline);
                  const days = daysUntil(task.deadline);
                  return (
                    <div key={task.id} style={{
                      padding: '12px 20px',
                      borderBottom: i < upcomingTasks.length - 1 ? '1px solid var(--border-color)' : 'none',
                      borderLeft: `3px solid ${overdue ? 'var(--danger)' : dueToday ? 'var(--warning)' : 'transparent'}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 500 }} className="truncate">{task.title}</div>
                          {task.clientName && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>👤 {task.clientName}</div>}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0, fontSize: 11 }}>
                          {task.deadline && (
                            <div style={{ color: overdue ? 'var(--danger)' : dueToday ? 'var(--warning)' : 'var(--text-muted)' }}>
                              {overdue ? `⚠ ${Math.abs(days)}d overdue` : dueToday ? '📅 Today' : task.deadline ? formatDate(task.deadline) : ''}
                            </div>
                          )}
                          <span className={`badge ${priorityBadge(task.priority)}`} style={{ marginTop: 4 }}>{task.priority}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Bills */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Recent Bills</span>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/bills')} style={{ fontSize: 12 }}>
                View All <ArrowRight size={13} />
              </button>
            </div>
            {recentBills.length === 0 ? (
              <div style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>No bills yet</div>
            ) : (
              <div>
                {recentBills.map((b, i) => {
                  const balance = (b.billTotal || 0) - (b.totalPaymentsReceived || 0);
                  return (
                    <div key={b.id} style={{
                      padding: '12px 20px',
                      borderBottom: i < recentBills.length - 1 ? '1px solid var(--border-color)' : 'none',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      cursor: 'pointer',
                    }} onClick={() => navigate(`/bills/${b.id}`)}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent-light)', fontFamily: 'Space Grotesk' }}>{b.billNumber}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{clientName(b.clientId)}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{formatCurrency(b.billTotal || 0)}</div>
                        <div style={{ fontSize: 11, color: balance > 0 ? 'var(--danger)' : 'var(--success)' }}>
                          {balance > 0 ? `Due: ${formatCurrency(balance)}` : '✓ Settled'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

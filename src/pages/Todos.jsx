import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, getDocs, query, where, orderBy, serverTimestamp, Timestamp
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import {
  Plus, Search, CheckSquare, Square, Trash2, Edit2,
  AlertCircle, Clock, CheckCircle, Calendar, Flag
} from 'lucide-react';
import { formatDate, formatDateInput, today, isOverdue, isToday, daysUntil, priorityBadge } from '../utils/helpers';

const PRIORITIES = ['High', 'Medium', 'Low'];
const FILTERS = ['All', 'Pending', 'Overdue', 'Due Today', 'Completed'];
const emptyForm = { title: '', deadline: '', priority: 'Medium', description: '', clientName: '' };

export default function Todos() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('Pending');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModal, setDeleteModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchTasks(); }, []);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'tasks'), where('userId', '==', user.uid));
      const snap = await getDocs(q);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setTasks(data);
    } catch (e) { console.error(e); toast('Failed to load tasks: ' + e.message, 'error'); }
    setLoading(false);
  };

  const openAdd = () => { setEditing(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (t) => {
    setEditing(t);
    setForm({
      title: t.title,
      deadline: formatDateInput(t.deadline?.toDate ? t.deadline.toDate() : new Date(t.deadline)),
      priority: t.priority,
      description: t.description || '',
      clientName: t.clientName || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast('Task title is required', 'error'); return; }
    setSaving(true);
    try {
      const data = {
        title: form.title,
        deadline: form.deadline ? Timestamp.fromDate(new Date(form.deadline)) : null,
        priority: form.priority,
        description: form.description,
        clientName: form.clientName,
        status: 'Pending',
      };
      if (editing) {
        await updateDoc(doc(db, 'tasks', editing.id), { ...data, updatedAt: serverTimestamp() });
        toast('Task updated', 'success');
      } else {
        await addDoc(collection(db, 'tasks'), { ...data, userId: user.uid, createdAt: serverTimestamp() });
        toast('Task added', 'success');
      }
      setModalOpen(false);
      fetchTasks();
    } catch (e) { toast('Failed to save task', 'error'); }
    setSaving(false);
  };

  const toggleComplete = async (task) => {
    const newStatus = task.status === 'Completed' ? 'Pending' : 'Completed';
    try {
      await updateDoc(doc(db, 'tasks', task.id), { status: newStatus, updatedAt: serverTimestamp() });
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
      toast(newStatus === 'Completed' ? 'Task completed! ✅' : 'Marked as pending', 'success');
    } catch (e) { toast('Failed to update', 'error'); }
  };

  const handleDelete = async () => {
    try {
      await deleteDoc(doc(db, 'tasks', deleteModal.id));
      toast('Task deleted', 'success');
      setDeleteModal(null);
      fetchTasks();
    } catch (e) { toast('Failed to delete', 'error'); }
  };

  const getDeadlineText = (task) => {
    if (!task.deadline) return null;
    const days = daysUntil(task.deadline);
    if (days === null) return null;
    if (days < 0) return { text: `Overdue by ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''}`, color: 'var(--danger)' };
    if (days === 0) return { text: 'Due Today', color: 'var(--warning)' };
    if (days === 1) return { text: 'Due Tomorrow', color: 'var(--warning)' };
    return { text: `Due in ${days} days`, color: 'var(--text-muted)' };
  };

  const filtered = tasks.filter(t => {
    const matchSearch = t.title?.toLowerCase().includes(search.toLowerCase()) ||
      t.clientName?.toLowerCase().includes(search.toLowerCase());
    const matchFilter = (() => {
      switch (filter) {
        case 'Pending': return t.status === 'Pending';
        case 'Completed': return t.status === 'Completed';
        case 'Overdue': return t.status === 'Pending' && t.deadline && isOverdue(t.deadline);
        case 'Due Today': return t.status === 'Pending' && t.deadline && isToday(t.deadline);
        default: return true;
      }
    })();
    return matchSearch && matchFilter;
  }).sort((a, b) => {
    // BUG-19 fix: Sort overdue first → then by deadline date → then by priority
    const order = { High: 0, Medium: 1, Low: 2 };
    const aOverdue = a.status === 'Pending' && a.deadline && isOverdue(a.deadline) ? 1 : 0;
    const bOverdue = b.status === 'Pending' && b.deadline && isOverdue(b.deadline) ? 1 : 0;
    if (aOverdue !== bOverdue) return bOverdue - aOverdue; // overdue first

    if (a.deadline && b.deadline) {
      const da = a.deadline?.toDate ? a.deadline.toDate() : new Date(a.deadline);
      const db2 = b.deadline?.toDate ? b.deadline.toDate() : new Date(b.deadline);
      return da - db2;
    }
    if (a.deadline && !b.deadline) return -1;
    if (!a.deadline && b.deadline) return 1;
    return (order[a.priority] ?? 3) - (order[b.priority] ?? 3);
  });

  const overdueCount = tasks.filter(t => t.status === 'Pending' && t.deadline && isOverdue(t.deadline)).length;
  const pendingCount = tasks.filter(t => t.status === 'Pending').length;
  const doneCount = tasks.filter(t => t.status === 'Completed').length;

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header">
        <div className="page-header-left">
          <h2>To-Do / Tasks</h2>
          <p>{pendingCount} pending · {doneCount} completed{overdueCount > 0 ? ` · ⚠️ ${overdueCount} overdue` : ''}</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={openAdd}><Plus size={16} /> Add Task</button>
        </div>
      </div>

      {/* Stats row */}
      {tasks.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { label: 'Total', count: tasks.length, color: 'var(--accent-light)' },
            { label: 'Pending', count: pendingCount, color: 'var(--warning)' },
            { label: 'Overdue', count: overdueCount, color: 'var(--danger)' },
            { label: 'Completed', count: doneCount, color: 'var(--success)' },
          ].map(s => (
            <div key={s.label} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)', padding: '10px 18px',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: 'Space Grotesk' }}>{s.count}</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="filter-bar" style={{ marginBottom: 20 }}>
        <div className="tabs">
          {FILTERS.map(f => (
            <button key={f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f}
              {f === 'Overdue' && overdueCount > 0 && (
                <span style={{ marginLeft: 4, background: 'var(--danger)', color: 'white', borderRadius: 'var(--radius-full)', padding: '0 5px', fontSize: 10, fontWeight: 700 }}>
                  {overdueCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="search-input-wrap" style={{ maxWidth: 260 }}>
          <Search size={15} />
          <input className="form-input" placeholder="Search tasks…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Task List */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><CheckSquare size={28} /></div>
          <h3>No tasks found</h3>
          <p>{filter === 'Pending' ? 'All caught up! 🎉' : 'No tasks in this category'}</p>
          <button className="btn btn-primary" onClick={openAdd}><Plus size={15} /> Add Task</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(task => {
            const deadlineInfo = getDeadlineText(task);
            const overdue = task.status === 'Pending' && task.deadline && isOverdue(task.deadline);
            const done = task.status === 'Completed';
            return (
              <div key={task.id} className="card" style={{
                padding: '16px 20px',
                borderLeft: `3px solid ${overdue ? 'var(--danger)' : done ? 'var(--success)' : task.priority === 'High' ? 'var(--warning)' : 'var(--border-color)'}`,
                opacity: done ? 0.6 : 1,
                transition: 'all var(--transition-fast)',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  {/* Checkbox */}
                  <button
                    onClick={() => toggleComplete(task)}
                    style={{ background: 'none', border: 'none', padding: 2, marginTop: 2, color: done ? 'var(--success)' : 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}
                  >
                    {done ? <CheckCircle size={20} /> : <Square size={20} />}
                  </button>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{
                        fontSize: 15, fontWeight: 600,
                        color: done ? 'var(--text-muted)' : 'var(--text-primary)',
                        textDecoration: done ? 'line-through' : 'none',
                      }}>{task.title}</span>
                      <span className={`badge ${priorityBadge(task.priority)}`}>
                        <Flag size={10} /> {task.priority}
                      </span>
                      {task.clientName && (
                        <span className="badge badge-muted" style={{ fontSize: 10 }}>👤 {task.clientName}</span>
                      )}
                    </div>

                    {task.description && (
                      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.4 }}>{task.description}</p>
                    )}

                    {task.deadline && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <Calendar size={12} />
                        <span style={{ color: 'var(--text-muted)' }}>{formatDate(task.deadline)}</span>
                        {deadlineInfo && !done && (
                          <span style={{ color: deadlineInfo.color, fontWeight: 600 }}>· {deadlineInfo.text}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className="btn btn-ghost btn-icon" onClick={() => openEdit(task)}><Edit2 size={14} /></button>
                    <button className="btn btn-ghost btn-icon" style={{ color: 'var(--danger)' }} onClick={() => setDeleteModal(task)}><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Task' : 'Add New Task'} size="md"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} />Saving…</> : (editing ? 'Save Changes' : 'Add Task')}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">Task Title <span className="required">*</span></label>
          <input className="form-input" placeholder="e.g. Deliver homepage design" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
        </div>
        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Deadline</label>
            <input type="date" className="form-input" value={form.deadline} onChange={e => setForm(p => ({ ...p, deadline: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Priority</label>
            <select className="form-select" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Client (optional)</label>
            <input className="form-input" placeholder="e.g. Rahul Sharma" value={form.clientName} onChange={e => setForm(p => ({ ...p, clientName: e.target.value }))} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Notes / Description</label>
          <textarea className="form-textarea" placeholder="What exactly was committed…" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
        </div>
      </Modal>

      {/* Delete Confirm */}
      <Modal isOpen={!!deleteModal} onClose={() => setDeleteModal(null)} title="Delete Task" size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleteModal(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
          </>
        }
      >
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Delete "<strong style={{ color: 'var(--text-primary)' }}>{deleteModal?.title}</strong>"?</p>
      </Modal>
    </div>
  );
}

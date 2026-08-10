import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, getDocs, query, where, serverTimestamp
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import {
  Plus, Search, Edit2, Trash2, Users, Phone,
  Mail, Building2, Eye, ChevronRight
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const emptyForm = { name: '', company: '', phone: '', email: '', notes: '' };

export default function Clients() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModal, setDeleteModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchClients(); }, []);

  const fetchClients = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'clients'),
        where('userId', '==', user.uid)
      );
      const snap = await getDocs(q);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort client-side to avoid composite index requirement
      data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setClients(data);
    } catch (e) { console.error(e); toast('Failed to load clients: ' + e.message, 'error'); }
    setLoading(false);
  };

  const openAdd = () => { setEditing(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (c) => { setEditing(c); setForm({ name: c.name, company: c.company || '', phone: c.phone || '', email: c.email || '', notes: c.notes || '' }); setModalOpen(true); };

  const handleSave = async () => {
    if (!form.name.trim()) { toast('Client name is required', 'error'); return; }
    setSaving(true);
    try {
      if (editing) {
        await updateDoc(doc(db, 'clients', editing.id), { ...form, updatedAt: serverTimestamp() });
        toast('Client updated', 'success');
      } else {
        await addDoc(collection(db, 'clients'), { ...form, userId: user.uid, balance: 0, createdAt: serverTimestamp() });
        toast('Client added', 'success');
      }
      setModalOpen(false);
      fetchClients();
    } catch (e) { toast('Failed to save client', 'error'); }
    setSaving(false);
  };

  const handleDelete = async () => {
    try {
      await deleteDoc(doc(db, 'clients', deleteModal.id));
      toast('Client deleted', 'success');
      setDeleteModal(null);
      fetchClients();
    } catch (e) { toast('Failed to delete', 'error'); }
  };

  const filtered = clients.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.company?.toLowerCase().includes(search.toLowerCase())
  );

  const handleField = (f, v) => setForm(p => ({ ...p, [f]: v }));

  return (
    <div className="page-content animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <h2>Clients</h2>
          <p>{clients.length} client{clients.length !== 1 ? 's' : ''} total</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={openAdd}>
            <Plus size={16} /> Add Client
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="filter-bar">
        <div className="search-input-wrap" style={{ maxWidth: 340 }}>
          <Search size={15} />
          <input
            className="form-input"
            placeholder="Search clients…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Client Grid */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div className="spinner" style={{ width: 32, height: 32 }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Users size={28} /></div>
          <h3>{search ? 'No clients found' : 'No clients yet'}</h3>
          <p>{search ? 'Try a different search term' : 'Add your first client to get started'}</p>
          {!search && <button className="btn btn-primary" onClick={openAdd}><Plus size={15} /> Add Client</button>}
        </div>
      ) : (
        <div className="grid-auto">
          {filtered.map(c => (
            <div
              key={c.id}
              className="card card-clickable"
              onClick={() => navigate(`/clients/${c.id}`)}
              style={{ padding: 22, cursor: 'pointer' }}
            >
              {/* Avatar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                <div style={{
                  width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg, var(--accent) 0%, var(--purple) 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, fontWeight: 700, color: 'white',
                  boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
                }}>
                  {c.name?.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }} className="truncate">{c.name}</div>
                  {c.company && <div style={{ fontSize: 13, color: 'var(--text-muted)' }} className="truncate">{c.company}</div>}
                </div>
              </div>

              {/* Details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {c.phone && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                    <Phone size={13} /> {c.phone}
                  </div>
                )}
                {c.email && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                    <Mail size={13} /> {c.email}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border-color)'
              }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={e => { e.stopPropagation(); openEdit(c); }}
                  >
                    <Edit2 size={13} /> Edit
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={e => { e.stopPropagation(); setDeleteModal(c); }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--accent-light)' }}>
                  View Bills <ChevronRight size={14} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Client' : 'Add New Client'}
        size="md"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} />Saving…</> : (editing ? 'Save Changes' : 'Add Client')}
            </button>
          </>
        }
      >
        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Name <span className="required">*</span></label>
            <input className="form-input" placeholder="e.g. Rahul Sharma" value={form.name} onChange={e => handleField('name', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Company / Project</label>
            <input className="form-input" placeholder="e.g. TechCorp Pvt Ltd" value={form.company} onChange={e => handleField('company', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input className="form-input" placeholder="e.g. 9876543210" value={form.phone} onChange={e => handleField('phone', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" placeholder="e.g. rahul@email.com" value={form.email} onChange={e => handleField('email', e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea className="form-textarea" placeholder="Any additional notes…" value={form.notes} onChange={e => handleField('notes', e.target.value)} />
        </div>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal
        isOpen={!!deleteModal}
        onClose={() => setDeleteModal(null)}
        title="Delete Client"
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleteModal(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={handleDelete}>Delete Client</button>
          </>
        }
      >
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          Are you sure you want to delete <strong style={{ color: 'var(--text-primary)' }}>{deleteModal?.name}</strong>?
          This will not delete their bills — those will remain in the system.
        </p>
      </Modal>
    </div>
  );
}

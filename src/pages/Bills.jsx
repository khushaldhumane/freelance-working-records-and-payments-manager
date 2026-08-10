import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, getDocs, query, where, serverTimestamp, Timestamp
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import {
  Plus, Search, Edit2, Trash2, FileText, Filter,
  ChevronRight, ArrowRight, IndianRupee, Calendar, User
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency, formatDate, formatDateInput, getBillStatusBadge, generateBillNumber, computeCarryForward, today } from '../utils/helpers';

const STATUS_OPTIONS = ['Draft', 'Sent', 'Partial', 'Paid', 'Overdue', 'Unpaid'];
const emptyForm = {
  clientId: '', billDate: today(), advanceReceived: '',
  notes: '', status: 'Draft'
};

export default function Bills() {
  const { user } = useAuth();
  const { profile } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [bills, setBills] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [clientFilter, setClientFilter] = useState('All');
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModal, setDeleteModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [carryForward, setCarryForward] = useState(false); // optional carry-forward toggle

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [billsSnap, clientsSnap] = await Promise.all([
        getDocs(query(collection(db, 'bills'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'clients'), where('userId', '==', user.uid)))
      ]);
      const billsData = billsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const clientsData = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      billsData.sort((a, b) => (b.billDate?.seconds || 0) - (a.billDate?.seconds || 0));
      clientsData.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setBills(billsData);
      setClients(clientsData);
    } catch (e) { console.error(e); toast('Failed to load bills: ' + e.message, 'error'); }
    setLoading(false);
  };

  const openAdd = () => { setEditing(null); setForm(emptyForm); setCarryForward(false); setModalOpen(true); };

  const openEdit = (b) => {
    setEditing(b);
    setForm({
      clientId: b.clientId,
      billDate: formatDateInput(b.billDate?.toDate ? b.billDate.toDate() : new Date(b.billDate)),
      advanceReceived: b.advanceReceived || '',
      notes: b.notes || '',
      status: b.status || 'Draft',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.clientId) { toast('Please select a client', 'error'); return; }
    setSaving(true);
    try {
      const billDate = Timestamp.fromDate(new Date(form.billDate));
      const advanceReceived = parseFloat(form.advanceReceived) || 0;

      if (editing) {
        // BUG-02 fix: recalculate billTotal when editing advance
        const entriesTotal = editing.entriesTotal || 0;
        const carriedForwardDue = editing.carriedForwardDue || 0;
        const carriedForwardAdvance = editing.carriedForwardAdvance || 0;
        const billTotal = entriesTotal + carriedForwardDue - carriedForwardAdvance - advanceReceived;
        const totalPaid = editing.totalPaymentsReceived || 0;
        let status = form.status;
        if (billTotal <= 0) status = 'Paid';
        else if (totalPaid >= billTotal) status = 'Paid';
        else if (totalPaid > 0) status = 'Partial';

        await updateDoc(doc(db, 'bills', editing.id), {
          clientId: form.clientId,
          billDate,
          advanceReceived,
          billTotal,
          status,
          notes: form.notes,
          updatedAt: serverTimestamp(),
        });
        toast('Bill updated', 'success');
      } else {
        // Query ALL bills fresh from Firestore to guarantee unique bill number
        const allBillsSnap = await getDocs(query(collection(db, 'bills'), where('userId', '==', user.uid)));
        const allBillNumbers = allBillsSnap.docs.map(d => d.data().billNumber).filter(Boolean);
        const billNumber = generateBillNumber(profile?.billPrefix || 'INV-', allBillNumbers);

        // Optional carry-forward: find previous bill for this client
        let carriedForwardDue = 0;
        let carriedForwardAdvance = 0;
        if (carryForward) {
          const clientBills = allBillsSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(b => b.clientId === form.clientId)
            .sort((a, b) => {
              const da = a.billDate?.toDate ? a.billDate.toDate() : new Date(a.billDate || 0);
              const db2 = b.billDate?.toDate ? b.billDate.toDate() : new Date(b.billDate || 0);
              return da - db2;
            });
          const prevBill = clientBills.length > 0 ? clientBills[clientBills.length - 1] : null;
          const cf = computeCarryForward(prevBill);
          carriedForwardDue = cf.carriedForwardDue;
          carriedForwardAdvance = cf.carriedForwardAdvance;
        }

        const initialBillTotal = carriedForwardDue - carriedForwardAdvance - advanceReceived;

        await addDoc(collection(db, 'bills'), {
          userId: user.uid,
          clientId: form.clientId,
          billNumber,
          billDate,
          status: form.status,
          advanceReceived,
          carriedForwardDue,
          carriedForwardAdvance,
          entriesTotal: 0,
          billTotal: initialBillTotal,
          totalPaymentsReceived: 0,
          notes: form.notes,
          createdAt: serverTimestamp(),
        });
        toast(`Bill ${billNumber} created`, 'success');
      }
      setModalOpen(false);
      fetchAll();
    } catch (e) {
      console.error(e);
      toast('Failed to save bill', 'error');
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    try {
      const billId = deleteModal.id;
      // BUG-01 fix: cascade delete orphan work entries and payments
      const [entriesSnap, paymentsSnap] = await Promise.all([
        getDocs(query(collection(db, 'workEntries'), where('billId', '==', billId))),
        getDocs(query(collection(db, 'payments'), where('billId', '==', billId))),
      ]);
      const deletePromises = [
        deleteDoc(doc(db, 'bills', billId)),
        ...entriesSnap.docs.map(d => deleteDoc(doc(db, 'workEntries', d.id))),
        ...paymentsSnap.docs.map(d => deleteDoc(doc(db, 'payments', d.id))),
      ];
      await Promise.all(deletePromises);
      toast('Bill and all related records deleted', 'success');
      setDeleteModal(null);
      fetchAll();
    } catch (e) { console.error(e); toast('Failed to delete', 'error'); }
  };

  const clientName = (id) => clients.find(c => c.id === id)?.name || 'Unknown';

  const filtered = bills.filter(b => {
    const matchSearch = clientName(b.clientId).toLowerCase().includes(search.toLowerCase()) ||
      b.billNumber?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'All' || b.status === statusFilter;
    const matchClient = clientFilter === 'All' || b.clientId === clientFilter;
    return matchSearch && matchStatus && matchClient;
  });

  const handleField = (f, v) => setForm(p => ({ ...p, [f]: v }));

  const netBalance = (b) => (b.billTotal || 0) - (b.totalPaymentsReceived || 0);

  return (
    <div className="page-content animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <h2>Bills</h2>
          <p>{bills.length} bill{bills.length !== 1 ? 's' : ''} total</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={openAdd}>
            <Plus size={16} /> New Bill
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <div className="search-input-wrap" style={{ maxWidth: 300 }}>
          <Search size={15} />
          <input className="form-input" placeholder="Search bills…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="form-select" style={{ width: 'auto' }} value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
          <option value="All">All Clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="form-select" style={{ width: 'auto' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="All">All Status</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Bills Table */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div className="spinner" style={{ width: 32, height: 32 }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><FileText size={28} /></div>
          <h3>No bills found</h3>
          <p>Create your first bill to start tracking payments</p>
          <button className="btn btn-primary" onClick={openAdd}><Plus size={15} /> New Bill</button>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bill #</th>
                <th>Client</th>
                <th>Date</th>
                <th>Total</th>
                <th>Received</th>
                <th>Balance</th>
                <th>Status</th>
                <th style={{ width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => {
                const balance = netBalance(b);
                return (
                  <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/bills/${b.id}`)}>
                    <td>
                      <span style={{ fontFamily: 'Space Grotesk', fontWeight: 600, color: 'var(--accent-light)' }}>
                        {b.billNumber}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%',
                          background: 'linear-gradient(135deg, var(--accent), var(--purple))',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, color: 'white', flexShrink: 0
                        }}>
                          {clientName(b.clientId).charAt(0)}
                        </div>
                        {clientName(b.clientId)}
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{formatDate(b.billDate)}</td>
                    <td className="font-semibold">{formatCurrency(b.billTotal || 0)}</td>
                    <td style={{ color: 'var(--success)' }}>{formatCurrency(b.totalPaymentsReceived || 0)}</td>
                    <td className={balance > 0 ? 'amount-negative' : balance < 0 ? 'amount-positive' : 'text-muted'}>
                      {balance > 0 ? `Due: ${formatCurrency(balance)}` : balance < 0 ? `Adv: ${formatCurrency(Math.abs(balance))}` : '✓ Settled'}
                    </td>
                    <td>
                      <span className={`badge ${getBillStatusBadge(b.status)}`}>{b.status}</span>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost btn-icon" onClick={() => openEdit(b)} title="Edit">
                          <Edit2 size={15} />
                        </button>
                        <button className="btn btn-ghost btn-icon" style={{ color: 'var(--danger)' }} onClick={() => setDeleteModal(b)} title="Delete">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.billNumber}` : 'Create New Bill'}
        size="md"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} />Saving…</> : (editing ? 'Save Changes' : 'Create Bill')}
            </button>
          </>
        }
      >
        <div className="form-grid form-grid-2">
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Client <span className="required">*</span></label>
            <select className="form-select" value={form.clientId} onChange={e => handleField('clientId', e.target.value)}>
              <option value="">— Select a client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ''}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Bill Date</label>
            <input type="date" className="form-input" value={form.billDate} onChange={e => handleField('billDate', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-select" value={form.status} onChange={e => handleField('status', e.target.value)}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Advance Received (₹)</label>
            <input type="number" className="form-input" placeholder="0" min="0" value={form.advanceReceived} onChange={e => handleField('advanceReceived', e.target.value)} />
            <span className="form-hint">Any advance paid by client before work starts for this billing cycle</span>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Notes / Terms</label>
          <textarea className="form-textarea" placeholder="Payment terms, delivery notes…" value={form.notes} onChange={e => handleField('notes', e.target.value)} />
        </div>

        {!editing && form.clientId && (() => {
          // Find most recent bill for this client
          const clientBills = bills.filter(b => b.clientId === form.clientId);
          const prevBill = [...clientBills].sort((a, b_) => {
            const da = a.billDate?.toDate ? a.billDate.toDate() : new Date(a.billDate);
            const db2 = b_.billDate?.toDate ? b_.billDate.toDate() : new Date(b_.billDate);
            return db2 - da;
          })[0];
          const { carriedForwardDue, carriedForwardAdvance } = computeCarryForward(prevBill);
          const hasBalance = carriedForwardDue > 0 || carriedForwardAdvance > 0;
          if (!hasBalance) return null;

          const label = carriedForwardDue > 0
            ? `Carry forward ${formatCurrency(carriedForwardDue)} unpaid balance from ${prevBill?.billNumber}`
            : `Carry forward ${formatCurrency(carriedForwardAdvance)} advance credit from ${prevBill?.billNumber}`;
          const color = carriedForwardDue > 0 ? 'var(--warning)' : 'var(--success)';
          const bg = carriedForwardDue > 0 ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.08)';
          const border = carriedForwardDue > 0 ? 'rgba(245,158,11,0.25)' : 'rgba(34,197,94,0.25)';

          return (
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, marginTop: 4,
              background: bg, border: `1px solid ${border}`,
              borderRadius: 'var(--radius-md)', padding: '12px 16px',
              cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={carryForward}
                onChange={e => setCarryForward(e.target.checked)}
                style={{ marginTop: 2, accentColor: color, width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color }}>{label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                  {carriedForwardDue > 0
                    ? 'This will add the outstanding amount to the new bill so it gets tracked together.'
                    : 'This will deduct the advance credit from the new bill total.'}
                </div>
              </div>
            </label>
          );
        })()}
      </Modal>

      {/* Delete Confirm */}
      <Modal isOpen={!!deleteModal} onClose={() => setDeleteModal(null)} title="Delete Bill" size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleteModal(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={handleDelete}>Delete Bill</button>
          </>
        }
      >
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          Delete bill <strong style={{ color: 'var(--text-primary)' }}>{deleteModal?.billNumber}</strong>? All entries in this bill will also be removed.
        </p>
      </Modal>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, getDoc, getDocs, query, where, serverTimestamp, Timestamp
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import { Plus, Search, Edit2, Trash2, ClipboardList, Filter } from 'lucide-react';
import { formatCurrency, formatDate, formatDateInput, today } from '../utils/helpers';

const emptyForm = {
  billId: '', clientId: '', date: today(),
  category: '', description: '', amount: ''
};

export default function WorkEntries() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [entries, setEntries] = useState([]);
  const [bills, setBills] = useState([]);
  const [clients, setClients] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModal, setDeleteModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customCategory, setCustomCategory] = useState('');

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [entriesSnap, billsSnap, clientsSnap] = await Promise.all([
        getDocs(query(collection(db, 'workEntries'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'bills'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'clients'), where('userId', '==', user.uid))),
      ]);
      const entriesData = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const billsData = billsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const clientsData = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      entriesData.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
      billsData.sort((a, b) => (b.billDate?.seconds || 0) - (a.billDate?.seconds || 0));
      clientsData.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setEntries(entriesData);
      setBills(billsData);
      setClients(clientsData);

      // Categories: merge profile categories + categories from existing entries
      const profileSnap = await getDoc(doc(db, 'profile', user.uid));
      const profileCats = profileSnap.exists() ? (profileSnap.data().categories || []) : [];
      const entryCats = [...new Set(entriesData.map(d => d.category).filter(Boolean))];
      const merged = [...new Set([...profileCats, ...entryCats])];
      setCategories(merged);
    } catch (e) { console.error(e); toast('Failed to load entries: ' + e.message, 'error'); }
    setLoading(false);
  };

  const clientName = (id) => clients.find(c => c.id === id)?.name || '—';
  const billNumber = (id) => bills.find(b => b.id === id)?.billNumber || '—';
  const clientBills = (clientId) => bills.filter(b => b.clientId === clientId);

  const openAdd = () => { setEditing(null); setForm(emptyForm); setShowCustom(false); setCustomCategory(''); setModalOpen(true); };
  const openEdit = (e) => {
    setEditing(e);
    setForm({
      billId: e.billId,
      clientId: e.clientId,
      date: formatDateInput(e.date?.toDate ? e.date.toDate() : new Date(e.date)),
      category: e.category,
      description: e.description,
      amount: e.amount,
    });
    setShowCustom(false);
    setCustomCategory('');
    setModalOpen(true);
  };

  const handleSave = async () => {
    const cat = showCustom ? customCategory.trim() : form.category;
    if (!form.billId) { toast('Please select a bill', 'error'); return; }
    if (!cat) { toast('Select or enter a category', 'error'); return; }
    if (!form.description.trim()) { toast('Description is required', 'error'); return; }
    if (!form.amount) { toast('Enter an amount', 'error'); return; }

    setSaving(true);
    try {
      const bill = bills.find(b => b.id === form.billId);
      const data = {
        billId: form.billId,
        clientId: bill?.clientId || form.clientId,
        userId: user.uid,
        date: Timestamp.fromDate(new Date(form.date)),
        category: cat,
        description: form.description,
        amount: parseFloat(form.amount),
      };

      if (editing) {
        await updateDoc(doc(db, 'workEntries', editing.id), { ...data, updatedAt: serverTimestamp() });

        // BUG-06 fix: if bill changed, recalculate BOTH old and new bill
        if (editing.billId && editing.billId !== form.billId) {
          const oldBill = bills.find(b => b.id === editing.billId);
          if (oldBill) {
            const oldEntries = await getDocs(query(collection(db, 'workEntries'), where('billId', '==', editing.billId), where('userId', '==', user.uid)));
            const oldEntriesTotal = oldEntries.docs.reduce((s, d) => s + (d.data().amount || 0), 0);
            const oldBillTotal = oldEntriesTotal - (oldBill.advanceReceived || 0);
            const oldPaid = oldBill.totalPaymentsReceived || 0;
            let oldStatus = oldBillTotal <= 0 ? 'Paid' : oldPaid >= oldBillTotal ? 'Paid' : oldPaid > 0 ? 'Partial' : 'Unpaid';
            await updateDoc(doc(db, 'bills', editing.billId), { entriesTotal: oldEntriesTotal, billTotal: oldBillTotal, status: oldStatus, updatedAt: serverTimestamp() });
          }
        }

        toast('Entry updated', 'success');
      } else {
        await addDoc(collection(db, 'workEntries'), { ...data, createdAt: serverTimestamp() });
        toast('Entry added', 'success');
      }

      // Recalculate current bill (bills are independent — no carry-forward)
      if (bill) {
        const allEntries = await getDocs(query(collection(db, 'workEntries'), where('billId', '==', form.billId), where('userId', '==', user.uid)));
        const entriesTotal = allEntries.docs.reduce((s, d) => s + (d.data().amount || 0), 0);
        const billTotal = entriesTotal - (bill.advanceReceived || 0);
        const totalPaid = bill.totalPaymentsReceived || 0;
        let status = billTotal <= 0 ? 'Paid' : totalPaid >= billTotal ? 'Paid' : totalPaid > 0 ? 'Partial' : 'Unpaid';
        await updateDoc(doc(db, 'bills', form.billId), { entriesTotal, billTotal, status, updatedAt: serverTimestamp() });
      }

      setModalOpen(false);
      fetchAll();
    } catch (e) { console.error(e); toast('Failed to save', 'error'); }
    setSaving(false);
  };

  const handleDelete = async () => {
    try {
      await deleteDoc(doc(db, 'workEntries', deleteModal.id));
      // BUG-07 fix: recalculate bill total AND status on delete
      const bill = bills.find(b => b.id === deleteModal.billId);
      if (bill) {
        const remaining = entries.filter(e => e.billId === deleteModal.billId && e.id !== deleteModal.id);
        const entriesTotal = remaining.reduce((s, e) => s + (e.amount || 0), 0);
        const billTotal = entriesTotal - (bill.advanceReceived || 0);
        const totalPaid = bill.totalPaymentsReceived || 0;
        let status = billTotal <= 0 ? 'Paid' : totalPaid >= billTotal ? 'Paid' : totalPaid > 0 ? 'Partial' : 'Unpaid';
        await updateDoc(doc(db, 'bills', deleteModal.billId), { entriesTotal, billTotal, status, updatedAt: serverTimestamp() });
      }
      toast('Entry deleted', 'success');
      setDeleteModal(null);
      fetchAll();
    } catch (e) { toast('Failed to delete', 'error'); }
  };

  const allCats = [...new Set([...categories, 'Web Design', 'Web Development', 'UI/UX Design', 'Logo Design', 'Bug Fix', 'Maintenance', 'Other'])];

  const filtered = entries.filter(e => {
    const matchSearch = e.description?.toLowerCase().includes(search.toLowerCase()) ||
      clientName(e.clientId).toLowerCase().includes(search.toLowerCase()) ||
      e.category?.toLowerCase().includes(search.toLowerCase());
    const matchClient = clientFilter === 'All' || e.clientId === clientFilter;
    const matchCat = categoryFilter === 'All' || e.category === categoryFilter;
    return matchSearch && matchClient && matchCat;
  });

  const totalAmount = filtered.reduce((s, e) => s + (e.amount || 0), 0);

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header">
        <div className="page-header-left">
          <h2>Work Entries</h2>
          <p>{entries.length} entries · {formatCurrency(entries.reduce((s, e) => s + (e.amount || 0), 0))} total</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={openAdd}><Plus size={16} /> Add Entry</button>
        </div>
      </div>

      <div className="filter-bar">
        <div className="search-input-wrap" style={{ maxWidth: 300 }}>
          <Search size={15} />
          <input className="form-input" placeholder="Search entries…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="form-select" style={{ width: 'auto' }} value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
          <option value="All">All Clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="form-select" style={{ width: 'auto' }} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="All">All Categories</option>
          {allCats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {filtered.length > 0 && (
          <div style={{ marginLeft: 'auto', fontFamily: 'Space Grotesk', fontWeight: 600, color: 'var(--accent-light)' }}>
            Showing: {formatCurrency(totalAmount)}
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><ClipboardList size={28} /></div>
          <h3>No entries found</h3>
          <p>Log your first work entry against a bill</p>
          <button className="btn btn-primary" onClick={openAdd}><Plus size={15} /> Add Entry</button>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Client</th>
                <th>Bill #</th>
                <th>Category</th>
                <th>Description</th>
                <th>Amount</th>
                <th style={{ width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id}>
                  <td style={{ color: 'var(--text-muted)', fontSize: 13, whiteSpace: 'nowrap' }}>{formatDate(e.date)}</td>
                  <td style={{ fontWeight: 500 }}>{clientName(e.clientId)}</td>
                  <td><span style={{ color: 'var(--accent-light)', fontFamily: 'Space Grotesk', fontSize: 13 }}>{billNumber(e.billId)}</span></td>
                  <td><span className="badge badge-accent" style={{ fontSize: 11 }}>{e.category}</span></td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13, maxWidth: 300 }} className="truncate">{e.description}</td>
                  <td className="font-semibold">{formatCurrency(e.amount)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-icon" onClick={() => openEdit(e)}><Edit2 size={14} /></button>
                      <button className="btn btn-ghost btn-icon" style={{ color: 'var(--danger)' }} onClick={() => setDeleteModal(e)}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Work Entry' : 'Add Work Entry'} size="md"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} />Saving…</> : (editing ? 'Save Changes' : 'Add Entry')}
            </button>
          </>
        }
      >
        {/* Client then Bill selector */}
        <div className="form-group">
          <label className="form-label">Client</label>
          <select className="form-select" value={form.clientId} onChange={e => setForm(p => ({ ...p, clientId: e.target.value, billId: '' }))}>
            <option value="">— Select a client first —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Select Bill <span className="required">*</span></label>
          <select className="form-select" value={form.billId} onChange={e => setForm(p => ({ ...p, billId: e.target.value }))} disabled={!form.clientId}>
            <option value="">— Select a bill —</option>
            {clientBills(form.clientId).map(b => (
              <option key={b.id} value={b.id}>{b.billNumber} · {formatDate(b.billDate)}</option>
            ))}
          </select>
          <span className="form-hint">You can add entries to any existing bill, including older ones</span>
        </div>

        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Date</label>
            <input type="date" className="form-input" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Category <span className="required">*</span></label>
            {!showCustom ? (
              <select className="form-select" value={form.category} onChange={e => {
                if (e.target.value === '__custom__') setShowCustom(true);
                else setForm(p => ({ ...p, category: e.target.value }));
              }}>
                <option value="">— Select —</option>
                {allCats.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="__custom__">+ Add custom…</option>
              </select>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="form-input" placeholder="Type category" value={customCategory} onChange={e => setCustomCategory(e.target.value)} />
                <button className="btn btn-secondary btn-sm" onClick={() => { setShowCustom(false); setCustomCategory(''); }}>✕</button>
              </div>
            )}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Work Description <span className="required">*</span></label>
          <textarea className="form-textarea" placeholder="Describe the work done in detail…" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Amount (₹) <span className="required">*</span></label>
          <input type="number" className="form-input" placeholder="0" min="0" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
        </div>
      </Modal>

      {/* Delete Confirm */}
      <Modal isOpen={!!deleteModal} onClose={() => setDeleteModal(null)} title="Delete Entry" size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleteModal(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
          </>
        }
      >
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          Delete this work entry? The bill total will be recalculated automatically.
        </p>
      </Modal>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, getDocs, getDoc, query, where,
  serverTimestamp, Timestamp
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import { ArrowLeft, Plus, Edit2, Trash2, IndianRupee } from 'lucide-react';
import { formatCurrency, formatDate, formatDateInput, today } from '../utils/helpers';

// ─── Default categories ─────────────────────────────────────
const DEFAULT_CATS = [
  'Web Design', 'Web Development', 'Mobile App', 'UI/UX Design',
  'Logo Design', 'Graphic Design', 'Content Writing', 'SEO',
  'Digital Marketing', 'Bug Fix', 'Maintenance', 'Consultation', 'Other'
];

const BLANK = { date: today(), category: '', description: '', amount: '' };

// ─── Helpers ────────────────────────────────────────────────
function toTimestamp(dateStr) {
  // dateStr is "YYYY-MM-DD" from <input type="date">
  const [y, m, d] = dateStr.split('-').map(Number);
  return Timestamp.fromDate(new Date(y, m - 1, d));
}

// ─── Main Component ─────────────────────────────────────────
export default function EntryManager() {
  const { billId } = useParams();
  const navigate   = useNavigate();
  const { user }   = useAuth();
  const { toast }  = useToast();

  // Data
  const [bill,     setBill]     = useState(null);
  const [client,   setClient]   = useState(null);
  const [entries,  setEntries]  = useState([]);
  const [cats,     setCats]     = useState(DEFAULT_CATS);
  const [loading,  setLoading]  = useState(true);

  // Form state (shared for add + edit)
  const [form,       setForm]       = useState(BLANK);
  const [customCat,  setCustomCat]  = useState('');
  const [showCustom, setShowCustom] = useState(false);

  // Modal flags
  const [addOpen,    setAddOpen]    = useState(false);
  const [editTarget, setEditTarget] = useState(null); // entry object
  const [delTarget,  setDelTarget]  = useState(null); // entry object

  const [busy, setBusy] = useState(false); // true while waiting for Firestore

  // ── Load bill + entries on mount ────────────────────────
  useEffect(() => {
    if (!billId) return;
    loadAll();
  }, [billId]);

  async function loadAll() {
    setLoading(true);
    try {
      // 1. Fetch bill
      const billSnap = await getDoc(doc(db, 'bills', billId));
      if (!billSnap.exists()) {
        toast('Bill not found', 'error');
        navigate('/bills');
        return;
      }
      const billData = { id: billSnap.id, ...billSnap.data() };
      setBill(billData);

      // 2. Fetch client (optional, don't block on failure)
      if (billData.clientId) {
        try {
          const cSnap = await getDoc(doc(db, 'clients', billData.clientId));
          if (cSnap.exists()) setClient({ id: cSnap.id, ...cSnap.data() });
        } catch (_) { /* client not critical */ }
      }

      // 3. Fetch entries
      await loadEntries();
    } catch (err) {
      console.error('loadAll failed:', err);
      toast('Failed to load bill: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  // Fetch ONLY entries — called after every add/edit/delete
  async function loadEntries() {
    const snap = await getDocs(
      query(
        collection(db, 'workEntries'),
        where('billId', '==', billId),
        where('userId', '==', user.uid)
      )
    );
    const list = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.date?.seconds || 0) - (b.date?.seconds || 0));
    setEntries(list);
    return list;
  }

  // Update bill totals after entries change
  async function syncBillTotals(freshEntries, billData) {
    const b = billData || bill;
    if (!b) return;
    const entriesTotal = freshEntries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const billTotal    = entriesTotal
      + (b.carriedForwardDue     || 0)
      - (b.carriedForwardAdvance || 0)
      - (b.advanceReceived       || 0);
    const paid = b.totalPaymentsReceived || 0;
    const status =
      billTotal <= 0              ? 'Paid'    :
      paid >= billTotal           ? 'Paid'    :
      paid > 0                    ? 'Partial' :
      b.status === 'Draft'        ? 'Draft'   : 'Unpaid';

    await updateDoc(doc(db, 'bills', billId), {
      entriesTotal, billTotal, status, updatedAt: serverTimestamp()
    });
    setBill(prev => ({ ...prev, entriesTotal, billTotal, status }));
  }

  // ── VALIDATE form ────────────────────────────────────────
  function validate() {
    const cat = showCustom ? customCat.trim() : form.category;
    if (!cat)                        { toast('Please select or enter a category', 'error'); return null; }
    if (!form.description.trim())    { toast('Description is required', 'error');           return null; }
    const amt = parseFloat(form.amount);
    if (isNaN(amt) || amt <= 0)      { toast('Enter a valid amount (greater than 0)', 'error'); return null; }
    return { cat, amt };
  }

  // ── ADD ENTRY ────────────────────────────────────────────
  async function handleAdd() {
    if (busy) return;
    const validated = validate();
    if (!validated) return;
    const { cat, amt } = validated;

    setBusy(true);
    try {
      // ── Wait for Firestore to confirm the write ──
      const ref = await addDoc(collection(db, 'workEntries'), {
        billId,
        clientId: bill?.clientId || '',
        userId:   user.uid,
        date:     toTimestamp(form.date),
        category: cat,
        description: form.description.trim(),
        amount:   amt,
        createdAt: serverTimestamp(),
      });
      console.log('Entry saved, id:', ref.id);

      // ── Firestore confirmed → show success ──
      toast('Entry added successfully ✓', 'success');
      closeAddModal();

      // ── Refresh list from DB ──
      const fresh = await loadEntries();
      await syncBillTotals(fresh, bill);
    } catch (err) {
      // Only reaches here if Firestore actually rejected the write
      console.error('addDoc failed:', err);
      toast('Failed to add entry: ' + err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  // ── EDIT ENTRY ───────────────────────────────────────────
  async function handleEdit() {
    if (busy || !editTarget) return;
    const validated = validate();
    if (!validated) return;
    const { cat, amt } = validated;

    setBusy(true);
    try {
      await updateDoc(doc(db, 'workEntries', editTarget.id), {
        date:     toTimestamp(form.date),
        category: cat,
        description: form.description.trim(),
        amount:   amt,
        updatedAt: serverTimestamp(),
      });
      toast('Entry updated ✓', 'success');
      setEditTarget(null);
      const fresh = await loadEntries();
      await syncBillTotals(fresh, bill);
    } catch (err) {
      console.error('updateDoc failed:', err);
      toast('Failed to update entry: ' + err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  // ── DELETE ENTRY ─────────────────────────────────────────
  async function handleDelete() {
    if (!delTarget) return;
    try {
      await deleteDoc(doc(db, 'workEntries', delTarget.id));
      toast('Entry deleted', 'success');
      setDelTarget(null);
      const fresh = await loadEntries();
      await syncBillTotals(fresh, bill);
    } catch (err) {
      toast('Failed to delete: ' + err.message, 'error');
    }
  }

  // ── Modal helpers ────────────────────────────────────────
  function openAdd() {
    setForm(BLANK);
    setCustomCat('');
    setShowCustom(false);
    setAddOpen(true);
  }

  function closeAddModal() {
    setAddOpen(false);
    setForm(BLANK);
    setCustomCat('');
    setShowCustom(false);
  }

  function openEdit(entry) {
    setForm({
      date:        formatDateInput(entry.date?.toDate ? entry.date.toDate() : new Date(entry.date)),
      category:    entry.category    || '',
      description: entry.description || '',
      amount:      String(entry.amount || ''),
    });
    setCustomCat('');
    setShowCustom(false);
    setEditTarget(entry);
  }

  // ── Shared form fields ───────────────────────────────────
  function FormFields() {
    return (
      <>
        <div className="form-grid form-grid-2">
          {/* Date */}
          <div className="form-group">
            <label className="form-label">Date <span className="required">*</span></label>
            <input
              type="date"
              className="form-input"
              value={form.date}
              onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
            />
          </div>

          {/* Category */}
          <div className="form-group">
            <label className="form-label">Category <span className="required">*</span></label>
            {showCustom ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="form-input"
                  placeholder="e.g. Video Editing"
                  value={customCat}
                  onChange={e => setCustomCat(e.target.value)}
                  autoFocus
                />
                <button className="btn btn-secondary btn-sm"
                  onClick={() => { setShowCustom(false); setCustomCat(''); }}>✕</button>
              </div>
            ) : (
              <select
                className="form-select"
                value={form.category}
                onChange={e => {
                  if (e.target.value === '__custom__') setShowCustom(true);
                  else setForm(p => ({ ...p, category: e.target.value }));
                }}
              >
                <option value="">— Select category —</option>
                {cats.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="__custom__">+ Add custom…</option>
              </select>
            )}
          </div>
        </div>

        {/* Description */}
        <div className="form-group">
          <label className="form-label">Work Description <span className="required">*</span></label>
          <textarea
            className="form-textarea"
            placeholder="Describe the work done in detail…"
            style={{ minHeight: 90 }}
            value={form.description}
            onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
          />
        </div>

        {/* Amount */}
        <div className="form-group">
          <label className="form-label">Amount (₹) <span className="required">*</span></label>
          <input
            type="number"
            className="form-input"
            placeholder="0.00"
            min="1"
            step="0.01"
            value={form.amount}
            onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
          />
        </div>
      </>
    );
  }

  // ── Loading / null guards ─────────────────────────────────
  if (loading) return (
    <div className="page-content" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
      <div className="spinner" style={{ width: 40, height: 40 }} />
    </div>
  );
  if (!bill) return null;

  const entriesTotal = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="page-content animate-fade-in">

      {/* Back button + title */}
      <div style={{ marginBottom: 24 }}>
        <button className="btn btn-ghost"
          onClick={() => navigate(`/bills/${billId}`)}
          style={{ marginBottom: 16, padding: '6px 0' }}>
          <ArrowLeft size={16} /> Back to Bill
        </button>

        <div className="page-header">
          <div className="page-header-left">
            <h2 style={{ marginBottom: 4 }}>Work Entries</h2>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>
              {bill.billNumber}
              {client?.name ? ` · ${client.name}` : ''}
            </p>
          </div>
          <div className="page-header-actions">
            <button className="btn btn-primary" onClick={openAdd}>
              <Plus size={16} /> Add Work Entry
            </button>
          </div>
        </div>
      </div>

      {/* Summary strip */}
      <div className="card" style={{ padding: '16px 24px', marginBottom: 24, display: 'flex', gap: 40 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Total Billed</div>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'Space Grotesk', color: 'var(--accent-light)' }}>
            <IndianRupee size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />
            {entriesTotal.toLocaleString('en-IN')}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Entries</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{entries.length}</div>
        </div>
      </div>

      {/* Entries list */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">All Entries</span>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            <Plus size={13} /> Add
          </button>
        </div>

        {entries.length === 0 ? (
          <div className="empty-state" style={{ padding: '60px 20px' }}>
            <div className="empty-state-icon"><Plus size={24} /></div>
            <h3>No entries yet</h3>
            <p>Click "Add Work Entry" to get started</p>
            <button className="btn btn-primary" onClick={openAdd} style={{ marginTop: 12 }}>
              <Plus size={16} /> Add First Entry
            </button>
          </div>
        ) : (
          <div>
            {entries.map((entry, i) => (
              <div key={entry.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 16,
                padding: '16px 20px',
                borderBottom: i < entries.length - 1 ? '1px solid var(--border-color)' : 'none',
              }}>
                {/* Left: info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span className="badge badge-accent" style={{ fontSize: 10 }}>
                      {entry.category}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {formatDate(entry.date)}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {entry.description}
                  </div>
                </div>

                {/* Right: amount + actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 16 }}>
                    {formatCurrency(entry.amount)}
                  </span>
                  <button className="btn btn-ghost btn-icon" title="Edit"
                    onClick={() => openEdit(entry)}>
                    <Edit2 size={14} />
                  </button>
                  <button className="btn btn-ghost btn-icon" title="Delete"
                    style={{ color: 'var(--danger)' }}
                    onClick={() => setDelTarget(entry)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}

            {/* Total footer */}
            <div style={{
              padding: '14px 20px',
              background: 'var(--bg-glass-light)',
              borderTop: '2px solid var(--border-color)',
              display: 'flex', justifyContent: 'space-between',
              fontWeight: 700, fontSize: 15,
            }}>
              <span>Total</span>
              <span style={{ color: 'var(--accent-light)' }}>{formatCurrency(entriesTotal)}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Add Modal ── */}
      <Modal
        isOpen={addOpen}
        onClose={closeAddModal}
        title="Add Work Entry"
        size="md"
        footer={
          <>
            <button className="btn btn-secondary" onClick={closeAddModal} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleAdd} disabled={busy}>
              {busy
                ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving to database…</>
                : 'Add Entry'}
            </button>
          </>
        }
      >
        <FormFields />
      </Modal>

      {/* ── Edit Modal ── */}
      <Modal
        isOpen={!!editTarget}
        onClose={() => setEditTarget(null)}
        title="Edit Work Entry"
        size="md"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setEditTarget(null)} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleEdit} disabled={busy}>
              {busy
                ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</>
                : 'Save Changes'}
            </button>
          </>
        }
      >
        <FormFields />
      </Modal>

      {/* ── Delete Confirm Modal ── */}
      <Modal
        isOpen={!!delTarget}
        onClose={() => setDelTarget(null)}
        title="Delete Entry"
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDelTarget(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={handleDelete}>Yes, Delete</button>
          </>
        }
      >
        <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          Delete <strong style={{ color: 'var(--text-primary)' }}>"{delTarget?.description}"</strong>
          {' '}({formatCurrency(delTarget?.amount || 0)})?<br />
          This cannot be undone.
        </p>
      </Modal>

    </div>
  );
}

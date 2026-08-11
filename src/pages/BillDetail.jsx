import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../firebase/config';
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, getDocs, query, where, serverTimestamp, Timestamp, setDoc, getDoc
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import {
  ArrowLeft, Plus, Edit2, Trash2,
  IndianRupee, FileText, Download,
  CheckCircle, Clock, AlertCircle
} from 'lucide-react';
import { formatCurrency, formatDate, formatDateInput, today } from '../utils/helpers';
import { generatePDF } from '../utils/pdfGenerator';

const PAYMENT_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Other'];
const DEFAULT_CATEGORIES = [
  'Web Design', 'Web Development', 'Mobile App', 'UI/UX Design',
  'Logo Design', 'Graphic Design', 'Content Writing', 'SEO',
  'Digital Marketing', 'Bug Fix', 'Maintenance', 'Consultation', 'Other'
];

const emptyEntry = { date: today(), category: '', description: '', amount: '' };
const emptyPayment = { date: today(), amount: '', mode: 'UPI', notes: '' };

export default function BillDetail() {
  const { billId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile } = useApp();
  const { toast } = useToast();

  /* ─── State ─────────────────────────────────────────────── */
  const [bill, setBill]         = useState(null);
  const [client, setClient]     = useState(null);
  const [entries, setEntries]   = useState([]);
  const [payments, setPayments] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [loading, setLoading]   = useState(true);

  // Modals
  const [entryModal, setEntryModal]           = useState(false);
  const [editEntry, setEditEntry]             = useState(null);   // entry object or null
  const [paymentModal, setPaymentModal]       = useState(false);
  const [deleteConfirm, setDeleteConfirm]     = useState(null);   // { type:'entry'|'payment', item }

  // Forms
  const [entryForm, setEntryForm]     = useState(emptyEntry);
  const [paymentForm, setPaymentForm] = useState(emptyPayment);
  const [customCat, setCustomCat]     = useState('');
  const [showCustom, setShowCustom]   = useState(false);

  const [saving, setSaving] = useState(false);
  const lock = useRef(false); // prevents double-submit

  /* ─── Fetch helpers ─────────────────────────────────────── */

  // Fetch ONLY the bill document
  const fetchBill = useCallback(async () => {
    const snap = await getDoc(doc(db, 'bills', billId));
    if (!snap.exists()) { toast('Bill not found', 'error'); navigate('/bills'); return null; }
    const data = { id: snap.id, ...snap.data() };
    setBill(data);
    return data;
  }, [billId]);

  // Fetch ONLY entries for this bill
  const fetchEntries = useCallback(async () => {
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
  }, [billId, user.uid]);

  // Fetch ONLY payments for this bill
  const fetchPayments = useCallback(async () => {
    const snap = await getDocs(
      query(
        collection(db, 'payments'),
        where('billId', '==', billId),
        where('userId', '==', user.uid)
      )
    );
    const list = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.date?.seconds || 0) - (b.date?.seconds || 0));
    setPayments(list);
    return list;
  }, [billId, user.uid]);

  // Initial load — fetch everything independently so one failure doesn't block others
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const billData = await fetchBill();
      if (!billData) return;

      // Load client, entries, payments, categories in parallel
      // Each is wrapped so a single failure doesn't kill the rest
      const [, , , profileData] = await Promise.allSettled([
        // Client
        (async () => {
          if (!billData.clientId) return;
          const s = await getDoc(doc(db, 'clients', billData.clientId));
          if (s.exists()) setClient({ id: s.id, ...s.data() });
        })(),
        // Entries
        fetchEntries(),
        // Payments
        fetchPayments(),
        // Profile / categories
        (async () => {
          const s = await getDoc(doc(db, 'profile', user.uid));
          return s.exists() ? s.data() : null;
        })(),
      ]);

      if (profileData.status === 'fulfilled' && profileData.value?.categories) {
        setCategories(profileData.value.categories);
      }
    } catch (e) {
      console.error('loadAll error:', e);
      toast('Failed to load bill details', 'error');
    } finally {
      setLoading(false);
    }
  }, [billId, user.uid, fetchBill, fetchEntries, fetchPayments]);

  useEffect(() => { loadAll(); }, [billId]);

  /* ─── Bill total recalculation ──────────────────────────── */
  // Uses freshly passed lists — never reads stale state
  const updateBillTotals = async (entriesList, paymentsList, billData) => {
    const b = billData || bill;
    if (!b) return;
    const entriesTotal        = entriesList.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const totalPaymentsReceived = paymentsList.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const billTotal = entriesTotal
      + (b.carriedForwardDue || 0)
      - (b.carriedForwardAdvance || 0)
      - (b.advanceReceived || 0);

    let status = b.status;
    if      (billTotal <= 0)                                          status = 'Paid';
    else if (totalPaymentsReceived >= billTotal)                       status = 'Paid';
    else if (totalPaymentsReceived > 0 && totalPaymentsReceived < billTotal) status = 'Partial';
    else if (totalPaymentsReceived === 0 && status !== 'Draft')        status = 'Unpaid';

    await updateDoc(doc(db, 'bills', billId), {
      entriesTotal, billTotal, totalPaymentsReceived, status,
      updatedAt: serverTimestamp()
    });
    setBill(prev => ({ ...prev, entriesTotal, billTotal, totalPaymentsReceived, status }));
  };

  /* ─── Work Entries ──────────────────────────────────────── */
  const handleAddEntry = async () => {
    if (lock.current) return;

    const cat = showCustom ? customCat.trim() : entryForm.category;
    if (!cat)                    { toast('Please select a category', 'error'); return; }
    if (!entryForm.description.trim()) { toast('Description is required', 'error'); return; }
    const amt = parseFloat(entryForm.amount);
    if (isNaN(amt) || amt <= 0) { toast('Enter a valid amount greater than 0', 'error'); return; }

    lock.current = true;
    setSaving(true);

    try {
      // ── Critical: save to Firestore ──
      await addDoc(collection(db, 'workEntries'), {
        billId,
        clientId: bill?.clientId || '',
        userId: user.uid,
        date: Timestamp.fromDate(new Date(`${entryForm.date}T00:00:00`)),
        category: cat,
        description: entryForm.description.trim(),
        amount: amt,
        createdAt: serverTimestamp(),
      });

      // ── Close modal + show success ──
      toast('Work entry added successfully', 'success');
      closeEntryModal();
    } catch (err) {
      console.error('addDoc(workEntries) failed:', err);
      toast('Failed to add entry: ' + (err.message || 'Unknown error'), 'error');
      setSaving(false);
      lock.current = false;
      return;
    }

    setSaving(false);
    lock.current = false;

    // ── Non-critical: refresh + recalc (after modal is already closed) ──
    try {
      const [freshEntries, freshPayments] = await Promise.all([fetchEntries(), fetchPayments()]);
      await updateBillTotals(freshEntries, freshPayments, bill);
    } catch (e) {
      console.warn('Post-save refresh failed (entries still saved):', e);
    }

    // ── Save custom category if new ──
    if (showCustom && cat && !categories.includes(cat)) {
      const updated = [...categories, cat];
      setCategories(updated);
      setDoc(doc(db, 'profile', user.uid), { categories: updated }, { merge: true })
        .catch(e => console.warn('Category save failed:', e));
    }
  };

  const handleEditEntry = async () => {
    if (lock.current || !editEntry) return;
    const cat = showCustom ? customCat.trim() : entryForm.category;
    if (!cat || !entryForm.description.trim()) { toast('Fill all required fields', 'error'); return; }
    const amt = parseFloat(entryForm.amount);
    if (isNaN(amt) || amt <= 0) { toast('Enter a valid amount', 'error'); return; }

    lock.current = true;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'workEntries', editEntry.id), {
        date: Timestamp.fromDate(new Date(`${entryForm.date}T00:00:00`)),
        category: cat,
        description: entryForm.description.trim(),
        amount: amt,
        updatedAt: serverTimestamp(),
      });
      toast('Entry updated', 'success');
      setEditEntry(null);
    } catch (err) {
      toast('Failed to update entry: ' + (err.message || ''), 'error');
    }
    setSaving(false);
    lock.current = false;

    try {
      const [freshEntries, freshPayments] = await Promise.all([fetchEntries(), fetchPayments()]);
      await updateBillTotals(freshEntries, freshPayments, bill);
    } catch (e) { console.warn('Refresh after edit failed:', e); }
  };

  const handleDeleteEntry = async (entry) => {
    try {
      await deleteDoc(doc(db, 'workEntries', entry.id));
      toast('Entry deleted', 'success');
      setDeleteConfirm(null);
      const [freshEntries, freshPayments] = await Promise.all([fetchEntries(), fetchPayments()]);
      await updateBillTotals(freshEntries, freshPayments, bill);
    } catch (e) { toast('Failed to delete entry', 'error'); }
  };

  /* ─── Payments ──────────────────────────────────────────── */
  const handleAddPayment = async () => {
    if (lock.current) return;
    const amt = parseFloat(paymentForm.amount);
    if (isNaN(amt) || amt <= 0) { toast('Enter a valid payment amount', 'error'); return; }

    lock.current = true;
    setSaving(true);
    try {
      await addDoc(collection(db, 'payments'), {
        billId,
        clientId: bill?.clientId || '',
        userId: user.uid,
        date: Timestamp.fromDate(new Date(`${paymentForm.date}T00:00:00`)),
        amount: amt,
        mode: paymentForm.mode,
        notes: paymentForm.notes.trim(),
        createdAt: serverTimestamp(),
      });
      toast('Payment recorded', 'success');
      setPaymentModal(false);
      setPaymentForm(emptyPayment);
    } catch (err) {
      toast('Failed to record payment: ' + (err.message || ''), 'error');
    }
    setSaving(false);
    lock.current = false;

    try {
      const [freshEntries, freshPayments] = await Promise.all([fetchEntries(), fetchPayments()]);
      await updateBillTotals(freshEntries, freshPayments, bill);
    } catch (e) { console.warn('Refresh after payment failed:', e); }
  };

  const handleDeletePayment = async (payment) => {
    try {
      await deleteDoc(doc(db, 'payments', payment.id));
      toast('Payment deleted', 'success');
      setDeleteConfirm(null);
      const [freshEntries, freshPayments] = await Promise.all([fetchEntries(), fetchPayments()]);
      await updateBillTotals(freshEntries, freshPayments, bill);
    } catch (e) { toast('Failed to delete payment', 'error'); }
  };

  /* ─── Helpers ───────────────────────────────────────────── */
  const closeEntryModal = () => {
    setEntryModal(false);
    setEditEntry(null);
    setEntryForm(emptyEntry);
    setCustomCat('');
    setShowCustom(false);
  };

  const openEditEntry = (entry) => {
    setEntryForm({
      date: formatDateInput(entry.date?.toDate ? entry.date.toDate() : new Date(entry.date)),
      category: entry.category || '',
      description: entry.description || '',
      amount: String(entry.amount || ''),
    });
    setShowCustom(false);
    setCustomCat('');
    setEditEntry(entry);
  };

  /* ─── Render guards ─────────────────────────────────────── */
  if (loading) return (
    <div className="page-content" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
      <div className="spinner" style={{ width: 40, height: 40 }} />
    </div>
  );
  if (!bill) return null;

  const balance = (bill.billTotal || 0) - (bill.totalPaymentsReceived || 0);
  const payPct  = bill.billTotal > 0
    ? Math.min(100, ((bill.totalPaymentsReceived || 0) / bill.billTotal) * 100)
    : 0;

  /* ─── Shared entry form fields ──────────────────────────── */
  const EntryFields = () => (
    <>
      <div className="form-grid form-grid-2">
        <div className="form-group">
          <label className="form-label">Date <span className="required">*</span></label>
          <input type="date" className="form-input"
            value={entryForm.date}
            onChange={e => setEntryForm(p => ({ ...p, date: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Category <span className="required">*</span></label>
          {!showCustom ? (
            <select className="form-select" value={entryForm.category}
              onChange={e => {
                if (e.target.value === '__custom__') { setShowCustom(true); }
                else setEntryForm(p => ({ ...p, category: e.target.value }));
              }}>
              <option value="">— Select —</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="__custom__">+ Add custom…</option>
            </select>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="form-input" placeholder="Custom category name"
                value={customCat} onChange={e => setCustomCat(e.target.value)} autoFocus />
              <button className="btn btn-secondary btn-sm"
                onClick={() => { setShowCustom(false); setCustomCat(''); }}>✕</button>
            </div>
          )}
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Work Description <span className="required">*</span></label>
        <textarea className="form-textarea" placeholder="Describe the work done…"
          value={entryForm.description}
          onChange={e => setEntryForm(p => ({ ...p, description: e.target.value }))}
          style={{ minHeight: 80 }} />
      </div>
      <div className="form-group">
        <label className="form-label">Amount (₹) <span className="required">*</span></label>
        <input type="number" className="form-input" placeholder="0" min="1"
          value={entryForm.amount}
          onChange={e => setEntryForm(p => ({ ...p, amount: e.target.value }))} />
      </div>
    </>
  );

  /* ─── JSX ───────────────────────────────────────────────── */
  return (
    <div className="page-content animate-fade-in">

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button className="btn btn-ghost" onClick={() => navigate('/bills')}
          style={{ marginBottom: 16, padding: '6px 0' }}>
          <ArrowLeft size={16} /> Back to Bills
        </button>
        <div className="page-header">
          <div className="page-header-left">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <h2 style={{ marginBottom: 0 }}>{bill.billNumber}</h2>
              <span className={`badge badge-lg ${
                bill.status === 'Paid' ? 'badge-success' :
                bill.status === 'Partial' ? 'badge-warning' :
                bill.status === 'Overdue' ? 'badge-danger' : 'badge-muted'}`}>
                {bill.status}
              </span>
            </div>
            <p>{client?.name}{client?.company ? ` — ${client.company}` : ''} · {formatDate(bill.billDate)}</p>
          </div>
          <div className="page-header-actions">
            <button className="btn btn-secondary"
              onClick={() => generatePDF(bill, client, entries, payments, profile)}>
              <Download size={15} /> Download PDF
            </button>
            <button className="btn btn-primary" onClick={() => navigate(`/bills/${billId}/entries`)}>
              <Plus size={16} /> Manage Work Entries
            </button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid-4" style={{ marginBottom: 28 }}>
        <div className="stat-card" style={{ '--stat-color':'var(--accent)', '--stat-bg':'var(--accent-glow)', '--stat-border':'rgba(99,102,241,0.2)' }}>
          <div className="stat-icon-wrap"><IndianRupee size={20} color="var(--accent-light)" /></div>
          <div className="stat-label">Bill Total</div>
          <div className="stat-value">{formatCurrency(bill.billTotal || 0)}</div>
        </div>
        <div className="stat-card" style={{ '--stat-color':'var(--success)', '--stat-bg':'var(--success-bg)', '--stat-border':'var(--success-border)' }}>
          <div className="stat-icon-wrap"><CheckCircle size={20} color="var(--success)" /></div>
          <div className="stat-label">Amount Received</div>
          <div className="stat-value" style={{ color:'var(--success)' }}>{formatCurrency(bill.totalPaymentsReceived || 0)}</div>
          <div className="stat-sub">{payments.length} payment{payments.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="stat-card" style={{ '--stat-color': balance > 0 ? 'var(--danger)' : 'var(--success)', '--stat-bg': balance > 0 ? 'var(--danger-bg)' : 'var(--success-bg)', '--stat-border': balance > 0 ? 'var(--danger-border)' : 'var(--success-border)' }}>
          <div className="stat-icon-wrap"><AlertCircle size={20} color={balance > 0 ? 'var(--danger)' : 'var(--success)'} /></div>
          <div className="stat-label">{balance > 0 ? 'Balance Due' : balance < 0 ? 'Advance Credit' : 'Balance'}</div>
          <div className="stat-value" style={{ color: balance > 0 ? 'var(--danger)' : balance < 0 ? 'var(--success)' : 'var(--text-primary)' }}>
            {balance === 0 ? '✓ Settled' : formatCurrency(Math.abs(balance))}
          </div>
        </div>
        <div className="stat-card" style={{ '--stat-color':'var(--purple)', '--stat-bg':'var(--purple-bg)', '--stat-border':'var(--purple-border)' }}>
          <div className="stat-icon-wrap"><Clock size={20} color="var(--purple)" /></div>
          <div className="stat-label">Work Entries</div>
          <div className="stat-value">{entries.length}</div>
          <div className="stat-sub">{formatCurrency(bill.entriesTotal || 0)} billed</div>
        </div>
      </div>

      {/* Payment progress bar */}
      {bill.billTotal > 0 && (
        <div className="card" style={{ padding: '16px 24px', marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Payment Progress</span>
            <span style={{ fontWeight: 600 }}>{Math.round(payPct)}%</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{
              width: `${payPct}%`,
              background: payPct >= 100 ? 'var(--success)' : payPct > 0 ? 'var(--warning)' : 'var(--danger)',
            }} />
          </div>
        </div>
      )}

      <div className="grid-2" style={{ gap: 24, alignItems: 'start' }}>

        {/* ── Work Entries ── */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Work Entries</span>
            <button className="btn btn-primary btn-sm" onClick={() => setEntryModal(true)}>
              <Plus size={14} /> Add
            </button>
          </div>

          {entries.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 20px' }}>
              <div className="empty-state-icon" style={{ width: 40, height: 40 }}><FileText size={20} /></div>
              <h3 style={{ fontSize: 14 }}>No entries yet</h3>
              <p style={{ fontSize: 13 }}>Click "Add" to add work items to this bill</p>
            </div>
          ) : (
            <div>
              {entries.map((entry, i) => (
                <div key={entry.id} style={{
                  padding: '14px 20px',
                  borderBottom: i < entries.length - 1 ? '1px solid var(--border-color)' : 'none',
                  display: 'flex', gap: 12,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span className="badge badge-accent" style={{ fontSize: 10 }}>{entry.category}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDate(entry.date)}</span>
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      {entry.description}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <span style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 15 }}>
                      {formatCurrency(entry.amount)}
                    </span>
                    <button className="btn btn-ghost btn-icon" onClick={() => openEditEntry(entry)}
                      title="Edit"><Edit2 size={13} /></button>
                    <button className="btn btn-ghost btn-icon" style={{ color: 'var(--danger)' }}
                      onClick={() => setDeleteConfirm({ type: 'entry', item: entry })}
                      title="Delete"><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
              {/* Total row */}
              <div style={{
                padding: '14px 20px', background: 'var(--bg-glass-light)',
                display: 'flex', justifyContent: 'space-between',
                fontWeight: 600, fontSize: 14, borderTop: '2px solid var(--border-color)'
              }}>
                <span>Entries Total</span>
                <span>{formatCurrency(entries.reduce((s, e) => s + (e.amount || 0), 0))}</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Right column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Bill Breakdown */}
          <div className="card">
            <div className="card-header"><span className="card-title">Bill Breakdown</span></div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Work Entries',             val: bill.entriesTotal || 0,        color: 'var(--text-primary)' },
                ...(bill.carriedForwardDue > 0    ? [{ label: '+ Carried Forward Due',   val:  bill.carriedForwardDue,    color: 'var(--danger)'  }] : []),
                ...(bill.carriedForwardAdvance > 0? [{ label: '− Advance Credit (prev)', val: -bill.carriedForwardAdvance, color: 'var(--success)' }] : []),
                ...(bill.advanceReceived > 0       ? [{ label: '− Advance Received',     val: -bill.advanceReceived,       color: 'var(--success)' }] : []),
              ].map((row, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{row.label}</span>
                  <span style={{ color: row.color, fontWeight: 500 }}>
                    {row.val < 0 ? `−${formatCurrency(Math.abs(row.val))}` : formatCurrency(row.val)}
                  </span>
                </div>
              ))}
              <div style={{ height: 1, background: 'var(--border-color)', margin: '4px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700 }}>
                <span>Net Payable</span>
                <span style={{ color: 'var(--accent-light)' }}>{formatCurrency(bill.billTotal || 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: 'var(--text-muted)' }}>Received</span>
                <span style={{ color: 'var(--success)' }}>−{formatCurrency(bill.totalPaymentsReceived || 0)}</span>
              </div>
              <div style={{ height: 1, background: 'var(--border-color)', margin: '4px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700 }}>
                <span>{balance > 0 ? 'Balance Due' : balance < 0 ? 'Advance Credit' : 'Settled'}</span>
                <span style={{ color: balance > 0 ? 'var(--danger)' : 'var(--success)' }}>
                  {balance === 0 ? '✓' : formatCurrency(Math.abs(balance))}
                </span>
              </div>
            </div>
          </div>

          {/* Payments */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Payments</span>
              <button className="btn btn-success btn-sm" onClick={() => setPaymentModal(true)}>
                <Plus size={14} /> Record
              </button>
            </div>
            {payments.length === 0 ? (
              <div style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                No payments recorded yet
              </div>
            ) : (
              <div>
                {payments.map((p, i) => (
                  <div key={p.id} style={{
                    padding: '12px 20px',
                    borderBottom: i < payments.length - 1 ? '1px solid var(--border-color)' : 'none',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{formatCurrency(p.amount)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.mode} · {formatDate(p.date)}</div>
                      {p.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{p.notes}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="badge badge-success">Received</span>
                      <button className="btn btn-ghost btn-icon" style={{ color: 'var(--danger)' }}
                        onClick={() => setDeleteConfirm({ type: 'payment', item: p })} title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          {bill.notes && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Notes</div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{bill.notes}</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Add Entry Modal ── */}
      <Modal isOpen={entryModal} onClose={closeEntryModal} title="Add Work Entry" size="md"
        footer={<>
          <button className="btn btn-secondary" onClick={closeEntryModal}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAddEntry} disabled={saving}>
            {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} />Saving…</> : 'Add Entry'}
          </button>
        </>}>
        <EntryFields />
      </Modal>

      {/* ── Edit Entry Modal ── */}
      <Modal isOpen={!!editEntry} onClose={() => { setEditEntry(null); setEntryForm(emptyEntry); setShowCustom(false); setCustomCat(''); }}
        title="Edit Work Entry" size="md"
        footer={<>
          <button className="btn btn-secondary" onClick={() => setEditEntry(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleEditEntry} disabled={saving}>
            {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} />Saving…</> : 'Save Changes'}
          </button>
        </>}>
        <EntryFields />
      </Modal>

      {/* ── Record Payment Modal ── */}
      <Modal isOpen={paymentModal} onClose={() => { setPaymentModal(false); setPaymentForm(emptyPayment); }}
        title="Record Payment" size="sm"
        footer={<>
          <button className="btn btn-secondary" onClick={() => setPaymentModal(false)}>Cancel</button>
          <button className="btn btn-success" onClick={handleAddPayment} disabled={saving}>
            {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} />Saving…</> : 'Record Payment'}
          </button>
        </>}>
        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Date</label>
            <input type="date" className="form-input" value={paymentForm.date}
              onChange={e => setPaymentForm(p => ({ ...p, date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Amount (₹) <span className="required">*</span></label>
            <input type="number" className="form-input" placeholder="0" min="1"
              value={paymentForm.amount}
              onChange={e => setPaymentForm(p => ({ ...p, amount: e.target.value }))} />
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Payment Mode</label>
            <select className="form-select" value={paymentForm.mode}
              onChange={e => setPaymentForm(p => ({ ...p, mode: e.target.value }))}>
              {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <input className="form-input" placeholder="Transaction ID, reference…"
            value={paymentForm.notes}
            onChange={e => setPaymentForm(p => ({ ...p, notes: e.target.value }))} />
        </div>
        {bill.billTotal > 0 && (
          <div style={{ background: 'var(--info-bg)', border: '1px solid var(--info-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 13, color: 'var(--info)' }}>
            Balance due: {formatCurrency(Math.max(0, balance))}
          </div>
        )}
      </Modal>

      {/* ── Delete Confirm Modal ── */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title={`Delete ${deleteConfirm?.type === 'entry' ? 'Work Entry' : 'Payment'}`}
        size="sm"
        footer={<>
          <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => {
            if (deleteConfirm.type === 'entry')   handleDeleteEntry(deleteConfirm.item);
            if (deleteConfirm.type === 'payment') handleDeletePayment(deleteConfirm.item);
          }}>
            Yes, Delete
          </button>
        </>}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          {deleteConfirm?.type === 'entry'
            ? `Delete the entry "${deleteConfirm.item?.description}"? This cannot be undone.`
            : `Delete this payment of ${formatCurrency(deleteConfirm?.item?.amount || 0)}? This cannot be undone.`}
        </p>
      </Modal>

    </div>
  );
}

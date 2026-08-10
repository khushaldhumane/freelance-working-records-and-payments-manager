import { useState, useEffect, useRef } from 'react';
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
  ArrowLeft, Plus, Edit2, Trash2, CreditCard,
  IndianRupee, Calendar, Tag, FileText, Download,
  CheckCircle, Clock, AlertCircle
} from 'lucide-react';
import {
  formatCurrency, formatDate, formatDateInput, today
} from '../utils/helpers';
import { generatePDF } from '../utils/pdfGenerator';


const PAYMENT_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Other'];
const emptyEntry = { date: today(), category: '', description: '', amount: '' };
const emptyPayment = { date: today(), amount: '', mode: 'UPI', notes: '' };

export default function BillDetail() {
  const { billId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile } = useApp();
  const { toast } = useToast();

  const [bill, setBill] = useState(null);
  const [client, setClient] = useState(null);
  const [entries, setEntries] = useState([]);
  const [payments, setPayments] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  const [entryModal, setEntryModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [editEntryModal, setEditEntryModal] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null);
  const [entryForm, setEntryForm] = useState(emptyEntry);
  const [paymentForm, setPaymentForm] = useState(emptyPayment);
  const [saving, setSaving] = useState(false);
  const [customCategory, setCustomCategory] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const submittingRef = useRef(false); // guard against double-fire

  useEffect(() => { fetchAll(); }, [billId]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const billSnap = await getDoc(doc(db, 'bills', billId));
      if (!billSnap.exists()) { toast('Bill not found', 'error'); navigate('/bills'); return; }
      const billData = { id: billSnap.id, ...billSnap.data() };
      setBill(billData);

      const [clientSnap, entriesSnap, paymentsSnap, profileSnap] = await Promise.all([
        getDoc(doc(db, 'clients', billData.clientId)),
        getDocs(query(collection(db, 'workEntries'), where('billId', '==', billId))),
        getDocs(query(collection(db, 'payments'), where('billId', '==', billId))),
        getDoc(doc(db, 'profile', user.uid)),
      ]);

      setClient(clientSnap.exists() ? { id: clientSnap.id, ...clientSnap.data() } : null);
      const entriesData = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const paymentsData = paymentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      entriesData.sort((a, b) => (a.date?.seconds || 0) - (b.date?.seconds || 0));
      paymentsData.sort((a, b) => (a.date?.seconds || 0) - (b.date?.seconds || 0));
      setEntries(entriesData);
      setPayments(paymentsData);

      const profileData = profileSnap.exists() ? profileSnap.data() : {};
      setCategories(profileData.categories || [
        'Web Design', 'Web Development', 'UI/UX Design', 'Logo Design',
        'Graphic Design', 'Content Writing', 'Bug Fix', 'Maintenance', 'Other'
      ]);
    } catch (e) { console.error(e); toast('Failed to load bill', 'error'); }
    setLoading(false);
  };

  // Recalculate and update bill totals
  const recalcBill = async (entriesList, paymentsList) => {
    const entriesTotal = entriesList.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const totalPaymentsReceived = paymentsList.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    // Respect carry-forward if this bill was created with it (stored on bill doc).
    // Bills without carry-forward have carriedForwardDue/Advance = 0, so formula works for both.
    const billTotal = entriesTotal
      + (bill.carriedForwardDue || 0)
      - (bill.carriedForwardAdvance || 0)
      - (bill.advanceReceived || 0);

    // BUG-09 fix: handle billTotal <= 0
    let status = bill.status;
    if (billTotal <= 0) {
      status = 'Paid'; // nothing owed
    } else if (totalPaymentsReceived >= billTotal) {
      status = 'Paid';
    } else if (totalPaymentsReceived > 0 && totalPaymentsReceived < billTotal) {
      status = 'Partial';
    } else if (totalPaymentsReceived === 0) {
      status = status === 'Draft' ? 'Draft' : 'Unpaid';
    }

    await updateDoc(doc(db, 'bills', billId), {
      entriesTotal, billTotal, totalPaymentsReceived, status, updatedAt: serverTimestamp()
    });
    setBill(prev => ({ ...prev, entriesTotal, billTotal, totalPaymentsReceived, status }));
  };

  // Add Work Entry
  const handleAddEntry = async () => {
    if (submittingRef.current) return;

    const cat = showCustom ? customCategory.trim() : entryForm.category;
    if (!cat) { toast('Please select a category', 'error'); return; }
    if (!entryForm.description.trim()) { toast('Description is required', 'error'); return; }
    const amt = parseFloat(entryForm.amount);
    if (!entryForm.amount || isNaN(amt) || amt <= 0) { toast('Enter a valid amount', 'error'); return; }

    submittingRef.current = true;
    setSaving(true);

    let entryAdded = false;
    let newDocRef = null;

    // STEP 1: Save entry to Firestore — the only critical step
    try {
      const newEntry = {
        billId,
        clientId: bill?.clientId || '',
        userId: user.uid,
        date: Timestamp.fromDate(new Date(entryForm.date + 'T00:00:00')),
        category: cat,
        description: entryForm.description.trim(),
        amount: amt,
        createdAt: serverTimestamp(),
      };
      newDocRef = await addDoc(collection(db, 'workEntries'), newEntry);
      entryAdded = true;
      console.log('[Entry] Saved to Firestore:', newDocRef.id);
    } catch (saveErr) {
      console.error('[Entry] FAILED to save:', saveErr);
      toast('Failed to save entry: ' + (saveErr.message || 'Check your connection'), 'error');
      setSaving(false);
      submittingRef.current = false;
      return;
    }

    // STEP 2: Entry saved — close modal and show success immediately
    toast('Work entry added', 'success');
    setEntryModal(false);
    setEntryForm(emptyEntry);
    setCustomCategory('');
    setShowCustom(false);
    setSaving(false);
    submittingRef.current = false;

    // STEP 3: Refresh entries list from Firestore (always runs)
    try {
      await fetchAll();
    } catch (fetchErr) {
      console.warn('[Entry] fetchAll failed:', fetchErr);
    }

    // STEP 4: Save custom category (non-critical, fire-and-forget)
    if (showCustom && cat && !categories.includes(cat)) {
      const newCats = [...categories, cat];
      setCategories(newCats);
      try {
        await setDoc(doc(db, 'profile', user.uid), { categories: newCats }, { merge: true });
      } catch (catErr) {
        console.warn('[Entry] Category save failed (non-critical):', catErr);
      }
    }

    // STEP 5: Update bill totals (non-critical, fire-and-forget)
    try {
      await updateDoc(doc(db, 'bills', billId), {
        updatedAt: serverTimestamp()
      });
      // Re-fetch to get accurate totals after Firestore settles
      const fresh = await getDocs(query(collection(db, 'workEntries'), where('billId', '==', billId)));
      const freshEntries = fresh.docs.map(d => ({ id: d.id, ...d.data() }));
      const entriesTotal = freshEntries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const billTotal = entriesTotal
        + (bill.carriedForwardDue || 0)
        - (bill.carriedForwardAdvance || 0)
        - (bill.advanceReceived || 0);
      const totalPaid = bill.totalPaymentsReceived || 0;
      let status = billTotal <= 0 ? 'Paid' : totalPaid >= billTotal ? 'Paid' : totalPaid > 0 ? 'Partial' : bill.status === 'Draft' ? 'Draft' : 'Unpaid';
      await updateDoc(doc(db, 'bills', billId), { entriesTotal, billTotal, status, updatedAt: serverTimestamp() });
      console.log('[Entry] Bill totals updated:', { entriesTotal, billTotal, status });
    } catch (recalcErr) {
      console.warn('[Entry] Bill recalc failed (non-critical):', recalcErr);
    }
  };


  // Edit Entry
  const handleEditEntry = async () => {
    if (submittingRef.current) return;
    const cat = showCustom ? customCategory.trim() : entryForm.category;
    // BUG-18 fix: allow zero amounts, reject only empty/NaN
    if ((!cat) || !entryForm.description || (entryForm.amount === '' || entryForm.amount === null || isNaN(entryForm.amount))) {
      toast('Fill all required fields', 'error'); return;
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'workEntries', editEntryModal.id), {
        date: Timestamp.fromDate(new Date(entryForm.date)),
        category: cat,
        description: entryForm.description,
        amount: parseFloat(entryForm.amount),
        updatedAt: serverTimestamp(),
      });
      toast('Entry updated', 'success');
      setEditEntryModal(null);
      try {
        const updatedEntries = entries.map(e => e.id === editEntryModal.id ? { ...e, amount: parseFloat(entryForm.amount) } : e);
        await recalcBill(updatedEntries, payments);
      } catch (re) { console.warn('Recalc failed:', re); }
    } catch (e) { toast('Failed to update: ' + e.message, 'error'); }
    finally { fetchAll(); setSaving(false); submittingRef.current = false; }
  };

  // Delete Entry
  const handleDeleteEntry = async (entry) => {
    try {
      await deleteDoc(doc(db, 'workEntries', entry.id));
      const newEntries = entries.filter(e => e.id !== entry.id);
      await recalcBill(newEntries, payments);
      toast('Entry deleted', 'success');
      fetchAll();
    } catch (e) { toast('Failed to delete', 'error'); }
  };

  // Record Payment
  const handleAddPayment = async () => {
    if (submittingRef.current) return;
    // BUG-22 fix: reject negative/zero payments
    const amt = parseFloat(paymentForm.amount);
    if (!paymentForm.amount || isNaN(amt) || amt <= 0) { toast('Enter a valid positive amount', 'error'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      await addDoc(collection(db, 'payments'), {
        billId,
        clientId: bill.clientId,
        userId: user.uid,
        date: Timestamp.fromDate(new Date(paymentForm.date)),
        amount: amt,
        mode: paymentForm.mode,
        notes: paymentForm.notes,
        createdAt: serverTimestamp(),
      });
      toast('Payment recorded', 'success');
      setPaymentModal(false);
      setPaymentForm(emptyPayment);
      try {
        const newPayments = [...payments, { amount: amt }];
        await recalcBill(entries, newPayments);
      } catch (re) { console.warn('Recalc failed:', re); }
    } catch (e) { toast('Failed to record payment: ' + e.message, 'error'); }
    finally { fetchAll(); setSaving(false); submittingRef.current = false; }
  };

  // BUG-20 fix: Delete payment
  const handleDeletePayment = async (payment) => {
    try {
      await deleteDoc(doc(db, 'payments', payment.id));
      const newPayments = payments.filter(p => p.id !== payment.id);
      await recalcBill(entries, newPayments);
      toast('Payment deleted', 'success');
      fetchAll();
    } catch (e) { toast('Failed to delete payment', 'error'); }
  };

  const openEditEntry = (entry) => {
    setEditEntryModal(entry);
    setEntryForm({
      date: formatDateInput(entry.date?.toDate ? entry.date.toDate() : new Date(entry.date)),
      category: entry.category,
      description: entry.description,
      amount: entry.amount,
    });
    setShowCustom(false);
    setCustomCategory('');
  };

  if (loading) return (
    <div className="page-content" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
      <div className="spinner" style={{ width: 40, height: 40 }} />
    </div>
  );

  if (!bill) return null;

  const balance = (bill.billTotal || 0) - (bill.totalPaymentsReceived || 0);
  const paymentProgress = bill.billTotal > 0 ? Math.min(100, ((bill.totalPaymentsReceived || 0) / bill.billTotal) * 100) : 0;

  const EntryFormFields = () => (
    <>
      <div className="form-grid form-grid-2">
        <div className="form-group">
          <label className="form-label">Date <span className="required">*</span></label>
          <input type="date" className="form-input" value={entryForm.date} onChange={e => setEntryForm(p => ({ ...p, date: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Category <span className="required">*</span></label>
          {!showCustom ? (
            <select className="form-select" value={entryForm.category} onChange={e => {
              if (e.target.value === '__custom__') setShowCustom(true);
              else setEntryForm(p => ({ ...p, category: e.target.value }));
            }}>
              <option value="">— Select —</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="__custom__">+ Add custom…</option>
            </select>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="form-input" placeholder="Custom category" value={customCategory} onChange={e => setCustomCategory(e.target.value)} />
              <button className="btn btn-secondary btn-sm" onClick={() => { setShowCustom(false); setCustomCategory(''); }}>✕</button>
            </div>
          )}
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Work Description <span className="required">*</span></label>
        <textarea className="form-textarea" placeholder="Describe the work done…" value={entryForm.description} onChange={e => setEntryForm(p => ({ ...p, description: e.target.value }))} style={{ minHeight: 80 }} />
      </div>
      <div className="form-group">
        <label className="form-label">Amount (₹) <span className="required">*</span></label>
        <input type="number" className="form-input" placeholder="0" min="0" value={entryForm.amount} onChange={e => setEntryForm(p => ({ ...p, amount: e.target.value }))} />
      </div>
    </>
  );

  return (
    <div className="page-content animate-fade-in">
      {/* Back + Header */}
      <div style={{ marginBottom: 24 }}>
        <button className="btn btn-ghost" onClick={() => navigate('/bills')} style={{ marginBottom: 16, padding: '6px 0' }}>
          <ArrowLeft size={16} /> Back to Bills
        </button>
        <div className="page-header">
          <div className="page-header-left">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <h2 style={{ marginBottom: 0 }}>{bill.billNumber}</h2>
              <span className={`badge badge-lg ${bill.status === 'Paid' ? 'badge-success' : bill.status === 'Partial' ? 'badge-warning' : bill.status === 'Overdue' ? 'badge-danger' : 'badge-muted'}`}>
                {bill.status}
              </span>
            </div>
            <p>{client?.name} {client?.company ? `— ${client.company}` : ''} · {formatDate(bill.billDate)}</p>
          </div>
          <div className="page-header-actions">
            <button className="btn btn-secondary" onClick={() => generatePDF(bill, client, entries, payments, profile)}>
              <Download size={15} /> Download PDF
            </button>
            <button className="btn btn-primary" onClick={() => setEntryModal(true)}>
              <Plus size={16} /> Add Work Entry
            </button>
          </div>
        </div>
      </div>

      {/* Bill Summary Cards */}
      <div className="grid-4" style={{ marginBottom: 28 }}>
        <div className="stat-card" style={{ '--stat-color': 'var(--accent)', '--stat-bg': 'var(--accent-glow)', '--stat-border': 'rgba(99,102,241,0.2)' }}>
          <div className="stat-icon-wrap"><IndianRupee size={20} color="var(--accent-light)" /></div>
          <div className="stat-label">Bill Total</div>
          <div className="stat-value">{formatCurrency(bill.billTotal || 0)}</div>
        </div>
        <div className="stat-card" style={{ '--stat-color': 'var(--success)', '--stat-bg': 'var(--success-bg)', '--stat-border': 'var(--success-border)' }}>
          <div className="stat-icon-wrap"><CheckCircle size={20} color="var(--success)" /></div>
          <div className="stat-label">Amount Received</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(bill.totalPaymentsReceived || 0)}</div>
          <div className="stat-sub">{payments.length} payment{payments.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="stat-card" style={{ '--stat-color': balance > 0 ? 'var(--danger)' : 'var(--success)', '--stat-bg': balance > 0 ? 'var(--danger-bg)' : 'var(--success-bg)', '--stat-border': balance > 0 ? 'var(--danger-border)' : 'var(--success-border)' }}>
          <div className="stat-icon-wrap"><AlertCircle size={20} color={balance > 0 ? 'var(--danger)' : 'var(--success)'} /></div>
          <div className="stat-label">{balance > 0 ? 'Balance Due' : balance < 0 ? 'Advance Credit' : 'Balance'}</div>
          <div className="stat-value" style={{ color: balance > 0 ? 'var(--danger)' : balance < 0 ? 'var(--success)' : 'var(--text-primary)' }}>
            {balance === 0 ? '✓ Settled' : formatCurrency(Math.abs(balance))}
          </div>
        </div>
        <div className="stat-card" style={{ '--stat-color': 'var(--purple)', '--stat-bg': 'var(--purple-bg)', '--stat-border': 'var(--purple-border)' }}>
          <div className="stat-icon-wrap"><Clock size={20} color="var(--purple)" /></div>
          <div className="stat-label">Work Entries</div>
          <div className="stat-value">{entries.length}</div>
          <div className="stat-sub">{formatCurrency(bill.entriesTotal || 0)} billed</div>
        </div>
      </div>

      {/* Payment Progress */}
      {bill.billTotal > 0 && (
        <div className="card" style={{ padding: '16px 24px', marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Payment Progress</span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{Math.round(paymentProgress)}%</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{
              width: `${paymentProgress}%`,
              background: paymentProgress >= 100 ? 'var(--success)' : paymentProgress > 0 ? 'var(--warning)' : 'var(--danger)',
            }} />
          </div>
        </div>
      )}

      <div className="grid-2" style={{ gap: 24, alignItems: 'start' }}>
        {/* Work Entries */}
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
              <p style={{ fontSize: 13 }}>Add work items to this bill</p>
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
                    <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{entry.description}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <span style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 15 }}>
                      {formatCurrency(entry.amount)}
                    </span>
                    <button className="btn btn-ghost btn-icon" onClick={() => openEditEntry(entry)}><Edit2 size={13} /></button>
                    <button className="btn btn-ghost btn-icon" style={{ color: 'var(--danger)' }} onClick={() => handleDeleteEntry(entry)}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
              {/* Total row */}
              <div style={{
                padding: '14px 20px',
                background: 'var(--bg-glass-light)',
                display: 'flex', justifyContent: 'space-between',
                fontWeight: 600, fontSize: 14, borderTop: '2px solid var(--border-color)'
              }}>
                <span>Entries Total</span>
                <span>{formatCurrency(bill.entriesTotal || 0)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Right column: Bill summary + Payments */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Bill Breakdown */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Bill Breakdown</span>
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Work Entries', val: bill.entriesTotal || 0, color: 'var(--text-primary)' },
                ...(bill.carriedForwardDue > 0 ? [{ label: '+ Carried Forward Due', val: bill.carriedForwardDue, color: 'var(--danger)' }] : []),
                ...(bill.carriedForwardAdvance > 0 ? [{ label: '− Advance Credit (prev)', val: -bill.carriedForwardAdvance, color: 'var(--success)' }] : []),
                ...(bill.advanceReceived > 0 ? [{ label: '− Advance Received', val: -bill.advanceReceived, color: 'var(--success)' }] : []),
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
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{formatCurrency(p.amount)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.mode} · {formatDate(p.date)}</div>
                      {p.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{p.notes}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="badge badge-success">Received</span>
                      <button className="btn btn-ghost btn-icon" style={{ color: 'var(--danger)' }} onClick={() => handleDeletePayment(p)} title="Delete payment">
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

      {/* Add Entry Modal */}
      <Modal isOpen={entryModal} onClose={() => { setEntryModal(false); setEntryForm(emptyEntry); setShowCustom(false); setCustomCategory(''); }} title="Add Work Entry" size="md"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setEntryModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleAddEntry} disabled={saving}>
              {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} />Saving…</> : 'Add Entry'}
            </button>
          </>
        }
      >
        <EntryFormFields />
      </Modal>

      {/* Edit Entry Modal */}
      <Modal isOpen={!!editEntryModal} onClose={() => setEditEntryModal(null)} title="Edit Work Entry" size="md"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setEditEntryModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleEditEntry} disabled={saving}>
              {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} />Saving…</> : 'Save Changes'}
            </button>
          </>
        }
      >
        <EntryFormFields />
      </Modal>

      {/* Payment Modal */}
      <Modal isOpen={paymentModal} onClose={() => setPaymentModal(false)} title="Record Payment" size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setPaymentModal(false)}>Cancel</button>
            <button className="btn btn-success" onClick={handleAddPayment} disabled={saving}>
              {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} />Saving…</> : 'Record Payment'}
            </button>
          </>
        }
      >
        <div className="form-grid form-grid-2">
          <div className="form-group">
            <label className="form-label">Date</label>
            <input type="date" className="form-input" value={paymentForm.date} onChange={e => setPaymentForm(p => ({ ...p, date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Amount (₹) <span className="required">*</span></label>
            <input type="number" className="form-input" placeholder="0" min="0" value={paymentForm.amount} onChange={e => setPaymentForm(p => ({ ...p, amount: e.target.value }))} />
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Payment Mode</label>
            <select className="form-select" value={paymentForm.mode} onChange={e => setPaymentForm(p => ({ ...p, mode: e.target.value }))}>
              {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <input className="form-input" placeholder="Transaction ID, reference…" value={paymentForm.notes} onChange={e => setPaymentForm(p => ({ ...p, notes: e.target.value }))} />
        </div>
        {bill.billTotal > 0 && (
          <div style={{ background: 'var(--info-bg)', border: '1px solid var(--info-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 13, color: 'var(--info)' }}>
            Balance due: {formatCurrency(Math.max(0, balance))}
          </div>
        )}
      </Modal>
    </div>
  );
}

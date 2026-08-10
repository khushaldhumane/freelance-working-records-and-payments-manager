import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import {
  collection, getDocs, query, where, orderBy, doc, updateDoc, serverTimestamp
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useApp, defaultCategories } from '../context/AppContext';
import { useToast } from '../components/Toast';
import { Save, Plus, X, User, Building2, Phone, Mail, CreditCard, Palette, Tag, Lock } from 'lucide-react';

export default function Settings() {
  const { user, changePassword } = useAuth();
  const { profile, saveProfile } = useApp();
  const { toast } = useToast();

  const [profileForm, setProfileForm] = useState({
    name: '', businessName: '', phone: '', email: '',
    upi: '', bankDetails: '', billPrefix: 'INV-', address: ''
  });
  const [categories, setCategories] = useState([]);
  const [newCategory, setNewCategory] = useState('');
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');

  useEffect(() => {
    if (profile) {
      setProfileForm({
        name: profile.name || '',
        businessName: profile.businessName || '',
        phone: profile.phone || '',
        email: profile.email || '',
        upi: profile.upi || '',
        bankDetails: profile.bankDetails || '',
        billPrefix: profile.billPrefix || 'INV-',
        address: profile.address || '',
      });
      setCategories(profile.categories || defaultCategories);
    }
  }, [profile]);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await saveProfile({ ...profileForm, categories });
      toast('Profile saved!', 'success');
    } catch (e) { toast('Failed to save', 'error'); }
    setSaving(false);
  };

  const addCategory = () => {
    if (!newCategory.trim()) return;
    if (categories.includes(newCategory.trim())) { toast('Category already exists', 'error'); return; }
    setCategories(prev => [...prev, newCategory.trim()]);
    setNewCategory('');
  };

  const removeCategory = (cat) => setCategories(prev => prev.filter(c => c !== cat));

  const handleChangePassword = async () => {
    if (!pwForm.current || !pwForm.newPw) { toast('Fill all fields', 'error'); return; }
    if (pwForm.newPw !== pwForm.confirm) { toast('Passwords do not match', 'error'); return; }
    if (pwForm.newPw.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
    setPwSaving(true);
    try {
      await changePassword(pwForm.current, pwForm.newPw);
      toast('Password changed!', 'success');
      setPwForm({ current: '', newPw: '', confirm: '' });
    } catch (e) {
      // BUG-21 fix: show specific error messages
      if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
        toast('Incorrect current password', 'error');
      } else if (e.code === 'auth/network-request-failed') {
        toast('Network error. Check your connection.', 'error');
      } else if (e.code === 'auth/too-many-requests') {
        toast('Too many attempts. Try again later.', 'error');
      } else {
        toast(e.message || 'Failed to change password', 'error');
      }
    }
    setPwSaving(false);
  };

  const tabs = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'invoice', label: 'Invoice', icon: CreditCard },
    { id: 'categories', label: 'Categories', icon: Tag },
    { id: 'security', label: 'Security', icon: Lock },
  ];

  return (
    <div className="page-content animate-fade-in">
      <div className="page-header">
        <div className="page-header-left">
          <h2>Settings</h2>
          <p>Manage your profile, categories, and preferences</p>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ marginBottom: 28 }}>
        <div className="tabs">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`tab ${activeTab === id ? 'active' : ''}`} onClick={() => setActiveTab(id)}>
              <Icon size={14} style={{ marginRight: 6 }} />{label}
            </button>
          ))}
        </div>
      </div>

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <div className="card" style={{ maxWidth: 600 }}>
          <div className="card-header">
            <span className="card-title">Personal & Business Info</span>
          </div>
          <div className="card-body">
            <div className="form-grid form-grid-2">
              <div className="form-group">
                <label className="form-label">Your Name</label>
                <input className="form-input" placeholder="e.g. Khush Patel" value={profileForm.name} onChange={e => setProfileForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Business / Brand Name</label>
                <input className="form-input" placeholder="e.g. KP Designs" value={profileForm.businessName} onChange={e => setProfileForm(p => ({ ...p, businessName: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" placeholder="e.g. 9876543210" value={profileForm.phone} onChange={e => setProfileForm(p => ({ ...p, phone: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" placeholder="e.g. you@email.com" value={profileForm.email} onChange={e => setProfileForm(p => ({ ...p, email: e.target.value }))} />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Address</label>
                <textarea className="form-textarea" placeholder="Your full address (shown on invoices)" value={profileForm.address} onChange={e => setProfileForm(p => ({ ...p, address: e.target.value }))} style={{ minHeight: 70 }} />
              </div>
            </div>
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={handleSaveProfile} disabled={saving}>
                {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} />Saving…</> : <><Save size={15} /> Save Profile</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Tab */}
      {activeTab === 'invoice' && (
        <div className="card" style={{ maxWidth: 600 }}>
          <div className="card-header">
            <span className="card-title">Invoice & Payment Settings</span>
          </div>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">Bill Number Prefix</label>
              <input className="form-input" placeholder="e.g. INV- or BILL-" value={profileForm.billPrefix} onChange={e => setProfileForm(p => ({ ...p, billPrefix: e.target.value }))} style={{ maxWidth: 200 }} />
              <span className="form-hint">Bills will be numbered: {profileForm.billPrefix || 'INV-'}0001, {profileForm.billPrefix || 'INV-'}0002…</span>
            </div>
            <div className="form-group">
              <label className="form-label">UPI ID</label>
              <input className="form-input" placeholder="e.g. yourname@upi" value={profileForm.upi} onChange={e => setProfileForm(p => ({ ...p, upi: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Bank Account Details</label>
              <textarea className="form-textarea" placeholder="Bank Name: &#10;Account No: &#10;IFSC: &#10;Account Name:" value={profileForm.bankDetails} onChange={e => setProfileForm(p => ({ ...p, bankDetails: e.target.value }))} />
              <span className="form-hint">This will be printed on PDF invoices under payment details</span>
            </div>
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={handleSaveProfile} disabled={saving}>
                {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} />Saving…</> : <><Save size={15} /> Save</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Categories Tab */}
      {activeTab === 'categories' && (
        <div className="card" style={{ maxWidth: 600 }}>
          <div className="card-header">
            <span className="card-title">Work Categories</span>
          </div>
          <div className="card-body">
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18 }}>
              These categories appear in the work entry dropdown. You can add or remove as needed.
            </p>

            {/* Add new */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              <input
                className="form-input"
                placeholder="New category name…"
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCategory()}
              />
              <button className="btn btn-primary" onClick={addCategory}><Plus size={15} /> Add</button>
            </div>

            {/* Category tags */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {categories.map(cat => (
                <div key={cat} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
                  borderRadius: 'var(--radius-full)', padding: '5px 12px',
                  fontSize: 13, color: 'var(--accent-light)',
                }}>
                  {cat}
                  <button
                    onClick={() => removeCategory(cat)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 0 }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={handleSaveProfile} disabled={saving}>
                {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} />Saving…</> : <><Save size={15} /> Save Categories</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Security Tab */}
      {activeTab === 'security' && (
        <div className="card" style={{ maxWidth: 500 }}>
          <div className="card-header">
            <span className="card-title">Change Password</span>
          </div>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">Current Password</label>
              <input type="password" className="form-input" placeholder="Enter current password" value={pwForm.current} onChange={e => setPwForm(p => ({ ...p, current: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">New Password</label>
              <input type="password" className="form-input" placeholder="At least 6 characters" value={pwForm.newPw} onChange={e => setPwForm(p => ({ ...p, newPw: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm New Password</label>
              <input type="password" className="form-input" placeholder="Repeat new password" value={pwForm.confirm} onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))} />
            </div>
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={handleChangePassword} disabled={pwSaving}>
                {pwSaving ? <><div className="spinner" style={{ width: 14, height: 14 }} />Updating…</> : <><Lock size={15} /> Change Password</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

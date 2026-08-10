// =====================
// Currency Formatting
// =====================
export const formatCurrency = (amount) => {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num);
};

export const formatNumber = (num) =>
  new Intl.NumberFormat('en-IN').format(Number(num) || 0);

// =====================
// Date Helpers
// =====================
export const formatDate = (date) => {
  if (!date) return '-';
  const d = date?.toDate ? date.toDate() : new Date(date);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const formatDateInput = (date) => {
  if (!date) return '';
  const d = date?.toDate ? date.toDate() : new Date(date);
  // Use local date parts to avoid UTC timezone shift (BUG-05 fix)
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const today = () => formatDateInput(new Date());

export const isOverdue = (deadline) => {
  if (!deadline) return false;
  const d = deadline?.toDate ? deadline.toDate() : new Date(deadline);
  return d < new Date() && d.toDateString() !== new Date().toDateString();
};

export const isToday = (date) => {
  if (!date) return false;
  const d = date?.toDate ? date.toDate() : new Date(date);
  return d.toDateString() === new Date().toDateString();
};

export const daysUntil = (date) => {
  if (!date) return null;
  const d = date?.toDate ? date.toDate() : new Date(date);
  // Normalize both dates to midnight to avoid off-by-one (BUG-11 fix)
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((target - today) / (1000 * 60 * 60 * 24));
  return diff;
};

// =====================
// Bill Number Generator
// =====================
export const generateBillNumber = (prefix = 'INV-', existingNumbers = []) => {
  const nums = existingNumbers
    .map(n => parseInt(n.replace(/\D/g, ''), 10))
    .filter(n => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
};

// =====================
// Bill Status
// =====================
export const getBillStatus = (bill) => {
  const total = bill.billTotal || 0;
  const paid = bill.totalPaymentsReceived || 0;
  if (total <= 0 && paid >= 0) return 'Paid'; // Nothing owed (BUG-09 fix)
  if (paid <= 0 && total > 0) return 'Unpaid';
  if (paid >= total) return 'Paid';
  return 'Partial';
};

export const getBillStatusBadge = (status) => {
  switch (status) {
    case 'Paid': return 'badge-success';
    case 'Partial': return 'badge-warning';
    case 'Unpaid': return 'badge-danger';
    case 'Draft': return 'badge-muted';
    case 'Overdue': return 'badge-danger';
    default: return 'badge-muted';
  }
};

// =====================
// Carry-Forward Logic
// =====================
export const computeCarryForward = (previousBill) => {
  if (!previousBill) return { carriedForwardDue: 0, carriedForwardAdvance: 0 };
  const total = previousBill.billTotal || 0;
  const paid = previousBill.totalPaymentsReceived || 0;
  const balance = total - paid;
  if (balance > 0) return { carriedForwardDue: balance, carriedForwardAdvance: 0 };
  if (balance < 0) return { carriedForwardDue: 0, carriedForwardAdvance: Math.abs(balance) };
  return { carriedForwardDue: 0, carriedForwardAdvance: 0 };
};

export const computeBillTotal = (entriesTotal, carriedForwardDue, carriedForwardAdvance, advanceReceived) => {
  // Net payable = entries + carried due - carried advance - new advance received
  return entriesTotal + (carriedForwardDue || 0) - (carriedForwardAdvance || 0) - (advanceReceived || 0);
};

// =====================
// Priority Helpers
// =====================
export const priorityBadge = (priority) => {
  switch (priority) {
    case 'High': return 'badge-danger';
    case 'Medium': return 'badge-warning';
    case 'Low': return 'badge-muted';
    default: return 'badge-muted';
  }
};

// =====================
// Month Name Helper
// =====================
export const monthName = (monthIndex) => {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[monthIndex] || '';
};

// =====================
// Truncate Text
// =====================
export const truncate = (str, n = 50) =>
  str && str.length > n ? str.slice(0, n) + '…' : str;

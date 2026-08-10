import * as XLSX from 'xlsx';
import { formatDate } from './helpers';

export const exportToExcel = (bills, clients, entries) => {
  const wb = XLSX.utils.book_new();

  const clientName = (id) => clients.find(c => c.id === id)?.name || 'Unknown';

  // ---- Sheet 1: All Bills Summary ----
  const billsData = bills.map(b => ({
    'Bill Number': b.billNumber,
    'Client': clientName(b.clientId),
    'Date': formatDate(b.billDate),
    'Entries Total (₹)': b.entriesTotal || 0,
    'Carried Forward Due (₹)': b.carriedForwardDue || 0,
    'Carried Forward Advance (₹)': b.carriedForwardAdvance || 0,
    'Advance Received (₹)': b.advanceReceived || 0,
    'Net Payable (₹)': b.billTotal || 0,
    'Amount Received (₹)': b.totalPaymentsReceived || 0,
    'Balance Due (₹)': Math.max(0, (b.billTotal || 0) - (b.totalPaymentsReceived || 0)),
    'Advance Credit (₹)': Math.max(0, (b.totalPaymentsReceived || 0) - (b.billTotal || 0)),
    'Status': b.status,
    'Notes': b.notes || '',
  }));
  const billsSheet = XLSX.utils.json_to_sheet(billsData);
  XLSX.utils.book_append_sheet(wb, billsSheet, 'Bills Summary');

  // ---- Sheet 2: All Work Entries ----
  const entriesData = entries.map(e => {
    const bill = bills.find(b => b.id === e.billId);
    return {
      'Date': formatDate(e.date),
      'Client': clientName(e.clientId),
      'Bill Number': bill?.billNumber || '—',
      'Category': e.category,
      'Description': e.description,
      'Amount (₹)': e.amount || 0,
    };
  });
  const entriesSheet = XLSX.utils.json_to_sheet(entriesData);
  XLSX.utils.book_append_sheet(wb, entriesSheet, 'Work Entries');

  // ---- Sheet 3: Client Statement ----
  const clientData = clients.map(c => {
    const cBills = bills.filter(b => b.clientId === c.id);
    const totalBilled = cBills.reduce((s, b) => s + (b.billTotal || 0), 0);
    const totalReceived = cBills.reduce((s, b) => s + (b.totalPaymentsReceived || 0), 0);
    const pending = Math.max(0, totalBilled - totalReceived);
    const advance = Math.max(0, totalReceived - totalBilled);
    return {
      'Client Name': c.name,
      'Company': c.company || '',
      'Phone': c.phone || '',
      'Total Bills': cBills.length,
      'Total Billed (₹)': totalBilled,
      'Total Received (₹)': totalReceived,
      'Balance Due (₹)': pending,
      'Advance Credit (₹)': advance,
    };
  });
  const clientSheet = XLSX.utils.json_to_sheet(clientData);
  XLSX.utils.book_append_sheet(wb, clientSheet, 'Client Statements');

  // BUG-16 fix: SheetJS requires {wch: N} (width in chars), not {width: N}
  [billsSheet, entriesSheet, clientSheet].forEach(sheet => {
    const ref = sheet['!ref'];
    if (!ref) return;
    const range = XLSX.utils.decode_range(ref);
    const colCount = range.e.c + 1;
    sheet['!cols'] = Array.from({ length: colCount }, () => ({ wch: 22 }));
  });

  const fileName = `FreelanceTracker_Export_${new Date().toLocaleDateString('en-IN').replace(/\//g, '-')}.xlsx`;
  XLSX.writeFile(wb, fileName);
};

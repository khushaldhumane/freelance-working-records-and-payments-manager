import jsPDF from 'jspdf';
import { formatDate } from './helpers';

// jsPDF Helvetica cannot render Unicode ₹ (U+20B9). Use 'Rs.' instead.
const RS = 'Rs.';
const fmtAmt = (n) => `${RS} ${Number(n || 0).toLocaleString('en-IN')}`;

export const generatePDF = async (bill, client, entries, payments, profile) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const margin = 18;
  let y = margin;

  const colors = {
    accent: [99, 102, 241],
    dark: [10, 11, 15],
    text: [30, 32, 42],
    muted: [100, 106, 140],
    light: [240, 242, 248],
    success: [34, 197, 94],
    danger: [239, 68, 68],
    white: [255, 255, 255],
    border: [230, 232, 240],
  };

  const setColor = (c) => doc.setTextColor(...c);
  const setFill = (c) => doc.setFillColor(...c);
  const setDraw = (c) => doc.setDrawColor(...c);

  // Header gradient block
  setFill(colors.accent);
  doc.rect(0, 0, W, 42, 'F');

  // Brand name
  setColor(colors.white);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(profile?.businessName || 'FreelanceTrack', margin, 18);

  // INVOICE label
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('TAX INVOICE', W - margin, 14, { align: 'right' });

  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(bill.billNumber || 'DRAFT', W - margin, 26, { align: 'right' }); // BUG-03 guard null billNumber

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Date: ${formatDate(bill.billDate)}`, W - margin, 34, { align: 'right' });

  y = 52;

  // From / To
  const col2X = W / 2 + 4;

  // FROM box
  setFill(colors.light);
  doc.rect(margin, y, W / 2 - margin - 4, 38, 'F');
  setColor(colors.muted);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.text('FROM', margin + 6, y + 8);
  setColor(colors.text);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(profile?.name || 'Your Name', margin + 6, y + 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  if (profile?.phone) doc.text(`📞 ${profile.phone}`, margin + 6, y + 23);
  if (profile?.email) doc.text(`✉ ${profile.email}`, margin + 6, y + 29);
  if (profile?.address) {
    const addrLines = doc.splitTextToSize(profile.address, W / 2 - margin - 14);
    doc.text(addrLines, margin + 6, y + 35);
  }

  // TO box
  setFill([245, 246, 252]);
  doc.rect(col2X, y, W - col2X - margin, 38, 'F');
  setColor(colors.muted);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.text('BILLED TO', col2X + 6, y + 8);
  setColor(colors.text);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(client?.name || 'Client Name', col2X + 6, y + 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  if (client?.company) doc.text(client.company, col2X + 6, y + 23);
  if (client?.phone) doc.text(client.phone, col2X + 6, y + 29);

  y += 48;

  // Work Entries Table Header
  setFill(colors.accent);
  doc.rect(margin, y, W - 2 * margin, 9, 'F');
  setColor(colors.white);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Date', margin + 4, y + 6);
  doc.text('Category', margin + 28, y + 6);
  doc.text('Description', margin + 60, y + 6);
  doc.text('Amount (₹)', W - margin - 4, y + 6, { align: 'right' });

  y += 9;

  // Entries
  doc.setFont('helvetica', 'normal');
  entries.forEach((entry, i) => {
    if (y > 260) {
      doc.addPage();
      y = margin;
    }
    if (i % 2 === 0) {
      setFill([248, 249, 255]);
      doc.rect(margin, y, W - 2 * margin, 9, 'F');
    }
    setColor(colors.text);
    doc.setFontSize(8.5);
    doc.text(formatDate(entry.date), margin + 4, y + 6);
    doc.text(entry.category || '', margin + 28, y + 6);
    // BUG-03 fix: guard against null/undefined description
    const descText = String(entry.description || '');
    const desc = doc.splitTextToSize(descText, 75);
    doc.text(desc[0] || '', margin + 60, y + 6);
    setColor(colors.muted);
    doc.text(fmtAmt(entry.amount), W - margin - 4, y + 6, { align: 'right' }); // BUG-04 fix
    setColor(colors.text);
    y += 9;
  });

  setDraw(colors.border);
  doc.setLineWidth(0.3);
  doc.line(margin, y, W - margin, y);
  y += 6;

  // BUG-13 fix: page break before summary block if needed
  if (y > 230) { doc.addPage(); y = margin; }

  // Bill Summary
  const summaryX = W - margin - 75;
  const summaryRows = [
    { label: 'Work Entries Total', val: fmtAmt(bill.entriesTotal || 0) },
    ...(bill.carriedForwardDue > 0 ? [{ label: 'Previous Due (carried)', val: `+ ${fmtAmt(bill.carriedForwardDue)}` }] : []),
    ...(bill.carriedForwardAdvance > 0 ? [{ label: 'Advance Credit (prev)', val: `- ${fmtAmt(bill.carriedForwardAdvance)}` }] : []),
    ...(bill.advanceReceived > 0 ? [{ label: 'Advance Received', val: `- ${fmtAmt(bill.advanceReceived)}` }] : []),
    { label: 'Amount Received', val: `- ${fmtAmt(bill.totalPaymentsReceived || 0)}` },
  ];

  summaryRows.forEach(row => {
    setColor(colors.muted);
    doc.setFontSize(8.5);
    doc.text(row.label, summaryX, y);
    setColor(colors.text);
    doc.text(row.val, W - margin, y, { align: 'right' });
    y += 7;
  });

  // NET PAYABLE
  const balance = (bill.billTotal || 0) - (bill.totalPaymentsReceived || 0);
  setFill(balance > 0 ? [254, 242, 242] : [240, 253, 244]);
  doc.rect(summaryX - 4, y - 2, W - margin - summaryX + 4 + margin, 12, 'F');
  setColor(balance > 0 ? colors.danger : colors.success);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(balance > 0 ? 'BALANCE DUE' : 'FULLY PAID', summaryX, y + 7);
  doc.text(fmtAmt(Math.abs(balance)), W - margin, y + 7, { align: 'right' }); // BUG-04 fix
  y += 20;

  // Payment section
  if (payments.length > 0) {
    if (y > 250) { doc.addPage(); y = margin; } // BUG-13 fix
    setColor(colors.muted);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('PAYMENT HISTORY', margin, y);
    y += 6;
    payments.forEach(p => {
      if (y > 270) { doc.addPage(); y = margin; } // BUG-13 fix
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      setColor(colors.text);
      doc.text(`${formatDate(p.date)} - ${p.mode}: ${fmtAmt(p.amount)}${p.notes ? ` (${p.notes})` : ''}`, margin, y); // BUG-04 fix
      y += 6;
    });
    y += 4;
  }

  // Payment details footer
  if (profile?.upi || profile?.bankDetails) {
    if (y > 240) { doc.addPage(); y = margin; } // BUG-13 fix
    setFill(colors.light);
    doc.rect(margin, y, W - 2 * margin, 28, 'F');
    setColor(colors.muted);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('PAYMENT DETAILS', margin + 6, y + 8);
    doc.setFont('helvetica', 'normal');
    setColor(colors.text);
    let px = y + 15;
    if (profile.upi) { doc.text(`UPI: ${profile.upi}`, margin + 6, px); px += 6; }
    if (profile.bankDetails) {
      const lines = profile.bankDetails.split('\n').slice(0, 4); // cap lines to avoid overflow
      lines.forEach(l => { if (px < y + 27) { doc.text(l, margin + 6, px); px += 5; } });
    }
    y += 32;
  }

  // Footer
  setColor(colors.muted);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Thank you for your business!', W / 2, 290, { align: 'center' });

  doc.save(`${bill.billNumber}-${client?.name || 'Invoice'}.pdf`);
};

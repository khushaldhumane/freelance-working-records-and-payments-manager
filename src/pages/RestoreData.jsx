import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase/config';
import { collection, getDocs, updateDoc, doc, setDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

export default function RestoreData() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('idle'); // idle, running, success, error
  const [logs, setLogs] = useState([]);
  const [migratedCount, setMigratedCount] = useState(0);

  const addLog = (msg) => setLogs((prev) => [...prev, msg]);

  const handleRestore = async () => {
    if (!user) {
      addLog('❌ Error: You must be logged in first.');
      setStatus('error');
      return;
    }

    setStatus('running');
    setLogs([]);
    setMigratedCount(0);
    addLog(`🔄 Starting data restore for new User ID: ${user.uid}...`);

    const collections = ['bills', 'clients', 'workEntries', 'payments', 'tasks'];
    let totalUpdated = 0;

    try {
      for (const colName of collections) {
        addLog(`📂 Scanning collection: "${colName}"...`);
        const querySnapshot = await getDocs(collection(db, colName));
        let colUpdated = 0;

        for (const docSnap of querySnapshot.docs) {
          const data = docSnap.data();
          // If the userId doesn't match the current logged-in user's UID, update it
          if (data.userId !== user.uid) {
            await updateDoc(doc(db, colName, docSnap.id), {
              userId: user.uid
            });
            colUpdated++;
            totalUpdated++;
          }
        }
        addLog(`✅ Collection "${colName}" done. Updated ${colUpdated} documents.`);
      }

      // Also copy old profile settings to the new user.uid doc
      addLog(`📂 Scanning collection: "profile"...`);
      const profileSnap = await getDocs(collection(db, 'profile'));
      for (const pDoc of profileSnap.docs) {
        if (pDoc.id !== user.uid) {
          await setDoc(doc(db, 'profile', user.uid), pDoc.data(), { merge: true });
          addLog(`✅ Restored profile settings from old ID (${pDoc.id}).`);
          totalUpdated++;
          break;
        }
      }

      setMigratedCount(totalUpdated);
      addLog(`🎉 Restore complete! A total of ${totalUpdated} documents have been updated.`);
      setStatus('success');
    } catch (error) {
      console.error(error);
      addLog(`❌ Error running restore: ${error.message}`);
      addLog('👉 Please make sure you published the temporary "allow read, write: if true;" rule in Firebase Console.');
      setStatus('error');
    }
  };

  return (
    <div style={{
      maxWidth: 600,
      margin: '60px auto',
      padding: 32,
      background: 'var(--bg-glass)',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border-color)',
      boxShadow: 'var(--shadow-card)',
    }}>
      <h2 style={{ fontFamily: 'Space Grotesk', marginBottom: 16 }}>🛠️ Data Restore Utility</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
        This utility will update the user ID of all existing Firestore data (bills, clients, work entries, payments, and tasks) to your new logged-in account ID so you don't lose any of your records.
      </p>

      {status === 'idle' && (
        <button className="btn btn-primary btn-lg" onClick={handleRestore}>
          Start Restore Process
        </button>
      )}

      {status === 'running' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="spinner" style={{ width: 20, height: 20 }} />
          <span>Restoring your data... please do not close this tab.</span>
        </div>
      )}

      {status === 'success' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ color: 'var(--success)', fontWeight: 600 }}>
            🎉 Successfully restored {migratedCount} records!
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Go to Dashboard
          </button>
        </div>
      )}

      {status === 'error' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ color: 'var(--danger)', fontWeight: 600 }}>
            ⚠️ Restore failed. See details below.
          </div>
          <button className="btn btn-secondary" onClick={handleRestore}>
            Try Again
          </button>
        </div>
      )}

      {logs.length > 0 && (
        <div style={{
          marginTop: 24,
          padding: 16,
          background: 'rgba(0,0,0,0.3)',
          borderRadius: 'var(--radius-md)',
          fontFamily: 'monospace',
          fontSize: 12,
          maxHeight: 200,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }}>
          {logs.map((log, index) => (
            <div key={index}>{log}</div>
          ))}
        </div>
      )}
    </div>
  );
}

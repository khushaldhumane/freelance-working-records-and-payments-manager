import { createContext, useContext, useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useAuth } from './AuthContext';

const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (user) loadProfile();
    else setProfile(null); // Clear stale profile on logout
  }, [user]);

  const loadProfile = async () => {
    const ref = doc(db, 'profile', user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) setProfile(snap.data());
    else setProfile({ name: 'Freelancer', businessName: '', phone: '', upi: '', bankDetails: '', billPrefix: 'INV-', categories: defaultCategories });
  };

  const saveProfile = async (data) => {
    const ref = doc(db, 'profile', user.uid);
    await setDoc(ref, data, { merge: true });
    setProfile(prev => ({ ...prev, ...data }));
  };

  return (
    <AppContext.Provider value={{ profile, saveProfile, sidebarOpen, setSidebarOpen }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => useContext(AppContext);

export const defaultCategories = [
  'Web Design',
  'Web Development',
  'Mobile App',
  'UI/UX Design',
  'Logo Design',
  'Graphic Design',
  'Content Writing',
  'SEO',
  'Digital Marketing',
  'Bug Fix',
  'Maintenance',
  'Consultation',
  'Other'
];

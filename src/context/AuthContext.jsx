import { createContext, useContext, useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail
} from 'firebase/auth';
import { auth } from '../firebase/config';

const AuthContext = createContext();

// The single app user email (fixed, password-only auth concept)
export const APP_USER_EMAIL = 'khushaldhumane0011@gmail.com';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const login = (password) =>
    signInWithEmailAndPassword(auth, APP_USER_EMAIL, password);

  const logout = () => signOut(auth);

  const resetPassword = () =>
    sendPasswordResetEmail(auth, APP_USER_EMAIL);

  const changePassword = async (currentPassword, newPassword) => {
    const credential = EmailAuthProvider.credential(APP_USER_EMAIL, currentPassword);
    await reauthenticateWithCredential(auth.currentUser, credential);
    await updatePassword(auth.currentUser, newPassword);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, changePassword, resetPassword }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

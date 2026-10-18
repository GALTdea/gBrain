"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { auth, googleProvider, isFirebaseConfigured } from "@/lib/firebase/client";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  isConfigured: boolean;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  loginAsDemoUser: (name: "gustavo" | "gianna") => void;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const AUTH_CACHE_KEY = "gbrain_cached_auth_user";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const cached = localStorage.getItem(AUTH_CACHE_KEY);
      return cached ? (JSON.parse(cached) as User) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState<boolean>(() => Boolean(auth));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;

    const unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        setUser(currentUser);
        setLoading(false);
        try {
          if (currentUser) {
            localStorage.setItem(
              AUTH_CACHE_KEY,
              JSON.stringify({
                uid: currentUser.uid,
                email: currentUser.email,
                displayName: currentUser.displayName,
                photoURL: currentUser.photoURL,
              })
            );
          } else {
            localStorage.removeItem(AUTH_CACHE_KEY);
          }
        } catch {
          // ignore storage errors
        }
      },
      (err) => {
        console.error("Auth state error:", err);
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const signInWithEmail = async (email: string, pass: string) => {
    setError(null);
    if (!auth) {
      throw new Error("Firebase Auth is not configured. Please add your Firebase credentials.");
    }
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (err: unknown) {
      const authErr = err as { code?: string; message?: string };
      const message =
        authErr.code === "auth/invalid-credential"
          ? "Invalid email or password."
          : authErr.code === "auth/user-not-found"
          ? "Account not found. Open signups are disabled."
          : authErr.message || "Failed to sign in.";
      setError(message);
      throw err;
    }
  };

  const signInWithGoogle = async () => {
    setError(null);
    if (!auth || !googleProvider) {
      throw new Error("Firebase Auth is not configured. Please add your Firebase credentials.");
    }
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: unknown) {
      const authErr = err as { code?: string; message?: string };
      if (authErr.code !== "auth/popup-closed-by-user") {
        setError(authErr.message || "Google sign-in failed.");
      }
      throw err;
    }
  };

  const signOut = async () => {
    setError(null);
    try {
      localStorage.removeItem(AUTH_CACHE_KEY);
    } catch {
      // ignore
    }
    if (auth) {
      await firebaseSignOut(auth);
    }
    setUser(null);
  };

  // Demo user login for local UI validation when Firebase credentials are not yet injected
  const loginAsDemoUser = (name: "gustavo" | "gianna") => {
    const demoUser = {
      uid: name === "gustavo" ? "usr_gustavo_01" : "usr_gianna_02",
      email: name === "gustavo" ? "gustavo@example.com" : "gianna@example.com",
      displayName: name === "gustavo" ? "Gustavo" : "Gianna",
      emailVerified: true,
      isAnonymous: false,
      metadata: {},
      providerData: [],
      refreshToken: "",
      tenantId: null,
      delete: async () => {},
      getIdToken: async () => "mock-token",
      getIdTokenResult: async () => ({
        token: "mock-token",
        authTime: "0",
        issuedAtTime: "0",
        expirationTime: "0",
        signInProvider: "demo",
        signInSecondFactor: null,
        claims: {},
      }),
      reload: async () => {},
      toJSON: () => ({}),
      phoneNumber: null,
      photoURL: null,
      providerId: "demo",
    } as unknown as User;

    setUser(demoUser);
  };

  const clearError = () => setError(null);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        isConfigured: isFirebaseConfigured,
        signInWithEmail,
        signInWithGoogle,
        signOut,
        loginAsDemoUser,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}


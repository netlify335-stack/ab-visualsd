import { FirebaseAdapter } from './firebase/firebaseAdapter';
import { ADMIN_EMAIL, ADMIN_EMAILS } from './firebase/config';

declare global {
  interface Window {
    __ABV_FIREBASE__?: typeof FirebaseAdapter;
    __ABV_ADMIN_EMAIL__?: string;
    __ABV_ADMIN_EMAILS__?: string[];
    __ABV_ON_FIREBASE_READY__?: () => void;
  }
}

window.__ABV_FIREBASE__ = FirebaseAdapter;
window.__ABV_ADMIN_EMAIL__ = ADMIN_EMAIL;
window.__ABV_ADMIN_EMAILS__ = [...ADMIN_EMAILS];

if (typeof window.__ABV_ON_FIREBASE_READY__ === 'function') {
  window.__ABV_ON_FIREBASE_READY__();
}

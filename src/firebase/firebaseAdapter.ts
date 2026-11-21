import {
  EmailAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  reauthenticateWithPopup,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
} from 'firebase/storage';
import {
  ADMIN_EMAIL,
  ADMIN_EMAILS,
  ADMIN_PHONE,
  FIREBASE_CONFIG,
  OperationType,
  PRIMARY_ADMIN_UID,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  storage,
} from './config';
import {
  SCHEMA_LIMITS,
  aggregateAnalyticsEvents,
  extractMediaIdsFromProject,
  isAuthorizedAdminIdentity,
  isMediaRef,
  normalizeAnalyticsEventPayload,
  normalizeInquiryPayload,
  normalizeProjectPayload,
  normalizeSiteContentData,
  parseMediaRef,
  resolveAdminEmailForPhone,
  sanitizeId,
  sortProjects,
  toMediaRef,
  type AnalyticsEventRecord,
  type AnalyticsEventType,
  type AnalyticsSummary,
  type GalleryImage,
  type InquiryInput,
  type PortfolioProject,
} from './portfolioUtils';

export interface AdminUserState {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  isAdmin: boolean;
}

const mediaIdToDataUrl = new Map<string, string>();
const dataUrlToMediaId = new Map<string, string>();
let lastUploadChannel: 'firebase-storage' | 'firestore-media' | null = null;
let storageUnavailable = false;
let verifiedAdminCache: { uid: string; isAdmin: boolean } | null = null;

function generateId(prefix: string): string {
  const base =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return sanitizeId(`${prefix}-${base}`, prefix);
}

async function checkIsAdminUser(user: User | null): Promise<boolean> {
  if (!user) return false;
  if (
    isAuthorizedAdminIdentity(
      { uid: user.uid, email: user.email, emailVerified: user.emailVerified },
      ADMIN_EMAILS,
      PRIMARY_ADMIN_UID
    )
  ) {
    return true;
  }
  if (!user.emailVerified) return false;
  if (verifiedAdminCache && verifiedAdminCache.uid === user.uid) {
    return verifiedAdminCache.isAdmin;
  }
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    const ok = snap.exists() && snap.data()?.role === 'admin';
    verifiedAdminCache = { uid: user.uid, isAdmin: ok };
    return ok;
  } catch {
    return false;
  }
}

async function requireVerifiedAdmin(): Promise<User> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Please sign in as Studio Admin first.');
  }
  const ok = await checkIsAdminUser(user);
  if (!ok) {
    throw new Error(`Account ${user.email || ''} is not authorized as Studio Admin.`);
  }
  return user;
}

function compressImageFile(
  file: File,
  maxDim: number,
  quality: number,
  onProg?: (p: number) => void
): Promise<{ blob: Blob; dataUrl: string; w: number; h: number; mimeType: string }> {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) {
      reject(new Error('Not an image file'));
      return;
    }
    onProg?.(0.08);
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      onProg?.(0.28);
      try {
        const sc = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * sc));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * sc));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objUrl);
          reject(new Error('Canvas context unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(objUrl);
        onProg?.(0.45);
        let mimeType = 'image/webp';
        let dataUrl = '';
        try {
          dataUrl = canvas.toDataURL('image/webp', quality);
          if (!dataUrl.startsWith('data:image/webp')) {
            mimeType = 'image/jpeg';
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }
        } catch {
          mimeType = 'image/jpeg';
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Could not encode image'));
              return;
            }
            onProg?.(0.6);
            resolve({ blob, dataUrl, w: canvas.width, h: canvas.height, mimeType });
          },
          mimeType,
          quality
        );
      } catch (err) {
        URL.revokeObjectURL(objUrl);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      reject(new Error('Could not read image file'));
    };
    img.src = objUrl;
  });
}

async function compressToFitFirestore(
  file: File
): Promise<{ dataUrl: string; w: number; h: number; mimeType: string }> {
  const attempts: Array<[number, number]> = [
    [1600, 0.82],
    [1280, 0.76],
    [1024, 0.7],
    [800, 0.62],
  ];
  for (const [dim, q] of attempts) {
    const res = await compressImageFile(file, dim, q);
    if (res.dataUrl.length <= 720000) {
      return { dataUrl: res.dataUrl, w: res.w, h: res.h, mimeType: res.mimeType };
    }
  }
  const fallback = await compressImageFile(file, 640, 0.55);
  if (fallback.dataUrl.length > SCHEMA_LIMITS.mediaDataUrlMax) {
    throw new Error('Image is too large even after compression.');
  }
  return {
    dataUrl: fallback.dataUrl,
    w: fallback.w,
    h: fallback.h,
    mimeType: fallback.mimeType,
  };
}

function uploadToFirebaseStorage(
  blob: Blob,
  path: string,
  mimeType: string,
  onProg?: (p: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const fileRef = storageRef(storage, path);
    const task = uploadBytesResumable(fileRef, blob, { contentType: mimeType });
    let settled = false;

    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          task.cancel();
        } catch {
          // ignore
        }
        reject(new Error('Firebase Storage upload timed out'));
      }
    }, 4500);

    task.on(
      'state_changed',
      (snap) => {
        if (snap.totalBytes > 0) {
          const frac = snap.bytesTransferred / snap.totalBytes;
          onProg?.(0.6 + frac * 0.35);
        }
      },
      (err) => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          reject(err);
        }
      },
      async () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          onProg?.(0.98);
          resolve(url);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

async function saveMediaDoc(
  dataUrl: string,
  mimeType: string,
  w: number,
  h: number,
  uid: string
): Promise<string> {
  const existing = dataUrlToMediaId.get(dataUrl);
  if (existing) return existing;

  const mediaId = generateId('media');
  const safeMime =
    mimeType === 'image/jpeg' || mimeType === 'image/png' ? mimeType : 'image/webp';
  const payload = {
    id: mediaId,
    dataUrl,
    mimeType: safeMime,
    width: Math.max(1, Math.min(4096, Math.round(w || 1200))),
    height: Math.max(1, Math.min(4096, Math.round(h || 800))),
    createdAt: serverTimestamp(),
    uploadedBy: uid,
  };
  try {
    await setDoc(doc(db, 'media', mediaId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `media/${mediaId}`);
  }
  mediaIdToDataUrl.set(mediaId, dataUrl);
  dataUrlToMediaId.set(dataUrl, mediaId);
  return mediaId;
}

async function resolveMediaUrl(url: string): Promise<string> {
  const mediaId = parseMediaRef(url);
  if (!mediaId) return url;
  const cached = mediaIdToDataUrl.get(mediaId);
  if (cached) return cached;
  try {
    const snap = await getDoc(doc(db, 'media', mediaId));
    if (snap.exists()) {
      const dataUrl = String(snap.data()?.dataUrl || '');
      if (dataUrl) {
        mediaIdToDataUrl.set(mediaId, dataUrl);
        dataUrlToMediaId.set(dataUrl, mediaId);
        return dataUrl;
      }
    }
  } catch (err) {
    console.warn('Could not resolve media asset:', mediaId, err);
  }
  return '';
}

async function dehydrateUrlForFirestore(
  url: string,
  uid: string,
  w = 1200,
  h = 800
): Promise<{ url: string; mediaId?: string }> {
  if (!url) return { url: '' };
  if (isMediaRef(url)) {
    return { url, mediaId: parseMediaRef(url) || undefined };
  }
  const knownMediaId = dataUrlToMediaId.get(url);
  if (knownMediaId) {
    return { url: toMediaRef(knownMediaId), mediaId: knownMediaId };
  }
  if (url.startsWith('data:image/')) {
    if (url.length <= SCHEMA_LIMITS.mediaDataUrlMax) {
      const mimeMatch = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/webp';
      const mediaId = await saveMediaDoc(url, mime, w, h, uid);
      return { url: toMediaRef(mediaId), mediaId };
    }
    throw new Error('Embedded image exceeds 850KB limit; please re-upload the photo.');
  }
  return { url };
}

async function hydrateProject(raw: PortfolioProject): Promise<PortfolioProject> {
  const gallery: GalleryImage[] = await Promise.all(
    (raw.gallery_images || []).map(async (g) => {
      const resolved = await resolveMediaUrl(g.url);
      return {
        ...g,
        url: resolved || g.url,
        mediaId: g.mediaId || parseMediaRef(g.url) || undefined,
      };
    })
  );
  const cover = await resolveMediaUrl(raw.cover_image_url);
  return {
    ...raw,
    cover_image_url: cover || (gallery[0]?.url ?? ''),
    gallery_images: gallery,
  };
}

export const FirebaseAdapter = {
  name: 'firebase' as const,
  config: FIREBASE_CONFIG,

  get lastUploadChannel() {
    return lastUploadChannel;
  },

  async init(): Promise<void> {
    if (typeof auth.authStateReady === 'function') {
      await auth.authStateReady();
    }
  },

  async getAdminUser(): Promise<AdminUserState | null> {
    if (typeof auth.authStateReady === 'function') {
      await auth.authStateReady();
    }
    const user = auth.currentUser;
    if (!user) return null;
    const isAdmin = await checkIsAdminUser(user);
    return {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || user.email || 'Admin',
      photoURL: user.photoURL || '',
      isAdmin,
    };
  },

  onAdminAuthChange(cb: (state: AdminUserState | null) => void): Unsubscribe {
    return onAuthStateChanged(auth, async (user) => {
      verifiedAdminCache = null;
      if (!user) {
        cb(null);
        return;
      }
      const isAdmin = await checkIsAdminUser(user);
      cb({
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || user.email || 'Admin',
        photoURL: user.photoURL || '',
        isAdmin,
      });
    });
  },

  async signInAdmin(): Promise<AdminUserState> {
    const cred = await signInWithPopup(auth, googleProvider);
    verifiedAdminCache = null;
    const user = cred.user;
    const isAdmin = await checkIsAdminUser(user);
    return {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || user.email || 'Admin',
      photoURL: user.photoURL || '',
      isAdmin,
    };
  },

  async signInAdminWithPhone(phone: string, password: string): Promise<AdminUserState> {
    const email = resolveAdminEmailForPhone(phone, ADMIN_PHONE, ADMIN_EMAIL);
    const cleanPass = String(password || '').trim();
    if (!email || !cleanPass) {
      throw new Error('Invalid mobile number or password.');
    }
    const cred = await signInWithEmailAndPassword(auth, email, cleanPass);
    verifiedAdminCache = null;
    const user = cred.user;
    const isAdmin = await checkIsAdminUser(user);
    return {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || user.email || 'Admin',
      photoURL: user.photoURL || '',
      isAdmin,
    };
  },

  hasPasswordLoginEnabled(): boolean {
    const user = auth.currentUser;
    if (!user) return false;
    return (user.providerData || []).some((p) => p.providerId === 'password');
  },

  async setDirectLoginPassword(password: string): Promise<'linked' | 'updated'> {
    const user = await requireVerifiedAdmin();
    const trimmed = String(password || '');
    if (trimmed.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }
    const alreadyLinked = (user.providerData || []).some((p) => p.providerId === 'password');
    const runOp = async (): Promise<'linked' | 'updated'> => {
      if (alreadyLinked) {
        await updatePassword(user, trimmed);
        return 'updated';
      }
      const cred = EmailAuthProvider.credential(user.email || ADMIN_EMAIL, trimmed);
      await linkWithCredential(user, cred);
      return 'linked';
    };
    try {
      return await runOp();
    } catch (err: any) {
      if (err?.code === 'auth/requires-recent-login') {
        await reauthenticateWithPopup(user, googleProvider);
        return await runOp();
      }
      throw err;
    }
  },

  async signOutAdmin(): Promise<void> {
    verifiedAdminCache = null;
    await signOut(auth);
  },

  async getProjects(includeDrafts = false): Promise<PortfolioProject[]> {
    const canSeeAll = includeDrafts && (await checkIsAdminUser(auth.currentUser));
    const q = canSeeAll
      ? collection(db, 'projects')
      : query(collection(db, 'projects'), where('is_published', '==', true));

    let snap;
    try {
      snap = await getDocs(q);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'projects');
    }

    const rawList: PortfolioProject[] = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data() as PortfolioProject;
      rawList.push({ ...d, id: d.id || docSnap.id });
    });

    const hydrated = await Promise.all(rawList.map(hydrateProject));
    return sortProjects(hydrated);
  },

  async saveProject(project: Partial<PortfolioProject>): Promise<void> {
    const user = await requireVerifiedAdmin();
    const dehydratedGallery: GalleryImage[] = [];
    for (const g of project.gallery_images || []) {
      const { url, mediaId } = await dehydrateUrlForFirestore(
        g.url,
        user.uid,
        g.w || 1200,
        g.h || 800
      );
      dehydratedGallery.push({
        id: sanitizeId(g.id, 'img'),
        url,
        caption: g.caption || '',
        w: g.w || 0,
        h: g.h || 0,
        ...(mediaId ? { mediaId } : {}),
      });
    }

    const rawCover = project.cover_image_url || dehydratedGallery[0]?.url || '';
    const { url: dehydratedCover } = await dehydrateUrlForFirestore(rawCover, user.uid);

    const normalized = normalizeProjectPayload(
      {
        ...project,
        cover_image_url: dehydratedCover,
        gallery_images: dehydratedGallery,
      },
      user.uid
    );

    const docRef = doc(db, 'projects', normalized.id);
    let existingSnap;
    try {
      existingSnap = await getDoc(docRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `projects/${normalized.id}`);
    }

    if (existingSnap.exists()) {
      const { id: _id, created_at: _ca, ...mutable } = normalized;
      try {
        await updateDoc(docRef, {
          ...mutable,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `projects/${normalized.id}`);
      }
    } else {
      try {
        await setDoc(docRef, {
          ...normalized,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `projects/${normalized.id}`);
      }
    }
  },

  async deleteProject(id: string): Promise<void> {
    await requireVerifiedAdmin();
    const safeId = sanitizeId(id, 'proj');
    const docRef = doc(db, 'projects', safeId);

    // Best-effort cleanup of Firestore fallback media documents owned by this project
    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data() as PortfolioProject;
        const mediaIds = extractMediaIdsFromProject(data);
        for (const mid of mediaIds) {
          deleteDoc(doc(db, 'media', mid)).catch(() => {});
          mediaIdToDataUrl.delete(mid);
        }
        // Best-effort Firebase Storage cleanup for storage URLs under ab-visuals/
        const allUrls = [
          data.cover_image_url,
          ...(data.gallery_images || []).map((g) => g.url),
        ].filter((u) => typeof u === 'string' && u.includes('firebasestorage.googleapis.com'));
        for (const u of allUrls) {
          try {
            deleteObject(storageRef(storage, u)).catch(() => {});
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // proceed with project delete
    }

    try {
      await deleteDoc(docRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `projects/${safeId}`);
    }
  },

  async reorderProjects(list: PortfolioProject[]): Promise<void> {
    const user = await requireVerifiedAdmin();
    const batch = writeBatch(db);
    list.forEach((p, idx) => {
      const safeId = sanitizeId(p.id, 'proj');
      batch.update(doc(db, 'projects', safeId), {
        sort_order: idx,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
    });
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'projects');
    }
  },

  async getSite(): Promise<Record<string, unknown> | null> {
    const docRef = doc(db, 'site_content', 'main');
    let snap;
    try {
      snap = await getDoc(docRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'site_content/main');
    }
    if (!snap.exists()) return null;
    const rawData = (snap.data()?.data || null) as Record<string, any> | null;
    if (!rawData) return null;
    if (rawData.badge?.photoUrl && isMediaRef(rawData.badge.photoUrl)) {
      rawData.badge = {
        ...rawData.badge,
        photoUrl: await resolveMediaUrl(rawData.badge.photoUrl),
      };
    }
    if (rawData.visuals && typeof rawData.visuals === 'object') {
      const vis = { ...rawData.visuals };
      for (const k of ['heroPlateUrl', 'heroCutUrl', 'casePlateUrl'] as const) {
        if (vis[k] && isMediaRef(vis[k])) {
          vis[k] = await resolveMediaUrl(vis[k]);
        }
      }
      rawData.visuals = vis;
    }
    return rawData;
  },

  async saveSite(data: Record<string, any>): Promise<void> {
    const user = await requireVerifiedAdmin();
    const copy = JSON.parse(JSON.stringify(data || {}));
    if (copy.badge?.photoUrl) {
      const { url } = await dehydrateUrlForFirestore(copy.badge.photoUrl, user.uid, 800, 800);
      copy.badge.photoUrl = url;
    }
    if (copy.visuals && typeof copy.visuals === 'object') {
      for (const k of ['heroPlateUrl', 'heroCutUrl', 'casePlateUrl'] as const) {
        if (copy.visuals[k]) {
          const { url } = await dehydrateUrlForFirestore(copy.visuals[k], user.uid, 1920, 1080);
          copy.visuals[k] = url;
        }
      }
    }
    const cleanData = normalizeSiteContentData(copy);
    const docRef = doc(db, 'site_content', 'main');
    let existingSnap;
    try {
      existingSnap = await getDoc(docRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'site_content/main');
    }

    if (existingSnap.exists()) {
      try {
        await updateDoc(docRef, {
          data: cleanData,
          seeded: true,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'site_content/main');
      }
    } else {
      try {
        await setDoc(docRef, {
          id: 'main',
          data: cleanData,
          seeded: true,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'site_content/main');
      }
    }
  },

  async uploadImage(
    file: File,
    onProg?: (p: number) => void
  ): Promise<{ url: string; w: number; h: number; mediaId?: string }> {
    const user = await requireVerifiedAdmin();
    const compressed = await compressImageFile(file, 2048, 0.85, onProg);
    const ext = (compressed.mimeType.split('/')[1] || 'webp').split('+')[0];
    const storagePath = `ab-visuals/projects/${generateId('img')}.${ext}`;

    // Primary: Firebase Storage
    if (!storageUnavailable) {
      try {
        const downloadUrl = await uploadToFirebaseStorage(
          compressed.blob,
          storagePath,
          compressed.mimeType,
          onProg
        );
        lastUploadChannel = 'firebase-storage';
        onProg?.(1);
        return { url: downloadUrl, w: compressed.w, h: compressed.h };
      } catch (storageErr) {
        storageUnavailable = true;
        console.warn(
          'Firebase Storage unavailable, storing optimized image in Firestore media collection:',
          storageErr instanceof Error ? storageErr.message : storageErr
        );
      }
    }

    // Resilient cloud fallback: Firestore /media/{mediaId} (globally visible to all visitors)
    onProg?.(0.72);
    const fitted =
      compressed.dataUrl.length <= 720000
        ? {
            dataUrl: compressed.dataUrl,
            w: compressed.w,
            h: compressed.h,
            mimeType: compressed.mimeType,
          }
        : await compressToFitFirestore(file);

    onProg?.(0.88);
    const mediaId = await saveMediaDoc(
      fitted.dataUrl,
      fitted.mimeType,
      fitted.w,
      fitted.h,
      user.uid
    );
    lastUploadChannel = 'firestore-media';
    onProg?.(1);
    return { url: fitted.dataUrl, w: fitted.w, h: fitted.h, mediaId };
  },

  async logInquiry(rec: InquiryInput): Promise<boolean> {
    const normalized = normalizeInquiryPayload(rec, generateId('inq'));
    try {
      await setDoc(doc(db, 'inquiries', normalized.id), {
        ...normalized,
        createdAt: serverTimestamp(),
      });
      return true;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `inquiries/${normalized.id}`);
    }
  },

  async getInquiries(): Promise<Array<Record<string, unknown>>> {
    await requireVerifiedAdmin();
    let snap;
    try {
      snap = await getDocs(collection(db, 'inquiries'));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'inquiries');
    }
    const items: Array<Record<string, unknown>> = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    return items
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, 50);
  },

  async deleteInquiry(id: string): Promise<void> {
    await requireVerifiedAdmin();
    const safeId = sanitizeId(id, 'inq');
    try {
      await deleteDoc(doc(db, 'inquiries', safeId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `inquiries/${safeId}`);
    }
  },

  async trackEvent(input: {
    type: AnalyticsEventType;
    projectId?: string;
    projectTitle?: string;
  }): Promise<boolean> {
    const normalized = normalizeAnalyticsEventPayload(input, generateId('evt'));
    if (!normalized) return false;
    try {
      await setDoc(doc(db, 'analytics_events', normalized.id), {
        ...normalized,
        createdAt: serverTimestamp(),
      });
      return true;
    } catch {
      return false;
    }
  },

  async getAnalyticsSummary(projectsList?: PortfolioProject[]): Promise<AnalyticsSummary> {
    await requireVerifiedAdmin();
    let snap;
    try {
      snap = await getDocs(
        query(collection(db, 'analytics_events'), orderBy('createdAt', 'desc'), limit(2500))
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'analytics_events');
    }
    const events: Partial<AnalyticsEventRecord>[] = [];
    snap.forEach((docSnap) => {
      events.push(docSnap.data() as Partial<AnalyticsEventRecord>);
    });
    const projects = Array.isArray(projectsList) ? projectsList : await this.getProjects(true);
    return aggregateAnalyticsEvents(events, projects);
  },

  async checkHealth(): Promise<{
    ok: boolean;
    publishedCount: number;
    totalCount: number;
    siteConfigured: boolean;
    uploadChannel: string;
    latencyMs: number;
  }> {
    const t0 = performance.now();
    const [siteSnap, projects] = await Promise.all([
      getDoc(doc(db, 'site_content', 'main')),
      this.getProjects(true),
    ]);
    const publishedCount = projects.filter((p) => p.is_published !== false).length;
    return {
      ok: true,
      publishedCount,
      totalCount: projects.length,
      siteConfigured: siteSnap.exists(),
      uploadChannel: lastUploadChannel || (storageUnavailable ? 'firestore-media' : 'firebase-storage (auto-fallback enabled)'),
      latencyMs: Math.max(1, Math.round(performance.now() - t0)),
    };
  },

  async seedIfEmpty(
    seedProjectsFn: () => PortfolioProject[],
    defaultSite: Record<string, any>
  ): Promise<boolean> {
    const user = await requireVerifiedAdmin();
    const siteRef = doc(db, 'site_content', 'main');
    const siteSnap = await getDoc(siteRef);
    if (siteSnap.exists() && siteSnap.data()?.seeded === true) {
      return false;
    }

    const existingProjects = await getDocs(collection(db, 'projects'));
    if (existingProjects.empty) {
      const seeds = seedProjectsFn();
      for (let i = 0; i < seeds.length; i++) {
        await this.saveProject({ ...seeds[i], sort_order: i });
      }
    }

    if (!siteSnap.exists()) {
      await setDoc(siteRef, {
        id: 'main',
        data: normalizeSiteContentData(defaultSite),
        seeded: true,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
    } else {
      await updateDoc(siteRef, {
        seeded: true,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
    }
    return true;
  },

  realtime(cb: (what: 'projects' | 'site') => void): () => void {
    let firstProj = true;
    let firstSite = true;

    const unsubProjects = onSnapshot(
      query(collection(db, 'projects'), where('is_published', '==', true)),
      () => {
        if (firstProj) {
          firstProj = false;
          return;
        }
        cb('projects');
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, 'projects');
        } catch {
          // keep UI responsive
        }
      }
    );

    const unsubSite = onSnapshot(
      doc(db, 'site_content', 'main'),
      () => {
        if (firstSite) {
          firstSite = false;
          return;
        }
        cb('site');
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.GET, 'site_content/main');
        } catch {
          // keep UI responsive
        }
      }
    );

    return () => {
      unsubProjects();
      unsubSite();
    };
  },
};

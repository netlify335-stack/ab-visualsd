export const MEDIA_REF_PREFIX = 'fbmedia://';

export const SCHEMA_LIMITS = {
  id: 128,
  title: 200,
  slug: 200,
  category: 120,
  location: 200,
  year: 20,
  ticketRowsMax: 5,
  ticketRowLen: 120,
  shortKey: 160,
  shortDesc: 500,
  fullDesc: 8000,
  youtubeUrlsMax: 30,
  youtubeUrlLen: 500,
  previewVideoUrl: 1000,
  coverImageUrl: 2000,
  galleryImagesMax: 100,
  captionLen: 400,
  createdAtStr: 64,
  sortOrderMax: 10000,
  mediaDataUrlMax: 850000,
  inquiryName: 120,
  inquiryPhone: 40,
  inquiryType: 120,
  inquiryDate: 40,
  inquiryLocation: 200,
  inquiryMessage: 2000,
  analyticsType: 32,
  analyticsProjectId: 128,
  analyticsProjectTitle: 200,
} as const;

export const ANALYTICS_EVENT_TYPES = [
  'visitor',
  'home',
  'portfolio',
  'services',
  'book',
  'whatsapp',
  'project_view',
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export interface AnalyticsEventRecord {
  id: string;
  type: AnalyticsEventType;
  projectId: string;
  projectTitle: string;
  created_at: string;
}

export interface ProjectViewStat {
  projectId: string;
  title: string;
  category: string;
  coverUrl: string;
  views: number;
}

export interface AnalyticsSummary {
  visitors: number;
  home: number;
  portfolio: number;
  services: number;
  book: number;
  whatsapp: number;
  totalClicks: number;
  totalProjectViews: number;
  projectViews: ProjectViewStat[];
  topProject: ProjectViewStat | null;
  lastUpdatedAt: string;
}

export interface GalleryImage {
  id: string;
  url: string;
  caption: string;
  w: number;
  h: number;
  mediaId?: string;
}

export interface PortfolioProject {
  id: string;
  title: string;
  slug: string;
  category: string;
  location: string;
  year: string;
  ticket_rows: string[];
  short_key: string;
  short_desc: string;
  full_description: string;
  youtube_urls: string[];
  preview_video_url: string;
  cover_image_url: string;
  gallery_images: GalleryImage[];
  sort_order: number;
  is_published: boolean;
  created_at: string;
}

export interface InquiryInput {
  name?: string;
  phone?: string;
  shoot_type?: string;
  shoot_date?: string;
  shoot_location?: string;
  message?: string;
}

const VALID_ID_RE = /^[a-zA-Z0-9_-]+$/;
export const SITE_DATA_KEYS = [
  'hero',
  'badge',
  'nav',
  'contact',
  'socials',
  'services',
  'seo',
  'categories',
  'inquiryTypes',
  'visuals',
] as const;

const DEMO_PREVIEW_HOST_RE = /^https:\/\/pub-[a-z0-9]+\.r2\.dev\//i;

export function extractYouTubeId(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  const trimmed = url.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(
    /(?:(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i
  );
  return match ? match[1] : null;
}

export function toYouTubeWatchUrl(urlOrId: unknown): string {
  const id = extractYouTubeId(urlOrId);
  return id ? `https://www.youtube.com/watch?v=${id}` : '';
}

export function isDemoPreviewVideoUrl(url: unknown): boolean {
  return typeof url === 'string' && DEMO_PREVIEW_HOST_RE.test(url.trim());
}

export function shouldPreferYouTubePreview(project: {
  preview_video_url?: string;
  youtube_urls?: string[];
}): boolean {
  const hasYt = (project.youtube_urls || []).some((u) => Boolean(extractYouTubeId(u)));
  if (!hasYt) return false;
  const prev = String(project.preview_video_url || '').trim();
  return !prev || isDemoPreviewVideoUrl(prev);
}

export function normalizePhoneNumber(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D+/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  return digits;
}

export function resolveAdminEmailForPhone(
  rawPhone: unknown,
  allowedPhone: string,
  adminEmail: string
): string | null {
  const input = normalizePhoneNumber(rawPhone);
  const expected = normalizePhoneNumber(allowedPhone);
  if (!input || !expected || input !== expected) return null;
  return adminEmail;
}

export function isAllowedAdminEmail(
  email: unknown,
  allowedEmails: readonly string[]
): boolean {
  if (typeof email !== 'string' || !email.trim()) return false;
  const normalized = email.trim().toLowerCase();
  return allowedEmails.some((e) => e.trim().toLowerCase() === normalized);
}

export function isAuthorizedAdminIdentity(
  identity: {
    uid?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  } | null,
  allowedEmails: readonly string[],
  primaryAdminUid?: string
): boolean {
  if (!identity) return false;
  if (primaryAdminUid && identity.uid && identity.uid === primaryAdminUid) {
    return true;
  }
  if (identity.emailVerified === true && isAllowedAdminEmail(identity.email, allowedEmails)) {
    return true;
  }
  return false;
}

export function truncateStr(val: unknown, maxLen: number): string {
  const s = val == null ? '' : String(val);
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export function sanitizeId(raw: unknown, fallbackPrefix = 'id'): string {
  const cleaned = String(raw ?? '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SCHEMA_LIMITS.id);
  if (cleaned && VALID_ID_RE.test(cleaned)) {
    return cleaned;
  }
  const rand = Math.random().toString(36).slice(2, 10);
  return `${fallbackPrefix}-${Date.now()}-${rand}`.slice(0, SCHEMA_LIMITS.id);
}

export function slugifyTitle(title: string): string {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, SCHEMA_LIMITS.slug);
}

export function isMediaRef(url: unknown): boolean {
  return typeof url === 'string' && url.startsWith(MEDIA_REF_PREFIX) && url.length > MEDIA_REF_PREFIX.length;
}

export function toMediaRef(mediaId: string): string {
  return `${MEDIA_REF_PREFIX}${sanitizeId(mediaId, 'img')}`;
}

export function parseMediaRef(url: unknown): string | null {
  if (typeof url !== 'string' || !isMediaRef(url)) return null;
  const id = url.slice(MEDIA_REF_PREFIX.length);
  return VALID_ID_RE.test(id) && id.length <= SCHEMA_LIMITS.id ? id : null;
}

export function extractMediaIdsFromProject(project: Partial<PortfolioProject>): string[] {
  const ids = new Set<string>();
  const coverId = parseMediaRef(project.cover_image_url);
  if (coverId) ids.add(coverId);
  for (const g of project.gallery_images || []) {
    const gid = parseMediaRef(g?.url);
    if (gid) ids.add(gid);
    if (g?.mediaId && VALID_ID_RE.test(g.mediaId)) ids.add(g.mediaId);
  }
  return Array.from(ids);
}

export function clampNumber(val: unknown, min: number, max: number, fallback = 0): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function normalizeProjectPayload(
  input: Partial<PortfolioProject>,
  uid: string
): Omit<PortfolioProject, 'created_at'> & { created_at: string; updatedBy: string } {
  const safeId = sanitizeId(input.id, 'proj');
  const title = truncateStr((input.title || '').trim() || 'UNTITLED PROJECT', SCHEMA_LIMITS.title);
  const slug = truncateStr(input.slug || slugifyTitle(title), SCHEMA_LIMITS.slug);

  const ticketRows = (Array.isArray(input.ticket_rows) ? input.ticket_rows : [])
    .slice(0, SCHEMA_LIMITS.ticketRowsMax)
    .map((r) => truncateStr(r, SCHEMA_LIMITS.ticketRowLen));

  const youtubeUrls = (Array.isArray(input.youtube_urls) ? input.youtube_urls : [])
    .map((u) => truncateStr(String(u || '').trim(), SCHEMA_LIMITS.youtubeUrlLen))
    .filter(Boolean)
    .slice(0, SCHEMA_LIMITS.youtubeUrlsMax);

  const galleryImages: GalleryImage[] = (Array.isArray(input.gallery_images) ? input.gallery_images : [])
    .slice(0, SCHEMA_LIMITS.galleryImagesMax)
    .filter((g) => g && typeof g.url === 'string' && g.url.length > 0)
    .map((g) => {
      const clean: GalleryImage = {
        id: sanitizeId(g.id, 'img'),
        url: truncateStr(g.url, SCHEMA_LIMITS.coverImageUrl),
        caption: truncateStr(g.caption || '', SCHEMA_LIMITS.captionLen),
        w: clampNumber(g.w, 0, 10000, 0),
        h: clampNumber(g.h, 0, 10000, 0),
      };
      if (g.mediaId && VALID_ID_RE.test(g.mediaId)) {
        clean.mediaId = g.mediaId.slice(0, SCHEMA_LIMITS.id);
      }
      return clean;
    });

  return {
    id: safeId,
    title,
    slug,
    category: truncateStr(input.category || '', SCHEMA_LIMITS.category),
    location: truncateStr(input.location || '', SCHEMA_LIMITS.location),
    year: truncateStr(input.year || '', SCHEMA_LIMITS.year),
    ticket_rows: ticketRows,
    short_key: truncateStr(input.short_key || '', SCHEMA_LIMITS.shortKey),
    short_desc: truncateStr(input.short_desc || '', SCHEMA_LIMITS.shortDesc),
    full_description: truncateStr(input.full_description || '', SCHEMA_LIMITS.fullDesc),
    youtube_urls: youtubeUrls,
    preview_video_url: truncateStr(input.preview_video_url || '', SCHEMA_LIMITS.previewVideoUrl),
    cover_image_url: truncateStr(input.cover_image_url || '', SCHEMA_LIMITS.coverImageUrl),
    gallery_images: galleryImages,
    sort_order: clampNumber(input.sort_order, 0, SCHEMA_LIMITS.sortOrderMax, 0),
    is_published: input.is_published !== false,
    created_at: truncateStr(input.created_at || new Date().toISOString(), SCHEMA_LIMITS.createdAtStr),
    updatedBy: truncateStr(uid, SCHEMA_LIMITS.id),
  };
}

export function normalizeSiteContentData(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SITE_DATA_KEYS) {
    if (raw && Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined) {
      out[key] = raw[key];
    }
  }
  return out;
}

export function normalizeInquiryPayload(input: InquiryInput, rawId?: string) {
  const id = sanitizeId(rawId, 'inq');
  const name = truncateStr((input.name || '').trim() || 'Visitor', SCHEMA_LIMITS.inquiryName);
  return {
    id,
    name,
    phone: truncateStr((input.phone || '').trim(), SCHEMA_LIMITS.inquiryPhone),
    shoot_type: truncateStr((input.shoot_type || '').trim(), SCHEMA_LIMITS.inquiryType),
    shoot_date: truncateStr((input.shoot_date || '').trim(), SCHEMA_LIMITS.inquiryDate),
    shoot_location: truncateStr((input.shoot_location || '').trim(), SCHEMA_LIMITS.inquiryLocation),
    message: truncateStr((input.message || '').trim(), SCHEMA_LIMITS.inquiryMessage),
    created_at: new Date().toISOString().slice(0, SCHEMA_LIMITS.createdAtStr),
  };
}

export function sortProjects<T extends { sort_order?: number; created_at?: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ao = typeof a.sort_order === 'number' ? a.sort_order : 0;
    const bo = typeof b.sort_order === 'number' ? b.sort_order : 0;
    if (ao !== bo) return ao - bo;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
}

export function filterPublishedProjects<T extends { is_published?: boolean }>(list: T[]): T[] {
  return list.filter((p) => p.is_published !== false);
}

export function normalizeAnalyticsEventPayload(
  input: { type: unknown; projectId?: unknown; projectTitle?: unknown },
  rawId?: string
): AnalyticsEventRecord | null {
  const rawType = typeof input.type === 'string' ? input.type.trim() : '';
  if (!(ANALYTICS_EVENT_TYPES as readonly string[]).includes(rawType)) {
    return null;
  }
  const type = rawType as AnalyticsEventType;
  const projectId =
    type === 'project_view'
      ? truncateStr(String(input.projectId ?? '').trim(), SCHEMA_LIMITS.analyticsProjectId)
      : '';
  const projectTitle =
    type === 'project_view'
      ? truncateStr(String(input.projectTitle ?? '').trim(), SCHEMA_LIMITS.analyticsProjectTitle)
      : '';

  return {
    id: sanitizeId(rawId, 'evt'),
    type,
    projectId,
    projectTitle,
    created_at: new Date().toISOString().slice(0, SCHEMA_LIMITS.createdAtStr),
  };
}

export function aggregateAnalyticsEvents(
  events: Array<Partial<AnalyticsEventRecord>>,
  projects: Array<{
    id: string;
    title?: string;
    category?: string;
    cover_image_url?: string;
    gallery_images?: Array<{ url?: string }>;
  }> = []
): AnalyticsSummary {
  const counts = {
    visitor: 0,
    home: 0,
    portfolio: 0,
    services: 0,
    book: 0,
    whatsapp: 0,
  };

  const viewMap = new Map<string, { views: number; fallbackTitle: string }>();
  let totalProjectViews = 0;

  for (const ev of events || []) {
    const t = ev?.type;
    if (t === 'visitor') counts.visitor += 1;
    else if (t === 'home') counts.home += 1;
    else if (t === 'portfolio') counts.portfolio += 1;
    else if (t === 'services') counts.services += 1;
    else if (t === 'book') counts.book += 1;
    else if (t === 'whatsapp') counts.whatsapp += 1;
    else if (t === 'project_view') {
      totalProjectViews += 1;
      const pid = String(ev.projectId || '').trim();
      const title = String(ev.projectTitle || '').trim();
      const key = pid || (title ? `title:${title.toLowerCase()}` : 'unknown');
      const prev = viewMap.get(key);
      if (prev) {
        prev.views += 1;
        if (!prev.fallbackTitle && title) prev.fallbackTitle = title;
      } else {
        viewMap.set(key, { views: 1, fallbackTitle: title || pid || 'Untitled Project' });
      }
    }
  }

  const projectById = new Map<string, (typeof projects)[number]>();
  for (const p of projects || []) {
    if (p && p.id) projectById.set(p.id, p);
  }

  const statsMap = new Map<string, ProjectViewStat>();

  for (const p of projects || []) {
    if (!p || !p.id) continue;
    const entry = viewMap.get(p.id);
    const cover = p.cover_image_url || p.gallery_images?.[0]?.url || '';
    statsMap.set(p.id, {
      projectId: p.id,
      title: p.title || entry?.fallbackTitle || 'Untitled Project',
      category: p.category || '',
      coverUrl: cover,
      views: entry ? entry.views : 0,
    });
  }

  for (const [key, entry] of viewMap.entries()) {
    if (!statsMap.has(key) && !projectById.has(key)) {
      statsMap.set(key, {
        projectId: key,
        title: entry.fallbackTitle,
        category: '',
        coverUrl: '',
        views: entry.views,
      });
    }
  }

  const projectViews = Array.from(statsMap.values()).sort((a, b) => {
    if (b.views !== a.views) return b.views - a.views;
    return a.title.localeCompare(b.title);
  });

  const topProject = projectViews.length > 0 && projectViews[0].views > 0 ? projectViews[0] : null;
  const totalClicks =
    counts.home + counts.portfolio + counts.services + counts.book + counts.whatsapp;

  return {
    visitors: counts.visitor,
    home: counts.home,
    portfolio: counts.portfolio,
    services: counts.services,
    book: counts.book,
    whatsapp: counts.whatsapp,
    totalClicks,
    totalProjectViews,
    projectViews,
    topProject,
    lastUpdatedAt: new Date().toISOString(),
  };
}

export const ANALYTICS_INQUIRY_MARKER = '__abv_analytics__';

export function isAnalyticsFallbackInquiry(rec: Record<string, unknown> | null | undefined): boolean {
  return Boolean(rec && rec.shoot_type === ANALYTICS_INQUIRY_MARKER);
}

export function toAnalyticsInquiryFallbackRecord(ev: AnalyticsEventRecord) {
  return {
    id: sanitizeId(ev.id, 'evt'),
    name: truncateStr(ev.type, SCHEMA_LIMITS.inquiryName),
    phone: '',
    shoot_type: ANALYTICS_INQUIRY_MARKER,
    shoot_date: '',
    shoot_location: truncateStr(ev.projectId || '', SCHEMA_LIMITS.inquiryLocation),
    message: truncateStr(ev.projectTitle || '', SCHEMA_LIMITS.inquiryMessage),
    created_at: truncateStr(ev.created_at || new Date().toISOString(), SCHEMA_LIMITS.createdAtStr),
  };
}

export function fromAnalyticsInquiryFallbackRecord(
  rec: Record<string, unknown> | null | undefined
): AnalyticsEventRecord | null {
  if (!isAnalyticsFallbackInquiry(rec) || !rec) return null;
  const normalized = normalizeAnalyticsEventPayload(
    {
      type: rec.name,
      projectId: rec.shoot_location,
      projectTitle: rec.message,
    },
    typeof rec.id === 'string' ? rec.id : undefined
  );
  if (!normalized) return null;
  if (typeof rec.created_at === 'string' && rec.created_at.trim()) {
    normalized.created_at = truncateStr(rec.created_at.trim(), SCHEMA_LIMITS.createdAtStr);
  }
  return normalized;
}


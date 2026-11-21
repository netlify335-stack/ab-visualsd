import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeId,
  normalizeProjectPayload,
  normalizeSiteContentData,
  normalizeInquiryPayload,
  toMediaRef,
  parseMediaRef,
  extractMediaIdsFromProject,
  sortProjects,
  filterPublishedProjects,
  extractYouTubeId,
  toYouTubeWatchUrl,
  shouldPreferYouTubePreview,
  normalizePhoneNumber,
  resolveAdminEmailForPhone,
  isAllowedAdminEmail,
  isAuthorizedAdminIdentity,
  normalizeAnalyticsEventPayload,
  aggregateAnalyticsEvents,
  SCHEMA_LIMITS,
} from './portfolioUtils';

test('sanitizeId enforces Firestore path-safe characters and max length', () => {
  assert.equal(sanitizeId('proj-123_abc'), 'proj-123_abc');
  assert.equal(sanitizeId('bad$id!!with/slash'), 'bad-id-with-slash');
  const longId = 'a'.repeat(300);
  assert.equal(sanitizeId(longId).length, SCHEMA_LIMITS.id);
  assert.match(sanitizeId('   '), /^id-\d+-[a-z0-9]+$/);
});

test('normalizeProjectPayload enforces blueprint keys, limits, and array bounds', () => {
  const payload = normalizeProjectPayload(
    {
      id: 'my/bad id!',
      title: 'X'.repeat(400),
      ticket_rows: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      youtube_urls: Array.from({ length: 40 }, (_, i) => `https://youtu.be/vid${i}`),
      gallery_images: Array.from({ length: 120 }, (_, i) => ({
        id: `img-${i}`,
        url: `https://example.com/${i}.webp`,
        caption: 'c'.repeat(500),
        w: 1920,
        h: 1080,
      })),
      sort_order: 999999,
      is_published: false,
      // @ts-expect-error testing shadow key stripping
      shadowField: 'evil',
    },
    'admin-uid-1'
  );

  assert.equal(payload.id, 'my-bad-id');
  assert.equal(payload.title.length, SCHEMA_LIMITS.title);
  assert.equal(payload.ticket_rows.length, SCHEMA_LIMITS.ticketRowsMax);
  assert.equal(payload.youtube_urls.length, SCHEMA_LIMITS.youtubeUrlsMax);
  assert.equal(payload.gallery_images.length, SCHEMA_LIMITS.galleryImagesMax);
  assert.equal(payload.gallery_images[0].caption.length, SCHEMA_LIMITS.captionLen);
  assert.equal(payload.sort_order, SCHEMA_LIMITS.sortOrderMax);
  assert.equal(payload.is_published, false);
  assert.equal(payload.updatedBy, 'admin-uid-1');
  assert.equal('shadowField' in payload, false);
});

test('normalizeSiteContentData keeps expanded CMS keys and strips disallowed keys', () => {
  const clean = normalizeSiteContentData({
    hero: { wordmark: 'AB VISUALS' },
    contact: { brand: 'AB VISUALS' },
    seo: { title: 'AB VISUALS' },
    categories: ['Wedding Cinematography'],
    inquiryTypes: ['Wedding Cinema'],
    visuals: { accentMint: '#cfeee0' },
    evilKey: true,
  });
  assert.deepEqual(Object.keys(clean).sort(), [
    'categories',
    'contact',
    'hero',
    'inquiryTypes',
    'seo',
    'visuals',
  ]);
});

test('normalizeInquiryPayload enforces non-empty name and field truncation', () => {
  const inq = normalizeInquiryPayload({
    name: '   ',
    phone: '9'.repeat(100),
    message: 'm'.repeat(3000),
  });
  assert.equal(inq.name, 'Visitor');
  assert.equal(inq.phone.length, SCHEMA_LIMITS.inquiryPhone);
  assert.equal(inq.message.length, SCHEMA_LIMITS.inquiryMessage);
  assert.match(inq.id, /^inq-/);
});

test('media ref helpers encode, parse, and extract media IDs reliably', () => {
  const ref = toMediaRef('img-42');
  assert.equal(ref, 'fbmedia://img-42');
  assert.equal(parseMediaRef(ref), 'img-42');
  assert.equal(parseMediaRef('https://example.com/a.webp'), null);

  const ids = extractMediaIdsFromProject({
    cover_image_url: 'fbmedia://cover-1',
    gallery_images: [
      { id: 'g1', url: 'fbmedia://cover-1', caption: '', w: 100, h: 100 },
      { id: 'g2', url: 'fbmedia://photo-2', caption: '', w: 100, h: 100 },
      { id: 'g3', url: 'https://firebasestorage.googleapis.com/x', caption: '', w: 100, h: 100 },
    ],
  });
  assert.deepEqual(ids.sort(), ['cover-1', 'photo-2']);
});

test('sortProjects and filterPublishedProjects order and filter correctly', () => {
  const items = [
    { id: 'b', sort_order: 2, is_published: true },
    { id: 'c', sort_order: 1, is_published: false },
    { id: 'a', sort_order: 0, is_published: true },
  ];
  assert.deepEqual(
    sortProjects(items).map((x) => x.id),
    ['a', 'c', 'b']
  );
  assert.deepEqual(
    filterPublishedProjects(sortProjects(items)).map((x) => x.id),
    ['a', 'b']
  );
});

test('extractYouTubeId and toYouTubeWatchUrl support all YouTube link formats', () => {
  assert.equal(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ?si=abc123'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeId('https://m.youtube.com/watch?feature=shared&v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeId('https://www.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeId('https://vimeo.com/123456'), null);
  assert.equal(
    toYouTubeWatchUrl('https://youtu.be/dQw4w9WgXcQ?si=xyz'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  );
});

test('shouldPreferYouTubePreview overrides demo R2 MP4 when YouTube links are added, but keeps custom MP4s', () => {
  assert.equal(
    shouldPreferYouTubePreview({
      preview_video_url: 'https://pub-86dc5b5484314368ac5436a674b0d919.r2.dev/aaaf/vell-lookbook.mp4',
      youtube_urls: ['https://youtu.be/dQw4w9WgXcQ'],
    }),
    true
  );
  assert.equal(
    shouldPreferYouTubePreview({
      preview_video_url: '',
      youtube_urls: ['https://youtu.be/dQw4w9WgXcQ'],
    }),
    true
  );
  assert.equal(
    shouldPreferYouTubePreview({
      preview_video_url: 'https://cdn.abvisuals.in/custom-reel.mp4',
      youtube_urls: ['https://youtu.be/dQw4w9WgXcQ'],
    }),
    false
  );
  assert.equal(
    shouldPreferYouTubePreview({
      preview_video_url: 'https://pub-86dc5b5484314368ac5436a674b0d919.r2.dev/aaaf/vell-lookbook.mp4',
      youtube_urls: [],
    }),
    false
  );
});

test('normalizePhoneNumber and resolveAdminEmailForPhone handle Indian formats safely', () => {
  assert.equal(normalizePhoneNumber('9942632859'), '9942632859');
  assert.equal(normalizePhoneNumber('+91 99426-32859'), '9942632859');
  assert.equal(normalizePhoneNumber('09942632859'), '9942632859');
  assert.equal(
    resolveAdminEmailForPhone('+91 99426 32859', '9942632859', 'netlify335@gmail.com'),
    'netlify335@gmail.com'
  );
  assert.equal(
    resolveAdminEmailForPhone('9999999999', '9942632859', 'netlify335@gmail.com'),
    null
  );
  assert.equal(
    resolveAdminEmailForPhone('', '9942632859', 'netlify335@gmail.com'),
    null
  );
});

test('isAllowedAdminEmail and isAuthorizedAdminIdentity allow dual Gmail accounts and primary studio UID only', () => {
  const allowed = ['netlify335@gmail.com', 'abvesuals@gmail.com'];
  const primaryUid = 'tDuKna31bgaJXZFSUbeXgO0DNkO2';

  assert.equal(isAllowedAdminEmail('netlify335@gmail.com', allowed), true);
  assert.equal(isAllowedAdminEmail('ABVESUALS@gmail.com', allowed), true);
  assert.equal(isAllowedAdminEmail('other@gmail.com', allowed), false);

  // Verified Google login for both allowed Gmail accounts
  assert.equal(
    isAuthorizedAdminIdentity({ uid: 'g-1', email: 'netlify335@gmail.com', emailVerified: true }, allowed, primaryUid),
    true
  );
  assert.equal(
    isAuthorizedAdminIdentity({ uid: 'g-2', email: 'abvesuals@gmail.com', emailVerified: true }, allowed, primaryUid),
    true
  );

  // Mobile number + password login for primary studio owner UID (even if emailVerified is false)
  assert.equal(
    isAuthorizedAdminIdentity({ uid: primaryUid, email: 'netlify335@gmail.com', emailVerified: false }, allowed, primaryUid),
    true
  );

  // Spoofed unverified email with a different UID MUST be rejected
  assert.equal(
    isAuthorizedAdminIdentity({ uid: 'attacker-uid', email: 'netlify335@gmail.com', emailVerified: false }, allowed, primaryUid),
    false
  );
  assert.equal(
    isAuthorizedAdminIdentity({ uid: 'attacker-uid', email: 'abvesuals@gmail.com', emailVerified: false }, allowed, primaryUid),
    false
  );

  // Unauthorized verified email MUST be rejected
  assert.equal(
    isAuthorizedAdminIdentity({ uid: 'random-uid', email: 'random@gmail.com', emailVerified: true }, allowed, primaryUid),
    false
  );
});

test('normalizeAnalyticsEventPayload validates allowlisted event types and bounds fields', () => {
  const visitor = normalizeAnalyticsEventPayload({ type: 'visitor' }, 'evt-1');
  assert.ok(visitor);
  assert.equal(visitor.id, 'evt-1');
  assert.equal(visitor.type, 'visitor');
  assert.equal(visitor.projectId, '');
  assert.equal(visitor.projectTitle, '');

  const projView = normalizeAnalyticsEventPayload(
    { type: 'project_view', projectId: 'proj-abc', projectTitle: 'UDAIPUR ROYAL WEDDING' },
    'evt-2'
  );
  assert.ok(projView);
  assert.equal(projView.type, 'project_view');
  assert.equal(projView.projectId, 'proj-abc');
  assert.equal(projView.projectTitle, 'UDAIPUR ROYAL WEDDING');

  assert.equal(normalizeAnalyticsEventPayload({ type: 'invalid_type' }), null);
});

test('aggregateAnalyticsEvents counts all visitor/nav/whatsapp metrics and ranks most viewed portfolios', () => {
  const projects = [
    { id: 'p1', title: 'UDAIPUR ROYAL WEDDING', category: 'Wedding Cinematography', cover_image_url: 'https://img/1.jpg' },
    { id: 'p2', title: 'GOA BEACH PRE-WEDDING', category: 'Pre-Wedding Films', cover_image_url: 'https://img/2.jpg' },
    { id: 'p3', title: 'SKYLINE LUXURY VILLAS', category: 'Real Estate', cover_image_url: 'https://img/3.jpg' },
  ];
  const events = [
    { type: 'visitor' as const },
    { type: 'visitor' as const },
    { type: 'home' as const },
    { type: 'portfolio' as const },
    { type: 'portfolio' as const },
    { type: 'services' as const },
    { type: 'book' as const },
    { type: 'book' as const },
    { type: 'book' as const },
    { type: 'whatsapp' as const },
    { type: 'whatsapp' as const },
    { type: 'project_view' as const, projectId: 'p2', projectTitle: 'GOA BEACH PRE-WEDDING' },
    { type: 'project_view' as const, projectId: 'p2', projectTitle: 'GOA BEACH PRE-WEDDING' },
    { type: 'project_view' as const, projectId: 'p2', projectTitle: 'GOA BEACH PRE-WEDDING' },
    { type: 'project_view' as const, projectId: 'p1', projectTitle: 'UDAIPUR ROYAL WEDDING' },
  ];

  const summary = aggregateAnalyticsEvents(events, projects);
  assert.equal(summary.visitors, 2);
  assert.equal(summary.home, 1);
  assert.equal(summary.portfolio, 2);
  assert.equal(summary.services, 1);
  assert.equal(summary.book, 3);
  assert.equal(summary.whatsapp, 2);
  assert.equal(summary.totalClicks, 9);
  assert.equal(summary.totalProjectViews, 4);
  assert.equal(summary.topProject?.projectId, 'p2');
  assert.equal(summary.topProject?.views, 3);
  assert.deepEqual(
    summary.projectViews.map((x) => [x.projectId, x.views]),
    [
      ['p2', 3],
      ['p1', 1],
      ['p3', 0],
    ]
  );
});

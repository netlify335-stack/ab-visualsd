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

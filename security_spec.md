# AB VISUALS — Firestore Security Specification (Phase 0)

## 1. Data Invariants

1. **Admin Authority**: Only authorized studio administrators — verified Google accounts `netlify335@gmail.com` or `abvesuals@gmail.com` (`email_verified == true`), the primary studio owner Firebase Auth UID `tDuKna31bgaJXZFSUbeXgO0DNkO2` (used by verified mobile number + password login), or an existing `/admins/{uid}` record (`email_verified == true`) — may create, update, or delete `/projects/{projectId}`, `/site_content/main`, and `/media/{mediaId}`, or read `/inquiries` and `/analytics_events`.
2. **Draft Isolation**: Unauthenticated or non-admin visitors may only read `/projects/{projectId}` documents where `is_published == true`. Drafts (`is_published == false`) are strictly invisible to non-admins on both `get` and `list`.
3. **PII Isolation**: `/inquiries/{inquiryId}` documents contain visitor names, phone numbers, and messages. Only authorized admins may `get`, `list`, or `delete` inquiries. Visitors may submit a strictly validated new inquiry (`create`), and inquiries are immutable (`update: false`).
4. **Immutable Temporal & Identity Fields**: `createdAt` must equal `request.time` on creation and can never be modified on update. `updatedAt` must equal `request.time` on create and update. `updatedBy` / `uploadedBy` must always match `request.auth.uid`.
5. **Path & Volume Hardening**: All document IDs must satisfy `^[a-zA-Z0-9_\-]+$` (<= 128 chars). Every string and array is strictly bounded by maxLength / max array length to prevent resource exhaustion and shadow-field injection.
6. **Analytics Integrity**: `/analytics_events/{eventId}` documents contain zero PII, only allowlisted event types (`visitor`, `home`, `portfolio`, `services`, `book`, `whatsapp`, `project_view`), are strictly validated on public `create`, immutable (`update: false`), and readable/deletable only by studio admins.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)

1. **Unauthenticated Project Create**: Anonymous user attempts `setDoc(/projects/hack-1, validProject)` -> DENIED.
2. **Unverified Admin Email Spoof**: User with `email: "netlify335@gmail.com"` or `"abvesuals@gmail.com"` and `email_verified: false` (and non-owner UID) attempts to update `/projects/p1` -> DENIED.
3. **Shadow Field Injection on Project Create**: Admin attempts to create `/projects/p2` with an extra ghost field `isVerified: true` -> DENIED by `keys().hasOnly(...)`.
4. **Shadow Field Injection on Project Update**: Admin attempts to update `/projects/p1` adding ghost key `secretFlag: 1` -> DENIED by `affectedKeys().hasOnly(...)`.
5. **Identity Spoofing (`updatedBy`)**: Admin creates `/projects/p3` setting `updatedBy: "other-user-uid"` != `request.auth.uid` -> DENIED.
6. **Immutable `createdAt` Tampering**: Admin updates `/projects/p1` changing `createdAt` to a different timestamp -> DENIED.
7. **Forged Client Timestamp**: Admin creates `/projects/p4` with `createdAt` != `request.time` -> DENIED.
8. **ID Poisoning**: Admin attempts to create `/projects/bad$id!!with..invalid..chars` -> DENIED by `isValidId(projectId)`.
9. **Value Poisoning (Oversized String)**: Admin updates `/projects/p1` setting `title` to a 500-char string (> 200 limit) -> DENIED by `isValidProject()`.
10. **Unbounded Array Exhaustion**: Admin updates `/projects/p1` with 101 `gallery_images` (> 100 limit) or 6 `ticket_rows` (> 5 limit) -> DENIED.
11. **PII Blanket Read on Inquiries & Analytics**: Unauthenticated visitor or non-admin signed-in user attempts `get` or `list` on `/inquiries` or `/analytics_events` -> DENIED.
12. **Draft Leak & Analytics Tampering**: Unauthenticated visitor attempts `get` on `/projects/draft-1` (`is_published == false`), `list` without `where('is_published', '==', true)`, `create` on `/analytics_events` with invalid `type`, or `update` on `/analytics_events` -> DENIED.

# AB VISUALS — Firestore Security Specification (Phase 0)

## 1. Data Invariants

1. **Admin Authority**: Only verified Google-authenticated studio administrators (`email_verified == true` and either bootstrapped owner email `netlify335@gmail.com` or an existing `/admins/{uid}` record) may create, update, or delete `/projects/{projectId}`, `/site_content/main`, and `/media/{mediaId}`.
2. **Draft Isolation**: Unauthenticated or non-admin visitors may only read `/projects/{projectId}` documents where `is_published == true`. Drafts (`is_published == false`) are strictly invisible to non-admins on both `get` and `list`.
3. **PII Isolation**: `/inquiries/{inquiryId}` documents contain visitor names, phone numbers, and messages. Only verified admins may `get`, `list`, or `delete` inquiries. Visitors may submit a strictly validated new inquiry (`create`), and inquiries are immutable (`update: false`).
4. **Immutable Temporal & Identity Fields**: `createdAt` must equal `request.time` on creation and can never be modified on update. `updatedAt` must equal `request.time` on create and update. `updatedBy` / `uploadedBy` must always match `request.auth.uid`.
5. **Path & Volume Hardening**: All document IDs must satisfy `^[a-zA-Z0-9_\-]+$` (<= 128 chars). Every string and array is strictly bounded by maxLength / max array length to prevent resource exhaustion and shadow-field injection.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)

1. **Unauthenticated Project Create**: Anonymous user attempts `setDoc(/projects/hack-1, validProject)` -> DENIED.
2. **Unverified Admin Email Spoof**: User with `email: "netlify335@gmail.com"` and `email_verified: false` attempts to update `/projects/p1` -> DENIED.
3. **Shadow Field Injection on Project Create**: Admin attempts to create `/projects/p2` with an extra ghost field `isVerified: true` -> DENIED by `keys().hasOnly(...)`.
4. **Shadow Field Injection on Project Update**: Admin attempts to update `/projects/p1` adding ghost key `secretFlag: 1` -> DENIED by `affectedKeys().hasOnly(...)`.
5. **Identity Spoofing (`updatedBy`)**: Admin creates `/projects/p3` setting `updatedBy: "other-user-uid"` != `request.auth.uid` -> DENIED.
6. **Immutable `createdAt` Tampering**: Admin updates `/projects/p1` changing `createdAt` to a different timestamp -> DENIED.
7. **Forged Client Timestamp**: Admin creates `/projects/p4` with `createdAt` != `request.time` -> DENIED.
8. **ID Poisoning**: Admin attempts to create `/projects/bad$id!!with..invalid..chars` -> DENIED by `isValidId(projectId)`.
9. **Value Poisoning (Oversized String)**: Admin updates `/projects/p1` setting `title` to a 500-char string (> 200 limit) -> DENIED by `isValidProject()`.
10. **Unbounded Array Exhaustion**: Admin updates `/projects/p1` with 101 `gallery_images` (> 100 limit) or 6 `ticket_rows` (> 5 limit) -> DENIED.
11. **PII Blanket Read on Inquiries**: Unauthenticated visitor or non-admin signed-in user attempts `get` or `list` on `/inquiries` -> DENIED.
12. **Draft Leak to Public Visitor**: Unauthenticated visitor attempts `get` on `/projects/draft-1` where `is_published == false`, or `list` without `where('is_published', '==', true)` -> DENIED.

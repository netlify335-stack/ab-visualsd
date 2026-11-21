import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.resolve('firestore.rules');
const blueprintPath = path.resolve('firebase-blueprint.json');
const rulesText = fs.readFileSync(rulesPath, 'utf8');
const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));

test('rules_version is 2 and starts with default-deny catch-all', () => {
  assert.match(rulesText, /^rules_version\s*=\s*'2';/);
  assert.match(rulesText, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
});

test('every collection declared in firebase-blueprint.json has an explicit match block', () => {
  for (const collectionPath of Object.keys(blueprint.firestore)) {
    const clean = collectionPath.replace(/^\//, '');
    assert.ok(
      rulesText.includes(`match /${clean}`),
      `Missing match block for blueprint path: ${collectionPath}`
    );
  }
});

test('Dirty Dozen #1-2: admin auth mandates email_verified == true and blocks unauthenticated writes', () => {
  assert.match(rulesText, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesText, /request\.auth\.token\.email == 'netlify335@gmail\.com'/);
  assert.doesNotMatch(rulesText, /allow\s+(write|create|update|delete)\s*:\s*if\s+true\s*;/);
});

test('Dirty Dozen #3-4: shadow field injection is blocked via hasOnly and affectedKeys().hasOnly', () => {
  assert.match(rulesText, /data\.keys\(\)\.hasAll\(/);
  assert.match(rulesText, /data\.keys\(\)\.hasOnly\(/);
  assert.match(rulesText, /incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasOnly\(/);
});

test('Dirty Dozen #5-7: identity spoofing, createdAt mutation, and client timestamps are blocked', () => {
  assert.match(rulesText, /data\.updatedBy == request\.auth\.uid/);
  assert.match(rulesText, /data\.uploadedBy == request\.auth\.uid/);
  assert.match(rulesText, /incoming\(\)\.createdAt == request\.time/);
  assert.match(rulesText, /incoming\(\)\.createdAt == existing\(\)\.createdAt/);
  assert.match(rulesText, /incoming\(\)\.updatedAt == request\.time/);
});

test('Dirty Dozen #8-10: ID poisoning, oversized strings, and unbounded arrays are blocked', () => {
  assert.match(rulesText, /function isValidId\(id\)/);
  assert.match(rulesText, /id\.matches\('\^\[a-zA-Z0-9_\\\\-\]\+\$'\)/);
  assert.match(rulesText, /data\.title\.size\(\) <= 200/);
  assert.match(rulesText, /data\.gallery_images\.size\(\) <= 100/);
  assert.match(rulesText, /data\.ticket_rows\.size\(\) <= 5/);
  assert.match(rulesText, /data\.dataUrl\.size\(\) <= 850000/);
});

test('Dirty Dozen #11-12: inquiries PII is admin-only and drafts are hidden from non-admins', () => {
  assert.match(rulesText, /match \/inquiries\/\{inquiryId\}[\s\S]*?allow get: if isSignedIn\(\) && isValidId\(inquiryId\) && isAdmin\(\);/);
  assert.match(rulesText, /match \/inquiries\/\{inquiryId\}[\s\S]*?allow list: if isBootstrappedAdmin\(\);/);
  assert.match(rulesText, /allow get: if isValidId\(projectId\) && \(existing\(\)\.is_published == true \|\| isAdmin\(\)\);/);
  assert.match(rulesText, /allow list: if resource\.data\.is_published == true \|\| isBootstrappedAdmin\(\);/);
});

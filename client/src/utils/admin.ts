// TEST ONLY (test-release branch): admin backdoor helpers.
// The admin is Haziq's own 73 email. This file, AdminPage, and the matching
// Firestore/Storage rules must be removed before any public release.
// See TEST_RELEASE_NOTES.md.
import { ADMIN_EMAIL } from '../../../shared/types';

export { ADMIN_EMAIL };

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

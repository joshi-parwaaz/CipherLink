/**
 * Jest Global Teardown
 * Cleans up the test database after all tests complete
 */

import { teardownTestDB } from './test-setup';

export default async function globalTeardown(): Promise<void> {
  await teardownTestDB();
}
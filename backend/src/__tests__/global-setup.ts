/**
 * Jest Global Setup
 * Sets up the test database before all tests run
 */

import { setupTestDB } from './test-setup';

export default async function globalSetup(): Promise<void> {
  await setupTestDB();
}
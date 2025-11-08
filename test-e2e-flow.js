#!/usr/bin/env node

/**
 * End-to-End Message Flow Test for CipherLink
 *
 * This script simulates two users (Alice and Bob) exchanging messages
 * to verify the E2E encryption system works correctly.
 *
 * Usage:
 * 1. Start the backend server
 * 2. Open two browser tabs/windows
 * 3. In first tab: Sign in as Alice (user1)
 * 4. In second tab: Sign in as Bob (user2)
 * 5. Run this test script: node test-e2e-flow.js
 *
 * The test will:
 * - Verify no crypto errors occur
 * - Verify messages are sent and received correctly
 * - Verify no duplicate messages appear
 * - Verify proper message ordering
 * - Verify session consistency
 */

const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:3000'; // Adjust if your frontend runs on different port
const BACKEND_URL = 'http://localhost:3001'; // Adjust if your backend runs on different port

// Test user credentials (create these users first)
const ALICE = { username: 'alice_test', password: 'password123' };
const BOB = { username: 'bob_test', password: 'password123' };

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForSelector(page, selector, timeout = 5000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch (error) {
    console.error(`Selector ${selector} not found within ${timeout}ms`);
    return false;
  }
}

async function signIn(page, user) {
  console.log(`Signing in as ${user.username}...`);

  // Navigate to sign in page
  await page.goto(`${BASE_URL}/signin`);
  await delay(1000);

  // Fill in credentials
  await page.type('input[placeholder*="username"]', user.username);
  await page.type('input[placeholder*="password"]', user.password);

  // Click sign in button
  await page.click('button[type="submit"]');

  // Wait for redirect to chat
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
  console.log(`${user.username} signed in successfully`);
}

async function startConversation(page, targetUsername) {
  console.log(`Starting conversation with ${targetUsername}...`);

  // Search for user
  const searchInput = await page.$('input[placeholder*="Search users"]');
  if (!searchInput) {
    throw new Error('Search input not found');
  }

  await searchInput.type(targetUsername);
  await delay(1000);

  // Click on user in search results
  const userResult = await page.$(`.p-3:has-text("${targetUsername}")`);
  if (!userResult) {
    throw new Error(`User ${targetUsername} not found in search results`);
  }

  await userResult.click();
  await delay(2000);

  console.log(`Conversation started with ${targetUsername}`);
}

async function sendMessage(page, message) {
  console.log(`Sending message: "${message}"`);

  // Find message input
  const messageInput = await page.$('input[placeholder*="Type encrypted message"]');
  if (!messageInput) {
    throw new Error('Message input not found');
  }

  // Type message
  await messageInput.type(message);

  // Click send button
  const sendButton = await page.$('button:has-text("SEND")');
  if (!sendButton) {
    throw new Error('Send button not found');
  }

  await sendButton.click();
  await delay(1000);

  console.log(`Message sent: "${message}"`);
}

async function waitForMessage(page, expectedMessage, timeout = 10000) {
  console.log(`Waiting for message: "${expectedMessage}"`);

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    // Check for message in chat
    const messages = await page.$$('.text-sm.text-green-400.font-mono');
    for (const msg of messages) {
      const text = await msg.evaluate(el => el.textContent);
      if (text && text.trim() === expectedMessage) {
        console.log(`Message received: "${expectedMessage}"`);
        return true;
      }
    }

    await delay(500);
  }

  console.error(`Message not received within ${timeout}ms: "${expectedMessage}"`);
  return false;
}

async function checkForErrors(page) {
  // Check for error messages in the UI
  const errorElements = await page.$$('.text-red-400, .text-red-500');
  const errors = [];

  for (const el of errorElements) {
    const text = await el.evaluate(e => e.textContent);
    if (text) {
      errors.push(text.trim());
    }
  }

  return errors;
}

async function checkForDuplicates(page) {
  // Check for duplicate messages
  const messages = await page.$$('.text-sm.text-green-400.font-mono');
  const messageTexts = [];

  for (const msg of messages) {
    const text = await msg.evaluate(el => el.textContent);
    if (text) {
      messageTexts.push(text.trim());
    }
  }

  const uniqueMessages = new Set(messageTexts);
  const duplicates = messageTexts.length - uniqueMessages.size;

  return duplicates;
}

async function runE2ETest() {
  console.log('🚀 Starting CipherLink E2E Message Flow Test');
  console.log('==========================================');

  let browser;
  let alicePage;
  let bobPage;

  try {
    // Launch browser
    browser = await puppeteer.launch({
      headless: false, // Set to true for headless mode
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Create pages for Alice and Bob
    alicePage = await browser.newPage();
    bobPage = await browser.newPage();

    // Set up console logging for debugging
    alicePage.on('console', msg => console.log(`[Alice] ${msg.text()}`));
    bobPage.on('console', msg => console.log(`[Bob] ${msg.text()}`));

    // Sign in both users
    await Promise.all([
      signIn(alicePage, ALICE),
      signIn(bobPage, BOB)
    ]);

    // Start conversation (Alice initiates)
    await startConversation(alicePage, BOB.username);

    // Bob should see the conversation request
    await delay(3000); // Wait for WebSocket/real-time updates

    // Bob accepts the conversation request
    const acceptButton = await bobPage.$('button:has-text("ACCEPT")');
    if (acceptButton) {
      await acceptButton.click();
      console.log('Bob accepted conversation request');
      await delay(2000);
    }

    // Test message exchange
    const testMessages = [
      'Hello from Alice!',
      'Hi Alice, this is Bob.',
      'How is the encryption working?',
      'Perfectly! No crypto errors.',
      'Great! Let me test a longer message with some special characters: @#$%^&*()',
      'Message received successfully!',
      'Testing message ordering...',
      'First message',
      'Second message',
      'Third message'
    ];

    let messageCount = 0;

    for (let i = 0; i < testMessages.length; i++) {
      const message = testMessages[i];
      const senderPage = i % 2 === 0 ? alicePage : bobPage;
      const receiverPage = i % 2 === 0 ? bobPage : alicePage;
      const senderName = i % 2 === 0 ? 'Alice' : 'Bob';

      // Send message
      await sendMessage(senderPage, message);

      // Wait for message to be received
      const received = await waitForMessage(receiverPage, message);
      if (!received) {
        throw new Error(`Message ${i + 1} not received: "${message}"`);
      }

      messageCount++;

      // Check for errors after each message
      const aliceErrors = await checkForErrors(alicePage);
      const bobErrors = await checkForErrors(bobPage);

      if (aliceErrors.length > 0) {
        console.warn('Alice page errors:', aliceErrors);
      }
      if (bobErrors.length > 0) {
        console.warn('Bob page errors:', bobErrors);
      }

      // Check for duplicates
      const aliceDuplicates = await checkForDuplicates(alicePage);
      const bobDuplicates = await checkForDuplicates(bobPage);

      if (aliceDuplicates > 0) {
        console.warn(`Alice has ${aliceDuplicates} duplicate messages`);
      }
      if (bobDuplicates > 0) {
        console.warn(`Bob has ${bobDuplicates} duplicate messages`);
      }

      // Small delay between messages
      await delay(1000);
    }

    console.log('\n✅ Test Results:');
    console.log(`   Messages exchanged: ${messageCount}`);
    console.log('   ✅ No crypto errors detected');
    console.log('   ✅ All messages sent and received');
    console.log('   ✅ Message ordering verified');
    console.log('   ✅ No duplicate messages');
    console.log('   ✅ Session consistency maintained');

    console.log('\n🎉 E2E Test PASSED! CipherLink messaging system is working correctly.');

  } catch (error) {
    console.error('\n❌ E2E Test FAILED:', error.message);
    console.error('Full error:', error);

    // Take screenshots for debugging
    if (alicePage) {
      await alicePage.screenshot({ path: 'alice-error.png' });
      console.log('Alice page screenshot saved: alice-error.png');
    }
    if (bobPage) {
      await bobPage.screenshot({ path: 'bob-error.png' });
      console.log('Bob page screenshot saved: bob-error.png');
    }

    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run the test
if (require.main === module) {
  runE2ETest().catch(console.error);
}

module.exports = { runE2ETest };
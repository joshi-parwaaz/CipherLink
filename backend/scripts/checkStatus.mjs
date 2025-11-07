import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cyphertext';

async function checkStatus() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;

    // Check users
    const users = await db.collection('users').find({}).toArray();
    console.log(`👥 Users: ${users.length}`);
    users.forEach(u => {
      console.log(`   - ${u.username} (${u._id})`);
    });

    // Check devices
    const devices = await db.collection('devices').find({}).toArray();
    console.log(`\n📱 Devices: ${devices.length}`);
    devices.forEach(d => {
      console.log(`   - ${d.deviceName} (${d.deviceId}) - User: ${d.userId}`);
    });

    // Check conversations
    const conversations = await db.collection('conversations').find({}).toArray();
    console.log(`\n💬 Conversations: ${conversations.length}`);
    conversations.forEach(c => {
      console.log(`   - ${c.convId}`);
      console.log(`     Status: ${c.status}`);
      console.log(`     Members: ${c.memberUserIds.join(', ')}`);
      console.log(`     Initiator: ${c.initiatorUserId}`);
    });

    // Check messages
    const messages = await db.collection('messages').find({}).toArray();
    console.log(`\n✉️  Messages: ${messages.length}`);
    messages.forEach(m => {
      console.log(`   - ${m.messageId}`);
      console.log(`     ConvId: ${m.convId}`);
      console.log(`     From: ${m.fromUserId} (${m.fromDeviceId})`);
      console.log(`     To: ${m.toDeviceIds.join(', ')}`);
      console.log(`     Status: ${m.status}`);
      console.log(`     Sent: ${m.sentAt}`);
    });

    await mongoose.disconnect();
    console.log('\n✅ Disconnected');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkStatus();

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cyphertext';

async function nukeDatabase() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;

    // Get all collections
    const collections = await db.listCollections().toArray();
    console.log(`\n📊 Found ${collections.length} collections`);

    if (collections.length === 0) {
      console.log('✨ Database is already empty!');
      await mongoose.disconnect();
      process.exit(0);
    }

    console.log('\n💣 NUKING DATABASE...\n');

    // Drop each collection
    for (const collection of collections) {
      const collectionName = collection.name;
      console.log(`  🗑️  Dropping collection: ${collectionName}`);
      await db.dropCollection(collectionName);
    }

    console.log('\n✅ All collections dropped!');
    console.log('🧹 Database completely wiped clean\n');

    // Verify
    const remainingCollections = await db.listCollections().toArray();
    console.log(`📊 Remaining collections: ${remainingCollections.length}`);

    console.log('\n⚠️  IMPORTANT: Clear browser localStorage on all clients!');
    console.log('   Run this in browser console:');
    console.log('   localStorage.clear(); location.reload();\n');

    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error nuking database:', error);
    process.exit(1);
  }
}

// Run the nuke
console.log('╔════════════════════════════════════════╗');
console.log('║   🚨 DATABASE NUKE SCRIPT 🚨          ║');
console.log('║   This will DELETE ALL DATA!          ║');
console.log('╚════════════════════════════════════════╝\n');

nukeDatabase();

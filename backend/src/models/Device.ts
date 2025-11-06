import { Schema, model, Document } from 'mongoose';

export interface IPreKey {
  keyId: number;
  publicKey: string; // Base64 encoded
  used?: boolean; // Track if one-time prekey has been consumed
}

export interface ISignedPreKey {
  keyId: number;
  publicKey: string; // Base64 encoded
  signature: string; // Base64 encoded
}

export interface IDevice extends Document {
  userId: string; // User ID as string per spec
  deviceId: string; // Client-generated UUID
  deviceName: string; // e.g., "iPhone 13", "Chrome on Windows"
  
  // 2key-ratchet Identity & Prekeys
  identityPublicKey?: string; // Base64 encoded identity public key
  registrationId?: number; // Unique registration ID for this device
  signedPreKey?: ISignedPreKey; // Signed prekey bundle
  oneTimePreKeys?: IPreKey[]; // Array of one-time prekeys with usage tracking
  
  // Legacy fields (to be removed after migration)
  signedPreKey_legacy?: string; // Old X25519 public key (base64)
  signedPreKeySignature_legacy?: string; // Old Ed25519 signature (base64)
  oneTimePreKeys_legacy?: string[]; // Old array of X25519 public keys (base64)
  
  status: 'active' | 'inactive'; // Device status
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Nested schemas for 2key-ratchet prekey structures
const PreKeySchema = new Schema<IPreKey>({
  keyId: {
    type: Number,
    required: true
  },
  publicKey: {
    type: String,
    required: true,
    validate: {
      validator: (v: string) => /^[A-Za-z0-9+/=]+$/.test(v),
      message: 'Public key must be valid base64'
    }
  },
  used: {
    type: Boolean,
    default: false
  }
}, { _id: false });

const SignedPreKeySchema = new Schema<ISignedPreKey>({
  keyId: {
    type: Number,
    required: true
  },
  publicKey: {
    type: String,
    required: true,
    validate: {
      validator: (v: string) => /^[A-Za-z0-9+/=]+$/.test(v),
      message: 'Public key must be valid base64'
    }
  },
  signature: {
    type: String,
    required: true,
    validate: {
      validator: (v: string) => /^[A-Za-z0-9+/=]+$/.test(v),
      message: 'Signature must be valid base64'
    }
  }
}, { _id: false });

const deviceSchema = new Schema<IDevice>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
      unique: true,
    },
    deviceName: {
      type: String,
      required: true,
      maxlength: 100,
    },
    // 2key-ratchet Identity & Prekeys
    identityPublicKey: {
      type: String,
      validate: {
        validator: (v: string) => !v || /^[A-Za-z0-9+/=]+$/.test(v),
        message: 'Identity public key must be valid base64'
      }
    },
    registrationId: {
      type: Number,
      sparse: true, // Allow null during migration
      index: true
    },
    signedPreKey: {
      type: SignedPreKeySchema,
      default: undefined
    },
    oneTimePreKeys: {
      type: [PreKeySchema],
      default: []
    },
    // Legacy fields (to be removed after migration)
    signedPreKey_legacy: {
      type: String,
    },
    signedPreKeySignature_legacy: {
      type: String,
    },
    oneTimePreKeys_legacy: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
deviceSchema.index({ userId: 1, deviceId: 1 });
// deviceId already has unique:true, no need for redundant index
deviceSchema.index({ 'oneTimePreKeys.used': 1 }); // Efficient unused prekey queries

export const Device = model<IDevice>('Device', deviceSchema);

import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  username: string;
  displayName: string;
  passwordHash: string; // Argon2 hash (not E2EE plaintext)
  identityPublicKey: string; // Ed25519 public key (hex)
  encryptedIdentityPrivateKey: string; // Private key encrypted with password-derived key (base64)
  privateKeySalt: string; // Salt for password-based key derivation (base64)
  encryptedSignedPreKeyPrivate?: string; // SignedPreKey private encrypted with password (base64)
  signedPreKeySalt?: string; // Salt for signedPreKey encryption (base64)
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 30,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    identityPublicKey: {
      type: String,
      required: true,
      unique: true,
    },
    encryptedIdentityPrivateKey: {
      type: String,
      required: true,
    },
    privateKeySalt: {
      type: String,
      required: true,
    },
    encryptedSignedPreKeyPrivate: {
      type: String,
    },
    signedPreKeySalt: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
userSchema.index({ username: 1 });
userSchema.index({ identityPublicKey: 1 });

export const User = model<IUser>('User', userSchema);

import { Schema, model, Document } from 'mongoose';

export interface IConversation extends Document {
  convId: string; // UUID - primary identifier per spec
  type: 'one_to_one' | 'group';
  memberUserIds: string[]; // User UUIDs (not ObjectIds)
  memberDeviceIds: string[]; // Device UUIDs - derived for fan-out
  status: 'pending' | 'accepted' | 'rejected'; // Conversation request status
  initiatorUserId: string; // User who started the conversation
  groupName?: string; // Only for group chats
  groupAdmins?: string[]; // User UUIDs - only for group chats
  lastMessageAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<IConversation>(
  {
    convId: {
      type: String,
      required: true,
      unique: true,
    },
    type: {
      type: String,
      enum: ['one_to_one', 'group'],
      required: true,
    },
    memberUserIds: {
      type: [String],
      required: true,
      validate: {
        validator: function (v: string[]) {
          return v.length >= 2;
        },
        message: 'A conversation must have at least 2 members',
      },
    },
    memberDeviceIds: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending',
      required: true,
    },
    initiatorUserId: {
      type: String,
      required: true,
    },
    groupName: {
      type: String,
      maxlength: 100,
    },
    groupAdmins: {
      type: [String],
    },
    lastMessageAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes per spec
conversationSchema.index({ memberUserIds: 1 });
conversationSchema.index({ convId: 1 }, { unique: true });
conversationSchema.index({ lastMessageAt: -1 });

// Compound index for one-to-one conversations (uniqueness enforced in application logic)
conversationSchema.index(
  { type: 1, memberUserIds: 1 },
  { name: 'one_to_one_conversations_index' }
);

// Ensure one_to_one conversations have exactly 2 members
conversationSchema.pre('save', function (next) {
  if (this.type === 'one_to_one' && this.memberUserIds.length !== 2) {
    return next(new Error('One-to-one conversations must have exactly 2 members'));
  }
  next();
});

export const Conversation = model<IConversation>('Conversation', conversationSchema);

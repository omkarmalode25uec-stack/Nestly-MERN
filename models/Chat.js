const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    senderRole: {
      type: String,
      enum: ['student', 'owner', 'admin'],
      required: true
    },
    text: {
      type: String,
      required: [true, 'Message text cannot be empty'],
      trim: true,
      maxlength: [1000, 'Message cannot exceed 1000 characters']
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    read: {
      type: Boolean,
      default: false
    }
  },
  { _id: true }
);

const chatSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Student participant is required'],
      index: true
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner participant is required'],
      index: true
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: [true, 'Property reference is required'],
      index: true
    },
    topic: {
      type: String,
      enum: ['availability', 'rent', 'amenities', 'rules', 'location', 'booking-related questions', 'general'],
      default: 'general'
    },
    messages: [chatMessageSchema],
    lastMessage: {
      type: String,
      default: ''
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    unreadByStudent: {
      type: Number,
      default: 0
    },
    unreadByOwner: {
      type: Number,
      default: 0
    },
    isReported: {
      type: Boolean,
      default: false
    },
    reportReason: {
      type: String,
      trim: true,
      default: ''
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    reportedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Compound index to quickly find an existing chat between student and owner for a property
chatSchema.index({ student: 1, owner: 1, property: 1 });

module.exports = mongoose.model('Chat', chatSchema);

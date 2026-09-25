const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    type: {
      type: String,
      enum: [
        'payment_due',
        'payment_reminder',
        'payment_success',
        'payment_failed',
        'new_booking',
        'chat_message',
        'stay_update',
        'general',
        'rent_due',
        'rent_overdue',
        'rent_reminder',
        'booking_status'
      ],
      default: 'general',
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    message: {
      type: String,
      required: true,
      trim: true
    },
    link: {
      type: String,
      trim: true,
      default: ''
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Virtual icon helper based on notification type
notificationSchema.virtual('icon').get(function () {
  switch (this.type) {
    case 'payment_due':
    case 'payment_reminder':
      return 'notifications_active';
    case 'payment_success':
      return 'check_circle';
    case 'payment_failed':
      return 'error';
    case 'new_booking':
      return 'calendar_month';
    case 'chat_message':
      return 'chat';
    case 'stay_update':
      return 'home_work';
    default:
      return 'notifications';
  }
});

module.exports = mongoose.model('Notification', notificationSchema);

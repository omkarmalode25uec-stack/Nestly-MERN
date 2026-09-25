const mongoose = require('mongoose');

const rentPaymentSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: [true, 'Booking reference is required'],
      index: true
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Student reference is required'],
      index: true
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner reference is required'],
      index: true
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: [true, 'Property reference is required'],
      index: true
    },
    cycleNumber: {
      type: Number,
      required: true,
      min: 1
    },
    billingPeriod: {
      startDate: {
        type: Date,
        required: true
      },
      endDate: {
        type: Date,
        required: true
      }
    },
    dueDate: {
      type: Date,
      required: true,
      index: true
    },
    amount: {
      type: Number,
      required: true,
      min: 1
    },
    status: {
      type: String,
      enum: ['pending', 'due', 'overdue', 'paid', 'failed'],
      default: 'due',
      index: true
    },
    zapUpiOrderId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    zapUpiTxnId: {
      type: String,
      trim: true,
      default: null
    },
    zapUpiUtr: {
      type: String,
      trim: true,
      default: null
    },
    paidAt: {
      type: Date,
      default: null
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

// Prevent duplicate monthly payments for the exact same booking and cycle number
rentPaymentSchema.index({ booking: 1, cycleNumber: 1 }, { unique: true });

// Formatted billing period label virtual
rentPaymentSchema.virtual('periodLabel').get(function () {
  if (!this.billingPeriod || !this.billingPeriod.startDate || !this.billingPeriod.endDate) {
    return 'Monthly Term';
  }
  const start = new Date(this.billingPeriod.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const end = new Date(this.billingPeriod.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${start} – ${end}`;
});

module.exports = mongoose.model('RentPayment', rentPaymentSchema);

const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required']
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: [true, 'Property reference is required']
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner reference is required']
    },
    // Amount for token hold deposit (default ₹2,000 as per Stitch design)
    amount: {
      type: Number,
      default: 2000,
      min: 0
    },
    monthlyRent: {
      type: Number,
      required: [true, 'Monthly rent is required']
    },
    securityDeposit: {
      type: Number,
      default: 0
    },
    roomType: {
      type: String,
      default: 'Double'
    },
    sharing: {
      type: String,
      default: 'Double'
    },
    moveInDate: {
      type: Date,
      default: () => new Date(Date.now() + 1000 * 60 * 60 * 24 * 14) // default 14 days ahead
    },
    durationMonths: {
      type: Number,
      default: 10 // Standard academic term
    },
    studentNotes: {
      type: String,
      trim: true,
      default: ''
    },
    dietaryPreference: {
      type: String,
      default: 'Veg'
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'rejected', 'cancelled'],
      default: 'pending'
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending'
    },
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Virtual property to format booking reference code: e.g. #NES-BK-8841
bookingSchema.virtual('referenceCode').get(function () {
  return '#NES-BK-' + this._id.toString().slice(-5).toUpperCase();
});

module.exports = mongoose.model('Booking', bookingSchema);

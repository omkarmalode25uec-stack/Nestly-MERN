const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      default: null
    },
    orderId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    referenceId: {
      type: String,
      trim: true
    },
    propertyTitle: {
      type: String,
      default: 'CozyNest Student Co-Living'
    },
    roomNumber: {
      type: String,
      default: 'Studio Suite • Room #304-B'
    },
    customerName: {
      type: String,
      default: 'Ananya Sharma'
    },
    customerMobile: {
      type: String,
      default: '9876543210'
    },
    amount: {
      type: Number,
      required: true,
      min: 1
    },
    currency: {
      type: String,
      default: 'INR'
    },
    transactionId: {
      type: String,
      trim: true
    },
    utr: {
      type: String,
      trim: true
    },
    gatewayReference: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'timeout', 'cancelled'],
      default: 'pending'
    },
    paymentUrl: {
      type: String,
      trim: true
    },
    gatewayResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Payment', paymentSchema);

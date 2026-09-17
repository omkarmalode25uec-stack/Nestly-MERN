const mongoose = require('mongoose');

const settlementSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner reference is required']
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Student reference is required']
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: [true, 'Booking reference is required']
    },
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: [true, 'Payment reference is required']
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: [true, 'Property reference is required']
    },
    grossAmount: {
      type: Number,
      required: true,
      min: 0
    },
    platformFee: {
      type: Number,
      default: 0,
      min: 0
    },
    netAmount: {
      type: Number,
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'settled', 'on_hold'],
      default: 'pending'
    },
    settlementMethod: {
      type: String,
      enum: ['upi', 'bank_transfer'],
      default: 'upi'
    },
    destinationUpiId: {
      type: String,
      trim: true,
      default: ''
    },
    destinationAccountHolder: {
      type: String,
      trim: true,
      default: ''
    },
    destinationBankName: {
      type: String,
      trim: true,
      default: ''
    },
    destinationAccountNumberMasked: {
      type: String,
      trim: true,
      default: ''
    },
    settlementReference: {
      type: String,
      trim: true,
      default: ''
    },
    settledAt: {
      type: Date
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

module.exports = mongoose.model('Settlement', settlementSchema);

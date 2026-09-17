const mongoose = require('mongoose');
const plm = require('passport-local-mongoose');
const passportLocalMongoose = plm.default || plm;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true
    },
    college: {
      type: String,
      trim: true,
      default: ''
    },
    phone: {
      type: String,
      trim: true,
      default: ''
    },
    role: {
      type: String,
      enum: ['student', 'owner', 'admin'],
      default: 'student'
    },
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'verified'
    },
    ownerType: {
      type: String,
      enum: ['individual', 'hostel_warden', 'pg_operator', 'property_manager'],
      default: 'individual'
    },
    businessName: {
      type: String,
      trim: true,
      default: ''
    },
    verificationNotes: {
      type: String,
      trim: true,
      default: ''
    },
    verifiedAt: {
      type: Date
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    settlementProfile: {
      accountHolderName: { type: String, trim: true, default: '' },
      settlementMethod: { type: String, enum: ['upi', 'bank_transfer'], default: 'upi' },
      upiId: { type: String, trim: true, default: '' },
      bankName: { type: String, trim: true, default: '' },
      accountNumber: { type: String, trim: true, default: '' },
      ifscCode: { type: String, trim: true, default: '' },
      isConfigured: { type: Boolean, default: false }
    },
    avatar: {
      type: String,
      default: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAAqpTMQUCkhceotbCDpxAeWqtXHfAaUd_MvLbHpoUKqbSReNrdROy2OxJ61b2HqePtFbEMVR10ceaXifCBtpESiztRrvm8YE-x5_CI3jGo4SfPWrOHiQ8ZEMQWrK4aFi6A_w_5fYZW8xVmq0M2Wfi2nQl26KqZ1Y9c-Gd9B8S9ay1POG96lryJev6l73TDl0uvnogfOth_Tx2LfXvMyBHZr4hxiN1CYSdO86eYigQFE-EKDCs9yeUs'
    },
    savedProperties: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property'
      }
    ]
  },
  {
    timestamps: true
  }
);

// Connect passport-local-mongoose using email as the login username
userSchema.plugin(passportLocalMongoose, {
  usernameField: 'email',
  errorMessages: {
    UserExistsError: 'A user with the given email address is already registered.'
  }
});

module.exports = mongoose.model('User', userSchema);

const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Property name is required'],
      trim: true
    },
    propertyType: {
      type: String,
      required: [true, 'Property type is required'],
      enum: ['Hostel', 'PG', 'Shared Flat', 'Co-Living'],
      default: 'PG'
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
      default: 'Kopargaon'
    },
    locality: {
      type: String,
      required: [true, 'Locality/Area is required'],
      trim: true
    },
    address: {
      type: String,
      required: [true, 'Full address is required'],
      trim: true
    },
    // Structured geographic location object supporting coordinates & institutions
    location: {
      city: {
        type: String,
        trim: true,
        default: 'Kopargaon'
      },
      locality: {
        type: String,
        trim: true
      },
      address: {
        type: String,
        trim: true
      },
      latitude: {
        type: Number,
        min: -90,
        max: 90
      },
      longitude: {
        type: Number,
        min: -180,
        max: 180
      },
      nearbyInstitutions: [
        {
          name: { type: String, trim: true },
          distanceKm: { type: Number, min: 0 }
        }
      ]
    },
    campusDistance: {
      type: String,
      default: 'Short walk to Sanjivani campus',
      trim: true
    },
    price: {
      type: Number,
      required: [true, 'Monthly rent price is required'],
      min: [0, 'Price cannot be negative']
    },
    securityDeposit: {
      type: Number,
      default: function () {
        return this.price;
      }
    },
    roomSharing: {
      type: String,
      enum: ['Single', 'Double', 'Triple', 'Four+'],
      default: 'Double'
    },
    genderPreference: {
      type: String,
      enum: ['Boys', 'Girls', 'Unisex'],
      default: 'Unisex'
    },
    images: {
      type: [String],
      default: [
        'https://lh3.googleusercontent.com/aida-public/AB6AXuBgBDIxb-WpmtqzQeuCJSuSq2xX8QDvXr1slAGbURtXyJxN1EqB7ZQN2uJsIR2IHJAeFy8PJBYdzTUXtXauyeiyJGJ_hIkT7iD6LFwF3Kv2furgx1OFHMa3IgG6pkdwEkXtd1oaVY81xlSKh_4wY83NF4dvK1FY7rV1QydaTNCcnwXskfd2UVBLHS0jGhK42ss_rQBeQ4JTh6BZjWV5_73HR08RwMDZlbIk5AJMDqAewgHwnHt0Qoul'
      ]
    },
    amenities: {
      type: [String],
      default: ['High-Speed Wi-Fi', '3x Meals', 'Power Backup', 'Biometric / CCTV Security']
    },
    availableBeds: {
      type: Number,
      default: 2,
      min: 0
    },
    isAvailable: {
      type: Boolean,
      default: true
    },
    isVerified: {
      type: Boolean,
      default: true
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    contactPhone: {
      type: String,
      trim: true
    },
    rating: {
      type: Number,
      default: 4.8,
      min: 1,
      max: 5
    },
    reviewCount: {
      type: Number,
      default: 24
    }
  },
  {
    timestamps: true
  }
);

// Pre-save hook: ensure location subdocument remains in sync with root fields
propertySchema.pre('save', function () {
  if (!this.location) {
    this.location = {};
  }
  if (!this.location.city && this.city) {
    this.location.city = this.city;
  }
  if (!this.city && this.location.city) {
    this.city = this.location.city;
  }
  if (!this.location.locality && this.locality) {
    this.location.locality = this.locality;
  }
  if (!this.location.address && this.address) {
    this.location.address = this.address;
  }
});

module.exports = mongoose.model('Property', propertySchema);

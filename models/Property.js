const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true
    },
    filename: {
      type: String,
      trim: true,
      default: ''
    }
  },
  { _id: false }
);

imageSchema.methods.toString = function () {
  return this.url;
};

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
      googleMapsUrl: {
        type: String,
        trim: true,
        default: ''
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
      type: [imageSchema],
      default: [
        {
          url: 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?auto=format&fit=crop&w=1200&q=80',
          filename: 'default_property'
        }
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

// Pre-validate hook: normalize images to { url, filename } objects
propertySchema.pre('validate', function () {
  if (this.images && Array.isArray(this.images)) {
    this.images = this.images.map((img) => {
      if (typeof img === 'string') {
        return { url: img, filename: img };
      }
      return img;
    });
  }
});

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

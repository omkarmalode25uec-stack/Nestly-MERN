/**
 * Nestly Safe & Idempotent Database Seed Script
 * 
 * Target: MongoDB Atlas (via process.env.ATLASDB_URL) or local fallback
 * Characteristics:
 * - SAFE: Never calls deleteMany() or drops collections; protects real user accounts and listings.
 * - IDEMPOTENT: Checks for existing records before inserting; running multiple times creates zero duplicates.
 * - COMPLIANT: Uses existing Mongoose schemas exactly (User, Property, Review, Booking).
 * - AUTHENTICATION: Registers users via passport-local-mongoose so passwords are secure and functional.
 * - GEOGRAPHIC SCOPE: Realistic Kopargaon student accommodations with real GPS coordinates and landmarks.
 */

const dns = require('dns');
const mongoose = require('mongoose');
require('dotenv').config();

// Defensive DNS fallback for Windows local environments where c-ares may default to 127.0.0.1
if (process.platform === 'win32') {
  const currentServers = dns.getServers();
  if (currentServers.length === 1 && currentServers[0] === '127.0.0.1') {
    try {
      dns.setServers(['8.8.8.8', '1.1.1.1']);
    } catch (e) {}
  }
}

const User = require('../models/User');
const Property = require('../models/Property');
const Review = require('../models/Review');
const Booking = require('../models/Booking');

const DB_URL = process.env.ATLASDB_URL || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/nestly';

const DEMO_PROPERTIES = [
  {
    title: 'Sai Shraddha Executive Boys PG',
    propertyType: 'PG',
    description: 'Modern student-focused PG situated just 200 meters from Sanjivani College main gate in Sahajanandnagar. Designed specifically for engineering and diploma students, featuring high-speed 150 Mbps fiber internet with UPS power backup, ergonomic study desks, individual wooden wardrobes, and 3x hygienic home-style Maharashtrian meals prepared daily in an in-house kitchen.',
    city: 'Kopargaon',
    locality: 'Sahajanandnagar',
    address: 'Near Sanjivani Engineering College, Sahajanandnagar, Kopargaon',
    campusDistance: '200m to Sanjivani College main gate',
    price: 4500,
    securityDeposit: 4500,
    roomSharing: 'Double',
    genderPreference: 'Boys',
    availableBeds: 3,
    contactPhone: '+91 98221 12233',
    rating: 4.8,
    reviewCount: 38,
    isAvailable: true,
    isVerified: true,
    location: {
      city: 'Kopargaon',
      locality: 'Sahajanandnagar',
      address: 'Near Sanjivani Engineering College, Sahajanandnagar, Kopargaon',
      latitude: 19.8921,
      longitude: 74.4795,
      googleMapsUrl: 'https://maps.google.com/?q=19.8921,74.4795',
      nearbyInstitutions: [
        { name: 'Sanjivani College of Engineering', distanceKm: 0.2 },
        { name: 'Kopargaon Railway Station', distanceKm: 2.1 }
      ]
    },
    images: [
      { url: 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?auto=format&fit=crop&w=1200&q=80', filename: 'demo_sai_shraddha_1' },
      { url: 'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?auto=format&fit=crop&w=1200&q=80', filename: 'demo_sai_shraddha_2' }
    ],
    amenities: [
      'High-Speed Wi-Fi',
      '3x Meals (Mess Included)',
      'Power Backup (24/7)',
      'Attached Washroom',
      'Biometric / CCTV Security',
      'Washing Machine / Laundry',
      'RO Drinking Water',
      'Two-Wheeler Parking'
    ]
  },
  {
    title: 'Sanjivani Kanya Niwas Girls Hostel',
    propertyType: 'Hostel',
    description: 'Premier all-girls accommodation situated right on College Road, Kopargaon. Fully secured with 24/7 female warden presence, biometric turnstile entry, CCTV monitoring in all common passages, quiet dedicated study hall with reference desks, and nutritious 3-course meals cooked fresh with local organic produce.',
    city: 'Kopargaon',
    locality: 'College Road',
    address: 'Plot 14, Opposite Pharmacy College, College Road, Kopargaon',
    campusDistance: '350m to Sanjivani Campus',
    price: 5200,
    securityDeposit: 5200,
    roomSharing: 'Double',
    genderPreference: 'Girls',
    availableBeds: 4,
    contactPhone: '+91 98221 12233',
    rating: 4.9,
    reviewCount: 52,
    isAvailable: true,
    isVerified: true,
    location: {
      city: 'Kopargaon',
      locality: 'College Road',
      address: 'Plot 14, Opposite Pharmacy College, College Road, Kopargaon',
      latitude: 19.8905,
      longitude: 74.4810,
      googleMapsUrl: 'https://maps.google.com/?q=19.8905,74.4810',
      nearbyInstitutions: [
        { name: 'Sanjivani Institute of Pharmacy', distanceKm: 0.1 },
        { name: 'Sanjivani College of Engineering', distanceKm: 0.35 }
      ]
    },
    images: [
      { url: 'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=1200&q=80', filename: 'demo_kanya_niwas_1' },
      { url: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1200&q=80', filename: 'demo_kanya_niwas_2' }
    ],
    amenities: [
      'High-Speed Wi-Fi',
      '3x Meals (Mess Included)',
      'Attached Washroom',
      'Biometric / CCTV Security',
      'Power Backup (24/7)',
      'Washing Machine / Laundry',
      'Quiet Study Library',
      'Solar Water Heater'
    ]
  },
  {
    title: 'Godavari Student Co-Living Suites',
    propertyType: 'Co-Living',
    description: 'Boutique single-room co-living suites designed for final year engineering students, project scholars, and campus interns seeking an elevated living experience. Each private suite features an air-conditioner, balcony with green open views, weekly housekeeping service, mini pantry, high-speed fiber internet, and access to a common recreation lounge.',
    city: 'Kopargaon',
    locality: 'Sai City',
    address: 'Sai City Road, Near Shirdi Highway Bypass, Kopargaon',
    campusDistance: '1.1 km to Sanjivani Campus (Shuttle Available)',
    price: 7500,
    securityDeposit: 7500,
    roomSharing: 'Single',
    genderPreference: 'Unisex',
    availableBeds: 2,
    contactPhone: '+91 98221 12233',
    rating: 4.9,
    reviewCount: 29,
    isAvailable: true,
    isVerified: true,
    location: {
      city: 'Kopargaon',
      locality: 'Sai City',
      address: 'Sai City Road, Near Shirdi Highway Bypass, Kopargaon',
      latitude: 19.9002,
      longitude: 74.4775,
      googleMapsUrl: 'https://maps.google.com/?q=19.9002,74.4775',
      nearbyInstitutions: [
        { name: 'Sanjivani University Complex', distanceKm: 1.1 },
        { name: 'Sai City Market', distanceKm: 0.4 }
      ]
    },
    images: [
      { url: 'https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=1200&q=80', filename: 'demo_godavari_1' },
      { url: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80', filename: 'demo_godavari_2' }
    ],
    amenities: [
      'High-Speed Wi-Fi',
      'Air Conditioning (AC)',
      'Attached Washroom',
      'Private Balcony',
      'Daily Housekeeping',
      'Power Backup (24/7)',
      'Biometric / CCTV Security',
      'No Curfew / Flexible Entry'
    ]
  },
  {
    title: 'Mauli Scholars Boys Hostel',
    propertyType: 'Hostel',
    description: 'Affordable and disciplined hostel accommodation in Sahajanandnagar, just a short 5-minute walk from college laboratories and workshops. Clean 3-sharing rooms with steel cots, mattress, study desks, shared washrooms with instant hot water, filtered cold drinking water, and hot wholesome vegetarian meals twice daily.',
    city: 'Kopargaon',
    locality: 'Sahajanandnagar',
    address: 'Lane 3, Behind Engineering Workshop, Sahajanandnagar, Kopargaon',
    campusDistance: '400m walk to college workshops',
    price: 3500,
    securityDeposit: 3500,
    roomSharing: 'Triple',
    genderPreference: 'Boys',
    availableBeds: 6,
    contactPhone: '+91 98221 12233',
    rating: 4.6,
    reviewCount: 41,
    isAvailable: true,
    isVerified: true,
    location: {
      city: 'Kopargaon',
      locality: 'Sahajanandnagar',
      address: 'Lane 3, Behind Engineering Workshop, Sahajanandnagar, Kopargaon',
      latitude: 19.8935,
      longitude: 74.4760,
      googleMapsUrl: 'https://maps.google.com/?q=19.8935,74.4760',
      nearbyInstitutions: [
        { name: 'Sanjivani Polytechnic', distanceKm: 0.3 }
      ]
    },
    images: [
      { url: 'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?auto=format&fit=crop&w=1200&q=80', filename: 'demo_mauli_1' }
    ],
    amenities: [
      'High-Speed Wi-Fi',
      '3x Meals (Mess Included)',
      'RO Drinking Water',
      'Hot Water Geyser',
      'Two-Wheeler Parking',
      'Biometric / CCTV Security'
    ]
  },
  {
    title: 'Anand Premium Student Flat',
    propertyType: 'Shared Flat',
    description: 'Spacious 3-BHK student apartment near Kopargaon Bus Stand and Station Road, ideal for group of friends preferring independent apartment living. Includes modular kitchen with gas stove and refrigerator, automatic washing machine, wide terrace, 100 Mbps broadband, and complete privacy.',
    city: 'Kopargaon',
    locality: 'Station Road',
    address: 'Station Road, Near Kopargaon Bus Stand, Kopargaon',
    campusDistance: '1.8 km to Sanjivani Campus (Direct Auto/Bus)',
    price: 3200,
    securityDeposit: 3200,
    roomSharing: 'Four+',
    genderPreference: 'Boys',
    availableBeds: 4,
    contactPhone: '+91 98221 12233',
    rating: 4.5,
    reviewCount: 19,
    isAvailable: true,
    isVerified: true,
    location: {
      city: 'Kopargaon',
      locality: 'Station Road',
      address: 'Station Road, Near Kopargaon Bus Stand, Kopargaon',
      latitude: 19.8840,
      longitude: 74.4820,
      googleMapsUrl: 'https://maps.google.com/?q=19.8840,74.4820',
      nearbyInstitutions: [
        { name: 'Kopargaon Bus Station', distanceKm: 0.4 },
        { name: 'K.J. Somaiya College', distanceKm: 1.2 }
      ]
    },
    images: [
      { url: 'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=1200&q=80', filename: 'demo_anand_1' }
    ],
    amenities: [
      'High-Speed Wi-Fi',
      'Self-Cooking Kitchen',
      'Refrigerator',
      'Washing Machine / Laundry',
      'Power Backup (24/7)',
      'Attached Washroom'
    ]
  },
  {
    title: 'Radha Krishna Premium Girls PG',
    propertyType: 'PG',
    description: 'Exclusive, well-maintained single occupancy private rooms for female students and faculty. Located in quiet residential Shivaji Nagar. Highlights include attached private western washrooms, home-cooked food delivered hot twice a day, dedicated laundry service, and strict visitor verification policy.',
    city: 'Kopargaon',
    locality: 'Shivaji Nagar',
    address: 'Shivaji Nagar, Near Dr. Ambedkar Chowk, Kopargaon',
    campusDistance: '800m to College Campuses',
    price: 6200,
    securityDeposit: 6200,
    roomSharing: 'Single',
    genderPreference: 'Girls',
    availableBeds: 1,
    contactPhone: '+91 98221 12233',
    rating: 4.8,
    reviewCount: 34,
    isAvailable: true,
    isVerified: true,
    location: {
      city: 'Kopargaon',
      locality: 'Shivaji Nagar',
      address: 'Shivaji Nagar, Near Dr. Ambedkar Chowk, Kopargaon',
      latitude: 19.8870,
      longitude: 74.4750,
      googleMapsUrl: 'https://maps.google.com/?q=19.8870,74.4750',
      nearbyInstitutions: [
        { name: 'Sanjivani Campus', distanceKm: 0.8 },
        { name: 'Shivaji Nagar Garden', distanceKm: 0.3 }
      ]
    },
    images: [
      { url: 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?auto=format&fit=crop&w=1200&q=80', filename: 'demo_radha_krishna_1' }
    ],
    amenities: [
      'High-Speed Wi-Fi',
      '3x Meals (Mess Included)',
      'Attached Washroom',
      'Biometric / CCTV Security',
      'Power Backup (24/7)',
      'Washing Machine / Laundry',
      'RO Drinking Water'
    ]
  }
];

async function runSeed() {
  console.log('[Seed] Connecting to database...');
  await mongoose.connect(DB_URL);
  const isAtlas = DB_URL.includes('mongodb.net');
  console.log(`[Seed] Connected to: ${isAtlas ? 'MongoDB Atlas (Production)' : 'MongoDB (Local)'}`);

  // -------------------------------------------------------------
  // 1. SEED DEMO USERS (Safely check if existing, never delete)
  // -------------------------------------------------------------
  console.log('\n--- 1. SEEDING DEMO USERS ---');

  // A. Demo Owner Account
  let demoOwner = await User.findOne({ email: 'owner.demo@nestly.in' });
  if (!demoOwner) {
    demoOwner = new User({
      name: 'Suresh Kulkarni (Demo Host)',
      email: 'owner.demo@nestly.in',
      phone: '9822112233',
      role: 'owner',
      ownerType: 'pg_operator',
      businessName: 'Kulkarni Student Residencies',
      verificationStatus: 'verified',
      settlementProfile: {
        accountHolderName: 'Suresh Kulkarni',
        settlementMethod: 'upi',
        upiId: 'sureshkulkarni@okhdfcbank',
        isConfigured: true
      },
      avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAAqpTMQUCkhceotbCDpxAeWqtXHfAaUd_MvLbHpoUKqbSReNrdROy2OxJ61b2HqePtFbEMVR10ceaXifCBtpESiztRrvm8YE-x5_CI3jGo4SfPWrOHiQ8ZEMQWrK4aFi6A_w_5fYZW8xVmq0M2Wfi2nQl26KqZ1Y9c-Gd9B8S9ay1POG96lryJev6l73TDl0uvnogfOth_Tx2LfXvMyBHZr4hxiN1CYSdO86eYigQFE-EKDCs9yeUs'
    });
    demoOwner = await User.register(demoOwner, 'OwnerPass123!');
    console.log('✓ Created demo owner user: owner.demo@nestly.in / OwnerPass123!');
  } else {
    console.log('✓ Demo owner already exists: owner.demo@nestly.in (preserved)');
  }

  // B. Demo Student Account
  let demoStudent = await User.findOne({ email: 'student.demo@nestly.in' });
  if (!demoStudent) {
    demoStudent = new User({
      name: 'Aarav Patel (Demo Student)',
      email: 'student.demo@nestly.in',
      college: 'Sanjivani College of Engineering, Kopargaon',
      phone: '9876543210',
      role: 'student',
      verificationStatus: 'verified',
      avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAAqpTMQUCkhceotbCDpxAeWqtXHfAaUd_MvLbHpoUKqbSReNrdROy2OxJ61b2HqePtFbEMVR10ceaXifCBtpESiztRrvm8YE-x5_CI3jGo4SfPWrOHiQ8ZEMQWrK4aFi6A_w_5fYZW8xVmq0M2Wfi2nQl26KqZ1Y9c-Gd9B8S9ay1POG96lryJev6l73TDl0uvnogfOth_Tx2LfXvMyBHZr4hxiN1CYSdO86eYigQFE-EKDCs9yeUs'
    });
    demoStudent = await User.register(demoStudent, 'StudentPass123!');
    console.log('✓ Created demo student user: student.demo@nestly.in / StudentPass123!');
  } else {
    console.log('✓ Demo student already exists: student.demo@nestly.in (preserved)');
  }

  // -------------------------------------------------------------
  // 2. SEED ACCOMMODATION LISTINGS (Idempotent: title + city check)
  // -------------------------------------------------------------
  console.log('\n--- 2. SEEDING KOPARGAON ACCOMMODATIONS ---');
  const seededProperties = [];

  for (const propData of DEMO_PROPERTIES) {
    let existing = await Property.findOne({ title: propData.title, city: 'Kopargaon' });
    if (!existing) {
      const property = new Property({
        ...propData,
        owner: demoOwner._id
      });
      await property.save();
      console.log(`✓ Seeded new listing: "${property.title}" (${property.propertyType}, ${property.genderPreference}, ₹${property.price}/mo)`);
      seededProperties.push(property);
    } else {
      console.log(`✓ Listing already exists: "${existing.title}" (preserved, ID: ${existing._id})`);
      seededProperties.push(existing);
    }
  }

  // -------------------------------------------------------------
  // 3. SEED REVIEWS (Idempotent: author + property check)
  // -------------------------------------------------------------
  console.log('\n--- 3. SEEDING STUDENT REVIEWS ---');
  const reviewSamples = [
    {
      propertyIndex: 0,
      rating: 5,
      comment: 'Super convenient location! It takes less than 3 minutes to walk to the Sanjivani College mechanical engineering department. Food is clean, hygienic and Wi-Fi speed is reliable even in evenings.'
    },
    {
      propertyIndex: 1,
      rating: 5,
      comment: 'Very safe environment for girls with 24/7 warden support and biometric check-ins. The study hall is peaceful, and hot water is always available in morning hours.'
    },
    {
      propertyIndex: 2,
      rating: 5,
      comment: 'The private single room and balcony here is worth every rupee. Perfect for undisturbed final-year project preparation and online placement interviews.'
    }
  ];

  for (const rev of reviewSamples) {
    const targetProp = seededProperties[rev.propertyIndex];
    if (targetProp) {
      const existingReview = await Review.findOne({ author: demoStudent._id, property: targetProp._id });
      if (!existingReview) {
        const review = new Review({
          author: demoStudent._id,
          property: targetProp._id,
          rating: rev.rating,
          comment: rev.comment
        });
        await review.save();
        console.log(`✓ Seeded review on "${targetProp.title}": ${rev.rating}★ ("${rev.comment.slice(0, 45)}...")`);
      } else {
        console.log(`✓ Review already exists on "${targetProp.title}" (preserved)`);
      }
    }
  }

  // -------------------------------------------------------------
  // 4. SEED SAMPLE DEMO BOOKING (Idempotent: user + property check)
  // -------------------------------------------------------------
  console.log('\n--- 4. SEEDING SAMPLE DEMO BOOKING ---');
  const primeProperty = seededProperties[0];
  if (primeProperty) {
    const existingBooking = await Booking.findOne({ user: demoStudent._id, property: primeProperty._id });
    if (!existingBooking) {
      const demoBooking = new Booking({
        user: demoStudent._id,
        property: primeProperty._id,
        owner: demoOwner._id,
        amount: 2000,
        monthlyRent: primeProperty.price,
        securityDeposit: primeProperty.securityDeposit,
        roomType: primeProperty.roomSharing,
        sharing: primeProperty.roomSharing,
        status: 'confirmed',
        paymentStatus: 'completed',
        studentNotes: '[DEMO SHOWCASE RESERVATION] Academic year token deposit confirmed.'
      });
      await demoBooking.save();
      console.log(`✓ Seeded showcase booking (${demoBooking.referenceCode}) on "${primeProperty.title}"`);
    } else {
      console.log(`✓ Showcase booking already exists (${existingBooking.referenceCode}) (preserved)`);
    }
  }

  // -------------------------------------------------------------
  // 5. SUMMARY & TOTALS
  // -------------------------------------------------------------
  console.log('\n=============================================================');
  const totalUsers = await User.countDocuments();
  const totalProperties = await Property.countDocuments({ city: 'Kopargaon' });
  const totalReviews = await Review.countDocuments();
  const totalBookings = await Booking.countDocuments();

  console.log('🎉 SEEDING COMPLETE AND VERIFIED!');
  console.log(`- Total Users in DB: ${totalUsers}`);
  console.log(`- Total Kopargaon Properties: ${totalProperties}`);
  console.log(`- Total Reviews in DB: ${totalReviews}`);
  console.log(`- Total Bookings in DB: ${totalBookings}`);
  console.log('=============================================================\n');

  await mongoose.disconnect();
}

runSeed().catch(async (err) => {
  console.error('\n❌ SEED SCRIPT FAILED:', err.message);
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(1);
});

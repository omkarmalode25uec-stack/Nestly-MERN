const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Property = require('../models/Property');

const sampleProperties = [
  {
    title: 'Green Valley Premier PG',
    propertyType: 'PG',
    description: 'Modern student-centric accommodation specifically tailored for focused academic study and vibrant communal living. Every floor provides fully furnished rooms with individual ergonomic study workstations, 200 Mbps fiber connectivity with redundant backup, and hygienic home-style meals prepared 3 times daily by in-house trained chefs.',
    city: 'Pune',
    locality: 'Hinjewadi Phase 1',
    address: 'Sector 2, Phase 1, Hinjewadi, Pune',
    campusDistance: '0.8 km to Symbiosis Tech & Rajiv Gandhi Infotech Park',
    price: 8500,
    securityDeposit: 8500,
    roomSharing: 'Double',
    genderPreference: 'Unisex',
    availableBeds: 2,
    contactPhone: '+91 98765 43210',
    rating: 4.8,
    reviewCount: 142,
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBgBDIxb-WpmtqzQeuCJSuSq2xX8QDvXr1slAGbURtXyJxN1EqB7ZQN2uJsIR2IHJAeFy8PJBYdzTUXtXauyeiyJGJ_hIkT7iD6LFwF3Kv2furgx1OFHMa3IgG6pkdwEkXtd1oaVY81xlSKh_4wY83NF4dvK1FY7rV1QydaTNCcnwXskfd2UVBLHS0jGhK42ss_rQBeQ4JTh6BZjWV5_73HR08RwMDZlbIk5AJMDqAewgHwnHt0Qoul',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAg7qGDgoE-L4O5XEb65do0kjcLNoTvCJ_3x-8bSrA78i4Zaj57Nd_PfrLzvK9k8XI9oXYd1YBUbac4mlThC38kGiSZRRcnb_ijOPfYiMAp_QF8-3h03j5kagGZqwcIrQoicOOjG_s1AWVwgEHhvEwV2ao7af3mYfcQiNnLmLbnnb71RXuBRxEbAFkMkwqAHn2YAJwFAF23OuqnbxIprPjdCgSn6zNE4wJGiEJ3lD6XFI2WDwA_OVIE',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCwDASJnBO1Sa-xAVAqF_Dq7JnYOsdbZQD6iVjgQ8sN7KgyRnmLPZr6ea7tfEgC_r_z_D2dnWsHv6dC23GiN8q5sTZK4LQRI7rLhiuHBHqZryRytUWm0IGX9a3-c28gsd1wCMDjDc_VZ4lO-0IpjMZnjwZln0MD6ikO0ti1NL73huChu-JpuALOGb1M2dZrVOpFV80KV1z8nA-iwm0TQvwp_TqL-VhMVRaRrWz0tP74VRX2nx0V0LHi',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuB2hKNomyCs5fjlQhiTjlB_hXehvJEPXcnmcPeLlQqMe-rRR_g2Wbf2ZtG2A-MMtFxUVPzO4Z7wBeIzvxWQ7mnR1D01L2N9c6Z9aUF8d3WA_Ch2pDume7sXQ4RlSbRNhL0xl9qPKzDdXvspYliTj9Ou4shZ5TcCsFq8cKbh5-gGVSxRhCykUTjEd4lqCJOuxOkiNqzr3KQYzYWLtdvaMwBI2sxpIgRBlcgwgXWS9MnUmzr4UDIYKUIB',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAa1q3GQSPa4SIFj03WUkL4mDjKuQUA452NLCmCwUMKInHPlMqO_7nBoSez87T9HRPEQZmqTYWiuqTCkvOsdiMd3dV4ylaJBcX1orP-xGO2wbG5KgGQluot5RTZM9LeK7TNt3fTcJGQ5HQOmtTS1RQ5J5rskPkCacQ1a_moFnViZ5gZdRemW8ODgYEQbzF6SQYKZUJSddbV8KDJcH4XvTorBevNSUXDbvB9P--VyI0X4YWwgmRHbW5F'
    ],
    amenities: [
      'High-Speed Wi-Fi',
      '3x Meals (Mess Included)',
      'Air Conditioning (AC)',
      'Washing Machine / Laundry',
      'Power Backup (24/7)',
      'Attached Washroom',
      'Biometric / CCTV Security',
      'No Curfew / Flexible Entry'
    ]
  },
  {
    title: 'Scholar Haven Girls Hostel',
    propertyType: 'Hostel',
    description: 'Premier all-girls accommodation situated right next to college gates in Viman Nagar. Features biometric entry, 24/7 female warden presence, peaceful quiet study library, and daily multi-cuisine meal plans.',
    city: 'Pune',
    locality: 'Viman Nagar',
    address: 'Near Datta Mandir Chowk, Viman Nagar, Pune',
    campusDistance: '0.4 km to Symbiosis International Campus',
    price: 9200,
    securityDeposit: 9200,
    roomSharing: 'Double',
    genderPreference: 'Girls',
    availableBeds: 4,
    contactPhone: '+91 98450 11223',
    rating: 4.9,
    reviewCount: 184,
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCbO2BbUUkI1nVWSzTkHyjy2CHXYieCdkA89YTfIDL4VTeraYi6ytOve1KKxiUJLFKQvbeBd21ocSGgoyPTwy0emKYv51h5QnPFWMFz53ZxhUQpQ9otQ4VecX1QK11Z5IuAaLhq6-uGkRBzLDNrWaW2n85w5reO-MarsSXHyUp_jEUirGm93idEFLlauTm5IZcLGa-2UrwIwODAjomV8gVT4N-KXk2G6tk9EcpkBcXYL9TfmU-KCm2j',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBgBDIxb-WpmtqzQeuCJSuSq2xX8QDvXr1slAGbURtXyJxN1EqB7ZQN2uJsIR2IHJAeFy8PJBYdzTUXtXauyeiyJGJ_hIkT7iD6LFwF3Kv2furgx1OFHMa3IgG6pkdwEkXtd1oaVY81xlSKh_4wY83NF4dvK1FY7rV1QydaTNCcnwXskfd2UVBLHS0jGhK42ss_rQBeQ4JTh6BZjWV5_73HR08RwMDZlbIk5AJMDqAewgHwnHt0Qoul'
    ],
    amenities: [
      'High-Speed Wi-Fi',
      '3x Meals (Mess Included)',
      'Attached Washroom',
      'Biometric / CCTV Security',
      'Washing Machine / Laundry'
    ]
  },
  {
    title: 'CozyNest Student Co-Living',
    propertyType: 'Co-Living',
    description: 'Chic, premium co-living community designed for college students and interns. Includes private East garden view balcony suites, gaming zone, chef-curated nutrition, and weekly housekeeping.',
    city: 'Pune',
    locality: 'Baner',
    address: 'Baner Road, near MIT-WPU & Symbiosis Transit Hub, Pune',
    campusDistance: '1.2 km to MIT-WPU Transit hub',
    price: 11500,
    securityDeposit: 11500,
    roomSharing: 'Single',
    genderPreference: 'Unisex',
    availableBeds: 1,
    contactPhone: '+91 97654 32109',
    rating: 4.9,
    reviewCount: 96,
    images: [
      'https://lh3.googleusercontent.com/aida-public/AB6AXuA0VElJyMeK-Gjr7YFbG98rPMT1ZLTkNqv8tDAOFyp9dQrVHULE2C_eEMRVmVs8PZcoRtO9HhOsBWdYmPfxVV3O_FR_30zb-SrEiHS0TI0GYajICnyqIhbQ1ZEpctCdY3M5VTp_bVo6inRhxo0eoKP5G7ScYQqRpVgzOeAKdm1XGqHMktWLXfvtqew3rj_1fcMFDfiGgd-4Go5Ot1XViJJnEEUeFiIU4uXJmp2KkOTlDW4f5cc0vH1t',
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAxNvXNz9_QKUjyBxiqBj42eixl_YNRgQ3hqNI5oz75W6qVa6B5rQapW7_v8xNERpcL2VdE2_rlTw1a7s2c6Ux7HBqWy6q2IZg5wvrNS04TBjTv-RcILryb3PGIg0ZPp_DgZzsRG92AeRvPVQtHEeTwP6ICBd_h2P6UK1_wtuo8-tik6nLRGCdeO-Zj1j69wOqVCcB5eLiqxhhFK0Ye5u4wF6gZva2WmSGTpZyR3XZYvd__xUTX9cLD'
    ],
    amenities: [
      'High-Speed Wi-Fi',
      '3x Meals (Mess Included)',
      'Air Conditioning (AC)',
      'Power Backup (24/7)',
      'No Curfew / Flexible Entry'
    ]
  }
];

async function seedDatabase() {
  const dbUrl = process.env.ATLASDB_URL || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/nestly';
  await mongoose.connect(dbUrl);
  console.log('MongoDB connected for seeding.');

  // Find or create a default host/owner user
  let host = await User.findOne({ role: 'owner' });
  if (!host) {
    host = new User({
      name: 'Rajesh Deshmukh (Host)',
      email: 'rajesh.host@nestly.in',
      college: 'Property Management Partner',
      phone: '+91 98765 43210',
      role: 'owner'
    });
    host = await User.register(host, 'HostPass123!');
    console.log('Created default host user:', host.email);
  }

  // Count existing properties
  const count = await Property.countDocuments();
  if (count === 0) {
    for (const propData of sampleProperties) {
      propData.owner = host._id;
      const prop = new Property(propData);
      await prop.save();
      console.log('Seeded property:', prop.title);
    }
    console.log('Seeding complete! 3 Stitch properties added.');
  } else {
    console.log(`Database already has ${count} properties. Skipping seed.`);
  }

  await mongoose.disconnect();
}

seedDatabase().catch((err) => {
  console.error('Seeding error:', err);
  process.exit(1);
});

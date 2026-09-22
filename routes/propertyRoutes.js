const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Property = require('../models/Property');
const { isLoggedIn, isPropertyOwner, isVerifiedOwner } = require('../middleware/auth');
const {
  isCityInActiveServiceArea,
  normalizeToActiveCity,
  getPrimaryServiceArea,
  getActiveLocationQueryFilter
} = require('../config/serviceArea');

const { upload, deleteCloudinaryImage } = require('../config/cloudinary');

/**
 * Multer image upload middleware wrapper with user-friendly flash error handling
 */
function handleImageUpload(req, res, next) {
  upload.array('images', 10)(req, res, (err) => {
    if (err) {
      req.flash('error', err.message || 'Image upload error. Please select valid photos (max 5MB each).');
      const fallbackUrl = req.params && req.params.id ? `/stays/${req.params.id}/edit` : '/stays/new';
      return res.redirect(fallbackUrl);
    }
    next();
  });
}

/**
 * Helper to process amenities array from checkbox form inputs
 */
function parseAmenities(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * Helper to parse image URLs (split by newline or comma)
 */
function parseImages(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((img) => (typeof img === 'string' ? { url: img, filename: img } : img))
      .filter((img) => img && img.url);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith('http'))
      .map((url) => ({ url, filename: url }));
  }
}

/**
 * GET /stays
 * Explore / search listings with comprehensive Stitch filters
 */
router.get('/stays', async (req, res, next) => {
  try {
    const {
      city,
      locality,
      campus,
      type,
      gender,
      sharing,
      minPrice,
      maxPrice,
      amenities,
      availableOnly,
      sort,
      q
    } = req.query;

    const filter = {};

    // 1. Text Search across Title, Locality, City, Address, Campus, Description
    if (q && q.trim()) {
      const term = q.trim();
      const regex = new RegExp(term, 'i');
      filter.$or = [
        { title: regex },
        { locality: regex },
        { city: regex },
        { address: regex },
        { campusDistance: regex },
        { description: regex }
      ];
    }

    // 2. City Filter
    if (city && city.trim()) {
      filter.city = new RegExp(city.trim(), 'i');
    }

    // 3. Locality / Micro-Location Filter
    if (locality && locality.trim()) {
      filter.locality = new RegExp(locality.trim(), 'i');
    }

    // 4. Campus Filter
    if (campus && campus.trim()) {
      const campusRegex = new RegExp(campus.trim(), 'i');
      if (filter.$or) {
        filter.$or.push({ campusDistance: campusRegex });
      } else {
        filter.campusDistance = campusRegex;
      }
    }

    // 5. Stay Category / Property Type (supports single value or multiple array)
    if (type) {
      const types = Array.isArray(type) ? type.filter(Boolean) : [type].filter(Boolean);
      if (types.length === 1) {
        filter.propertyType = types[0];
      } else if (types.length > 1) {
        filter.propertyType = { $in: types };
      }
    }

    // 6. Occupant Suitability: Gender Preference
    if (gender) {
      const rawList = Array.isArray(gender) ? gender.filter(Boolean) : [gender].filter(Boolean);
      const normalizedGenders = rawList
        .map((g) => {
          const val = String(g).trim();
          if (!val || /^(all|any)$/i.test(val)) return null;
          if (/^(male|boys|boy|men)$/i.test(val)) return 'Boys';
          if (/^(female|girls|girl|women)$/i.test(val)) return 'Girls';
          if (/^(unisex|co-ed|coliving|co-living|mixed)$/i.test(val)) return 'Unisex';
          return val;
        })
        .filter(Boolean);

      if (normalizedGenders.length === 1) {
        filter.genderPreference = normalizedGenders[0];
      } else if (normalizedGenders.length > 1) {
        filter.genderPreference = { $in: normalizedGenders };
      }
    }

    // 7. Occupant Suitability: Room Occupancy / Sharing
    if (sharing) {
      const sharings = Array.isArray(sharing) ? sharing.filter(Boolean) : [sharing].filter(Boolean);
      if (sharings.length === 1 && sharings[0]) {
        filter.roomSharing = sharings[0];
      } else if (sharings.length > 1) {
        filter.roomSharing = { $in: sharings };
      }
    }

    // 8. Price Range (minPrice / maxPrice)
    const priceFilter = {};
    if (minPrice && !isNaN(minPrice) && Number(minPrice) > 0) {
      priceFilter.$gte = Number(minPrice);
    }
    if (maxPrice && !isNaN(maxPrice) && Number(maxPrice) > 0) {
      priceFilter.$lte = Number(maxPrice);
    }
    if (Object.keys(priceFilter).length > 0) {
      filter.price = priceFilter;
    }

    // 9. Amenities (must match all selected amenities using case-insensitive regex)
    if (amenities) {
      const amenityList = Array.isArray(amenities)
        ? amenities.filter(Boolean)
        : [amenities].filter(Boolean);

      if (amenityList.length > 0) {
        filter.amenities = {
          $all: amenityList.map((a) => new RegExp(a.trim(), 'i'))
        };
      }
    }

    // 10. Live Availability Filter (available beds > 0 and marked available)
    if (availableOnly === 'true' || availableOnly === 'on' || availableOnly === '1') {
      filter.isAvailable = true;
      filter.availableBeds = { $gt: 0 };
    }

    // 11. Geographic Scope Restriction: ALWAYS restrict public discovery to active service areas (Kopargaon)
    // If a user requested an unsupported city via query string, return 0 results inside Kopargaon scope
    const requestedCity = (city || '').trim();
    if (requestedCity && !isCityInActiveServiceArea(requestedCity)) {
      // Requested city is outside active scope (e.g. Pune, Mumbai, Nashik)
      filter.city = '__OUT_OF_SCOPE_NO_MATCH__';
    } else {
      // Merge active geographic scope filter (Kopargaon)
      const geoFilter = getActiveLocationQueryFilter();
      if (!filter.$and) {
        filter.$and = [];
      }
      filter.$and.push(geoFilter);
    }

    // 12. Trust & Safety: Exclude unverified/unapproved listings from public discovery
    filter.isVerified = { $ne: false };

    // 12. Sorting
    let sortQuery = { createdAt: -1 }; // Default: Recommended / Newest
    if (sort === 'price_asc') {
      sortQuery = { price: 1 };
    } else if (sort === 'price_desc') {
      sortQuery = { price: -1 };
    } else if (sort === 'rating') {
      sortQuery = { rating: -1 };
    }

    // Execute queries within active geographic scope
    const [properties, totalCount, categoryCounts] = await Promise.all([
      Property.find(filter).sort(sortQuery),
      Property.countDocuments(getActiveLocationQueryFilter()),
      Property.aggregate([
        { $match: getActiveLocationQueryFilter() },
        { $group: { _id: '$propertyType', count: { $sum: 1 } } }
      ]).then((results) => {
        const counts = {};
        results.forEach((r) => {
          counts[r._id] = r.count;
        });
        return counts;
      })
    ]);

    res.render('pages/stays/index', {
      title: 'Explore Verified Student Stays in Kopargaon | Nestly',
      activePage: 'explore',
      properties,
      filters: req.query,
      totalCount,
      categoryCounts,
      primaryServiceArea: getPrimaryServiceArea()
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /compare
 * Render side-by-side accommodation comparison view matching Stitch design
 */
router.get('/compare', async (req, res, next) => {
  try {
    let { ids } = req.query;
    let properties = [];

    if (ids) {
      const idList = Array.isArray(ids)
        ? ids
        : String(ids).split(',').map((id) => id.trim());

      const validIds = idList.filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (validIds.length > 0) {
        properties = await Property.find({ _id: { $in: validIds } }).limit(3);
      }
    }

    // If fewer than 3 properties provided, fetch top properties in active service area to complete 3-way matrix
    if (properties.length < 3) {
      const existingIds = properties.map((p) => p._id);
      const additional = await Property.find({
        _id: { $nin: existingIds },
        ...getActiveLocationQueryFilter()
      })
        .sort({ rating: -1, createdAt: -1 })
        .limit(3 - properties.length);
      properties = properties.concat(additional);
    }

    res.render('pages/compare', {
      title: 'Compare Student Stays & Hostels | Nestly',
      activePage: 'compare',
      properties
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /stays/new
 * Render form to create a new accommodation listing (Verified Owners & Admins only)
 */
router.get('/stays/new', isLoggedIn, isVerifiedOwner, (req, res) => {
  res.render('pages/stays/new', {
    title: 'List Your Student Property | Nestly',
    activePage: 'new-stay'
  });
});

/**
 * POST /stays
 * Handle new property listing creation (Verified Owners & Admins only)
 */
router.post('/stays', isLoggedIn, isVerifiedOwner, handleImageUpload, async (req, res, next) => {
  try {
    const {
      title,
      propertyType = 'PG',
      description,
      city = 'Pune',
      locality,
      address,
      campusDistance,
      price,
      securityDeposit,
      roomSharing = 'Double',
      genderPreference = 'Unisex',
      images,
      amenities,
      availableBeds,
      contactPhone,
      latitude,
      longitude,
      googleMapsUrl
    } = req.body;

    if (!title || !description || !city || !locality || !address || price === undefined || price === null || price === '') {
      req.flash('error', 'Please fill in all required property details.');
      return res.redirect('/stays/new');
    }

    // Location Coordinates validation
    let parsedLat = latitude !== undefined && latitude !== '' ? Number(latitude) : undefined;
    let parsedLng = longitude !== undefined && longitude !== '' ? Number(longitude) : undefined;
    if (parsedLat !== undefined && (isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90)) {
      req.flash('error', 'Please provide a valid latitude between -90 and 90.');
      return res.redirect('/stays/new');
    }
    if (parsedLng !== undefined && (isNaN(parsedLng) || parsedLng < -180 || parsedLng > 180)) {
      req.flash('error', 'Please provide a valid longitude between -180 and 180.');
      return res.redirect('/stays/new');
    }
    // Default to Kopargaon reference coordinates if not provided
    if (parsedLat === undefined || parsedLng === undefined) {
      parsedLat = 19.8913;
      parsedLng = 74.4784;
    }

    // Geographic boundary restriction: Validate city against active service areas (Kopargaon)
    if (!isCityInActiveServiceArea(city)) {
      req.flash(
        'error',
        `Nestly currently operates exclusively in ${getPrimaryServiceArea().name}, Maharashtra. Listings outside our active service scope cannot be accepted at this time.`
      );
      return res.redirect('/stays/new');
    }

    if (title.trim().length < 3 || title.trim().length > 120) {
      req.flash('error', 'Property name must be between 3 and 120 characters.');
      return res.redirect('/stays/new');
    }

    if (description.trim().length < 10) {
      req.flash('error', 'Description must be at least 10 characters long.');
      return res.redirect('/stays/new');
    }

    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice <= 0 || numPrice > 1000000) {
      req.flash('error', 'Please provide a valid monthly rent between ₹1 and ₹10,00,000.');
      return res.redirect('/stays/new');
    }

    const numDeposit = securityDeposit !== undefined && securityDeposit !== '' ? Number(securityDeposit) : numPrice;
    if (isNaN(numDeposit) || numDeposit < 0 || numDeposit > 2000000) {
      req.flash('error', 'Security deposit must be a valid non-negative amount.');
      return res.redirect('/stays/new');
    }

    const numBeds = availableBeds !== undefined && availableBeds !== '' ? parseInt(availableBeds, 10) : 2;
    if (isNaN(numBeds) || numBeds < 0 || numBeds > 500) {
      req.flash('error', 'Available beds must be a non-negative number.');
      return res.redirect('/stays/new');
    }

    const validPropertyTypes = ['Hostel', 'PG', 'Shared Flat', 'Co-Living'];
    const validGenders = ['Boys', 'Girls', 'Unisex'];
    const validSharings = ['Single', 'Double', 'Triple', 'Four+'];

    const chosenType = validPropertyTypes.includes(propertyType) ? propertyType : 'PG';
    const chosenGender = validGenders.includes(genderPreference) ? genderPreference : 'Unisex';
    const chosenSharing = validSharings.includes(roomSharing) ? roomSharing : 'Double';

    // Map uploaded files from Multer / Cloudinary
    let imageArray = [];
    if (req.files && req.files.length) {
      imageArray = req.files.map((file) => ({
        url: file.path || file.secure_url || file.url,
        filename: file.filename || file.public_id || file.originalname
      }));
    } else if (images) {
      imageArray = parseImages(images);
    }

    const amenityArray = parseAmenities(amenities);
    const normalizedCity = normalizeToActiveCity(city);

    const property = new Property({
      title: title.trim(),
      propertyType: chosenType,
      description: description.trim(),
      city: normalizedCity,
      locality: locality.trim(),
      address: address.trim(),
      location: {
        city: normalizedCity,
        locality: locality.trim(),
        address: address.trim(),
        latitude: parsedLat,
        longitude: parsedLng,
        googleMapsUrl: googleMapsUrl ? googleMapsUrl.trim() : ''
      },
      campusDistance: campusDistance ? campusDistance.trim() : 'Short walk to Sanjivani campus',
      price: numPrice,
      securityDeposit: numDeposit,
      roomSharing: chosenSharing,
      genderPreference: chosenGender,
      images: imageArray.length ? imageArray : undefined,
      amenities: amenityArray.length ? amenityArray : undefined,
      availableBeds: numBeds,
      contactPhone: contactPhone ? contactPhone.trim() : req.user.phone || '',
      owner: req.user._id
    });

    await property.save();

    req.flash('success', `"${property.title}" has been successfully listed on Nestly!`);
    res.redirect(`/stays/${property._id}`);
  } catch (err) {
    req.flash('error', err.message || 'Failed to list property.');
    res.redirect('/stays/new');
  }
});

const Review = require('../models/Review');

/**
 * GET /stays/:id
 * Render Property Details Page with reviews
 */
router.get('/stays/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error', 'Accommodation listing not found.');
      return res.redirect('/stays');
    }

    const property = await Property.findById(id).populate('owner', 'name email phone avatar');

    if (!property) {
      req.flash('error', 'Accommodation listing not found.');
      return res.redirect('/stays');
    }

    const reviews = await Review.find({ property: id })
      .populate('author', 'name college avatar')
      .sort({ createdAt: -1 });

    res.render('pages/stays/show', {
      title: `${property.title} | Nestly`,
      activePage: 'stay-details',
      property,
      reviews
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /stays/:id/edit
 * Render form to edit an existing property
 */
router.get('/stays/:id/edit', isLoggedIn, isPropertyOwner, async (req, res, next) => {
  try {
    const { id } = req.params;
    const property = await Property.findById(id);

    res.render('pages/stays/edit', {
      title: `Edit ${property.title} | Nestly`,
      activePage: 'edit-stay',
      property
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /stays/:id
 * Handle property update (supports uploading additional photos and deleting specific photos)
 */
router.post('/stays/:id', isLoggedIn, isPropertyOwner, handleImageUpload, async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      propertyType,
      description,
      city,
      locality,
      address,
      campusDistance,
      price,
      securityDeposit,
      roomSharing,
      genderPreference,
      images,
      deleteImages,
      amenities,
      availableBeds,
      contactPhone,
      isAvailable,
      latitude,
      longitude,
      googleMapsUrl
    } = req.body;

    if (!title || !description || !city || !locality || !address || price === undefined || price === null || price === '') {
      req.flash('error', 'Please fill in all required property details.');
      return res.redirect(`/stays/${id}/edit`);
    }

    // Location Coordinates validation
    let parsedLat = latitude !== undefined && latitude !== '' ? Number(latitude) : undefined;
    let parsedLng = longitude !== undefined && longitude !== '' ? Number(longitude) : undefined;
    if (parsedLat !== undefined && (isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90)) {
      req.flash('error', 'Please provide a valid latitude between -90 and 90.');
      return res.redirect(`/stays/${id}/edit`);
    }
    if (parsedLng !== undefined && (isNaN(parsedLng) || parsedLng < -180 || parsedLng > 180)) {
      req.flash('error', 'Please provide a valid longitude between -180 and 180.');
      return res.redirect(`/stays/${id}/edit`);
    }

    // Geographic boundary restriction: Validate city against active service areas (Kopargaon)
    if (!isCityInActiveServiceArea(city)) {
      req.flash(
        'error',
        `Nestly currently operates exclusively in ${getPrimaryServiceArea().name}, Maharashtra. Listings cannot be moved outside the active service area.`
      );
      return res.redirect(`/stays/${id}/edit`);
    }

    if (title.trim().length < 3 || title.trim().length > 120) {
      req.flash('error', 'Property name must be between 3 and 120 characters.');
      return res.redirect(`/stays/${id}/edit`);
    }

    if (description.trim().length < 10) {
      req.flash('error', 'Description must be at least 10 characters long.');
      return res.redirect(`/stays/${id}/edit`);
    }

    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice <= 0 || numPrice > 1000000) {
      req.flash('error', 'Please provide a valid monthly rent between ₹1 and ₹10,00,000.');
      return res.redirect(`/stays/${id}/edit`);
    }

    const numDeposit = securityDeposit !== undefined && securityDeposit !== '' ? Number(securityDeposit) : numPrice;
    if (isNaN(numDeposit) || numDeposit < 0 || numDeposit > 2000000) {
      req.flash('error', 'Security deposit must be a valid non-negative amount.');
      return res.redirect(`/stays/${id}/edit`);
    }

    const numBeds = availableBeds !== undefined && availableBeds !== '' ? parseInt(availableBeds, 10) : 0;
    if (isNaN(numBeds) || numBeds < 0 || numBeds > 500) {
      req.flash('error', 'Available beds must be a non-negative number.');
      return res.redirect(`/stays/${id}/edit`);
    }

    const validPropertyTypes = ['Hostel', 'PG', 'Shared Flat', 'Co-Living'];
    const validGenders = ['Boys', 'Girls', 'Unisex'];
    const validSharings = ['Single', 'Double', 'Triple', 'Four+'];

    const chosenType = validPropertyTypes.includes(propertyType) ? propertyType : 'PG';
    const chosenGender = validGenders.includes(genderPreference) ? genderPreference : 'Unisex';
    const chosenSharing = validSharings.includes(roomSharing) ? roomSharing : 'Double';

    const existingProperty = await Property.findById(id);
    if (!existingProperty) {
      req.flash('error', 'Property not found.');
      return res.redirect('/stays');
    }

    let currentImages = existingProperty.images ? [...existingProperty.images] : [];

    // Delete selected images from Cloudinary and property
    if (deleteImages) {
      const toDelete = Array.isArray(deleteImages) ? deleteImages : [deleteImages];
      for (const filename of toDelete) {
        await deleteCloudinaryImage(filename);
      }
      currentImages = currentImages.filter((img) => {
        const fn = img.filename || '';
        const u = img.url || (typeof img.toString === 'function' ? img.toString() : '');
        return !toDelete.includes(fn) && !toDelete.includes(u);
      });
    }

    // Append newly uploaded photos
    if (req.files && req.files.length) {
      const newImages = req.files.map((file) => ({
        url: file.path || file.secure_url || file.url,
        filename: file.filename || file.public_id || file.originalname
      }));
      currentImages = currentImages.concat(newImages);
    } else if (images) {
      const parsed = parseImages(images);
      if (parsed.length) currentImages = currentImages.concat(parsed);
    }

    const amenityArray = parseAmenities(amenities);
    const normalizedCity = normalizeToActiveCity(city);

    const updateData = {
      title: title.trim(),
      propertyType: chosenType,
      description: description.trim(),
      city: normalizedCity,
      locality: locality.trim(),
      address: address.trim(),
      'location.city': normalizedCity,
      'location.locality': locality.trim(),
      'location.address': address.trim(),
      campusDistance: campusDistance ? campusDistance.trim() : 'Short walk to Sanjivani campus',
      price: numPrice,
      securityDeposit: numDeposit,
      roomSharing: chosenSharing,
      genderPreference: chosenGender,
      availableBeds: numBeds,
      images: currentImages,
      isAvailable: isAvailable === 'true' || isAvailable === true || isAvailable === 'on',
      contactPhone: contactPhone ? contactPhone.trim() : ''
    };

    if (amenityArray.length) {
      updateData.amenities = amenityArray;
    }

    if (parsedLat !== undefined) {
      updateData['location.latitude'] = parsedLat;
    }
    if (parsedLng !== undefined) {
      updateData['location.longitude'] = parsedLng;
    }
    if (googleMapsUrl !== undefined) {
      updateData['location.googleMapsUrl'] = googleMapsUrl.trim();
    }

    const updated = await Property.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });

    req.flash('success', `"${updated.title}" updated successfully.`);
    res.redirect(`/stays/${id}`);
  } catch (err) {
    req.flash('error', err.message || 'Failed to update property.');
    res.redirect(`/stays/${req.params.id}/edit`);
  }
});

/**
 * POST /stays/:id/delete
 * Delete a property and purge its Cloudinary photos
 */
router.post('/stays/:id/delete', isLoggedIn, isPropertyOwner, async (req, res, next) => {
  try {
    const { id } = req.params;
    const property = await Property.findById(id);
    if (property) {
      if (property.images && property.images.length) {
        for (const img of property.images) {
          if (img.filename && !img.filename.startsWith('http') && img.filename !== 'default_property') {
            await deleteCloudinaryImage(img.filename);
          }
        }
      }
      await Property.findByIdAndDelete(id);
      const User = require('../models/User');
      await Review.deleteMany({ property: id });
      await User.updateMany({ savedProperties: id }, { $pull: { savedProperties: id } });
    }

    req.flash('success', `"${property?.title || 'Listing'}" has been removed.`);
    res.redirect('/stays');
  } catch (err) {
    req.flash('error', 'Failed to delete listing.');
    res.redirect('/stays');
  }
});

module.exports = router;

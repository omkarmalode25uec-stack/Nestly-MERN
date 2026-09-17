const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Property = require('../models/Property');
const { isLoggedIn } = require('../middleware/auth');

/**
 * 1. GET /stays/:id/book - Render Booking & Token Reservation Request Form
 */
router.get('/stays/:id/book', isLoggedIn, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error', 'Accommodation listing not found.');
      return res.redirect('/stays');
    }

    const property = await Property.findById(id).populate('owner');

    if (!property) {
      req.flash('error', 'Accommodation listing not found.');
      return res.redirect('/stays');
    }

    // Check availability
    if (!property.isAvailable || property.availableBeds <= 0) {
      req.flash('error', 'Sorry, this accommodation currently has no available beds or is paused.');
      return res.redirect(`/stays/${property._id}`);
    }

    // Prevent owner from booking their own accommodation
    if (property.owner && property.owner._id.equals(req.user._id)) {
      req.flash('error', 'You cannot book your own property listing.');
      return res.redirect(`/stays/${property._id}`);
    }

    res.render('pages/bookings/new', {
      title: `Reserve Bed & Hold Unit | ${property.title}`,
      activePage: 'checkout',
      property,
      user: req.user
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. POST /stays/:id/book - Submit Booking / Accommodation Request
 */
router.post('/stays/:id/book', isLoggedIn, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error', 'Accommodation listing not found.');
      return res.redirect('/stays');
    }

    const property = await Property.findById(id);

    if (!property) {
      req.flash('error', 'Accommodation listing not found.');
      return res.redirect('/stays');
    }

    // Prevent owner from booking their own accommodation
    if (property.owner && property.owner.equals(req.user._id)) {
      req.flash('error', 'You cannot book your own property listing.');
      return res.redirect(`/stays/${property._id}`);
    }

    // Check availability
    if (!property.isAvailable || property.availableBeds <= 0) {
      req.flash('error', 'Sorry, this accommodation currently has no available beds or is paused.');
      return res.redirect(`/stays/${property._id}`);
    }

    // Prevent duplicate active booking requests
    const existingBooking = await Booking.findOne({
      user: req.user._id,
      property: property._id,
      status: { $in: ['pending', 'confirmed'] }
    });

    if (existingBooking) {
      req.flash('info', 'You already have an active reservation or request for this accommodation.');
      return res.redirect(`/bookings/${existingBooking._id}`);
    }

    const {
      moveInDate,
      durationMonths = 10,
      studentNotes = '',
      dietaryPreference = 'Veg',
      roomType
    } = req.body;

    // Validate Move-in Date (cannot be in the past)
    let parsedMoveIn = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
    if (moveInDate) {
      const d = new Date(moveInDate);
      if (isNaN(d.getTime()) || d < new Date(Date.now() - 24 * 60 * 60 * 1000)) {
        req.flash('error', 'Please select a valid upcoming move-in date.');
        return res.redirect(`/stays/${property._id}/book`);
      }
      parsedMoveIn = d;
    }

    // Validate Duration
    const months = parseInt(durationMonths, 10);
    if (isNaN(months) || months < 1 || months > 60) {
      req.flash('error', 'Stay duration must be between 1 and 60 months.');
      return res.redirect(`/stays/${property._id}/book`);
    }

    // Build booking record with server-validated owner reference & fixed amount
    const booking = new Booking({
      user: req.user._id,
      property: property._id,
      owner: property.owner,
      amount: 2000, // Token hold deposit (strictly server-enforced)
      monthlyRent: property.price,
      securityDeposit: property.securityDeposit || property.price,
      roomType: roomType || property.roomSharing,
      sharing: property.roomSharing,
      moveInDate: parsedMoveIn,
      durationMonths: months,
      studentNotes: studentNotes ? studentNotes.trim().substring(0, 500) : '',
      dietaryPreference: dietaryPreference || 'Veg',
      status: 'pending',
      paymentStatus: 'pending'
    });

    await booking.save();

    req.flash('success', 'Your reservation request has been submitted! Unit hold is active pending owner confirmation.');
    res.redirect(`/bookings/${booking._id}`);
  } catch (err) {
    next(err);
  }
});

/**
 * 3. GET /bookings - Student's My Bookings & Enquiries List
 */
router.get('/bookings', isLoggedIn, async (req, res, next) => {
  try {
    const bookings = await Booking.find({ user: req.user._id })
      .populate('property')
      .populate('owner', 'name email phone')
      .sort({ createdAt: -1 });

    res.render('pages/bookings/index', {
      title: 'My Bookings & Enquiries | Nestly',
      activePage: 'bookings',
      bookings,
      user: req.user
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 4. GET /bookings/:id - View Booking Confirmation Pass & Allocation Certificate
 */
router.get('/bookings/:id', isLoggedIn, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error', 'Booking record not found.');
      return res.redirect('/bookings');
    }

    const booking = await Booking.findById(id)
      .populate('property')
      .populate('user', 'name email phone college avatar')
      .populate('owner', 'name email phone');

    if (!booking) {
      req.flash('error', 'Booking record not found.');
      return res.redirect('/bookings');
    }

    // Security Authorization: Student who booked or Property Owner only
    const isStudent = booking.user && booking.user._id.equals(req.user._id);
    const isOwner = booking.owner && booking.owner._id.equals(req.user._id);

    if (!isStudent && !isOwner && req.user.role !== 'admin') {
      req.flash('error', 'You do not have permission to view this reservation.');
      return res.redirect('/');
    }

    res.render('pages/bookings/show', {
      title: `Booking Details | ${booking.property ? booking.property.title : 'Nestly'}`,
      activePage: 'bookings',
      booking,
      isStudent,
      isOwner
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 5. POST /bookings/:id/cancel - Student Cancels Pending Booking
 */
router.post('/bookings/:id/cancel', isLoggedIn, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error', 'Booking record not found.');
      return res.redirect('/bookings');
    }

    const booking = await Booking.findById(id);

    if (!booking) {
      req.flash('error', 'Booking record not found.');
      return res.redirect('/bookings');
    }

    if (!booking.user.equals(req.user._id)) {
      req.flash('error', 'You are not authorized to cancel this booking.');
      return res.redirect('/bookings');
    }

    // State check: cannot re-cancel already finalized bookings
    if (booking.status === 'cancelled' || booking.status === 'rejected') {
      req.flash('info', `This reservation is already ${booking.status}.`);
      return res.redirect('/bookings');
    }

    // If booking was already confirmed, return bed to inventory
    if (booking.status === 'confirmed') {
      await Property.findByIdAndUpdate(booking.property, { $inc: { availableBeds: 1 } });
    }

    booking.status = 'cancelled';
    await booking.save();

    req.flash('success', 'Reservation request has been cancelled.');
    res.redirect('/bookings');
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const Property = require('../models/Property');
const { isLoggedIn } = require('../middleware/auth');

/**
 * Helper to respond with JSON or Redirect depending on request type
 */
const respondOrRedirect = (req, res, { json, redirectUrl, flashType, flashMsg }) => {
  if (
    req.xhr ||
    (req.headers.accept && req.headers.accept.includes('application/json')) ||
    req.query.format === 'json'
  ) {
    return res.json(json);
  }
  if (flashType && flashMsg) {
    req.flash(flashType, flashMsg);
  }
  return res.redirect(redirectUrl);
};

/**
 * 1. GET /profile - View student profile and preferences
 */
router.get('/profile', isLoggedIn, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: 'savedProperties',
      select: 'title locality city price images rating campusDistance roomSharing genderPreference'
    });

    if (!user) {
      req.flash('error', 'User account not found.');
      return res.redirect('/login');
    }

    res.render('pages/profile', {
      title: 'Student Profile & Preferences | Nestly',
      activePage: 'profile',
      user,
      savedProperties: user.savedProperties || []
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. POST /profile - Update permitted profile information
 * Permitted editable fields: name, phone, college, avatar.
 * Email and role are strictly protected from client manipulation.
 */
router.post('/profile', isLoggedIn, async (req, res, next) => {
  try {
    const { name, phone = '', college = '', avatar = '' } = req.body;

    if (!name || name.trim().length < 2) {
      req.flash('error', 'Name must be at least 2 characters long.');
      return res.redirect('/profile');
    }

    const updates = {
      name: name.trim(),
      phone: phone.trim(),
      college: college.trim()
    };

    if (avatar && avatar.trim()) {
      updates.avatar = avatar.trim();
    }

    await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true
    });

    req.flash('success', 'Your profile details have been saved successfully.');
    res.redirect('/profile');
  } catch (err) {
    req.flash('error', err.message || 'Failed to update profile.');
    res.redirect('/profile');
  }
});

/**
 * 3. GET /saved - View saved/favorited properties
 */
router.get('/saved', isLoggedIn, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: 'savedProperties',
      populate: { path: 'owner', select: 'name email phone' }
    });

    if (!user) {
      req.flash('error', 'User account not found.');
      return res.redirect('/login');
    }

    // Filter out any null values in case a saved property was deleted from DB
    const savedStays = (user.savedProperties || []).filter((stay) => stay != null);

    res.render('pages/saved', {
      title: 'Saved Stays & Shortlist | Nestly',
      activePage: 'saved',
      user,
      savedStays
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 4. POST /stays/:id/save - Save / favorite a property
 * Uses MongoDB $addToSet to prevent duplicate entries.
 */
router.post('/stays/:id/save', isLoggedIn, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return respondOrRedirect(req, res, {
        json: { success: false, message: 'Invalid property identifier' },
        redirectUrl: '/stays',
        flashType: 'error',
        flashMsg: 'Accommodation listing not found.'
      });
    }

    const property = await Property.findById(id);

    if (!property) {
      return respondOrRedirect(req, res, {
        json: { success: false, message: 'Property not found' },
        redirectUrl: '/stays',
        flashType: 'error',
        flashMsg: 'Accommodation listing not found.'
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $addToSet: { savedProperties: property._id } },
      { new: true }
    );

    const redirectTarget = req.headers.referer || `/stays/${property._id}`;

    return respondOrRedirect(req, res, {
      json: {
        success: true,
        saved: true,
        savedCount: updatedUser.savedProperties.length,
        message: 'Stay added to your shortlist!'
      },
      redirectUrl: redirectTarget,
      flashType: 'success',
      flashMsg: `"${property.title}" saved to your shortlist.`
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 5. POST /stays/:id/unsave - Remove a property from favorites
 */
router.post('/stays/:id/unsave', isLoggedIn, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return respondOrRedirect(req, res, {
        json: { success: false, message: 'Invalid property identifier' },
        redirectUrl: '/saved',
        flashType: 'error',
        flashMsg: 'Accommodation listing not found.'
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $pull: { savedProperties: id } },
      { new: true }
    );

    const redirectTarget = req.headers.referer || '/saved';

    return respondOrRedirect(req, res, {
      json: {
        success: true,
        saved: false,
        savedCount: updatedUser ? updatedUser.savedProperties.length : 0,
        message: 'Stay removed from shortlist.'
      },
      redirectUrl: redirectTarget,
      flashType: 'success',
      flashMsg: 'Stay removed from your shortlist.'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 6. POST /saved/:id/delete - Delete/unsave a property from the saved list
 */
router.post('/saved/:id/delete', isLoggedIn, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return respondOrRedirect(req, res, {
        json: { success: false, message: 'Invalid property identifier' },
        redirectUrl: '/saved',
        flashType: 'error',
        flashMsg: 'Accommodation listing not found.'
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $pull: { savedProperties: id } },
      { new: true }
    );

    return respondOrRedirect(req, res, {
      json: {
        success: true,
        saved: false,
        savedCount: updatedUser ? updatedUser.savedProperties.length : 0,
        message: 'Stay removed from shortlist.'
      },
      redirectUrl: '/saved',
      flashType: 'success',
      flashMsg: 'Stay removed from your shortlist.'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

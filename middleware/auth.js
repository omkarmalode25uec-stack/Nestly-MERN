/**
 * Authentication & Authorization Middleware for Nestly
 */

module.exports.isLoggedIn = (req, res, next) => {
  if (!req.isAuthenticated()) {
    req.session.returnTo = req.originalUrl;
    req.flash('error', 'Please sign in to access this page.');
    return res.redirect('/login');
  }
  next();
};

module.exports.storeReturnTo = (req, res, next) => {
  if (req.session.returnTo) {
    res.locals.returnTo = req.session.returnTo;
  }
  next();
};

/**
 * Role Check: Student Only (or Admin)
 */
module.exports.isStudent = (req, res, next) => {
  if (!req.isAuthenticated()) {
    req.session.returnTo = req.originalUrl;
    req.flash('error', 'Please sign in to continue.');
    return res.redirect('/login');
  }
  if (req.user.role !== 'student' && req.user.role !== 'admin') {
    req.flash('error', 'This feature is reserved for student accounts.');
    return res.redirect('/');
  }
  next();
};

/**
 * Role Check: Owner Only (or Admin)
 */
module.exports.isOwner = (req, res, next) => {
  if (!req.isAuthenticated()) {
    req.session.returnTo = req.originalUrl;
    req.flash('error', 'Please sign in to access the owner hub.');
    return res.redirect('/login');
  }
  if (req.user.role !== 'owner' && req.user.role !== 'admin') {
    req.flash('error', 'Access denied. You must have a registered Property Owner account to access this area.');
    return res.redirect('/');
  }
  next();
};

/**
 * Verification Check: Verified Owner Only (or Admin)
 * Unverified / pending owners are redirected to the verification status page.
 */
module.exports.isVerifiedOwner = (req, res, next) => {
  if (!req.isAuthenticated()) {
    req.session.returnTo = req.originalUrl;
    req.flash('error', 'Please sign in to continue.');
    return res.redirect('/login');
  }
  if (req.user.role === 'admin' || req.user.role === 'owner') {
    return next();
  }
  req.flash('error', 'Access denied. You must have a Property Owner account.');
  return res.redirect('/');
};

/**
 * Role Check: Admin Only
 */
module.exports.isAdmin = (req, res, next) => {
  if (!req.isAuthenticated()) {
    req.session.returnTo = req.originalUrl;
    req.flash('error', 'Please sign in with administrator credentials.');
    return res.redirect('/login');
  }
  if (req.user.role !== 'admin') {
    req.flash('error', 'Access denied. Administrator privileges required.');
    return res.redirect('/');
  }
  next();
};

const mongoose = require('mongoose');

module.exports.isPropertyOwner = async (req, res, next) => {
  try {
    const Property = require('../models/Property');
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

    if (!req.user || (!property.owner.equals(req.user._id) && req.user.role !== 'admin')) {
      req.flash('error', 'You do not have permission to modify this property.');
      return res.redirect(`/stays/${id}`);
    }

    next();
  } catch (err) {
    req.flash('error', 'Something went wrong verifying property ownership.');
    res.redirect('/stays');
  }
};



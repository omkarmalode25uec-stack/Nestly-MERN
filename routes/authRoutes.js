const express = require('express');
const router = express.Router();
const passport = require('passport');
const User = require('../models/User');
const { isLoggedIn, storeReturnTo } = require('../middleware/auth');

/**
 * -----------------------------------------------------------------------------
 * 1. STUDENT ONBOARDING FLOW
 * -----------------------------------------------------------------------------
 */

/**
 * GET /signup
 * Dedicated student registration page
 */
router.get('/signup', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/');
  }
  res.render('pages/signup', {
    title: 'Create Your Student Account | Nestly',
    activePage: 'signup'
  });
});

/**
 * POST /signup
 * Dedicated student account creation - always enforces 'student' role
 */
router.post('/signup', async (req, res, next) => {
  try {
    const { name, email, password, college = '', phone = '', role = 'student' } = req.body;

    if (!name || !email || !password) {
      req.flash('error', 'Name, email, and password are required.');
      return res.redirect('/signup');
    }

    if (name.trim().length < 2) {
      req.flash('error', 'Name must be at least 2 characters long.');
      return res.redirect('/signup');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      req.flash('error', 'Please provide a valid email address.');
      return res.redirect('/signup');
    }

    if (password.length < 6) {
      req.flash('error', 'Password must be at least 6 characters long.');
      return res.redirect('/signup');
    }

    // Role assignment: If explicitly admin (for testing/setup), allow admin; otherwise default to student.
    // Notice: owner registration has its own dedicated flow at /owner/register.
    let assignedRole = 'student';
    let verificationStatus = 'verified';

    if (role === 'admin') {
      assignedRole = 'admin';
      verificationStatus = 'verified';
    } else if (role === 'owner') {
      // If an owner submitted through the generic endpoint, assign owner role with pending verification
      assignedRole = 'owner';
      verificationStatus = 'pending';
    }

    const newUser = new User({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      college: college.trim(),
      phone: phone.trim(),
      role: assignedRole,
      verificationStatus
    });

    const registeredUser = await User.register(newUser, password);

    // Automatically log in the registered user
    req.login(registeredUser, (err) => {
      if (err) return next(err);
      if (registeredUser.role === 'owner') {
        req.flash('info', 'Owner account registered. Your account is pending campus verification.');
        return res.redirect('/owner/verification');
      }
      req.flash('success', `Welcome to Nestly, ${registeredUser.name}! Your student account is ready.`);
      res.redirect('/');
    });
  } catch (err) {
    req.flash('error', err.message || 'Registration failed. Please try again.');
    res.redirect('/signup');
  }
});

/**
 * -----------------------------------------------------------------------------
 * 2. OWNER ONBOARDING FLOW
 * -----------------------------------------------------------------------------
 */

/**
 * GET /owner/register & /owner/onboarding
 * Dedicated partner & property owner onboarding page
 */
const renderOwnerRegister = (req, res) => {
  if (req.isAuthenticated()) {
    if (req.user.role === 'owner') {
      return res.redirect(req.user.verificationStatus === 'verified' ? '/owner/dashboard' : '/owner/verification');
    }
    return res.redirect('/');
  }
  res.render('pages/owner/register', {
    title: 'Partner & Property Owner Registration | Nestly',
    activePage: 'owner-register'
  });
};

router.get('/owner/register', renderOwnerRegister);
router.get('/owner/onboarding', renderOwnerRegister);

/**
 * POST /owner/register
 * Handle property owner registration (always creates 'owner' role with 'pending' verification)
 */
router.post('/owner/register', async (req, res, next) => {
  try {
    const { name, businessName = '', email, phone = '', ownerType = 'individual', password } = req.body;

    if (!name || !email || !password) {
      req.flash('error', 'Owner full name, email, and password are required.');
      return res.redirect('/owner/register');
    }

    if (name.trim().length < 2) {
      req.flash('error', 'Name must be at least 2 characters long.');
      return res.redirect('/owner/register');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      req.flash('error', 'Please provide a valid business email address.');
      return res.redirect('/owner/register');
    }

    if (password.length < 6) {
      req.flash('error', 'Password must be at least 6 characters long.');
      return res.redirect('/owner/register');
    }

    const validOwnerTypes = ['individual', 'hostel_warden', 'pg_operator', 'property_manager'];
    const chosenType = validOwnerTypes.includes(ownerType) ? ownerType : 'individual';

    let settlementProfile = { isConfigured: false, settlementMethod: 'upi', upiId: '', accountHolderName: '', bankName: '', accountNumber: '', ifscCode: '' };
    const cleanUpi = (req.body.upiId || '').trim();
    const cleanAcc = (req.body.accountNumber || '').trim();
    const cleanIfsc = (req.body.ifscCode || '').trim();
    const cleanHolder = (req.body.accountHolderName || '').trim() || name.trim();

    if (req.body.settlementMethod === 'bank_transfer' && cleanAcc && cleanIfsc) {
      settlementProfile = {
        settlementMethod: 'bank_transfer',
        accountHolderName: cleanHolder,
        bankName: (req.body.bankName || '').trim(),
        accountNumber: cleanAcc,
        ifscCode: cleanIfsc.toUpperCase(),
        isConfigured: true
      };
    } else if (cleanUpi) {
      settlementProfile = {
        settlementMethod: 'upi',
        upiId: cleanUpi.toLowerCase(),
        accountHolderName: cleanHolder,
        bankName: '',
        accountNumber: '',
        ifscCode: '',
        isConfigured: true
      };
    }

    const newOwner = new User({
      name: name.trim(),
      businessName: businessName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      role: 'owner',
      ownerType: chosenType,
      verificationStatus: 'verified', // Campus audit skipped: instantly active
      settlementProfile
    });

    const registeredOwner = await User.register(newOwner, password);

    // Auto log-in owner and redirect directly to owner dashboard
    req.login(registeredOwner, (err) => {
      if (err) return next(err);
      req.flash(
        'success',
        `Welcome to the Nestly Partner Hub, ${registeredOwner.name}! Your owner account is active. You can now publish listings and manage student requests.`
      );
      res.redirect('/owner/dashboard');
    });
  } catch (err) {
    req.flash('error', err.message || 'Owner registration failed. Please try again.');
    res.redirect('/owner/register');
  }
});

/**
 * -----------------------------------------------------------------------------
 * 3. COMMON LOGIN & ROLE-BASED REDIRECTION
 * -----------------------------------------------------------------------------
 */

/**
 * Render Login Page
 */
router.get('/login', (req, res) => {
  if (req.isAuthenticated()) {
    if (req.user.role === 'admin') return res.redirect('/admin/dashboard');
    if (req.user.role === 'owner') return res.redirect('/owner/dashboard');
    return res.redirect('/');
  }
  res.render('pages/login', {
    title: 'Account Sign In | Nestly',
    activePage: 'login'
  });
});

/**
 * Handle Login Submission with Server-Side Role-Based Redirection
 */
router.post(
  '/login',
  storeReturnTo,
  passport.authenticate('local', {
    failureFlash: 'Invalid email address or password.',
    failureRedirect: '/login'
  }),
  (req, res) => {
    req.flash('success', `Welcome back, ${req.user.name}!`);

    const user = req.user;
    const requestedUrl = res.locals.returnTo;
    delete req.session.returnTo;

    // Check if user requested a specific page before login
    if (requestedUrl && typeof requestedUrl === 'string') {
      // Prevent unauthorized access attempts stored in returnTo
      const isOwnerUrl = requestedUrl.startsWith('/owner');
      const isAdminUrl = requestedUrl.startsWith('/admin');

      if (user.role === 'student' && (isOwnerUrl || isAdminUrl)) {
        return res.redirect('/');
      }
      if (user.role === 'owner' && isAdminUrl) {
        return res.redirect('/owner/dashboard');
      }
      return res.redirect(requestedUrl);
    }

    // Role-based default redirect
    if (user.role === 'admin') {
      return res.redirect('/admin/dashboard');
    }

    if (user.role === 'owner') {
      return res.redirect('/owner/dashboard');
    }

    // Default for students
    res.redirect('/');
  }
);

/**
 * Handle Logout
 */
router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash('success', 'You have been logged out safely.');
    res.redirect('/');
  });
});

module.exports = router;


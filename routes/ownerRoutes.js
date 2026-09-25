const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const Property = require('../models/Property')
const Booking = require('../models/Booking')
const Settlement = require('../models/Settlement')
const User = require('../models/User')
const { isLoggedIn, isOwner, isVerifiedOwner, isPropertyOwner } = require('../middleware/auth')

// verification status
router.get('/verification', isLoggedIn, isOwner, (req, res) => {
  res.render('pages/owner/verification', {
    title: 'Partner Verification Status | Nestly',
    activePage: 'owner-verification',
    owner: req.user
  })
})

// settlement overview
router.get('/settlement', isLoggedIn, isOwner, async (req, res, next) => {
  try {
    const settlements = await Settlement.find({ owner: req.user._id })
      .populate('property')
      .populate('booking')
      .populate('student', 'name email phone')
      .sort({ createdAt: -1 })

    const totalCollected = settlements.reduce((acc, s) => acc + (s.grossAmount || 0), 0)
    const settledAmount = settlements.filter((s) => s.status === 'settled').reduce((acc, s) => acc + (s.netAmount || 0), 0)
    const pendingSettlement = settlements
      .filter((s) => s.status === 'pending' || s.status === 'processing')
      .reduce((acc, s) => acc + (s.netAmount || 0), 0)

    const summary = {
      totalCollected,
      settledAmount,
      pendingSettlement,
      settlementCount: settlements.length
    }

    res.render('pages/owner/settlement', {
      title: 'Partner Payouts & Settlement Hub | Nestly',
      activePage: 'owner-settlement',
      owner: req.user,
      settlements,
      summary,
      settlementProfile: req.user.settlementProfile || {}
    })
  } catch (err) {
    next(err)
  }
})

// update settlement destination
router.post(['/settlement', '/owner/settlement'], isLoggedIn, isOwner, async (req, res, next) => {
  try {
    const {
      settlementMethod = 'upi',
      accountHolderName = '',
      upiId = '',
      bankName = '',
      accountNumber = '',
      ifscCode = ''
    } = req.body

    if (!accountHolderName || accountHolderName.trim().length < 2) {
      req.flash('error', 'Please provide a valid account holder name as registered with your bank.')
      return res.redirect('/owner/settlement')
    }

    if (settlementMethod === 'upi') {
      const cleanUpi = upiId.trim()
      const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/
      if (!cleanUpi || !upiRegex.test(cleanUpi)) {
        req.flash('error', 'Please provide a valid UPI ID (e.g. yourname@okhdfcbank or saikrupa@upi).')
        return res.redirect('/owner/settlement')
      }
    } else if (settlementMethod === 'bank_transfer') {
      const cleanAcc = accountNumber.trim()
      const cleanIfsc = ifscCode.trim().toUpperCase()
      if (!cleanAcc || cleanAcc.length < 6 || cleanAcc.length > 24) {
        req.flash('error', 'Please provide a valid bank account number.')
        return res.redirect('/owner/settlement')
      }
      const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/
      if (!cleanIfsc || !ifscRegex.test(cleanIfsc)) {
        req.flash('error', 'Please provide a valid 11-character Indian Financial System Code (IFSC).')
        return res.redirect('/owner/settlement')
      }
    }

    const user = await User.findById(req.user._id)
    user.settlementProfile = {
      settlementMethod: settlementMethod === 'bank_transfer' ? 'bank_transfer' : 'upi',
      accountHolderName: accountHolderName.trim(),
      upiId: settlementMethod === 'upi' ? upiId.trim().toLowerCase() : '',
      bankName: settlementMethod === 'bank_transfer' ? bankName.trim() : '',
      accountNumber: settlementMethod === 'bank_transfer' ? accountNumber.trim() : '',
      ifscCode: settlementMethod === 'bank_transfer' ? ifscCode.trim().toUpperCase() : '',
      isConfigured: true
    }
    await user.save()

    req.flash('success', 'Your payout settlement details have been saved securely.')
    res.redirect('/owner/settlement')
  } catch (err) {
    req.flash('error', 'Failed to update settlement profile.')
    res.redirect('/owner/settlement')
  }
})

// owner dashboard
router.get('/dashboard', isLoggedIn, isOwner, async (req, res, next) => {
  try {
    const properties = await Property.find({ owner: req.user._id }).sort({ createdAt: -1 })

    const bookings = await Booking.find({ owner: req.user._id })
      .populate('property')
      .populate('user', 'name email phone college avatar')
      .sort({ createdAt: -1 })

    const settlements = await Settlement.find({ owner: req.user._id }).sort({ createdAt: -1 })
    const totalCollected = settlements.reduce((acc, s) => acc + (s.grossAmount || 0), 0)
    const settledAmount = settlements.filter((s) => s.status === 'settled').reduce((acc, s) => acc + (s.netAmount || 0), 0)
    const pendingSettlement = settlements
      .filter((s) => s.status === 'pending' || s.status === 'processing')
      .reduce((acc, s) => acc + (s.netAmount || 0), 0)

    const totalProperties = properties.length
    const totalBeds = properties.reduce((acc, p) => acc + (p.availableBeds || 0), 0)
    const totalRevenue = properties.reduce((acc, p) => acc + (p.price || 0), 0)
    const avgRating = totalProperties > 0
      ? (properties.reduce((acc, p) => acc + (p.rating || 4.8), 0) / totalProperties).toFixed(1)
      : '4.8'

    const stats = {
      totalProperties,
      totalBeds,
      totalRevenue,
      avgRating,
      pendingRequests: bookings.filter((b) => b.status === 'pending').length,
      settledAmount,
      pendingSettlement,
      totalCollected
    }

    const RentCycleService = require('../services/rentCycleService')
    const [studentManagement, ledgerData] = await Promise.all([
      RentCycleService.getOwnerStudentManagementData(req.user._id).catch(() => ({ students: [], stats: {} })),
      RentCycleService.getOwnerEarningsLedger(req.user._id).catch(() => ({ totals: {}, verifiedPayments: [] }))
    ])

    res.render('pages/owner/dashboard', {
      title: 'Partner / Owner Operations Dashboard | Nestly',
      activePage: 'owner-dashboard',
      properties,
      bookings,
      settlements,
      stats,
      studentManagement,
      ledgerData
    })
  } catch (err) {
    next(err)
  }
})

router.get('/properties', isLoggedIn, (req, res) => {
  res.redirect('/owner/dashboard')
})

// toggle property availability
router.post('/properties/:id/toggle-status', isLoggedIn, isPropertyOwner, async (req, res, next) => {
  try {
    const { id } = req.params
    const property = await Property.findById(id)

    if (!property) {
      req.flash('error', 'Property not found.')
      return res.redirect('/owner/dashboard')
    }

    property.isAvailable = !property.isAvailable
    await property.save()

    req.flash(
      'success',
      `"${property.title}" status updated to ${property.isAvailable ? 'Active' : 'Paused'}.`
    )
    res.redirect('/owner/dashboard')
  } catch (err) {
    req.flash('error', 'Could not update property status.')
    res.redirect('/owner/dashboard')
  }
})

// delete property
router.post('/properties/:id/delete', isLoggedIn, isPropertyOwner, async (req, res, next) => {
  try {
    const { id } = req.params
    const property = await Property.findByIdAndDelete(id)
    if (property) {
      const Review = require('../models/Review')
      const User = require('../models/User')
      await Review.deleteMany({ property: id })
      await User.updateMany({ savedProperties: id }, { $pull: { savedProperties: id } })
    }

    req.flash('success', `"${property?.title || 'Accommodation'}" has been permanently removed.`)
    res.redirect('/owner/dashboard')
  } catch (err) {
    req.flash('error', 'Failed to delete listing.')
    res.redirect('/owner/dashboard')
  }
})

// accept booking
router.post('/bookings/:id/accept', isLoggedIn, async (req, res, next) => {
  try {
    const { id } = req.params

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error', 'Booking request not found.')
      return res.redirect('/owner/dashboard')
    }

    const booking = await Booking.findById(id).populate('property')

    if (!booking) {
      req.flash('error', 'Booking request not found.')
      return res.redirect('/owner/dashboard')
    }

    if (!booking.owner.equals(req.user._id) && req.user.role !== 'admin') {
      req.flash('error', 'You are not authorized to manage this booking.')
      return res.redirect('/owner/dashboard')
    }

    if (booking.status === 'cancelled' || booking.status === 'rejected') {
      req.flash('error', `Cannot accept a booking that has already been ${booking.status}.`)
      return res.redirect('/owner/dashboard')
    }

    if (booking.status !== 'confirmed') {
      booking.status = 'confirmed'
      await booking.save()

      if (booking.property && booking.property.availableBeds > 0) {
        await Property.findByIdAndUpdate(booking.property._id, {
          $inc: { availableBeds: -1 }
        })
      }
    }

    req.flash('success', `Booking request accepted! Unit allocated to ${booking.studentNotes || 'student'}.`)
    res.redirect('/owner/dashboard')
  } catch (err) {
    req.flash('error', 'Failed to accept booking.')
    res.redirect('/owner/dashboard')
  }
})

// reject booking
router.post('/bookings/:id/reject', isLoggedIn, async (req, res, next) => {
  try {
    const { id } = req.params

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error', 'Booking request not found.')
      return res.redirect('/owner/dashboard')
    }

    const booking = await Booking.findById(id)

    if (!booking) {
      req.flash('error', 'Booking request not found.')
      return res.redirect('/owner/dashboard')
    }

    if (!booking.owner.equals(req.user._id) && req.user.role !== 'admin') {
      req.flash('error', 'You are not authorized to manage this booking.')
      return res.redirect('/owner/dashboard')
    }

    if (booking.status === 'cancelled') {
      req.flash('info', 'This booking was already cancelled by the student.')
      return res.redirect('/owner/dashboard')
    }

    booking.status = 'rejected'
    await booking.save()

    req.flash('success', 'Booking request has been rejected.')
    res.redirect('/owner/dashboard')
  } catch (err) {
    req.flash('error', 'Failed to reject booking.')
    res.redirect('/owner/dashboard')
  }
})

module.exports = router

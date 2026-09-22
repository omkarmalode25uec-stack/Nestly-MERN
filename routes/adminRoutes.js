const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const User = require('../models/User')
const Property = require('../models/Property')
const Settlement = require('../models/Settlement')
const { isLoggedIn, isAdmin } = require('../middleware/auth')

// admin dashboard
router.get('/dashboard', isLoggedIn, isAdmin, async (req, res, next) => {
  try {
    const owners = await User.find({ role: 'owner' }).sort({ createdAt: -1 })

    const ownersWithStats = await Promise.all(
      owners.map(async (owner) => {
        const propertyCount = await Property.countDocuments({ owner: owner._id })
        return {
          ...owner.toObject(),
          propertyCount
        }
      })
    )

    const settlements = await Settlement.find()
      .populate('owner', 'name businessName email phone settlementProfile')
      .populate('student', 'name email phone')
      .populate('property', 'title locality city')
      .populate('booking')
      .sort({ createdAt: -1 })

    const totalSettledAmount = settlements
      .filter((s) => s.status === 'settled')
      .reduce((acc, s) => acc + (s.netAmount || 0), 0)
    const totalPendingSettlement = settlements
      .filter((s) => s.status === 'pending' || s.status === 'processing')
      .reduce((acc, s) => acc + (s.netAmount || 0), 0)

    const stats = {
      totalOwners: owners.length,
      pendingOwners: owners.filter((o) => o.verificationStatus === 'pending').length,
      verifiedOwners: owners.filter((o) => o.verificationStatus === 'verified').length,
      rejectedOwners: owners.filter((o) => o.verificationStatus === 'rejected').length,
      totalProperties: await Property.countDocuments(),
      totalSettledAmount,
      totalPendingSettlement,
      settlementCount: settlements.length
    }

    res.render('pages/admin/dashboard', {
      title: 'Administrator Operations & Owner Verification | Nestly',
      activePage: 'admin-dashboard',
      owners: ownersWithStats,
      settlements,
      stats
    })
  } catch (err) {
    next(err)
  }
})

// verify owner
router.post('/owners/:id/verify', isLoggedIn, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error', 'Invalid owner identifier.')
      return res.redirect('/admin/dashboard')
    }

    const owner = await User.findById(id)

    if (!owner || owner.role !== 'owner') {
      req.flash('error', 'Property owner not found.')
      return res.redirect('/admin/dashboard')
    }

    owner.verificationStatus = 'verified'
    owner.verifiedAt = new Date()
    owner.verifiedBy = req.user._id
    owner.verificationNotes = 'Verified by Nestly Campus Administration'
    await owner.save()

    req.flash('success', `Partner account for "${owner.name}" (${owner.businessName || owner.email}) has been verified successfully!`)
    res.redirect('/admin/dashboard')
  } catch (err) {
    req.flash('error', 'Failed to verify owner account.')
    res.redirect('/admin/dashboard')
  }
})

// reject owner
router.post('/owners/:id/reject', isLoggedIn, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params
    const { reason = 'Information provided could not be verified by on-ground campus team.' } = req.body

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error', 'Invalid owner identifier.')
      return res.redirect('/admin/dashboard')
    }

    const owner = await User.findById(id)

    if (!owner || owner.role !== 'owner') {
      req.flash('error', 'Property owner not found.')
      return res.redirect('/admin/dashboard')
    }

    owner.verificationStatus = 'rejected'
    owner.verificationNotes = reason.trim()
    await owner.save()

    req.flash('info', `Owner application for "${owner.name}" has been marked as rejected.`)
    res.redirect('/admin/dashboard')
  } catch (err) {
    req.flash('error', 'Failed to reject owner application.')
    res.redirect('/admin/dashboard')
  }
})

// record disbursement
router.post('/settlements/:id/disburse', isLoggedIn, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params
    const { settlementReference = '', notes = '' } = req.body

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error', 'Invalid settlement record ID.')
      return res.redirect('/admin/dashboard')
    }

    const settlement = await Settlement.findById(id).populate('owner')

    if (!settlement) {
      req.flash('error', 'Settlement record not found.')
      return res.redirect('/admin/dashboard')
    }

    const cleanRef = (settlementReference || '').trim()
    if (!cleanRef) {
      req.flash('error', 'Please provide a valid bank UTR / IMPS / UPI transaction reference for the disbursement.')
      return res.redirect('/admin/dashboard')
    }

    settlement.status = 'settled'
    settlement.settlementReference = cleanRef
    settlement.settledAt = new Date()
    if (notes) settlement.notes = notes.trim()
    await settlement.save()

    req.flash(
      'success',
      `Settlement of ₹${settlement.netAmount.toLocaleString('en-IN')} marked as disbursed to ${settlement.owner?.name || 'Owner'} (Ref: ${cleanRef}).`
    )
    res.redirect('/admin/dashboard')
  } catch (err) {
    req.flash('error', 'Failed to record settlement disbursement.')
    res.redirect('/admin/dashboard')
  }
})

// hold settlement
router.post('/settlements/:id/hold', isLoggedIn, isAdmin, async (req, res, next) => {
  try {
    const { id } = req.params
    const { reason = 'Pending move-in verification' } = req.body

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error', 'Invalid settlement identifier.')
      return res.redirect('/admin/dashboard')
    }

    const settlement = await Settlement.findById(id)
    if (!settlement) {
      req.flash('error', 'Settlement record not found.')
      return res.redirect('/admin/dashboard')
    }

    settlement.status = 'on_hold'
    settlement.notes = reason.trim()
    await settlement.save()

    req.flash('info', 'Settlement placed on administrative hold.')
    res.redirect('/admin/dashboard')
  } catch (err) {
    req.flash('error', 'Failed to update settlement hold status.')
    res.redirect('/admin/dashboard')
  }
})

module.exports = router

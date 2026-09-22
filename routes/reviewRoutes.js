const express = require('express')
const router = express.Router({ mergeParams: true })
const mongoose = require('mongoose')
const Property = require('../models/Property')
const Review = require('../models/Review')
const { isLoggedIn } = require('../middleware/auth')

// submit review
router.post('/stays/:id/reviews', isLoggedIn, async (req, res, next) => {
  try {
    const { id } = req.params
    const { rating, comment } = req.body

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error', 'Accommodation listing not found.')
      return res.redirect('/stays')
    }

    const property = await Property.findById(id)
    if (!property) {
      req.flash('error', 'Accommodation listing not found.')
      return res.redirect('/stays')
    }

    if (property.owner && property.owner.equals(req.user._id)) {
      req.flash('error', 'Property owners cannot review their own listings.')
      return res.redirect(`/stays/${id}#reviews`)
    }

    const existingReview = await Review.findOne({ property: property._id, author: req.user._id })
    if (existingReview) {
      req.flash('error', 'You have already submitted a review for this accommodation.')
      return res.redirect(`/stays/${id}#reviews`)
    }

    const numRating = Number(rating)
    if (!rating || isNaN(numRating) || !Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
      req.flash('error', 'Please provide a valid rating between 1 and 5 stars.')
      return res.redirect(`/stays/${id}#reviews`)
    }

    if (!comment || typeof comment !== 'string' || comment.trim().length < 3) {
      req.flash('error', 'Review comment must be at least 3 characters long.')
      return res.redirect(`/stays/${id}#reviews`)
    }

    if (comment.trim().length > 1000) {
      req.flash('error', 'Review comment cannot exceed 1000 characters.')
      return res.redirect(`/stays/${id}#reviews`)
    }

    const review = new Review({
      author: req.user._id,
      property: property._id,
      rating: numRating,
      comment: comment.trim()
    })
    await review.save()

    const allReviews = await Review.find({ property: property._id })
    const avgRating = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length
    property.rating = Math.round(avgRating * 10) / 10
    property.reviewCount = allReviews.length
    await property.save()

    req.flash('success', 'Your verified review has been posted successfully!')
    res.redirect(`/stays/${id}#reviews`)
  } catch (err) {
    req.flash('error', err.message || 'Failed to submit review.')
    res.redirect(`/stays/${req.params.id}#reviews`)
  }
})

// delete review
router.post('/stays/:id/reviews/:reviewId/delete', isLoggedIn, async (req, res, next) => {
  try {
    const { id, reviewId } = req.params

    if (!id || !mongoose.Types.ObjectId.isValid(id) || !reviewId || !mongoose.Types.ObjectId.isValid(reviewId)) {
      req.flash('error', 'Accommodation listing or review not found.')
      return res.redirect('/stays')
    }

    const property = await Property.findById(id)
    if (!property) {
      req.flash('error', 'Accommodation listing not found.')
      return res.redirect('/stays')
    }

    const review = await Review.findById(reviewId)
    if (!review) {
      req.flash('error', 'Review not found.')
      return res.redirect(`/stays/${id}#reviews`)
    }

    if (!review.author.equals(req.user._id) && req.user.role !== 'admin') {
      req.flash('error', 'You do not have permission to delete this review.')
      return res.redirect(`/stays/${id}#reviews`)
    }

    await Review.findByIdAndDelete(reviewId)

    const remainingReviews = await Review.find({ property: id })
    if (remainingReviews.length > 0) {
      const avgRating = remainingReviews.reduce((sum, r) => sum + r.rating, 0) / remainingReviews.length
      property.rating = Math.round(avgRating * 10) / 10
      property.reviewCount = remainingReviews.length
    } else {
      property.rating = 4.8
      property.reviewCount = 0
    }
    await property.save()

    req.flash('success', 'Your review has been deleted.')
    res.redirect(`/stays/${id}#reviews`)
  } catch (err) {
    req.flash('error', 'Failed to delete review.')
    res.redirect(`/stays/${req.params.id}#reviews`)
  }
})

module.exports = router

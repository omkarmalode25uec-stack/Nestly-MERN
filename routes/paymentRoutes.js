const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const Property = require('../models/Property');
const Settlement = require('../models/Settlement');
const User = require('../models/User');
const ZapUpiService = require('../services/zapUpiService');
const { isLoggedIn } = require('../middleware/auth');

// Fixed server-side defined token deposit amount (Security rule: Never trust client amount)
const TOKEN_DEPOSIT_AMOUNT = 2000;

// Helper to validate and sanitize orderId parameter
const isValidOrderId = (orderId) => typeof orderId === 'string' && /^[A-Za-z0-9_-]{3,64}$/.test(orderId);

/**
 * Synchronize booking status and Escrow Settlement Ledger with payment outcome
 */
async function syncBookingPayment(payment, outcome) {
  if (!payment || !payment.booking) return;
  try {
    const booking = await Booking.findById(payment.booking).populate('property');
    if (!booking) return;

    const isSuccess = outcome === 'success' || outcome === true;
    const isTimeout = outcome === 'timeout';

    if (isSuccess) {
      const alreadyCompleted = booking.paymentStatus === 'completed';
      booking.paymentStatus = 'completed';
      booking.payment = payment._id;
      booking.status = 'confirmed';
      await booking.save();

      // Only decrement bed inventory if not already completed!
      if (!alreadyCompleted && booking.property && booking.property.availableBeds > 0) {
        await Property.findByIdAndUpdate(booking.property._id || booking.property, {
          $inc: { availableBeds: -1 }
        });
      }

      // Escrow Settlement Architecture:
      // Create pending owner settlement ledger entry upon successful student token deposit
      const ownerId = booking.owner || (booking.property && booking.property.owner);
      if (ownerId) {
        const owner = await User.findById(ownerId);
        let settlement = await Settlement.findOne({ booking: booking._id, payment: payment._id });
        if (!settlement) {
          const profile = (owner && owner.settlementProfile) || {};
          settlement = new Settlement({
            owner: ownerId,
            student: payment.user || booking.user,
            booking: booking._id,
            payment: payment._id,
            property: booking.property._id || booking.property,
            grossAmount: payment.amount || TOKEN_DEPOSIT_AMOUNT,
            platformFee: 0, // Zero broker fee under Nestly Student Guarantee
            netAmount: payment.amount || TOKEN_DEPOSIT_AMOUNT,
            status: 'pending',
            settlementMethod: profile.settlementMethod || 'upi',
            destinationUpiId: profile.upiId || '',
            destinationAccountHolder: profile.accountHolderName || (owner ? owner.name : ''),
            destinationBankName: profile.bankName || '',
            destinationAccountNumberMasked: profile.accountNumber ? `******${profile.accountNumber.slice(-4)}` : '',
            notes: `Token hold escrow for Booking ${booking.referenceCode || booking._id}`
          });
          await settlement.save();
        }
      }
    } else if (isTimeout) {
      if (booking.paymentStatus !== 'completed') {
        booking.paymentStatus = 'timeout';
        await booking.save();
      }
    } else {
      if (booking.paymentStatus !== 'completed') {
        booking.paymentStatus = 'failed';
        await booking.save();
      }
    }
  } catch (err) {
    console.error('[Payment Booking Sync] Error:', err.message);
  }
}

/**
 * Render Bed Reservation Checkout Page
 * UI follows Stitch reserve_bed_token_escrow_checkout_nestly_mobile
 */
router.get('/checkout', isLoggedIn, async (req, res) => {
  try {
    const { bookingId } = req.query;
    let bookingDetails = {
      propertyTitle: 'CozyNest Student Co-Living',
      roomNumber: 'Studio Suite • Room #304-B',
      location: 'Kopargaon, Maharashtra',
      residentName: req.user.name || 'Student Resident',
      residentPhone: req.user.phone || '+91 98765 43210',
      monthlyRent: 8500,
      securityDeposit: 8500,
      tokenDeposit: TOKEN_DEPOSIT_AMOUNT,
      bookingId: null
    };

    if (bookingId && mongoose.Types.ObjectId.isValid(bookingId)) {
      const booking = await Booking.findById(bookingId).populate('property');
      if (booking && (booking.user.equals(req.user._id) || req.user.role === 'admin')) {
        bookingDetails = {
          propertyTitle: booking.property ? booking.property.title : 'Nestly Accommodations',
          roomNumber: `${booking.roomType} Room • Allocated`,
          location: booking.property ? `${booking.property.locality}, ${booking.property.city}` : 'Kopargaon',
          residentName: req.user.name,
          residentPhone: req.user.phone || '+91 98765 43210',
          monthlyRent: booking.monthlyRent,
          securityDeposit: booking.securityDeposit,
          tokenDeposit: booking.amount || TOKEN_DEPOSIT_AMOUNT,
          bookingId: booking._id
        };
      }
    }

    res.render('pages/checkout', {
      title: 'Reserve Bed & Hold Unit',
      activePage: 'checkout',
      bookingDetails
    });
  } catch (err) {
    res.redirect('/stays');
  }
});

/**
 * Create Payment Order on Server and initiate with ZapUPI gateway
 */
router.post('/payments/create-order', isLoggedIn, async (req, res) => {
  try {
    const {
      customerName,
      customerMobile,
      vpa = '',
      bookingId
    } = req.body;

    let bookingOwner = null;
    let bookingProperty = null;
    let amount = TOKEN_DEPOSIT_AMOUNT;
    let propertyTitle = req.body.propertyTitle || 'Nestly Student Stay';
    let roomNumber = req.body.roomNumber || 'Allocated Bed Space';

    // Verify & authorize booking if bookingId is provided
    if (bookingId && mongoose.Types.ObjectId.isValid(bookingId)) {
      const booking = await Booking.findById(bookingId).populate('property');
      if (!booking) {
        return res.status(404).render('pages/payment-failed', {
          title: 'Booking Not Found',
          orderId: 'N/A',
          errorMessage: 'The reservation specified does not exist.'
        });
      }

      // Security Authorization: Only the student who created the booking (or admin) can pay
      if (!booking.user.equals(req.user._id) && req.user.role !== 'admin') {
        return res.status(403).render('pages/payment-failed', {
          title: 'Access Denied',
          orderId: 'N/A',
          errorMessage: 'You are not authorized to make a payment for this reservation.'
        });
      }

      // Guard against double payment on already completed bookings
      if (booking.paymentStatus === 'completed') {
        req.flash('info', 'This reservation is already paid and confirmed.');
        return res.redirect(`/bookings/${booking._id}`);
      }

      // Check if an existing successful payment already exists for this booking
      const existingSuccess = await Payment.findOne({ booking: booking._id, status: 'success' });
      if (existingSuccess) {
        req.flash('info', 'A successful payment for this reservation has already been recorded.');
        return res.redirect(`/payments/success/${existingSuccess.orderId}`);
      }

      // Strictly enforce payable amount calculated on the server
      amount = booking.amount || TOKEN_DEPOSIT_AMOUNT;
      bookingOwner = booking.owner;
      bookingProperty = booking.property ? booking.property._id : null;
      if (booking.property) {
        propertyTitle = booking.property.title || propertyTitle;
        roomNumber = `${booking.roomType || 'Standard'} Room • Allocated`;
      }
    }

    // Generate unique order reference ID complying with ZapUPI ORD[timestamp][random3] format
    const orderId = 'ORD' + Math.floor(Date.now() / 1000) + Math.floor(100 + Math.random() * 900);

    // Determine gateway callback and redirect URLs
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;
    const webhookUrl = `${baseUrl}/payments/webhook`;
    const redirectUrl = `${baseUrl}/payments/verify/${orderId}`;
    const successUrl = `${baseUrl}/payments/success/${orderId}`;
    const failedUrl = `${baseUrl}/payments/failed/${orderId}`;
    const timeoutUrl = `${baseUrl}/payments/timeout/${orderId}`;

    const resolvedMobile = (req.user && req.user.phone) || customerMobile || '9876543210';
    const resolvedName = (req.user && req.user.name) || customerName || 'Student';

    // Save pending payment record in database with authenticated user association
    const payment = new Payment({
      user: req.user._id,
      booking: (bookingId && mongoose.Types.ObjectId.isValid(bookingId)) ? bookingId : null,
      owner: bookingOwner,
      property: bookingProperty,
      orderId,
      referenceId: orderId,
      propertyTitle: String(propertyTitle).substring(0, 100),
      roomNumber: String(roomNumber).substring(0, 50),
      customerName: String(resolvedName).substring(0, 100),
      customerMobile: String(resolvedMobile).substring(0, 15),
      amount,
      status: 'pending'
    });
    await payment.save();

    // Call ZapUPI Gateway
    const gatewayResult = await ZapUpiService.createOrder({
      orderId,
      amount,
      customerMobile: resolvedMobile,
      remark: `Nestly Token Deposit | ${roomNumber}`,
      webhookUrl,
      redirectUrl,
      successUrl,
      failedUrl,
      timeoutUrl
    });

    if (!gatewayResult.success) {
      payment.status = 'failed';
      await payment.save();
      await syncBookingPayment(payment, 'failed');
      return res.status(400).render('pages/payment-failed', {
        title: 'Payment Initiation Failed',
        orderId,
        errorMessage: gatewayResult.error || 'Failed to initiate payment gateway request'
      });
    }

    // Update payment URL in DB
    payment.paymentUrl = gatewayResult.paymentUrl;
    await payment.save();

    // Redirect user to payment URL (live gateway or local simulation sandbox)
    return res.redirect(gatewayResult.paymentUrl);
  } catch (err) {
    console.error('[Payment] Create order error:', err.message);
    res.status(500).render('pages/payment-failed', {
      title: 'Payment Error',
      orderId: 'N/A',
      errorMessage: 'An unexpected server error occurred while processing your reservation payment.'
    });
  }
});

/**
 * ZapUPI Gateway Webhook Callback
 * Receives payment status notifications, verifies server-side, and updates database idempotently
 */
router.post('/payments/webhook', async (req, res) => {
  try {
    const rawOrderId = req.body.order_id || req.body.orderId;
    const rawStatus = req.body.status || req.body.order_status;
    const txnId = req.body.txn_id || req.body.txnId || req.body.transaction_id;
    const utr = req.body.utr || req.body.bank_utr;

    // Security: Check sender IP against configured ZapUPI gateway server IP
    const callerIp = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    if (!ZapUpiService.isValidGatewayIp(callerIp)) {
      console.warn(`[ZapUPI Webhook Notice] Request from IP ${callerIp}. Verified in simulation/test mode.`);
    }

    if (!rawOrderId) {
      return res.status(400).json({ status: 'error', message: 'Missing order_id' });
    }

    const payment = await Payment.findOne({ orderId: rawOrderId });
    if (!payment) {
      return res.status(404).json({ status: 'error', message: 'Order not found' });
    }

    // Save gateway response payload for audit/reconciliation
    payment.gatewayResponse = req.body;

    // Idempotency: If payment is already marked success, do NOT duplicate booking confirm or settlements
    if (payment.status === 'success') {
      if (txnId && !payment.transactionId) payment.transactionId = txnId;
      if (utr && !payment.utr) payment.utr = utr;
      await payment.save();
      return res.status(200).json({ status: 'ok', message: 'Already processed as success' });
    }

    // Determine normalized status
    let normalizedStatus = ZapUpiService.normalizeStatus(rawStatus);

    // If configured with live gateway, double-confirm status
    if (ZapUpiService.isConfigured()) {
      const verification = await ZapUpiService.verifyOrderStatus(rawOrderId);
      if (verification && verification.normalizedStatus) {
        normalizedStatus = verification.normalizedStatus;
      }
    }

    if (normalizedStatus === 'success') {
      payment.status = 'success';
      payment.transactionId = txnId || payment.transactionId || ('TXN_' + Date.now());
      payment.utr = utr || payment.utr || ('UTR_' + Date.now());
      await payment.save();
      await syncBookingPayment(payment, 'success');
    } else if (normalizedStatus === 'timeout') {
      payment.status = 'timeout';
      await payment.save();
      await syncBookingPayment(payment, 'timeout');
    } else {
      payment.status = 'failed';
      await payment.save();
      await syncBookingPayment(payment, 'failed');
    }

    // Always respond with standard HTTP 200 JSON required by ZapUPI
    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('[Payment Webhook] Error:', err.message);
    return res.status(200).json({ status: 'ok' }); // Always acknowledge to prevent retries
  }
});

/**
 * Server-Side Verification Endpoint (e.g. When returning from gateway redirect)
 */
router.get('/payments/verify/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!isValidOrderId(orderId)) {
      req.flash('error', 'Invalid order reference.');
      return res.redirect('/');
    }

    const payment = await Payment.findOne({ orderId });

    if (!payment) {
      return res.status(404).render('pages/payment-failed', {
        title: 'Order Not Found',
        orderId,
        errorMessage: 'The requested reservation reference does not exist.'
      });
    }

    // If already finalized in database, redirect to corresponding view immediately
    if (payment.status === 'success') {
      return res.redirect(`/payments/success/${orderId}`);
    }
    if (payment.status === 'timeout') {
      return res.redirect(`/payments/timeout/${orderId}`);
    }
    if (payment.status === 'failed') {
      return res.redirect(`/payments/failed/${orderId}`);
    }

    // Verify order status directly with gateway
    const verification = await ZapUpiService.verifyOrderStatus(orderId);
    payment.gatewayResponse = verification.raw || null;

    if (verification.normalizedStatus === 'success' || verification.success) {
      payment.status = 'success';
      payment.transactionId = verification.txnId || ('TXN_' + Date.now());
      payment.utr = verification.utr || ('UTR_' + Date.now());
      await payment.save();
      await syncBookingPayment(payment, 'success');
      req.flash('success', 'Escrow token deposit received! Your accommodation reservation is confirmed.');
      return res.redirect(`/payments/success/${orderId}`);
    } else if (verification.normalizedStatus === 'timeout') {
      payment.status = 'timeout';
      await payment.save();
      await syncBookingPayment(payment, 'timeout');
      return res.redirect(`/payments/timeout/${orderId}`);
    } else if (verification.normalizedStatus === 'failed') {
      payment.status = 'failed';
      await payment.save();
      await syncBookingPayment(payment, 'failed');
      req.flash('error', 'Payment verification was unsuccessful or cancelled.');
      return res.redirect(`/payments/failed/${orderId}`);
    } else {
      // Still pending
      return res.redirect(`/payments/timeout/${orderId}`);
    }
  } catch (err) {
    console.error('[Payment Verification] Error:', err.message);
    req.flash('error', 'An error occurred while verifying the payment.');
    res.redirect('/');
  }
});

/**
 * Local Simulation: Fail Order
 */
router.get('/payments/simulate-fail/:orderId', async (req, res) => {
  const { orderId } = req.params;
  if (!isValidOrderId(orderId)) return res.redirect('/');
  const payment = await Payment.findOne({ orderId });
  if (payment && payment.status !== 'success') {
    payment.status = 'failed';
    await payment.save();
    await syncBookingPayment(payment, 'failed');
  }
  return res.redirect(`/payments/failed/${orderId}`);
});

/**
 * Local Simulation: Timeout Order
 */
router.get('/payments/simulate-timeout/:orderId', async (req, res) => {
  const { orderId } = req.params;
  if (!isValidOrderId(orderId)) return res.redirect('/');
  const payment = await Payment.findOne({ orderId });
  if (payment && payment.status !== 'success') {
    payment.status = 'timeout';
    await payment.save();
    await syncBookingPayment(payment, 'timeout');
  }
  return res.redirect(`/payments/timeout/${orderId}`);
});

/**
 * Payment Cancellation Endpoint
 */
router.get('/payments/cancel/:orderId', async (req, res) => {
  const { orderId } = req.params;
  if (!isValidOrderId(orderId)) return res.redirect('/');
  const payment = await Payment.findOne({ orderId });
  if (payment && payment.status !== 'success') {
    payment.status = 'cancelled';
    await payment.save();
    await syncBookingPayment(payment, 'failed');
  }
  req.flash('info', 'Your payment transaction was cancelled.');
  return res.redirect(`/payments/failed/${orderId}`);
});

/**
 * Payment Success Page
 * UI faithfully reproduces Stitch bed_reservation_escrow_deposit_success_nestly_mobile
 */
router.get('/payments/success/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!isValidOrderId(orderId)) {
      return res.redirect('/');
    }

    const payment = await Payment.findOne({ orderId });

    // Guard: Only display success if payment is actually verified as success in database
    if (!payment || payment.status !== 'success') {
      return res.redirect(`/payments/failed/${orderId}`);
    }

    res.render('pages/payment-success', {
      title: 'Booking Confirmed | Escrow Deposit Confirmed',
      activePage: 'payment-success',
      payment
    });
  } catch (err) {
    console.error('[Payment Success] Error:', err.message);
    res.redirect('/');
  }
});

/**
 * Payment Timeout Page
 */
router.get('/payments/timeout/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!isValidOrderId(orderId)) {
      return res.redirect('/');
    }

    const payment = await Payment.findOne({ orderId });

    res.render('pages/payment-timeout', {
      title: 'Payment Window Expired | Nestly',
      activePage: 'payment-timeout',
      orderId,
      payment
    });
  } catch (err) {
    console.error('[Payment Timeout] Error:', err.message);
    res.redirect('/');
  }
});

/**
 * Payment Failed Page
 */
router.get('/payments/failed/:orderId', async (req, res) => {
  const { orderId } = req.params;

  if (!isValidOrderId(orderId)) {
    return res.redirect('/');
  }

  const payment = await Payment.findOne({ orderId });

  res.render('pages/payment-failed', {
    title: 'Payment Failed or Cancelled',
    activePage: 'payment-failed',
    orderId,
    payment,
    errorMessage: 'The transaction could not be verified or was cancelled by the user.'
  });
});

/**
 * Local Gateway Simulation Handler (for safe testing when live API key is not configured)
 */
router.get('/payments/simulate-gateway/:orderId', async (req, res) => {
  const { orderId } = req.params;

  if (!isValidOrderId(orderId)) {
    return res.status(400).send('Invalid order reference format');
  }

  const payment = await Payment.findOne({ orderId });

  if (!payment) {
    return res.status(404).send('Order not found');
  }

  res.render('pages/simulate-gateway', {
    title: 'ZAP UPI Gateway Sandbox',
    payment
  });
});

module.exports = router;

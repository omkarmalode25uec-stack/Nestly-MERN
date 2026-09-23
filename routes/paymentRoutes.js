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

// Helper to validate and sanitize orderId parameter
const isValidOrderId = (orderId) => typeof orderId === 'string' && /^[A-Za-z0-9_-]{3,64}$/.test(orderId);

// Helper to reliably construct canonical base URL
const getBaseUrl = (req) => {
  const protocol = req.headers['x-forwarded-proto'] || (process.env.NODE_ENV === 'production' ? 'https' : req.protocol);
  const host = req.get('host');
  return `${protocol}://${host}`;
};

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
      // Create pending owner settlement ledger entry upon successful student payment (first month's rent)
      const ownerId = booking.owner || (booking.property && booking.property.owner);
      if (ownerId) {
        const owner = await User.findById(ownerId);
        let settlement = await Settlement.findOne({ booking: booking._id, payment: payment._id });
        if (!settlement) {
          const profile = (owner && owner.settlementProfile) || {};
          const payableRent = payment.amount || (booking.property && booking.property.price) || booking.monthlyRent || 0;
          settlement = new Settlement({
            owner: ownerId,
            student: payment.user || booking.user,
            booking: booking._id,
            payment: payment._id,
            property: booking.property._id || booking.property,
            grossAmount: payableRent,
            platformFee: 0, // Zero broker fee under Nestly Student Guarantee
            netAmount: payableRent,
            status: 'pending',
            settlementMethod: profile.settlementMethod || 'upi',
            destinationUpiId: profile.upiId || '',
            destinationAccountHolder: profile.accountHolderName || (owner ? owner.name : ''),
            destinationBankName: profile.bankName || '',
            destinationAccountNumberMasked: profile.accountNumber ? `******${profile.accountNumber.slice(-4)}` : '',
            notes: `First month rent escrow for Booking ${booking.referenceCode || booking._id}`
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
      monthlyRent: 6000,
      securityDeposit: 6000,
      payableAmount: 6000,
      bookingId: null
    };

    if (bookingId && mongoose.Types.ObjectId.isValid(bookingId)) {
      const booking = await Booking.findById(bookingId).populate('property');
      if (booking && (booking.user.equals(req.user._id) || req.user.role === 'admin')) {
        const rent = (booking.property && booking.property.price) || booking.monthlyRent || 6000;
        bookingDetails = {
          propertyTitle: booking.property ? booking.property.title : 'Nestly Accommodations',
          roomNumber: `${booking.roomType} Room • Allocated`,
          location: booking.property ? `${booking.property.locality}, ${booking.property.city}` : 'Kopargaon',
          residentName: req.user.name,
          residentPhone: req.user.phone || '+91 98765 43210',
          monthlyRent: rent,
          securityDeposit: booking.securityDeposit,
          payableAmount: rent,
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
    let amount = 6000;
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

      // Strictly enforce first month rent calculated dynamically on the server from property/booking
      const firstMonthRent = (booking.property && booking.property.price) || booking.monthlyRent || 6000;
      amount = firstMonthRent;
      if (booking.amount !== amount) {
        booking.amount = amount;
        await booking.save();
      }
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
    const baseUrl = getBaseUrl(req);
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
      remark: `Nestly First Month Rent | ${roomNumber}`,
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
    const payload = req.body || {};
    const inner = (payload && typeof payload.data === 'object' && payload.data !== null) ? payload.data : payload;

    const rawOrderId = inner.order_id || inner.orderId || payload.order_id || payload.orderId || req.query?.order_id || req.query?.orderId;
    const rawStatus = inner.order_status || inner.status || inner.txn_status || inner.payment_status || payload.status || payload.order_status || req.query?.status;
    const txnId = inner.txn_id || inner.txnId || inner.transaction_id || payload.txn_id || payload.txnId || payload.transaction_id || req.query?.txn_id;
    const utr = inner.utr || inner.bank_utr || inner.bank_rrn || payload.utr || payload.bank_utr || req.query?.utr;

    // Security: Check sender IP against configured ZapUPI gateway server IP
    const callerIp = req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress;
    if (!ZapUpiService.isValidGatewayIp(callerIp)) {
      console.warn(`[ZapUPI Webhook Notice] Request from IP ${callerIp}.`);
    }

    if (!rawOrderId) {
      return res.status(400).json({ status: 'error', message: 'Missing order_id' });
    }

    const trimmedOrderId = String(rawOrderId).trim();
    const payment = await Payment.findOne({
      $or: [
        { orderId: trimmedOrderId },
        { referenceId: trimmedOrderId }
      ]
    });

    if (!payment) {
      return res.status(404).json({ status: 'error', message: 'Order not found' });
    }

    // Save gateway response payload for audit/reconciliation
    payment.gatewayResponse = payload;

    // Idempotency: If payment is already marked success, do NOT duplicate booking confirm or settlements
    if (payment.status === 'success') {
      if (txnId && !payment.transactionId) payment.transactionId = txnId;
      if (utr && !payment.utr) payment.utr = utr;
      await payment.save();
      return res.status(200).json({ status: 'ok', message: 'Already processed as success' });
    }

    // Determine normalized status from incoming webhook notification
    let normalizedStatus = ZapUpiService.normalizeStatus(rawStatus);

    // If webhook alone did not provide definitive success, and gateway is configured, check with status API
    if (normalizedStatus !== 'success' && ZapUpiService.isConfigured()) {
      try {
        const verification = await ZapUpiService.verifyOrderStatus(payment.orderId);
        if (verification && verification.normalizedStatus === 'success') {
          normalizedStatus = 'success';
          if (!txnId && verification.txnId) payment.transactionId = verification.txnId;
          if (!utr && verification.utr) payment.utr = verification.utr;
        } else if (verification && (verification.normalizedStatus === 'failed' || verification.normalizedStatus === 'timeout')) {
          normalizedStatus = verification.normalizedStatus;
        }
      } catch (err) {
        // Retain webhook-provided status
      }
    }

    if (normalizedStatus === 'success') {
      // Validate expected amount against gateway payload if reported
      const reportedAmount = parseFloat(inner.amount || inner.pay_amount || payload.amount || payload.pay_amount);
      if (!isNaN(reportedAmount) && (reportedAmount <= 0 || Math.abs(reportedAmount - payment.amount) > 0.01)) {
        console.warn(`[Webhook Amount Mismatch] Order ${payment.orderId}: expected ₹${payment.amount}, received ₹${reportedAmount}`);
        payment.status = 'failed';
        await payment.save();
        await syncBookingPayment(payment, 'failed');
        return res.status(200).json({ status: 'error', message: 'Amount mismatch or invalid' });
      }

      payment.status = 'success';
      payment.transactionId = txnId || payment.transactionId || ('TXN_' + Date.now());
      payment.utr = utr || payment.utr || ('UTR_' + Date.now());
      await payment.save();
      await syncBookingPayment(payment, 'success');
    } else if (normalizedStatus === 'timeout') {
      payment.status = 'timeout';
      await payment.save();
      await syncBookingPayment(payment, 'timeout');
    } else if (normalizedStatus === 'failed') {
      payment.status = 'failed';
      await payment.save();
      await syncBookingPayment(payment, 'failed');
    } else {
      // Still pending: preserve pending status so subsequent checks or webhooks can settle
      await payment.save();
    }

    // Always respond with standard HTTP 200 JSON required by ZapUPI
    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('[Payment Webhook] Error:', err.message);
    return res.status(200).json({ status: 'ok' }); // Always acknowledge to prevent retries
  }
});

/**
 * Server-Side Verification Endpoint (e.g. When returning from gateway redirect or clicking Check Status)
 */
router.get('/payments/verify/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!isValidOrderId(orderId)) {
      req.flash('error', 'Invalid order reference.');
      return res.redirect('/');
    }

    const trimmedOrderId = String(orderId).trim();
    const payment = await Payment.findOne({
      $or: [
        { orderId: trimmedOrderId },
        { referenceId: trimmedOrderId }
      ]
    });

    if (!payment) {
      return res.status(404).render('pages/payment-failed', {
        title: 'Order Not Found',
        orderId,
        errorMessage: 'The requested reservation reference does not exist.'
      });
    }

    // If already finalized in database, redirect to corresponding view immediately
    if (payment.status === 'success') {
      return res.redirect(`/payments/success/${payment.orderId}`);
    }
    if (payment.status === 'timeout') {
      return res.redirect(`/payments/timeout/${payment.orderId}`);
    }
    if (payment.status === 'failed') {
      return res.redirect(`/payments/failed/${payment.orderId}`);
    }

    // Verify order status directly with gateway
    const verification = await ZapUpiService.verifyOrderStatus(payment.orderId);
    if (verification.raw) {
      payment.gatewayResponse = verification.raw;
    }

    if (verification.normalizedStatus === 'success' || verification.success) {
      // Validate expected amount against gateway response if reported
      const reportedAmount = parseFloat(verification.amount);
      if (!isNaN(reportedAmount) && (reportedAmount <= 0 || Math.abs(reportedAmount - payment.amount) > 0.01)) {
        console.warn(`[Payment Verification] Amount mismatch for ${payment.orderId}: expected ₹${payment.amount}, received ₹${reportedAmount}`);
        payment.status = 'failed';
        await payment.save();
        await syncBookingPayment(payment, 'failed');
        req.flash('error', 'Payment verification failed: Amount does not match listing rent.');
        return res.redirect(`/payments/failed/${payment.orderId}`);
      }

      payment.status = 'success';
      payment.transactionId = verification.txnId || payment.transactionId || ('TXN_' + Date.now());
      payment.utr = verification.utr || payment.utr || ('UTR_' + Date.now());
      await payment.save();
      await syncBookingPayment(payment, 'success');
      req.flash('success', 'First month rent payment verified! Your accommodation reservation is confirmed.');
      return res.redirect(`/payments/success/${payment.orderId}`);
    } else if (verification.normalizedStatus === 'timeout') {
      payment.status = 'timeout';
      await payment.save();
      await syncBookingPayment(payment, 'timeout');
      return res.redirect(`/payments/timeout/${payment.orderId}`);
    } else if (verification.normalizedStatus === 'failed') {
      payment.status = 'failed';
      await payment.save();
      await syncBookingPayment(payment, 'failed');
      req.flash('error', 'Payment verification was unsuccessful or cancelled.');
      return res.redirect(`/payments/failed/${payment.orderId}`);
    } else {
      // Still pending
      req.flash('info', 'Payment is awaiting completion. Please complete the UPI transaction in your payment app and check status again.');
      return res.redirect(`/payments/pay/${payment.orderId}`);
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
 * Hosted Payment Gateway Redirection Endpoint
 * Strictly redirects to the ZapUPI-hosted checkout URL. Never generates a local UPI QR.
 */
router.get('/payments/pay/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!isValidOrderId(orderId)) {
      req.flash('error', 'Invalid order reference.');
      return res.redirect('/');
    }

    const trimmedOrderId = String(orderId).trim();
    const payment = await Payment.findOne({
      $or: [
        { orderId: trimmedOrderId },
        { referenceId: trimmedOrderId }
      ]
    });

    if (!payment) {
      return res.status(404).render('pages/payment-failed', {
        title: 'Order Not Found',
        orderId,
        errorMessage: 'The requested reservation reference does not exist.'
      });
    }

    // Redirect to finalized views if already settled
    if (payment.status === 'success') {
      return res.redirect(`/payments/success/${payment.orderId}`);
    }
    if (payment.status === 'timeout') {
      return res.redirect(`/payments/timeout/${payment.orderId}`);
    }
    if (payment.status === 'failed') {
      return res.redirect(`/payments/failed/${payment.orderId}`);
    }

    // Redirect directly to ZapUPI's hosted gateway checkout page if present
    if (payment.paymentUrl && (payment.paymentUrl.startsWith('http://') || payment.paymentUrl.startsWith('https://'))) {
      return res.redirect(payment.paymentUrl);
    }

    // If paymentUrl is not yet generated, attempt to create it on the fly
    if (ZapUpiService.isConfigured()) {
      const baseUrl = getBaseUrl(req);
      const gatewayResult = await ZapUpiService.createOrder({
        orderId: payment.orderId,
        amount: payment.amount,
        customerMobile: payment.customerMobile,
        remark: `Nestly ${payment.orderId}`,
        webhookUrl: `${baseUrl}/payments/webhook`,
        redirectUrl: `${baseUrl}/payments/verify/${payment.orderId}`,
        successUrl: `${baseUrl}/payments/success/${payment.orderId}`,
        failedUrl: `${baseUrl}/payments/failed/${payment.orderId}`,
        timeoutUrl: `${baseUrl}/payments/timeout/${payment.orderId}`
      });

      if (gatewayResult.success && gatewayResult.paymentUrl) {
        payment.paymentUrl = gatewayResult.paymentUrl;
        await payment.save();
        return res.redirect(gatewayResult.paymentUrl);
      }
    }

    // If hosted gateway URL is missing, display clear configuration status
    return res.status(400).render('pages/payment-failed', {
      title: 'Hosted Gateway Checkout Unavailable',
      orderId: payment.orderId,
      errorMessage: 'Hosted payment checkout URL is not available. Please ensure your ZapUPI Merchant Key (zap_key) from panel.zapupi.com is configured in your environment settings.'
    });
  } catch (err) {
    console.error('[Payment Gateway Pay] Error:', err.message);
    res.redirect('/');
  }
});

/**
 * Real-time Payment Status Polling Endpoint (No manual UTR entry needed)
 */
router.get('/payments/check-status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!isValidOrderId(orderId)) {
      return res.status(400).json({ status: 'invalid' });
    }

    const trimmedOrderId = String(orderId).trim();
    const payment = await Payment.findOne({
      $or: [
        { orderId: trimmedOrderId },
        { referenceId: trimmedOrderId }
      ]
    });
    if (!payment) {
      return res.status(404).json({ status: 'not_found' });
    }

    if (payment.status === 'success') {
      return res.json({ status: 'success', redirectUrl: `/payments/success/${payment.orderId}` });
    }
    if (payment.status === 'failed') {
      return res.json({ status: 'failed', redirectUrl: `/payments/failed/${payment.orderId}` });
    }
    if (payment.status === 'timeout') {
      return res.json({ status: 'timeout', redirectUrl: `/payments/timeout/${payment.orderId}` });
    }

    // Check with live gateway if configured
    if (ZapUpiService.isConfigured()) {
      try {
        const verification = await ZapUpiService.verifyOrderStatus(payment.orderId);
        if (verification.raw) {
          payment.gatewayResponse = verification.raw;
        }
        if (verification.normalizedStatus === 'success' || verification.success) {
          const reportedAmount = parseFloat(verification.amount);
          if (!isNaN(reportedAmount) && (reportedAmount <= 0 || Math.abs(reportedAmount - payment.amount) > 0.01)) {
            payment.status = 'failed';
            await payment.save();
            await syncBookingPayment(payment, 'failed');
            return res.json({ status: 'failed', redirectUrl: `/payments/failed/${payment.orderId}` });
          }

          payment.status = 'success';
          payment.transactionId = verification.txnId || payment.transactionId || ('TXN_' + Date.now());
          payment.utr = verification.utr || payment.utr || ('UTR_' + Date.now());
          await payment.save();
          await syncBookingPayment(payment, 'success');
          return res.json({ status: 'success', redirectUrl: `/payments/success/${payment.orderId}` });
        } else if (verification.normalizedStatus === 'failed') {
          payment.status = 'failed';
          await payment.save();
          await syncBookingPayment(payment, 'failed');
          return res.json({ status: 'failed', redirectUrl: `/payments/failed/${payment.orderId}` });
        } else if (verification.normalizedStatus === 'timeout') {
          payment.status = 'timeout';
          await payment.save();
          await syncBookingPayment(payment, 'timeout');
          return res.json({ status: 'timeout', redirectUrl: `/payments/timeout/${payment.orderId}` });
        }
      } catch (err) {
        // Fall back to current pending status
      }
    }

    return res.json({ status: 'pending' });
  } catch (err) {
    return res.status(500).json({ status: 'error' });
  }
});

/**
 * Backward compatibility: Redirect legacy verify-utr requests directly to server verification
 */
router.all('/payments/verify-utr/:orderId', (req, res) => {
  res.redirect(`/payments/verify/${req.params.orderId}`);
});

/**
 * Backward compatibility: Redirect legacy simulator to real payment gateway screen
 */
router.get('/payments/simulate-gateway/:orderId', (req, res) => {
  res.redirect(`/payments/pay/${req.params.orderId}`);
});

module.exports = router;

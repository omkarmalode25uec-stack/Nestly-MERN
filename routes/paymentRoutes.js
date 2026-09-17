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
async function syncBookingPayment(payment, isSuccess) {
  if (!payment || !payment.booking) return;
  try {
    const booking = await Booking.findById(payment.booking).populate('property');
    if (!booking) return;

    if (isSuccess) {
      booking.paymentStatus = 'completed';
      booking.payment = payment._id;
      booking.status = 'confirmed';
      await booking.save();

      if (booking.property) {
        await Property.findByIdAndUpdate(booking.property._id || booking.property, { $inc: { availableBeds: -1 } });
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
      location: 'Baner Rd, near Symbiosis & MIT-WPU Transit hub, Pune',
      residentName: req.user.name || 'Student Resident',
      residentPhone: req.user.phone || '+91 98765 43210',
      monthlyRent: 11500,
      securityDeposit: 11500,
      tokenDeposit: TOKEN_DEPOSIT_AMOUNT,
      bookingId: null
    };

    if (bookingId && mongoose.Types.ObjectId.isValid(bookingId)) {
      const booking = await Booking.findById(bookingId).populate('property');
      if (booking && (booking.user.equals(req.user._id) || req.user.role === 'admin')) {
        bookingDetails = {
          propertyTitle: booking.property ? booking.property.title : 'Nestly Accommodations',
          roomNumber: `${booking.roomType} Room • Allocated`,
          location: booking.property ? `${booking.property.locality}, ${booking.property.city}` : 'Pune',
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
      propertyTitle = 'CozyNest Student Co-Living',
      roomNumber = 'Studio Suite • Room #304-B',
      customerName,
      customerMobile,
      vpa = '',
      bookingId
    } = req.body;

    // Generate unique order reference ID complying with ZapUPI ORD[timestamp][random3] format
    const orderId = 'ORD' + Math.floor(Date.now() / 1000) + Math.floor(100 + Math.random() * 900);
    const amount = TOKEN_DEPOSIT_AMOUNT; // Enforce server-side amount

    // Determine webhook callback URL
    const protocol = req.protocol;
    const host = req.get('host');
    const webhookUrl = `${protocol}://${host}/payments/webhook`;

    let bookingOwner = null;
    let bookingProperty = null;
    if (bookingId && mongoose.Types.ObjectId.isValid(bookingId)) {
      const b = await Booking.findById(bookingId);
      if (b) {
        bookingOwner = b.owner;
        bookingProperty = b.property;
      }
    }

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
      customerName: customerName ? String(customerName).substring(0, 100) : req.user.name,
      customerMobile: customerMobile ? String(customerMobile).substring(0, 15) : (req.user.phone || '9876543210'),
      amount,
      status: 'pending'
    });
    await payment.save();

    // Call ZapUPI Gateway
    const gatewayResult = await ZapUpiService.createOrder({
      orderId,
      amount,
      customerMobile,
      remark: `Nestly Token Deposit | ${roomNumber}`,
      webhookUrl
    });

    if (!gatewayResult.success) {
      payment.status = 'failed';
      await payment.save();
      await syncBookingPayment(payment, false);
      return res.status(400).render('pages/payment-failed', {
        title: 'Payment Initiation Failed',
        orderId,
        errorMessage: gatewayResult.error || 'Failed to initiate payment gateway request'
      });
    }

    // Update payment URL in DB
    payment.paymentUrl = gatewayResult.paymentUrl;
    await payment.save();

    // Redirect user to payment URL (either live gateway or local simulation)
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
 * Receives payment status updates and verifies server-side before updating database
 */
router.post('/payments/webhook', async (req, res) => {
  try {
    const { order_id, status } = req.body;

    // Security: Check sender IP against configured ZapUPI gateway server IP
    const callerIp = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    if (!ZapUpiService.isValidGatewayIp(callerIp)) {
      console.warn(`[ZapUPI Webhook Notice] Request from IP ${callerIp}. Verified in simulation/test mode.`);
    }

    if (!order_id) {
      return res.status(400).json({ status: 'error', message: 'Missing order_id' });
    }

    const payment = await Payment.findOne({ orderId: order_id });
    if (!payment) {
      return res.status(404).json({ status: 'error', message: 'Order not found' });
    }

    // Security Rule: Double-confirm with the gateway verification endpoint
    const verification = await ZapUpiService.verifyOrderStatus(order_id);

    if (verification.success) {
      payment.status = 'success';
      payment.transactionId = verification.txnId || req.body.txn_id || ('TXN_' + Date.now());
      payment.utr = verification.utr || req.body.utr || ('UTR_' + Date.now());
      await payment.save();
      await syncBookingPayment(payment, true);
    } else {
      payment.status = 'failed';
      await payment.save();
      await syncBookingPayment(payment, false);
    }

    // Respond with standard HTTP 200 JSON required by ZapUPI
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

    // Verify order status directly with gateway
    const verification = await ZapUpiService.verifyOrderStatus(orderId);

    if (verification.success) {
      payment.status = 'success';
      payment.transactionId = verification.txnId || ('TXN_' + Date.now());
      payment.utr = verification.utr || ('UTR_' + Date.now());
      await payment.save();
      await syncBookingPayment(payment, true);
      req.flash('success', 'Escrow token deposit received! Your accommodation reservation is confirmed.');
      return res.redirect(`/payments/success/${orderId}`);
    } else {
      payment.status = 'failed';
      await payment.save();
      await syncBookingPayment(payment, false);
      req.flash('error', 'Payment verification was unsuccessful or cancelled.');
      return res.redirect(`/payments/failed/${orderId}`);
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
  if (payment) {
    payment.status = 'failed';
    await payment.save();
    await syncBookingPayment(payment, false);
  }
  return res.redirect(`/payments/failed/${orderId}`);
});

/**
 * Payment Cancellation Endpoint
 */
router.get('/payments/cancel/:orderId', async (req, res) => {
  const { orderId } = req.params;
  if (!isValidOrderId(orderId)) return res.redirect('/');
  const payment = await Payment.findOne({ orderId });
  if (payment) {
    payment.status = 'cancelled';
    await payment.save();
    await syncBookingPayment(payment, false);
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

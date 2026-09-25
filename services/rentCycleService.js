const Booking = require('../models/Booking');
const RentPayment = require('../models/RentPayment');
const Payment = require('../models/Payment');
const NotificationService = require('./notificationService');

/**
 * Utility to accurately add N months to a date, preserving day of month
 */
function addMonths(baseDate, months) {
  const d = new Date(baseDate);
  const targetMonth = d.getMonth() + months;
  const originalDay = d.getDate();
  d.setMonth(targetMonth);
  // Handle edge cases like Feb 30 wrapping to Mar
  if (d.getDate() !== originalDay) {
    d.setDate(0); // set to last day of previous month
  }
  return d;
}

class RentCycleService {
  /**
   * Calculate exact dates for a given cycle
   * @param {Date} moveInDate 
   * @param {number} cycleNumber (1-based: 1, 2, 3...)
   */
  static getCycleDates(moveInDate, cycleNumber) {
    const cycleIndex = cycleNumber - 1;
    const startDate = addMonths(moveInDate, cycleIndex);
    const nextStart = addMonths(moveInDate, cycleIndex + 1);
    const endDate = new Date(nextStart.getTime() - 24 * 60 * 60 * 1000); // 1 day before next cycle
    const dueDate = new Date(startDate);
    return { startDate, endDate, dueDate };
  }

  /**
   * Synchronize and populate rent payment cycles for a confirmed booking
   */
  static async syncBookingCycles(booking) {
    if (!booking || booking.status !== 'confirmed') return null;

    const moveInDate = new Date(booking.moveInDate || Date.now());
    const durationMonths = booking.durationMonths || 10;
    const stayEndDate = addMonths(moveInDate, durationMonths);
    const monthlyRent = booking.monthlyRent || booking.amount || 6000;
    const now = new Date();

    booking.stayEndDate = stayEndDate;
    booking.totalCycles = durationMonths;

    // Check if initial reservation payment was completed
    const initialPaymentDone = booking.paymentStatus === 'completed';

    // Cycle 1 corresponds to Month 1 (paid upon reservation hold)
    if (initialPaymentDone) {
      const cycle1Dates = this.getCycleDates(moveInDate, 1);
      await RentPayment.findOneAndUpdate(
        { booking: booking._id, cycleNumber: 1 },
        {
          $setOnInsert: {
            booking: booking._id,
            student: booking.user,
            owner: booking.owner,
            property: booking.property,
            cycleNumber: 1,
            billingPeriod: {
              startDate: cycle1Dates.startDate,
              endDate: cycle1Dates.endDate
            },
            dueDate: cycle1Dates.dueDate,
            amount: monthlyRent,
            status: 'paid',
            paidAt: booking.updatedAt || new Date(),
            notes: 'First month rent paid via reservation pass'
          }
        },
        { upsert: true, returnDocument: 'after' }
      );
    }

    // Determine upcoming and active cycles
    let nextDueCycle = null;
    let nextDueDate = null;
    let overallCycleStatus = 'paid';

    for (let c = 2; c <= durationMonths; c++) {
      const dates = this.getCycleDates(moveInDate, c);
      let existing = await RentPayment.findOne({ booking: booking._id, cycleNumber: c });

      // Determine status based on current date
      // Due if current date is within 7 days before due date, or up to 3 days after
      // Overdue if current date is > 3 days past due date
      const daysDiff = (now - dates.dueDate) / (1000 * 60 * 60 * 24);

      let computedStatus = 'due';
      if (daysDiff > 3) {
        computedStatus = 'overdue';
      } else if (daysDiff < -7) {
        computedStatus = 'pending'; // not yet in the active billing window
      }

      if (!existing) {
        // Only create the record if it is in or near the billing window (within 10 days before due date or overdue)
        if (daysDiff >= -10) {
          existing = new RentPayment({
            booking: booking._id,
            student: booking.user,
            owner: booking.owner,
            property: booking.property,
            cycleNumber: c,
            billingPeriod: {
              startDate: dates.startDate,
              endDate: dates.endDate
            },
            dueDate: dates.dueDate,
            amount: monthlyRent,
            status: computedStatus
          });
          await existing.save();
        }
      } else if (existing.status !== 'paid') {
        // Update due/overdue status if unpaid
        if (existing.status !== computedStatus && (computedStatus === 'due' || computedStatus === 'overdue')) {
          existing.status = computedStatus;
          await existing.save();
        }
      }

      // Track the first unpaid cycle as the next due cycle
      if (existing && existing.status !== 'paid' && !nextDueCycle) {
        nextDueCycle = existing;
        nextDueDate = dates.dueDate;
        overallCycleStatus = existing.status; // 'due' or 'overdue'
      } else if (!existing && !nextDueCycle && daysDiff < 0) {
        nextDueDate = dates.dueDate;
        nextDueCycle = { dueDate: dates.dueDate, amount: monthlyRent, status: 'due', cycleNumber: c };
      }
    }

    // Calculate paid cycles count
    const paidCount = await RentPayment.countDocuments({ booking: booking._id, status: 'paid' });
    booking.paidCycles = paidCount;
    booking.nextDueDate = nextDueDate;
    booking.rentCycleStatus = (paidCount >= durationMonths) ? 'completed' : overallCycleStatus;
    await booking.save();

    return {
      booking,
      nextDueCycle,
      paidCycles: paidCount,
      totalCycles: durationMonths
    };
  }

  /**
   * Scheduled & on-demand task: process all active bookings for rent cycle transitions
   */
  static async processAllActiveRentCycles() {
    try {
      const activeBookings = await Booking.find({ status: 'confirmed' });
      let processed = 0;

      for (const booking of activeBookings) {
        const result = await this.syncBookingCycles(booking);
        if (result && result.nextDueCycle && (result.nextDueCycle.status === 'due' || result.nextDueCycle.status === 'overdue')) {
          // Check if notification already sent in the last 48 hours for this cycle
          const cycleNumber = result.nextDueCycle.cycleNumber;
          const formattedDue = new Date(result.nextDueCycle.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
          const rentAmount = (result.nextDueCycle.amount || booking.monthlyRent || 6000).toLocaleString('en-IN');

          const existingNotification = await NotificationService.getUserNotifications(booking.user, 10);
          const alreadyNotified = existingNotification.some(
            n => n.type === 'payment_due' && n.message.includes(`Month ${cycleNumber}`) && (Date.now() - new Date(n.createdAt).getTime() < 48 * 3600 * 1000)
          );

          if (!alreadyNotified) {
            await NotificationService.send({
              recipient: booking.user,
              type: 'payment_due',
              title: `Monthly Rent Due: ₹${rentAmount}`,
              message: `Your monthly rent of ₹${rentAmount} for Month ${cycleNumber} is due on ${formattedDue}. Pay easily online to keep your bed reserved.`,
              link: result.nextDueCycle._id ? `/checkout/rent/${result.nextDueCycle._id}` : `/bookings/${booking._id}`
            });
          }
        }
        processed++;
      }
      return { success: true, processed };
    } catch (err) {
      console.error('[RentCycleService] Error processing rent cycles:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Get Stay Management / "My Students" dataset for an owner
   */
  static async getOwnerStudentManagementData(ownerId) {
    const bookings = await Booking.find({ owner: ownerId, status: 'confirmed' })
      .populate('property')
      .populate('user', 'name email phone college avatar')
      .sort({ moveInDate: -1 });

    const now = new Date();
    const students = [];

    let paymentsDueCount = 0;
    let paymentsReceivedCount = 0;
    let overdueCount = 0;
    let upcomingRenewalsCount = 0;

    for (const b of bookings) {
      // Ensure cycles are synced
      await this.syncBookingCycles(b);

      // Find active/current rent payment
      const currentRent = await RentPayment.findOne({
        booking: b._id,
        status: { $in: ['due', 'overdue', 'pending'] }
      }).sort({ cycleNumber: 1 });

      let currentStatus = 'Paid';
      if (currentRent) {
        if (currentRent.status === 'overdue') {
          currentStatus = 'Overdue';
          overdueCount++;
        } else {
          currentStatus = 'Due';
          paymentsDueCount++;
        }
      } else {
        paymentsReceivedCount++;
      }

      // Check upcoming renewal (stay ends within 30 days)
      const stayEnd = b.stayEndDate || addMonths(b.moveInDate, b.durationMonths || 10);
      const daysUntilEnd = (stayEnd - now) / (1000 * 60 * 60 * 24);
      if (daysUntilEnd >= 0 && daysUntilEnd <= 30) {
        upcomingRenewalsCount++;
      }

      students.push({
        bookingId: b._id,
        studentName: b.user ? b.user.name : 'Student Member',
        studentAvatar: b.user ? b.user.avatar : null,
        studentCollege: b.user ? b.user.college : '',
        studentId: b.user ? b.user._id : null,
        propertyTitle: b.property ? b.property.title : 'Accommodation',
        propertyId: b.property ? b.property._id : null,
        roomNumber: `${b.roomType || 'Standard'} Room`,
        moveInDate: b.moveInDate,
        stayEndDate: stayEnd,
        monthlyRent: b.monthlyRent || (b.property ? b.property.price : 6000),
        nextDueDate: b.nextDueDate,
        currentStatus, // 'Paid' | 'Due' | 'Overdue'
        paidCycles: b.paidCycles || 1,
        totalCycles: b.totalCycles || b.durationMonths || 10,
        rentPaymentId: currentRent ? currentRent._id : null
      });
    }

    return {
      students,
      stats: {
        totalActiveStudents: students.length,
        paymentsDue: paymentsDueCount,
        paymentsReceived: paymentsReceivedCount,
        overduePayments: overdueCount,
        upcomingRenewals: upcomingRenewalsCount
      }
    };
  }

  /**
   * Get Verified Earnings & Payment Ledger for an owner
   * Note: strictly derives numbers from verified payment records
   */
  static async getOwnerEarningsLedger(ownerId) {
    // 1. Verified completed reservation and monthly rent payments
    const verifiedPayments = await Payment.find({
      owner: ownerId,
      status: 'success'
    })
      .populate('booking')
      .populate('property', 'title locality roomSharing')
      .populate('user', 'name avatar')
      .sort({ createdAt: -1 });

    const totalVerifiedPayments = verifiedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

    // Payments verified in the current calendar month
    const now = new Date();
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const paidThisMonth = verifiedPayments
      .filter(p => new Date(p.createdAt) >= startOfCurrentMonth)
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    // 2. Pending & Overdue rent payments
    const pendingRentPayments = await RentPayment.find({
      owner: ownerId,
      status: { $in: ['due', 'pending'] }
    });
    const pendingAmount = pendingRentPayments.reduce((sum, r) => sum + (r.amount || 0), 0);

    const overdueRentPayments = await RentPayment.find({
      owner: ownerId,
      status: 'overdue'
    });
    const overdueAmount = overdueRentPayments.reduce((sum, r) => sum + (r.amount || 0), 0);

    return {
      totals: {
        totalVerifiedPayments,
        paidThisMonth,
        pendingAmount,
        overdueAmount
      },
      verifiedPayments: verifiedPayments.slice(0, 50) // recent 50 verified ledger records
    };
  }
}

module.exports = RentCycleService;

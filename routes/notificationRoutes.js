const express = require('express');
const router = express.Router();
const NotificationService = require('../services/notificationService');
const { isLoggedIn } = require('../middleware/auth');

/**
 * GET /notifications
 * User in-app notifications hub
 */
router.get('/notifications', isLoggedIn, async (req, res, next) => {
  try {
    const notifications = await NotificationService.getUserNotifications(req.user._id);
    const unreadCount = await NotificationService.getUnreadCount(req.user._id);

    res.render('pages/notifications/index', {
      title: 'Notifications & Alerts | Nestly',
      activePage: 'notifications',
      notifications,
      unreadCount,
      user: req.user
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /notifications/:id/read
 * Mark notification as read
 */
router.post('/notifications/:id/read', isLoggedIn, async (req, res) => {
  try {
    await NotificationService.markAsRead(req.params.id, req.user._id);
    const returnUrl = req.headers.referer || '/notifications';
    res.redirect(returnUrl);
  } catch (err) {
    res.redirect('/notifications');
  }
});

/**
 * POST /notifications/read-all
 * Mark all notifications as read
 */
router.post('/notifications/read-all', isLoggedIn, async (req, res) => {
  try {
    await NotificationService.markAllAsRead(req.user._id);
    req.flash('success', 'All notifications marked as read.');
    res.redirect('/notifications');
  } catch (err) {
    res.redirect('/notifications');
  }
});

module.exports = router;

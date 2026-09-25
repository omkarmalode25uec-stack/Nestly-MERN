const Notification = require('../models/Notification');

class NotificationService {
  /**
   * Create an in-app notification safely
   */
  static async send({ recipient, sender = null, type = 'general', title, message, link = '' }) {
    if (!recipient || !title || !message) return null;
    try {
      const notification = new Notification({
        recipient,
        sender,
        type,
        title,
        message,
        link,
        isRead: false
      });
      await notification.save();
      return notification;
    } catch (err) {
      console.error('[NotificationService] Error creating notification:', err.message);
      return null;
    }
  }

  /**
   * Get unread notification count for user
   */
  static async getUnreadCount(userId) {
    if (!userId) return 0;
    try {
      return await Notification.countDocuments({ recipient: userId, isRead: false });
    } catch (err) {
      return 0;
    }
  }

  /**
   * Get user notifications with sender populated
   */
  static async getUserNotifications(userId, limit = 40) {
    if (!userId) return [];
    try {
      return await Notification.find({ recipient: userId })
        .populate('sender', 'name avatar role')
        .sort({ createdAt: -1 })
        .limit(limit);
    } catch (err) {
      console.error('[NotificationService] Error fetching notifications:', err.message);
      return [];
    }
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(notificationId, userId) {
    try {
      return await Notification.findOneAndUpdate(
        { _id: notificationId, recipient: userId },
        { isRead: true },
        { returnDocument: 'after' }
      );
    } catch (err) {
      return null;
    }
  }

  /**
   * Mark all as read
   */
  static async markAllAsRead(userId) {
    try {
      await Notification.updateMany({ recipient: userId, isRead: false }, { isRead: true });
      return true;
    } catch (err) {
      return false;
    }
  }
}

module.exports = NotificationService;

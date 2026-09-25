const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Chat = require('../models/Chat');
const Property = require('../models/Property');
const NotificationService = require('../services/notificationService');
const { isLoggedIn } = require('../middleware/auth');

/**
 * GET /chats
 * Inbox listing all active conversations for the authenticated user
 */
router.get('/chats', isLoggedIn, async (req, res, next) => {
  try {
    const isOwner = req.user.role === 'owner';
    const query = isOwner ? { owner: req.user._id } : { student: req.user._id };

    const chats = await Chat.find(query)
      .populate('student', 'name avatar college role')
      .populate('owner', 'name avatar role')
      .populate('property', 'title locality roomSharing price images isAvailable')
      .sort({ lastMessageAt: -1 });

    res.render('pages/chats/index', {
      title: 'Messages & Inquiries | Nestly',
      activePage: 'chats',
      chats,
      isOwner,
      user: req.user
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /chats/start?propertyId=...
 * Start or resume a conversation with a property host
 */
router.get('/chats/start', isLoggedIn, async (req, res, next) => {
  try {
    const { propertyId, topic = 'general' } = req.query;

    if (!propertyId || !mongoose.Types.ObjectId.isValid(propertyId)) {
      req.flash('error', 'Please select a valid property to chat with the host.');
      return res.redirect('/stays');
    }

    const property = await Property.findById(propertyId).populate('owner', 'name avatar role');
    if (!property) {
      req.flash('error', 'Accommodation listing not found.');
      return res.redirect('/stays');
    }

    if (property.owner && property.owner._id.equals(req.user._id)) {
      req.flash('info', 'You are the host of this property.');
      return res.redirect('/owner/dashboard');
    }

    // Check if an existing chat already exists between this student and owner for this property
    const existingChat = await Chat.findOne({
      student: req.user._id,
      owner: property.owner._id,
      property: property._id
    });

    if (existingChat) {
      return res.redirect(`/chats/${existingChat._id}`);
    }

    res.render('pages/chats/start', {
      title: `Chat with Host | ${property.title}`,
      activePage: 'chats',
      property,
      defaultTopic: topic,
      user: req.user
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /chats/start
 * Initiate new conversation and send first message
 */
router.post('/chats/start', isLoggedIn, async (req, res, next) => {
  try {
    const { propertyId, topic = 'general', message = '' } = req.body;

    if (!propertyId || !mongoose.Types.ObjectId.isValid(propertyId)) {
      req.flash('error', 'Invalid property reference.');
      return res.redirect('/stays');
    }

    const cleanMessage = String(message || '').trim();
    if (!cleanMessage || cleanMessage.length < 2) {
      req.flash('error', 'Please enter a message for the host.');
      return res.redirect(`/chats/start?propertyId=${propertyId}`);
    }

    if (cleanMessage.length > 1000) {
      req.flash('error', 'Message cannot exceed 1000 characters.');
      return res.redirect(`/chats/start?propertyId=${propertyId}`);
    }

    const validTopics = ['availability', 'rent', 'amenities', 'rules', 'location', 'booking-related questions', 'general'];
    const cleanTopic = validTopics.includes(topic) ? topic : 'general';

    const property = await Property.findById(propertyId);
    if (!property) {
      req.flash('error', 'Accommodation listing not found.');
      return res.redirect('/stays');
    }

    if (property.owner.equals(req.user._id)) {
      req.flash('error', 'You cannot message your own property.');
      return res.redirect('/owner/dashboard');
    }

    // Find existing or create new
    let chat = await Chat.findOne({
      student: req.user._id,
      owner: property.owner,
      property: property._id
    });

    const now = new Date();
    const firstMsg = {
      sender: req.user._id,
      senderRole: 'student',
      text: cleanMessage,
      createdAt: now,
      read: false
    };

    if (chat) {
      chat.messages.push(firstMsg);
      chat.lastMessage = cleanMessage;
      chat.lastMessageAt = now;
      chat.unreadByOwner = (chat.unreadByOwner || 0) + 1;
      chat.topic = cleanTopic;
      await chat.save();
    } else {
      chat = new Chat({
        student: req.user._id,
        owner: property.owner,
        property: property._id,
        topic: cleanTopic,
        messages: [firstMsg],
        lastMessage: cleanMessage,
        lastMessageAt: now,
        unreadByStudent: 0,
        unreadByOwner: 1
      });
      await chat.save();
    }

    // Send in-app notification to host
    await NotificationService.send({
      recipient: property.owner,
      sender: req.user._id,
      type: 'chat_message',
      title: `New Inquiry: ${property.title}`,
      message: `${req.user.name} sent an inquiry regarding ${cleanTopic}: "${cleanMessage.substring(0, 80)}${cleanMessage.length > 80 ? '...' : ''}"`,
      link: `/chats/${chat._id}`
    });

    req.flash('success', 'Your message has been sent to the host.');
    res.redirect(`/chats/${chat._id}`);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /chats/:id
 * View conversation thread
 */
router.get('/chats/:id', isLoggedIn, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error', 'Conversation not found.');
      return res.redirect('/chats');
    }

    const chat = await Chat.findById(id)
      .populate('student', 'name avatar college role')
      .populate('owner', 'name avatar role verificationStatus')
      .populate('property', 'title locality address roomSharing price images isAvailable');

    if (!chat) {
      req.flash('error', 'Conversation not found.');
      return res.redirect('/chats');
    }

    // Security Authorization: strictly participant or admin
    const isStudent = chat.student && chat.student._id.equals(req.user._id);
    const isOwner = chat.owner && chat.owner._id.equals(req.user._id);
    const isAdmin = req.user.role === 'admin';

    if (!isStudent && !isOwner && !isAdmin) {
      req.flash('error', 'Access denied. You are not a participant in this conversation.');
      return res.redirect('/chats');
    }

    // Mark messages as read for the current viewing user
    let modified = false;
    if (isStudent && chat.unreadByStudent > 0) {
      chat.unreadByStudent = 0;
      modified = true;
    }
    if (isOwner && chat.unreadByOwner > 0) {
      chat.unreadByOwner = 0;
      modified = true;
    }

    // Mark unread messages sent by the other party as read
    chat.messages.forEach(msg => {
      if (!msg.sender.equals(req.user._id) && !msg.read) {
        msg.read = true;
        modified = true;
      }
    });

    if (modified) {
      await chat.save();
    }

    res.render('pages/chats/show', {
      title: `Conversation | ${chat.property ? chat.property.title : 'Stay Inquiry'}`,
      activePage: 'chats',
      chat,
      isOwner,
      isStudent,
      user: req.user
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /chats/:id/message
 * Send a reply message in an existing conversation
 */
router.post('/chats/:id/message', isLoggedIn, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { message = '' } = req.body;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      req.flash('error', 'Conversation not found.');
      return res.redirect('/chats');
    }

    const cleanMessage = String(message || '').trim();
    if (!cleanMessage || cleanMessage.length < 1) {
      req.flash('error', 'Message cannot be empty.');
      return res.redirect(`/chats/${id}`);
    }

    if (cleanMessage.length > 1000) {
      req.flash('error', 'Message cannot exceed 1000 characters.');
      return res.redirect(`/chats/${id}`);
    }

    const chat = await Chat.findById(id).populate('property', 'title');
    if (!chat) {
      req.flash('error', 'Conversation not found.');
      return res.redirect('/chats');
    }

    const isStudent = chat.student.equals(req.user._id);
    const isOwner = chat.owner.equals(req.user._id);
    const isAdmin = req.user.role === 'admin';

    if (!isStudent && !isOwner && !isAdmin) {
      req.flash('error', 'Access denied.');
      return res.redirect('/chats');
    }

    // Basic anti-spam check: prevent duplicate message within 4 seconds
    const lastMsg = chat.messages[chat.messages.length - 1];
    if (lastMsg && lastMsg.sender.equals(req.user._id) && lastMsg.text === cleanMessage && (Date.now() - new Date(lastMsg.createdAt).getTime() < 4000)) {
      req.flash('info', 'Your message was already sent.');
      return res.redirect(`/chats/${id}`);
    }

    const senderRole = isOwner ? 'owner' : (isStudent ? 'student' : 'admin');
    const now = new Date();

    chat.messages.push({
      sender: req.user._id,
      senderRole,
      text: cleanMessage,
      createdAt: now,
      read: false
    });

    chat.lastMessage = cleanMessage;
    chat.lastMessageAt = now;

    if (isOwner) {
      chat.unreadByStudent = (chat.unreadByStudent || 0) + 1;
    } else {
      chat.unreadByOwner = (chat.unreadByOwner || 0) + 1;
    }

    await chat.save();

    // Send notification to recipient
    const recipientId = isOwner ? chat.student : chat.owner;
    const propertyTitle = chat.property ? chat.property.title : 'Stay';

    await NotificationService.send({
      recipient: recipientId,
      sender: req.user._id,
      type: 'chat_message',
      title: isOwner ? `Host Reply: ${propertyTitle}` : `New Message: ${propertyTitle}`,
      message: `${req.user.name}: "${cleanMessage.substring(0, 80)}${cleanMessage.length > 80 ? '...' : ''}"`,
      link: `/chats/${chat._id}`
    });

    res.redirect(`/chats/${id}`);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /chats/:id/report
 * Report a conversation for moderation review
 */
router.post('/chats/:id/report', isLoggedIn, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason = '' } = req.body;

    const chat = await Chat.findById(id);
    if (!chat) {
      req.flash('error', 'Conversation not found.');
      return res.redirect('/chats');
    }

    const isParticipant = chat.student.equals(req.user._id) || chat.owner.equals(req.user._id) || req.user.role === 'admin';
    if (!isParticipant) {
      req.flash('error', 'Access denied.');
      return res.redirect('/chats');
    }

    chat.isReported = true;
    chat.reportReason = String(reason || 'Inappropriate or abusive conversation').trim().substring(0, 500);
    chat.reportedBy = req.user._id;
    chat.reportedAt = new Date();
    await chat.save();

    req.flash('success', 'This conversation has been reported to Nestly moderation. We will investigate promptly.');
    res.redirect(`/chats/${id}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

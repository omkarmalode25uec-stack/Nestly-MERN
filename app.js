const express = require('express');
const path = require('path');
const dns = require('dns');
const ejsMate = require('ejs-mate');
const mongoose = require('mongoose');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const flash = require('connect-flash');
const passport = require('passport');
const LocalStrategy = require('passport-local');
const User = require('./models/User');
require('dotenv').config();

// Defensive DNS fallback for Windows local environments where c-ares may default to 127.0.0.1
if (process.platform === 'win32') {
  const currentServers = dns.getServers();
  if (currentServers.length === 1 && currentServers[0] === '127.0.0.1') {
    try {
      dns.setServers(['8.8.8.8', '1.1.1.1']);
    } catch (e) {}
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Primary Database Connection: MongoDB Atlas (process.env.ATLASDB_URL)
const DB_URL = process.env.ATLASDB_URL || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/nestly';

mongoose
  .connect(DB_URL)
  .then(async () => {
    const isAtlas = DB_URL.includes('mongodb.net');
    console.log(`[Database] Connected successfully to ${isAtlas ? 'MongoDB Atlas (Production)' : 'MongoDB (Local)'}`);
    try {
      let admin = await User.findOne({ email: 'admin@nestly.com' });
      if (!admin) {
        admin = new User({
          name: 'Nestly Administrator',
          email: 'admin@nestly.com',
          phone: '9822000000',
          role: 'admin',
          verificationStatus: 'verified'
        });
        await User.register(admin, 'admin123');
        console.log('[Admin Ready] Default platform administrator initialized: admin@nestly.com / admin123');
      }
    } catch (adminInitErr) {
      // Ignored if already initialized concurrently
    }
  })
  .catch((err) => console.log('MongoDB connection notice:', err.message));

// 2. View Engine Setup (EJS + EJS-Mate layout engine)
app.engine('ejs', ejsMate);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 3. Static Assets & Body Parsers
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const isProduction = process.env.NODE_ENV === 'production';

// In production behind reverse proxies (Render, Railway, Heroku, Nginx, Cloudflare), trust first proxy
if (isProduction) {
  app.set('trust proxy', 1);
  if (!process.env.SESSION_SECRET) {
    console.warn('[SECURITY WARNING] SESSION_SECRET is not set in production! Using fallback secret is strongly discouraged.');
  }
}

// 4. Session Configuration (Persistent sessions stored in MongoDB Atlas via connect-mongo)
const sessionSecret = process.env.SESSION_SECRET || 'nestly-learning-secret-session-key';

const store = MongoStore.create({
  mongoUrl: DB_URL,
  crypto: {
    secret: sessionSecret
  },
  touchAfter: 24 * 3600 // Lazy session update: update only once every 24 hours if unchanged
});

store.on('error', (err) => {
  console.log('[Session Store Notice]', err.message);
});

const sessionConfig = {
  store,
  name: 'nestly.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    expires: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
};
app.use(session(sessionConfig));

// 5. Connect Flash Messages
app.use(flash());

// 6. Passport Authentication Middleware
app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy({ usernameField: 'email' }, User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

const { getPrimaryServiceArea, getActiveLocationQueryFilter } = require('./config/serviceArea');

// 7. Global Template Context Middleware (Flash & Session locals)
app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.info = req.flash('info');
  res.locals.currentUser = req.user || null;
  res.locals.primaryServiceArea = getPrimaryServiceArea();
  res.locals.mapboxToken = process.env.MAPBOX_ACCESS_TOKEN || process.env.MAP_TOKEN || '';
  next();
});

// 8. Application Routes
const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const propertyRoutes = require('./routes/propertyRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const ownerRoutes = require('./routes/ownerRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const adminRoutes = require('./routes/adminRoutes');

const Property = require('./models/Property');

app.get('/', async (req, res, next) => {
  try {
    // Only return available & verified properties that belong to the active geographic scope (Kopargaon)
    const homeFilter = {
      isAvailable: true,
      isVerified: { $ne: false },
      ...getActiveLocationQueryFilter()
    };

    const featuredProperties = await Property.find(homeFilter)
      .populate('owner', 'name')
      .sort({ rating: -1, createdAt: -1 })
      .limit(6);

    res.render('pages/home', {
      title: 'Find A Place That Feels Like Home in Kopargaon | Nestly',
      activePage: 'home',
      featuredProperties
    });
  } catch (err) {
    next(err);
  }
});

app.use(authRoutes);
app.use(profileRoutes);
app.use(propertyRoutes);
app.use(bookingRoutes);
app.use(paymentRoutes);
app.use(reviewRoutes);
app.use('/owner', ownerRoutes);
app.use('/admin', adminRoutes);

// 9. 404 Not Found Handler
app.use((req, res, next) => {
  res.status(404).render('pages/error', {
    title: 'Page Not Found',
    statusCode: 404,
    message: 'The page or accommodation you are looking for does not exist or has been moved.'
  });
});

// 10. Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err.message || err);

  // 1. Handle Mongoose CastError (e.g. invalid MongoDB ObjectId in URL params)
  if (err.name === 'CastError' && err.kind === 'ObjectId') {
    return res.status(404).render('pages/error', {
      title: 'Resource Not Found',
      statusCode: 404,
      message: 'The requested accommodation or resource does not exist or has an invalid identifier.'
    });
  }

  // 2. Handle Mongoose ValidationError
  if (err.name === 'ValidationError') {
    const errorMessages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).render('pages/error', {
      title: 'Validation Error',
      statusCode: 400,
      message: errorMessages.join('. ') || 'Please correct the provided information.'
    });
  }

  // 3. General errors: ensure no raw stack traces or internal secrets leak to client
  const statusCode = err.status || err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';
  const message =
    statusCode === 500 && isProd
      ? 'An unexpected error occurred while processing your request. Please try again later.'
      : (err.message || 'An unexpected error occurred while processing your request.');

  res.status(statusCode).render('pages/error', {
    title: 'Error Encountered',
    statusCode,
    message
  });
});

// 11. Start Server
const server = app.listen(PORT, () => {
  console.log(`Nestly server running on http://localhost:${PORT}`);
});

// 12. Graceful Process Termination (Docker / PaaS / PM2)
const shutdown = async (signal) => {
  console.log(`[Shutdown] Received ${signal}. Closing HTTP server and MongoDB connection...`);
  server.close(async () => {
    try {
      await mongoose.connection.close();
      console.log('[Shutdown] MongoDB connection closed gracefully.');
      process.exit(0);
    } catch (err) {
      console.error('[Shutdown] Error during database shutdown:', err.message);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

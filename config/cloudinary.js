const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary SDK with environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'nestly_dev',
  api_key: process.env.CLOUDINARY_KEY || process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_SECRET || process.env.CLOUDINARY_API_SECRET
});

// Configure Multer Cloudinary Storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'nestly/properties',
    allowed_formats: ['jpeg', 'jpg', 'png', 'webp'],
    transformation: [{ width: 1280, height: 800, crop: 'limit', quality: 'auto' }]
  }
});

// File type filter: only accept valid image types
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, JPG, PNG, and WebP photos are permitted.'), false);
  }
};

// Multer upload middleware: max 10 files, 5MB each
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB max per image
  },
  fileFilter: fileFilter
});

/**
 * Safely delete a photo from Cloudinary by its public ID / filename
 */
async function deleteCloudinaryImage(filename) {
  if (!filename) return;
  try {
    const publicId = filename.startsWith('http')
      ? filename.split('/').slice(-2).join('/').split('.')[0]
      : filename;
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.warn('[Cloudinary] Could not delete asset:', err.message);
  }
}

module.exports = {
  cloudinary,
  storage,
  upload,
  deleteCloudinaryImage
};

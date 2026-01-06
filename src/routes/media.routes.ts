import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { MediaController } from '../controllers/media.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';
import { UploadService } from '../services/upload.service';

const router = express.Router();

// Public media routes
router.get(
    '/gallery',
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
        query('category').optional().isIn(['EVENT', 'GALLERY', 'SERMON', 'LIVE_STREAM']),
        query('tags').optional().isString(),
        query('sortBy').optional().isIn(['createdAt', 'filename']),
        query('sortOrder').optional().isIn(['asc', 'desc']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    MediaController.getPublicGallery
);

router.get(
    '/sermon-thumbnails',
    MediaController.getSermonThumbnails
);

router.get(
    '/event-gallery/:eventId',
    param('eventId').isUUID(),
    MediaController.getEventGallery
);

// Protected routes
router.use(authMiddleware);

// Upload media
router.post(
    '/upload',
    UploadService.getUploadMiddleware('user-uploads', {
        allowedMimeTypes: [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
            'video/mp4', 'video/mpeg', 'video/quicktime',
            'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg',
            'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain', 'application/json'
        ],
        maxFileSize: 100 * 1024 * 1024, // 100MB
    }).array('files', 10), // Max 10 files at once
    MediaController.uploadMedia
);

// User's media
router.get(
    '/my-uploads',
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
        query('category').optional().isIn(['PROFILE', 'DOCUMENT', 'GALLERY']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    MediaController.getMyUploads
);

router.delete(
    '/my-uploads/:mediaId',
    param('mediaId').isUUID(),
    MediaController.deleteMyMedia
);

// Admin routes
const adminRoutes = express.Router();
adminRoutes.use(roleMiddleware(['ADMIN', 'PASTOR', 'SUPER_ADMIN']));

// Media management
adminRoutes.get(
    '/',
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
        query('category').optional().isIn(['SERMON', 'EVENT', 'PROFILE', 'DOCUMENT', 'GALLERY', 'LIVE_STREAM']),
        query('uploadedById').optional().isUUID(),
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        query('tags').optional().isString(),
        query('search').optional().trim(),
        query('sortBy').optional().isIn(['createdAt', 'filename', 'size']),
        query('sortOrder').optional().isIn(['asc', 'desc']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    MediaController.getAllMedia
);

adminRoutes.get(
    '/:mediaId',
    param('mediaId').isUUID(),
    MediaController.getMediaById
);

adminRoutes.put(
    '/:mediaId',
    param('mediaId').isUUID(),
    [
        body('filename').optional().trim(),
        body('category').optional().isIn(['SERMON', 'EVENT', 'PROFILE', 'DOCUMENT', 'GALLERY', 'LIVE_STREAM']),
        body('tags').optional().isArray(),
        body('isPublic').optional().isBoolean(),
        body('description').optional().trim(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    MediaController.updateMedia
);

adminRoutes.delete(
    '/:mediaId',
    param('mediaId').isUUID(),
    MediaController.deleteMedia
);

// Bulk operations
adminRoutes.post(
    '/bulk-delete',
    body('mediaIds').isArray({ min: 1 }),
    body('mediaIds.*').isUUID(),
    MediaController.bulkDeleteMedia
);

adminRoutes.post(
    '/bulk-update',
    [
        body('mediaIds').isArray({ min: 1 }),
        body('mediaIds.*').isUUID(),
        body('updates').isObject(),
    ],
    MediaController.bulkUpdateMedia
);

// Upload for specific purposes
adminRoutes.post(
    '/upload/sermon/:sermonId',
    param('sermonId').isUUID(),
    UploadService.getUploadMiddleware('sermons', {
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maxFileSize: 10 * 1024 * 1024, // 10MB
    }).single('thumbnail'),
    MediaController.uploadSermonThumbnail
);

adminRoutes.post(
    '/upload/event/:eventId',
    param('eventId').isUUID(),
    UploadService.getUploadMiddleware('events', {
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maxFileSize: 10 * 1024 * 1024, // 10MB
    }).single('image'),
    MediaController.uploadEventImage
);

adminRoutes.post(
    '/upload/gallery',
    UploadService.getUploadMiddleware('gallery', {
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
        maxFileSize: 20 * 1024 * 1024, // 20MB
    }).array('images', 50), // Max 50 images
    MediaController.uploadGalleryImages
);

// Analytics
adminRoutes.get(
    '/analytics/storage',
    MediaController.getStorageAnalytics
);

adminRoutes.get(
    '/analytics/usage',
    [
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        query('groupBy').optional().isIn(['day', 'week', 'month', 'category', 'user']),
    ],
    MediaController.getMediaUsageAnalytics
);

// Export admin routes
router.use('/admin', adminRoutes);

export default router;
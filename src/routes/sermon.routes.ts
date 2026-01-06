import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { SermonController } from '../controllers/sermon.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';
import { UploadService } from '../services/upload.service';

const router = express.Router();

// Public routes
router.get(
    '/',
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
        query('preacher').optional().trim(),
        query('series').optional().trim(),
        query('tags').optional().isString(),
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        query('search').optional().trim(),
        query('sortBy').optional().isIn(['date', 'views', 'likes', 'createdAt']),
        query('sortOrder').optional().isIn(['asc', 'desc']),
        query('includeTranscript').optional().isBoolean(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    SermonController.getSermons
);

router.get(
    '/featured',
    SermonController.getFeaturedSermons
);

router.get(
    '/series',
    SermonController.getSermonSeries
);

router.get(
    '/:sermonId',
    param('sermonId').isUUID(),
    SermonController.getSermonById
);

router.post(
    '/:sermonId/view',
    param('sermonId').isUUID(),
    SermonController.incrementViews
);

router.post(
    '/:sermonId/like',
    param('sermonId').isUUID(),
    SermonController.toggleLike
);

// Download sermon
router.get(
    '/:sermonId/download/:type',
    param('sermonId').isUUID(),
    param('type').isIn(['audio', 'video', 'transcript']),
    SermonController.downloadSermon
);

// Protected routes (logged in users)
router.use(authMiddleware);

router.get(
    '/user/liked',
    SermonController.getLikedSermons
);

router.get(
    '/user/history',
    SermonController.getListeningHistory
);

// Admin routes
const adminRoutes = express.Router();
adminRoutes.use(roleMiddleware(['ADMIN', 'PASTOR', 'SUPER_ADMIN']));

// Sermon CRUD
adminRoutes.post(
    '/',
    [
        body('title').trim().notEmpty(),
        body('description').trim().notEmpty(),
        body('preacher').trim().notEmpty(),
        body('preacherId').optional().isUUID(),
        body('date').isISO8601(),
        body('duration').isInt({ min: 1 }),
        body('series').optional().trim(),
        body('biblePassage').optional().trim(),
        body('videoUrl').optional().isURL(),
        body('audioUrl').optional().isURL(),
        body('tags').optional().isArray(),
        body('isLive').optional().isBoolean(),
        body('liveStreamId').optional().isString(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    SermonController.createSermon
);

adminRoutes.put(
    '/:sermonId',
    param('sermonId').isUUID(),
    [
        body('title').optional().trim().notEmpty(),
        body('description').optional().trim().notEmpty(),
        body('preacher').optional().trim().notEmpty(),
        body('preacherId').optional().isUUID(),
        body('date').optional().isISO8601(),
        body('duration').optional().isInt({ min: 1 }),
        body('series').optional().trim(),
        body('biblePassage').optional().trim(),
        body('videoUrl').optional().isURL(),
        body('audioUrl').optional().isURL(),
        body('tags').optional().isArray(),
        body('isLive').optional().isBoolean(),
        body('liveStreamId').optional().isString(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    SermonController.updateSermon
);

adminRoutes.delete(
    '/:sermonId',
    param('sermonId').isUUID(),
    SermonController.deleteSermon
);

// Upload sermon media
adminRoutes.post(
    '/:sermonId/upload',
    param('sermonId').isUUID(),
    UploadService.getUploadMiddleware('sermons', {
        allowedMimeTypes: [
            'video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo',
            'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg',
            'application/pdf', 'text/plain'
        ],
        maxFileSize: 500 * 1024 * 1024, // 500MB for videos
    }).fields([
        { name: 'video', maxCount: 1 },
        { name: 'audio', maxCount: 1 },
        { name: 'thumbnail', maxCount: 1 },
        { name: 'transcript', maxCount: 1 },
    ]),
    SermonController.uploadSermonMedia
);

// Update transcript
adminRoutes.post(
    '/:sermonId/transcript',
    param('sermonId').isUUID(),
    body('transcript').trim().notEmpty(),
    SermonController.updateTranscript
);

// Analytics
adminRoutes.get(
    '/analytics/summary',
    [
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        query('preacher').optional().trim(),
    ],
    SermonController.getSermonAnalytics
);

adminRoutes.get(
    '/analytics/top',
    [
        query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
        query('period').optional().isIn(['day', 'week', 'month', 'year', 'all']),
    ],
    SermonController.getTopSermons
);

// Series management
adminRoutes.get(
    '/series/all',
    SermonController.getAllSeries
);

adminRoutes.post(
    '/series',
    [
        body('name').trim().notEmpty(),
        body('description').optional().trim(),
        body('image').optional().isURL(),
        body('startDate').optional().isISO8601(),
        body('endDate').optional().isISO8601(),
    ],
    SermonController.createSeries
);

adminRoutes.put(
    '/series/:seriesId',
    param('seriesId').isUUID(),
    [
        body('name').optional().trim().notEmpty(),
        body('description').optional().trim(),
        body('image').optional().isURL(),
        body('startDate').optional().isISO8601(),
        body('endDate').optional().isISO8601(),
    ],
    SermonController.updateSeries
);

adminRoutes.delete(
    '/series/:seriesId',
    param('seriesId').isUUID(),
    SermonController.deleteSeries
);

// Export admin routes
router.use('/admin', adminRoutes);

export default router;
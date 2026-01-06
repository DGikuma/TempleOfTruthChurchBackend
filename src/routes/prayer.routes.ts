import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { PrayerController } from '../controllers/prayer.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';

const router = express.Router();

// Public prayer wall (anonymous prayers)
router.get(
    '/public',
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
        query('category').optional().isIn(['HEALING', 'FINANCIAL', 'RELATIONSHIP', 'GUIDANCE', 'THANKSGIVING', 'OTHER']),
        query('sortBy').optional().isIn(['createdAt', 'prayerCount']),
        query('sortOrder').optional().isIn(['asc', 'desc']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    PrayerController.getPublicPrayers
);

// Submit prayer request (public)
router.post(
    '/submit',
    [
        body('title').trim().notEmpty(),
        body('description').trim().notEmpty(),
        body('category').isIn(['HEALING', 'FINANCIAL', 'RELATIONSHIP', 'GUIDANCE', 'THANKSGIVING', 'OTHER']),
        body('isAnonymous').optional().isBoolean(),
        body('isPublic').optional().isBoolean(),
        body('name').optional().trim(),
        body('email').optional().isEmail(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    PrayerController.submitPrayerRequest
);

// Protected routes
router.use(authMiddleware);

// User's prayer requests
router.get(
    '/my-requests',
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
        query('status').optional().isIn(['PENDING', 'PRAYED', 'ANSWERED']),
        query('category').optional().isIn(['HEALING', 'FINANCIAL', 'RELATIONSHIP', 'GUIDANCE', 'THANKSGIVING', 'OTHER']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    PrayerController.getMyPrayerRequests
);

router.post(
    '/my-requests',
    [
        body('title').trim().notEmpty(),
        body('description').trim().notEmpty(),
        body('category').isIn(['HEALING', 'FINANCIAL', 'RELATIONSHIP', 'GUIDANCE', 'THANKSGIVING', 'OTHER']),
        body('isAnonymous').optional().isBoolean(),
        body('isPublic').optional().isBoolean(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    PrayerController.createPrayerRequest
);

router.put(
    '/my-requests/:requestId',
    param('requestId').isUUID(),
    [
        body('title').optional().trim().notEmpty(),
        body('description').optional().trim().notEmpty(),
        body('category').optional().isIn(['HEALING', 'FINANCIAL', 'RELATIONSHIP', 'GUIDANCE', 'THANKSGIVING', 'OTHER']),
        body('isAnonymous').optional().isBoolean(),
        body('isPublic').optional().isBoolean(),
        body('status').optional().isIn(['PENDING', 'PRAYED', 'ANSWERED']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    PrayerController.updateMyPrayerRequest
);

router.delete(
    '/my-requests/:requestId',
    param('requestId').isUUID(),
    PrayerController.deleteMyPrayerRequest
);

// Pray for others
router.get(
    '/prayer-wall',
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
        query('category').optional().isIn(['HEALING', 'FINANCIAL', 'RELATIONSHIP', 'GUIDANCE', 'THANKSGIVING', 'OTHER']),
        query('status').optional().isIn(['PENDING', 'PRAYED', 'ANSWERED']),
        query('sortBy').optional().isIn(['createdAt', 'prayerCount']),
        query('sortOrder').optional().isIn(['asc', 'desc']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    PrayerController.getPrayerWall
);

router.get(
    '/prayer-wall/:requestId',
    param('requestId').isUUID(),
    PrayerController.getPrayerRequestById
);

router.post(
    '/prayer-wall/:requestId/pray',
    param('requestId').isUUID(),
    body('notes').optional().trim(),
    PrayerController.prayForRequest
);

router.get(
    '/prayer-wall/:requestId/prayers',
    param('requestId').isUUID(),
    PrayerController.getPrayerRequestPrayers
);

// Prayer groups
router.get(
    '/groups',
    PrayerController.getPrayerGroups
);

router.post(
    '/groups',
    [
        body('name').trim().notEmpty(),
        body('description').trim().notEmpty(),
        body('meetingDay').optional().trim(),
        body('meetingTime').optional().trim(),
        body('location').optional().trim(),
        body('isPrivate').optional().isBoolean(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    PrayerController.createPrayerGroup
);

router.get(
    '/groups/:groupId',
    param('groupId').isUUID(),
    PrayerController.getPrayerGroupById
);

router.put(
    '/groups/:groupId',
    param('groupId').isUUID(),
    [
        body('name').optional().trim().notEmpty(),
        body('description').optional().trim().notEmpty(),
        body('meetingDay').optional().trim(),
        body('meetingTime').optional().trim(),
        body('location').optional().trim(),
        body('isPrivate').optional().isBoolean(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    PrayerController.updatePrayerGroup
);

router.post(
    '/groups/:groupId/join',
    param('groupId').isUUID(),
    PrayerController.joinPrayerGroup
);

router.delete(
    '/groups/:groupId/leave',
    param('groupId').isUUID(),
    PrayerController.leavePrayerGroup
);

// Admin routes
const adminRoutes = express.Router();
adminRoutes.use(roleMiddleware(['ADMIN', 'PASTOR', 'SUPER_ADMIN']));

adminRoutes.get(
    '/all',
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
        query('status').optional().isIn(['PENDING', 'PRAYED', 'ANSWERED']),
        query('category').optional().isIn(['HEALING', 'FINANCIAL', 'RELATIONSHIP', 'GUIDANCE', 'THANKSGIVING', 'OTHER']),
        query('userId').optional().isUUID(),
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        query('isPublic').optional().isBoolean(),
        query('isAnonymous').optional().isBoolean(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    PrayerController.getAllPrayerRequests
);

adminRoutes.patch(
    '/:requestId/status',
    param('requestId').isUUID(),
    body('status').isIn(['PENDING', 'PRAYED', 'ANSWERED']),
    body('response').optional().trim(),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    PrayerController.updatePrayerRequestStatus
);

adminRoutes.delete(
    '/:requestId',
    param('requestId').isUUID(),
    PrayerController.deletePrayerRequest
);

adminRoutes.get(
    '/analytics/summary',
    [
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
    ],
    PrayerController.getPrayerAnalytics
);

adminRoutes.get(
    '/groups/all',
    PrayerController.getAllPrayerGroups
);

adminRoutes.delete(
    '/groups/:groupId',
    param('groupId').isUUID(),
    PrayerController.deletePrayerGroup
);

// Export admin routes
router.use('/admin', adminRoutes);

export default router;
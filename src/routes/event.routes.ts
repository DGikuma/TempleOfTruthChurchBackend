import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { EventController } from '../controllers/event.controller';
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
        query('category').optional().isIn(['WORSHIP', 'BIBLE_STUDY', 'FELLOWSHIP', 'OUTREACH', 'YOUTH', 'CHILDREN', 'MEN', 'WOMEN', 'SPECIAL']),
        query('status').optional().isIn(['UPCOMING', 'ONGOING', 'COMPLETED', 'CANCELLED']),
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        query('isOnline').optional().isBoolean(),
        query('search').optional().trim(),
        query('sortBy').optional().isIn(['startDate', 'title', 'createdAt']),
        query('sortOrder').optional().isIn(['asc', 'desc']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    EventController.getEvents
);

router.get(
    '/:eventId',
    param('eventId').isUUID(),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    EventController.getEventById
);

// Protected routes
router.use(authMiddleware);

// Event registration
router.post(
    '/:eventId/register',
    param('eventId').isUUID(),
    body('guests').optional().isInt({ min: 0, max: 10 }),
    body('notes').optional().trim(),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    EventController.registerForEvent
);

router.put(
    '/:eventId/registration',
    param('eventId').isUUID(),
    body('guests').optional().isInt({ min: 0, max: 10 }),
    body('notes').optional().trim(),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    EventController.updateRegistration
);

router.delete(
    '/:eventId/registration',
    param('eventId').isUUID(),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    EventController.cancelRegistration
);

router.get(
    '/:eventId/registration',
    param('eventId').isUUID(),
    EventController.getUserRegistration
);

router.get(
    '/user/registered',
    EventController.getUserRegisteredEvents
);

// Admin-only routes
const adminRoutes = express.Router();
adminRoutes.use(roleMiddleware(['ADMIN', 'PASTOR', 'SUPER_ADMIN']));

// Event CRUD
adminRoutes.post(
    '/',
    [
        body('title').trim().notEmpty(),
        body('description').trim().notEmpty(),
        body('shortDescription').optional().trim(),
        body('startDate').isISO8601(),
        body('endDate').optional().isISO8601(),
        body('location').trim().notEmpty(),
        body('venue').optional().trim(),
        body('isOnline').optional().isBoolean(),
        body('onlineLink').optional().isURL(),
        body('category').isIn(['WORSHIP', 'BIBLE_STUDY', 'FELLOWSHIP', 'OUTREACH', 'YOUTH', 'CHILDREN', 'MEN', 'WOMEN', 'SPECIAL']),
        body('maxAttendees').optional().isInt({ min: 1 }),
        body('isRegistrationRequired').optional().isBoolean(),
        body('registrationDeadline').optional().isISO8601(),
        body('status').optional().isIn(['UPCOMING', 'ONGOING', 'COMPLETED', 'CANCELLED']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    EventController.createEvent
);

adminRoutes.put(
    '/:eventId',
    param('eventId').isUUID(),
    [
        body('title').optional().trim().notEmpty(),
        body('description').optional().trim().notEmpty(),
        body('shortDescription').optional().trim(),
        body('startDate').optional().isISO8601(),
        body('endDate').optional().isISO8601(),
        body('location').optional().trim().notEmpty(),
        body('venue').optional().trim(),
        body('isOnline').optional().isBoolean(),
        body('onlineLink').optional().isURL(),
        body('category').optional().isIn(['WORSHIP', 'BIBLE_STUDY', 'FELLOWSHIP', 'OUTREACH', 'YOUTH', 'CHILDREN', 'MEN', 'WOMEN', 'SPECIAL']),
        body('maxAttendees').optional().isInt({ min: 1 }),
        body('isRegistrationRequired').optional().isBoolean(),
        body('registrationDeadline').optional().isISO8601(),
        body('status').optional().isIn(['UPCOMING', 'ONGOING', 'COMPLETED', 'CANCELLED']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    EventController.updateEvent
);

adminRoutes.delete(
    '/:eventId',
    param('eventId').isUUID(),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    EventController.deleteEvent
);

// Event image upload
adminRoutes.post(
    '/:eventId/image',
    param('eventId').isUUID(),
    UploadService.getUploadMiddleware('events', {
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maxFileSize: 5 * 1024 * 1024, // 5MB
    }).single('image'),
    EventController.uploadEventImage
);

// Event registrations management
adminRoutes.get(
    '/:eventId/registrations',
    param('eventId').isUUID(),
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
        query('status').optional().isIn(['PENDING', 'CONFIRMED', 'CANCELLED', 'WAITLIST']),
        query('search').optional().trim(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    EventController.getEventRegistrations
);

adminRoutes.patch(
    '/:eventId/registrations/:registrationId',
    param('eventId').isUUID(),
    param('registrationId').isUUID(),
    [
        body('status').isIn(['PENDING', 'CONFIRMED', 'CANCELLED', 'WAITLIST']),
        body('checkedIn').optional().isBoolean(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    EventController.updateRegistrationStatus
);

adminRoutes.post(
    '/:eventId/check-in',
    param('eventId').isUUID(),
    [
        body('userId').isUUID(),
        body('guests').optional().isInt({ min: 0, max: 10 }),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    EventController.checkInAttendee
);

adminRoutes.get(
    '/:eventId/stats',
    param('eventId').isUUID(),
    EventController.getEventStats
);

adminRoutes.get(
    '/analytics/summary',
    [
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        query('category').optional().isIn(['WORSHIP', 'BIBLE_STUDY', 'FELLOWSHIP', 'OUTREACH', 'YOUTH', 'CHILDREN', 'MEN', 'WOMEN', 'SPECIAL']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    EventController.getEventAnalytics
);

// Export admin routes
router.use('/admin', adminRoutes);

export default router;
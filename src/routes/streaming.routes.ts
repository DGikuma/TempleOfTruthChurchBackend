import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { StreamingController } from '../controllers/streaming.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';

const router = express.Router();

// Public streaming info
router.get(
    '/live',
    StreamingController.getLiveStreams
);

router.get(
    '/upcoming',
    StreamingController.getUpcomingStreams
);

router.get(
    '/:streamId/info',
    param('streamId').isUUID(),
    StreamingController.getStreamInfo
);

// WebSocket connection endpoint for live streams
router.get(
    '/:streamId/connect',
    param('streamId').isUUID(),
    StreamingController.getStreamConnectionInfo
);

// Chat history (public for past streams)
router.get(
    '/:streamId/chat/history',
    param('streamId').isUUID(),
    [
        query('limit').optional().isInt({ min: 1, max: 1000 }).toInt(),
        query('before').optional().isISO8601(),
    ],
    StreamingController.getChatHistory
);

// Protected routes for viewers
router.use(authMiddleware);

// Join/leave stream tracking
router.post(
    '/:streamId/join',
    param('streamId').isUUID(),
    StreamingController.joinStream
);

router.post(
    '/:streamId/leave',
    param('streamId').isUUID(),
    StreamingController.leaveStream
);

// Send chat message
router.post(
    '/:streamId/chat',
    param('streamId').isUUID(),
    body('message').trim().notEmpty(),
    body('type').optional().isIn(['message', 'prayer', 'question', 'testimony']),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    StreamingController.sendChatMessage
);

// Like/react to stream
router.post(
    '/:streamId/like',
    param('streamId').isUUID(),
    StreamingController.likeStream
);

// Ask question during Q&A
router.post(
    '/:streamId/questions',
    param('streamId').isUUID(),
    body('question').trim().notEmpty(),
    body('isAnonymous').optional().isBoolean(),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    StreamingController.submitQuestion
);

// Vote on poll
router.post(
    '/:streamId/polls/:pollId/vote',
    param('streamId').isUUID(),
    param('pollId').isUUID(),
    body('optionId').isUUID(),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    StreamingController.voteOnPoll
);

// Admin routes
const adminRoutes = express.Router();
adminRoutes.use(roleMiddleware(['ADMIN', 'PASTOR', 'SUPER_ADMIN']));

// Stream management
adminRoutes.post(
    '/create',
    [
        body('title').trim().notEmpty(),
        body('description').trim().notEmpty(),
        body('scheduledStartTime').isISO8601(),
        body('preacher').optional().trim(),
        body('preacherId').optional().isUUID(),
        body('category').optional().isIn(['SUNDAY_SERVICE', 'BIBLE_STUDY', 'PRAYER_MEETING', 'SPECIAL_EVENT', 'YOUTH', 'OTHER']),
        body('estimatedDuration').optional().isInt({ min: 1 }),
        body('isPublic').optional().isBoolean(),
        body('allowChat').optional().isBoolean(),
        body('allowQuestions').optional().isBoolean(),
        body('moderateChat').optional().isBoolean(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    StreamingController.createStream
);

adminRoutes.put(
    '/:streamId',
    param('streamId').isUUID(),
    [
        body('title').optional().trim().notEmpty(),
        body('description').optional().trim().notEmpty(),
        body('scheduledStartTime').optional().isISO8601(),
        body('preacher').optional().trim(),
        body('preacherId').optional().isUUID(),
        body('category').optional().isIn(['SUNDAY_SERVICE', 'BIBLE_STUDY', 'PRAYER_MEETING', 'SPECIAL_EVENT', 'YOUTH', 'OTHER']),
        body('estimatedDuration').optional().isInt({ min: 1 }),
        body('isPublic').optional().isBoolean(),
        body('allowChat').optional().isBoolean(),
        body('allowQuestions').optional().isBoolean(),
        body('moderateChat').optional().isBoolean(),
        body('status').optional().isIn(['SCHEDULED', 'LIVE', 'ENDING', 'ENDED', 'CANCELLED']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    StreamingController.updateStream
);

adminRoutes.delete(
    '/:streamId',
    param('streamId').isUUID(),
    StreamingController.deleteStream
);

adminRoutes.post(
    '/:streamId/start',
    param('streamId').isUUID(),
    StreamingController.startStream
);

adminRoutes.post(
    '/:streamId/end',
    param('streamId').isUUID(),
    StreamingController.endStream
);

// Stream configuration
adminRoutes.get(
    '/:streamId/config',
    param('streamId').isUUID(),
    StreamingController.getStreamConfig
);

adminRoutes.put(
    '/:streamId/config',
    param('streamId').isUUID(),
    [
        body('allowChat').optional().isBoolean(),
        body('allowQuestions').optional().isBoolean(),
        body('moderateChat').optional().isBoolean(),
        body('requireApproval').optional().isBoolean(),
        body('autoRecord').optional().isBoolean(),
        body('enablePolls').optional().isBoolean(),
        body('enableReactions').optional().isBoolean(),
        body('chatSlowMode').optional().isInt({ min: 0 }),
        body('maxMessageLength').optional().isInt({ min: 1, max: 1000 }),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    StreamingController.updateStreamConfig
);

// Chat moderation
adminRoutes.get(
    '/:streamId/chat/moderate',
    param('streamId').isUUID(),
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
        query('status').optional().isIn(['PENDING', 'APPROVED', 'REJECTED', 'DELETED']),
        query('type').optional().isIn(['message', 'question', 'prayer', 'testimony']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    StreamingController.getModerationQueue
);

adminRoutes.patch(
    '/:streamId/chat/:messageId/moderate',
    param('streamId').isUUID(),
    param('messageId').isUUID(),
    body('status').isIn(['APPROVED', 'REJECTED', 'DELETED']),
    body('reason').optional().trim(),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    StreamingController.moderateMessage
);

adminRoutes.delete(
    '/:streamId/chat/:messageId',
    param('streamId').isUUID(),
    param('messageId').isUUID(),
    StreamingController.deleteMessage
);

// Ban/block users from chat
adminRoutes.post(
    '/:streamId/ban',
    param('streamId').isUUID(),
    body('userId').isUUID(),
    body('reason').trim().notEmpty(),
    body('duration').optional().isInt({ min: 1 }), // in minutes
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    StreamingController.banUser
);

adminRoutes.post(
    '/:streamId/unban',
    param('streamId').isUUID(),
    body('userId').isUUID(),
    StreamingController.unbanUser
);

// Poll management
adminRoutes.post(
    '/:streamId/polls',
    param('streamId').isUUID(),
    [
        body('question').trim().notEmpty(),
        body('options').isArray({ min: 2, max: 6 }),
        body('options.*.text').trim().notEmpty(),
        body('isActive').optional().isBoolean(),
        body('duration').optional().isInt({ min: 30 }), // in seconds
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    StreamingController.createPoll
);

adminRoutes.put(
    '/:streamId/polls/:pollId',
    param('streamId').isUUID(),
    param('pollId').isUUID(),
    [
        body('question').optional().trim().notEmpty(),
        body('options').optional().isArray({ min: 2, max: 6 }),
        body('options.*.text').trim().notEmpty(),
        body('isActive').optional().isBoolean(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    StreamingController.updatePoll
);

adminRoutes.delete(
    '/:streamId/polls/:pollId',
    param('streamId').isUUID(),
    param('pollId').isUUID(),
    StreamingController.deletePoll
);

adminRoutes.post(
    '/:streamId/polls/:pollId/end',
    param('streamId').isUUID(),
    param('pollId').isUUID(),
    StreamingController.endPoll
);

adminRoutes.get(
    '/:streamId/polls/:pollId/results',
    param('streamId').isUUID(),
    param('pollId').isUUID(),
    StreamingController.getPollResults
);

// Questions management
adminRoutes.get(
    '/:streamId/questions',
    param('streamId').isUUID(),
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
        query('status').optional().isIn(['PENDING', 'ANSWERED', 'ARCHIVED']),
        query('sortBy').optional().isIn(['createdAt', 'votes']),
        query('sortOrder').optional().isIn(['asc', 'desc']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    StreamingController.getQuestions
);

adminRoutes.patch(
    '/:streamId/questions/:questionId',
    param('streamId').isUUID(),
    param('questionId').isUUID(),
    [
        body('status').isIn(['PENDING', 'ANSWERED', 'ARCHIVED']),
        body('answer').optional().trim(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    StreamingController.updateQuestion
);

// Analytics
adminRoutes.get(
    '/:streamId/analytics',
    param('streamId').isUUID(),
    StreamingController.getStreamAnalytics
);

adminRoutes.get(
    '/analytics/summary',
    [
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        query('groupBy').optional().isIn(['day', 'week', 'month', 'stream']),
    ],
    StreamingController.getStreamingAnalytics
);

// RTMP ingest info
adminRoutes.get(
    '/:streamId/ingest',
    param('streamId').isUUID(),
    StreamingController.getIngestInfo
);

// Export admin routes
router.use('/admin', adminRoutes);

export default router;
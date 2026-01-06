import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { AdminController } from '../controllers/admin.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authMiddleware);
router.use(roleMiddleware(['ADMIN', 'PASTOR', 'SUPER_ADMIN']));

// Dashboard statistics
router.get(
    '/dashboard/stats',
    [
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    AdminController.getDashboardStats
);

// User management
router.get(
    '/users/overview',
    AdminController.getUsersOverview
);

router.post(
    '/users/invite',
    [
        body('email').isEmail(),
        body('firstName').trim().notEmpty(),
        body('lastName').trim().notEmpty(),
        body('role').isIn(['MEMBER', 'LEADER', 'PASTOR']),
        body('sendEmail').optional().isBoolean(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    AdminController.inviteUser
);

router.post(
    '/users/bulk-import',
    AdminController.bulkImportUsers
);

router.get(
    '/users/export',
    AdminController.exportUsers
);

// Giving management
router.get(
    '/giving/overview',
    AdminController.getGivingOverview
);

router.post(
    '/giving/process-offline',
    [
        body('donations').isArray({ min: 1 }),
        body('donations.*.donorName').trim().notEmpty(),
        body('donations.*.amount').isFloat({ min: 0.01 }),
        body('donations.*.paymentMethod').isIn(['CASH', 'CHECK']),
        body('donations.*.date').isISO8601(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    AdminController.processOfflineDonations
);

// Attendance management
router.get(
    '/attendance/overview',
    [
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        query('eventId').optional().isUUID(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    AdminController.getAttendanceOverview
);

router.post(
    '/attendance/record',
    [
        body('eventId').isUUID(),
        body('userId').isUUID(),
        body('checkedInAt').optional().isISO8601(),
        body('guests').optional().isInt({ min: 0 }),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    AdminController.recordAttendance
);

router.post(
    '/attendance/bulk-record',
    AdminController.bulkRecordAttendance
);

// Communications
router.post(
    '/communications/announcement',
    [
        body('title').trim().notEmpty(),
        body('content').trim().notEmpty(),
        body('priority').isIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
        body('targetRoles').optional().isArray(),
        body('targetGroups').optional().isArray(),
        body('publishAt').optional().isISO8601(),
        body('sendEmail').optional().isBoolean(),
        body('sendPush').optional().isBoolean(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    AdminController.createAnnouncement
);

router.get(
    '/communications/announcements',
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
        query('status').optional().isIn(['DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    AdminController.getAnnouncements
);

router.post(
    '/communications/newsletter',
    [
        body('subject').trim().notEmpty(),
        body('content').trim().notEmpty(),
        body('target').isIn(['ALL', 'MEMBERS', 'GUESTS', 'SPECIFIC']),
        body('targetUsers').optional().isArray(),
        body('scheduleFor').optional().isISO8601(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    AdminController.createNewsletter
);

// Reports
router.get(
    '/reports/financial',
    [
        query('startDate').isISO8601(),
        query('endDate').isISO8601(),
        query('format').isIn(['pdf', 'excel', 'csv']),
        query('includeDetails').optional().isBoolean(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    AdminController.generateFinancialReport
);

router.get(
    '/reports/attendance',
    [
        query('startDate').isISO8601(),
        query('endDate').isISO8601(),
        query('format').isIn(['pdf', 'excel', 'csv']),
        query('groupBy').optional().isIn(['week', 'month', 'event']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    AdminController.generateAttendanceReport
);

router.get(
    '/reports/membership',
    [
        query('format').isIn(['pdf', 'excel', 'csv']),
        query('includeInactive').optional().isBoolean(),
    ],
    AdminController.generateMembershipReport
);

// System settings
router.get(
    '/settings',
    AdminController.getSystemSettings
);

router.put(
    '/settings',
    [
        body('settings').isObject(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    AdminController.updateSystemSettings
);

router.get(
    '/settings/email-templates',
    AdminController.getEmailTemplates
);

router.put(
    '/settings/email-templates/:templateId',
    param('templateId').isString(),
    body('content').trim().notEmpty(),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    AdminController.updateEmailTemplate
);

// Backup and restore
router.post(
    '/backup/create',
    AdminController.createBackup
);

router.get(
    '/backup/list',
    AdminController.listBackups
);

router.post(
    '/backup/restore',
    body('backupId').isString(),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    AdminController.restoreBackup
);

// Logs and monitoring
router.get(
    '/logs/access',
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
        query('userId').optional().isUUID(),
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        query('level').optional().isIn(['error', 'warn', 'info', 'debug']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    AdminController.getAccessLogs
);

router.get(
    '/logs/error',
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    AdminController.getErrorLogs
);

// Super admin only routes
const superAdminRouter = express.Router();
superAdminRouter.use(roleMiddleware(['SUPER_ADMIN']));

superAdminRouter.get(
    '/system/health',
    AdminController.getSystemHealth
);

superAdminRouter.post(
    '/system/maintenance',
    [
        body('enabled').isBoolean(),
        body('message').optional().trim(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    AdminController.toggleMaintenanceMode
);

superAdminRouter.post(
    '/system/cache/clear',
    body('cacheType').isIn(['all', 'redis', 'memory']),
    AdminController.clearCache
);

superAdminRouter.get(
    '/system/metrics',
    AdminController.getSystemMetrics
);

// Export super admin routes
router.use('/super', superAdminRouter);

export default router;
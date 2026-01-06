import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { DonationController } from '../controllers/donation.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';

const router = express.Router();

// Public donation endpoints
router.post(
    '/create-payment-intent',
    [
        body('amount').isFloat({ min: 1 }),
        body('currency').isIn(['USD', 'CAD', 'EUR', 'GBP']),
        body('donorName').trim().notEmpty(),
        body('donorEmail').isEmail(),
        body('designation').isIn(['GENERAL', 'MISSIONS', 'BUILDING', 'BENEVOLENCE', 'YOUTH', 'MEDIA', 'SPECIFIED']),
        body('frequency').isIn(['ONE_TIME', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']),
        body('specifiedDesignation').optional().trim(),
        body('anonymous').optional().isBoolean(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    DonationController.createPaymentIntent
);

router.post(
    '/create-paypal-order',
    [
        body('amount').isFloat({ min: 1 }),
        body('currency').isIn(['USD', 'CAD', 'EUR', 'GBP']),
        body('donorName').trim().notEmpty(),
        body('donorEmail').isEmail(),
        body('designation').isIn(['GENERAL', 'MISSIONS', 'BUILDING', 'BENEVOLENCE', 'YOUTH', 'MEDIA', 'SPECIFIED']),
        body('frequency').isIn(['ONE_TIME', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']),
        body('specifiedDesignation').optional().trim(),
        body('anonymous').optional().isBoolean(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    DonationController.createPayPalOrder
);

// Protected routes (donors)
router.use(authMiddleware);

router.get(
    '/my-donations',
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        query('status').optional().isIn(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    DonationController.getMyDonations
);

router.get(
    '/my-donations/:donationId',
    param('donationId').isUUID(),
    DonationController.getMyDonationById
);

router.get(
    '/my-donations/:donationId/receipt',
    param('donationId').isUUID(),
    DonationController.downloadReceipt
);

router.post(
    '/setup-recurring',
    [
        body('amount').isFloat({ min: 1 }),
        body('currency').isIn(['USD', 'CAD', 'EUR', 'GBP']),
        body('designation').isIn(['GENERAL', 'MISSIONS', 'BUILDING', 'BENEVOLENCE', 'YOUTH', 'MEDIA', 'SPECIFIED']),
        body('frequency').isIn(['MONTHLY', 'YEARLY']),
        body('paymentMethodId').notEmpty(),
        body('specifiedDesignation').optional().trim(),
        body('anonymous').optional().isBoolean(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    DonationController.setupRecurringDonation
);

router.delete(
    '/my-donations/recurring/:subscriptionId',
    param('subscriptionId').isString(),
    DonationController.cancelRecurringDonation
);

router.get(
    '/my-donations/tax-summary/:year',
    param('year').isInt({ min: 2000, max: 2100 }),
    DonationController.getTaxSummary
);

// Admin routes
const adminRoutes = express.Router();
adminRoutes.use(roleMiddleware(['ADMIN', 'PASTOR', 'SUPER_ADMIN']));

adminRoutes.get(
    '/',
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        query('userId').optional().isUUID(),
        query('status').optional().isIn(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED']),
        query('designation').optional().isIn(['GENERAL', 'MISSIONS', 'BUILDING', 'BENEVOLENCE', 'YOUTH', 'MEDIA', 'SPECIFIED']),
        query('frequency').optional().isIn(['ONE_TIME', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']),
        query('paymentMethod').optional().isIn(['STRIPE', 'PAYPAL', 'CASH', 'CHECK', 'BANK_TRANSFER', 'MOBILE_MONEY']),
        query('minAmount').optional().isFloat({ min: 0 }),
        query('maxAmount').optional().isFloat({ min: 0 }),
        query('search').optional().trim(),
        query('sortBy').optional().isIn(['amount', 'createdAt', 'donorName']),
        query('sortOrder').optional().isIn(['asc', 'desc']),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    DonationController.getAllDonations
);

adminRoutes.get(
    '/:donationId',
    param('donationId').isUUID(),
    DonationController.getDonationById
);

adminRoutes.patch(
    '/:donationId/status',
    param('donationId').isUUID(),
    body('status').isIn(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED']),
    body('notes').optional().trim(),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    DonationController.updateDonationStatus
);

adminRoutes.post(
    '/manual',
    [
        body('donorName').trim().notEmpty(),
        body('donorEmail').isEmail(),
        body('donorPhone').optional().isMobilePhone('any'),
        body('amount').isFloat({ min: 0.01 }),
        body('currency').isIn(['USD', 'CAD', 'EUR', 'GBP']),
        body('paymentMethod').isIn(['CASH', 'CHECK', 'BANK_TRANSFER', 'MOBILE_MONEY']),
        body('designation').isIn(['GENERAL', 'MISSIONS', 'BUILDING', 'BENEVOLENCE', 'YOUTH', 'MEDIA', 'SPECIFIED']),
        body('frequency').isIn(['ONE_TIME', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']),
        body('date').isISO8601(),
        body('notes').optional().trim(),
        body('anonymous').optional().isBoolean(),
        body('userId').optional().isUUID(),
    ],
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    DonationController.createManualDonation
);

adminRoutes.delete(
    '/:donationId',
    param('donationId').isUUID(),
    DonationController.deleteDonation
);

// Analytics
adminRoutes.get(
    '/analytics/summary',
    [
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601(),
        query('groupBy').optional().isIn(['day', 'week', 'month', 'year', 'designation', 'paymentMethod']),
    ],
    DonationController.getDonationAnalytics
);

adminRoutes.get(
    '/analytics/top-donors',
    [
        query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
        query('year').optional().isInt({ min: 2000, max: 2100 }),
    ],
    DonationController.getTopDonors
);

adminRoutes.get(
    '/analytics/recurring',
    DonationController.getRecurringDonationStats
);

adminRoutes.get(
    '/export',
    [
        query('startDate').isISO8601(),
        query('endDate').isISO8601(),
        query('format').isIn(['csv', 'excel', 'pdf']),
    ],
    DonationController.exportDonations
);

// Export admin routes
router.use('/admin', adminRoutes);

export default router;
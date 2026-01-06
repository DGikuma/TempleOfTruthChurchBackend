import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { UserController } from '../controllers/user.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/role.middleware';

const router = express.Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

// Validation middleware
const validateUpdateProfile = [
    body('firstName').optional().trim().notEmpty(),
    body('lastName').optional().trim().notEmpty(),
    body('phone').optional().isMobilePhone('any'),
    body('birthDate').optional().isISO8601(),
    body('gender').optional().isIn(['MALE', 'FEMALE', 'OTHER']),
    body('maritalStatus').optional().isIn(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']),
    body('baptismDate').optional().isISO8601(),
    body('membershipDate').optional().isISO8601(),
];

const validateUpdateAddress = [
    body('street').trim().notEmpty(),
    body('city').trim().notEmpty(),
    body('state').trim().notEmpty(),
    body('zipCode').trim().notEmpty(),
    body('country').optional().trim(),
    body('coordinates').optional().isString(),
];

const validateUserQuery = [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('search').optional().trim(),
    query('role').optional().isIn(['SUPER_ADMIN', 'ADMIN', 'PASTOR', 'LEADER', 'MEMBER', 'GUEST']),
    query('status').optional().isIn(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING']),
    query('sortBy').optional().isIn(['firstName', 'lastName', 'email', 'createdAt', 'membershipDate']),
    query('sortOrder').optional().isIn(['asc', 'desc']),
];

// Profile routes
router.get('/profile', UserController.getProfile);

router.put(
    '/profile',
    validateUpdateProfile,
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    UserController.updateProfile
);

router.put(
    '/profile/address',
    validateUpdateAddress,
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    UserController.updateAddress
);

router.post('/profile/avatar', UserController.uploadAvatar);

router.delete('/profile/avatar', UserController.deleteAvatar);

// Family members
router.get('/family', UserController.getFamilyMembers);
router.post('/family', UserController.addFamilyMember);
router.delete('/family/:memberId', UserController.removeFamilyMember);

// Group memberships
router.get('/groups', UserController.getUserGroups);

// Serving roles
router.get('/serving-roles', UserController.getServingRoles);

// Admin-only routes
router.get(
    '/',
    roleMiddleware(['ADMIN', 'PASTOR', 'SUPER_ADMIN']),
    validateUserQuery,
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    UserController.getAllUsers
);

router.get(
    '/:userId',
    roleMiddleware(['ADMIN', 'PASTOR', 'SUPER_ADMIN']),
    param('userId').isUUID(),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    UserController.getUserById
);

router.put(
    '/:userId',
    roleMiddleware(['ADMIN', 'SUPER_ADMIN']),
    param('userId').isUUID(),
    validateUpdateProfile,
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    UserController.updateUser
);

router.patch(
    '/:userId/role',
    roleMiddleware(['ADMIN', 'SUPER_ADMIN']),
    param('userId').isUUID(),
    body('role').isIn(['SUPER_ADMIN', 'ADMIN', 'PASTOR', 'LEADER', 'MEMBER', 'GUEST']),
    body('status').optional().isIn(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING']),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    UserController.updateUserRole
);

router.delete(
    '/:userId',
    roleMiddleware(['SUPER_ADMIN']),
    param('userId').isUUID(),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
    UserController.deleteUser
);

router.get(
    '/:userId/activity',
    roleMiddleware(['ADMIN', 'PASTOR', 'SUPER_ADMIN']),
    param('userId').isUUID(),
    UserController.getUserActivity
);

router.get(
    '/stats/summary',
    roleMiddleware(['ADMIN', 'PASTOR', 'SUPER_ADMIN']),
    UserController.getUserStats
);

export default router;
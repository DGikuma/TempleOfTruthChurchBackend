import express from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import eventRoutes from './event.routes';
import sermonRoutes from './sermon.routes';
import donationRoutes from './donation.routes';
import prayerRoutes from './prayer.routes';
import mediaRoutes from './media.routes';
import streamingRoutes from './streaming.routes';
import adminRoutes from './admin.routes';
import webhookRoutes from './webhook.routes';

const router = express.Router();

// API documentation
router.get('/', (req, res) => {
    res.json({
        message: 'GracePoint Church API',
        version: '1.0.0',
        endpoints: {
            auth: '/api/auth',
            users: '/api/users',
            events: '/api/events',
            sermons: '/api/sermons',
            donations: '/api/donations',
            prayers: '/api/prayers',
            media: '/api/media',
            streaming: '/api/streaming',
            admin: '/api/admin',
            webhooks: '/api/webhooks',
        },
        documentation: 'https://docs.gracepointchurch.org/api',
        status: 'operational',
        timestamp: new Date().toISOString(),
    });
});

// Health check
router.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
    });
});

// Mount routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/events', eventRoutes);
router.use('/sermons', sermonRoutes);
router.use('/donations', donationRoutes);
router.use('/prayers', prayerRoutes);
router.use('/media', mediaRoutes);
router.use('/streaming', streamingRoutes);
router.use('/admin', adminRoutes);
router.use('/webhooks', webhookRoutes);

// 404 handler for API routes
router.use('*', (req, res) => {
    res.status(404).json({
        status: 'error',
        message: `API endpoint ${req.originalUrl} not found`,
        suggestion: 'Check the API documentation at /api',
    });
});

export default router;
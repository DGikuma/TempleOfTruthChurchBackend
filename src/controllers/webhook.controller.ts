import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import logger from '../utils/logger';
import { PaymentService } from '../services/payment.service';
import { sendEmail } from '../services/email.service';

export class WebhookController {
    static async handleStripeWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const signature = req.headers['stripe-signature'] as string;

            // Process webhook
            await PaymentService.handleStripeWebhook(req.body, signature);

            res.status(200).json({ received: true });
        } catch (error: any) {
            logger.error('Stripe webhook error:', error);
            res.status(400).json({ error: error.message });
        }
    }

    static async handlePayPalWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            // PayPal webhook verification would go here
            const event = req.body;

            // Log webhook for now
            logger.info('PayPal webhook received:', event);

            // Process based on event type
            switch (event.event_type) {
                case 'PAYMENT.CAPTURE.COMPLETED':
                    // Handle completed payment
                    break;
                case 'PAYMENT.CAPTURE.DENIED':
                    // Handle denied payment
                    break;
                case 'BILLING.SUBSCRIPTION.CREATED':
                    // Handle subscription created
                    break;
                case 'BILLING.SUBSCRIPTION.CANCELLED':
                    // Handle subscription cancelled
                    break;
            }

            res.status(200).json({ received: true });
        } catch (error) {
            logger.error('PayPal webhook error:', error);
            res.status(400).json({ error: 'Webhook processing failed' });
        }
    }

    static async handleTwilioSMS(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { From, Body, To } = req.body;

            // Log SMS
            logger.info('Twilio SMS received:', { from: From, body: Body, to: To });

            // Process SMS (prayer requests, event RSVP, etc.)
            if (Body.toLowerCase().includes('pray')) {
                // Handle prayer request via SMS
                await this.handleSmsPrayerRequest(From, Body);
            }

            // Send automated response
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Message>Thank you for your message. We'll get back to you soon!</Message>
        </Response>`;

            res.type('text/xml');
            res.send(twiml);
        } catch (error) {
            logger.error('Twilio SMS webhook error:', error);
            res.status(400).json({ error: 'SMS processing failed' });
        }
    }

    private static async handleSmsPrayerRequest(from: string, body: string): Promise<void> {
        try {
            // Extract phone number and message
            const phone = from.replace('+', '');
            const message = body.replace(/pray/i, '').trim();

            // Find user by phone
            const user = await prisma.user.findFirst({
                where: { phone },
            });

            // Create prayer request
            await prisma.prayerRequest.create({
                data: {
                    title: 'SMS Prayer Request',
                    description: message,
                    category: 'OTHER',
                    isAnonymous: !user,
                    isPublic: false,
                    userId: user?.id,
                },
            });

            logger.info('SMS prayer request processed:', { phone, userId: user?.id });
        } catch (error) {
            logger.error('Error processing SMS prayer request:', error);
        }
    }

    static async handleTwilioVoice(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            // Handle incoming call
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say voice="alice">
            Thank you for calling GracePoint Church. Our office hours are Monday through Friday, 9 AM to 5 PM.
            Please leave a message after the beep.
          </Say>
          <Record maxLength="30" action="/api/webhooks/twilio/voice/recording" />
          <Say>I did not receive a recording. Goodbye.</Say>
        </Response>`;

            res.type('text/xml');
            res.send(twiml);
        } catch (error) {
            logger.error('Twilio voice webhook error:', error);
            res.status(400).json({ error: 'Voice processing failed' });
        }
    }

    static async handleGoogleCalendarWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { channelId, resourceId } = req.query;

            // Verify this is a valid webhook
            const subscription = await prisma.calendarSubscription.findUnique({
                where: { channelId: channelId as string },
            });

            if (!subscription) {
                res.status(404).json({ error: 'Subscription not found' });
                return;
            }

            // Sync calendar events
            await this.syncCalendarEvents();

            res.status(200).json({ received: true });
        } catch (error) {
            logger.error('Google Calendar webhook error:', error);
            res.status(400).json({ error: 'Calendar sync failed' });
        }
    }

    private static async syncCalendarEvents(): Promise<void> {
        // Sync events from Google Calendar to database
        logger.info('Syncing calendar events');
        // Implementation would go here
    }

    static async handleYouTubeWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const event = req.body;

            // Handle YouTube live stream events
            if (event.message?.data) {
                const data = JSON.parse(Buffer.from(event.message.data, 'base64').toString());

                switch (data.event) {
                    case 'liveBroadcastStarted':
                        // Update stream status
                        await this.updateStreamStatus(data.broadcastId, 'LIVE');
                        break;
                    case 'liveBroadcastEnded':
                        // Update stream status
                        await this.updateStreamStatus(data.broadcastId, 'ENDED');
                        break;
                }
            }

            res.status(200).json({ received: true });
        } catch (error) {
            logger.error('YouTube webhook error:', error);
            res.status(400).json({ error: 'YouTube webhook processing failed' });
        }
    }

    private static async updateStreamStatus(broadcastId: string, status: string): Promise<void> {
        try {
            // Find sermon with this broadcast ID
            const sermon = await prisma.sermon.findFirst({
                where: { liveStreamId: broadcastId },
            });

            if (sermon) {
                await prisma.sermon.update({
                    where: { id: sermon.id },
                    data: {
                        isLive: status === 'LIVE',
                    },
                });

                logger.info(`Updated stream status: ${broadcastId} -> ${status}`);
            }
        } catch (error) {
            logger.error('Error updating stream status:', error);
        }
    }

    static async handleSendGridWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const events = req.body;

            if (!Array.isArray(events)) {
                res.status(400).json({ error: 'Invalid webhook data' });
                return;
            }

            for (const event of events) {
                // Update email tracking
                await prisma.emailEvent.create({
                    data: {
                        emailId: event.sg_message_id,
                        event: event.event,
                        recipient: event.email,
                        timestamp: new Date(event.timestamp * 1000),
                        metadata: event,
                    },
                });

                // Update newsletter statistics if applicable
                if (event.newsletter_id) {
                    await this.updateNewsletterStats(event);
                }
            }

            res.status(200).json({ received: true });
        } catch (error) {
            logger.error('SendGrid webhook error:', error);
            res.status(400).json({ error: 'Email webhook processing failed' });
        }
    }

    private static async updateNewsletterStats(event: any): Promise<void> {
        try {
            const update: any = {};

            switch (event.event) {
                case 'delivered':
                    update.deliveredCount = { increment: 1 };
                    break;
                case 'open':
                    update.openedCount = { increment: 1 };
                    break;
                case 'click':
                    update.clickedCount = { increment: 1 };
                    break;
                case 'bounce':
                    update.bouncedCount = { increment: 1 };
                    break;
                case 'spamreport':
                    update.spamReportCount = { increment: 1 };
                    break;
                case 'unsubscribe':
                    update.unsubscribedCount = { increment: 1 };
                    break;
            }

            if (Object.keys(update).length > 0) {
                await prisma.newsletter.update({
                    where: { id: event.newsletter_id },
                    data: update,
                });
            }
        } catch (error) {
            logger.error('Error updating newsletter stats:', error);
        }
    }

    static async handleMailgunWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const event = req.body['event-data'];

            // Similar to SendGrid webhook processing
            await prisma.emailEvent.create({
                data: {
                    emailId: event.message?.headers['message-id'],
                    event: event.event,
                    recipient: event.recipient,
                    timestamp: new Date(event.timestamp * 1000),
                    metadata: event,
                },
            });

            res.status(200).json({ received: true });
        } catch (error) {
            logger.error('Mailgun webhook error:', error);
            res.status(400).json({ error: 'Mailgun webhook processing failed' });
        }
    }

    static async handleGitHubWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const event = req.headers['x-github-event'] as string;
            const payload = req.body;

            // Handle GitHub webhooks for deployment/CI
            switch (event) {
                case 'push':
                    // Handle code push
                    await this.handleGitHubPush(payload);
                    break;
                case 'pull_request':
                    // Handle pull request
                    await this.handleGitHubPullRequest(payload);
                    break;
                case 'deployment':
                    // Handle deployment
                    await this.handleGitHubDeployment(payload);
                    break;
            }

            res.status(200).json({ received: true });
        } catch (error) {
            logger.error('GitHub webhook error:', error);
            res.status(400).json({ error: 'GitHub webhook processing failed' });
        }
    }

    private static async handleGitHubPush(payload: any): Promise<void> {
        // Handle code push - trigger build/deployment
        logger.info('GitHub push received:', {
            repo: payload.repository.full_name,
            branch: payload.ref,
            commits: payload.commits?.length,
        });
    }

    private static async handleGitHubPullRequest(payload: any): Promise<void> {
        // Handle pull request
        logger.info('GitHub pull request:', {
            action: payload.action,
            number: payload.pull_request.number,
            title: payload.pull_request.title,
        });
    }

    private static async handleGitHubDeployment(payload: any): Promise<void> {
        // Handle deployment
        logger.info('GitHub deployment:', {
            environment: payload.deployment.environment,
            ref: payload.deployment.ref,
            creator: payload.deployment.creator.login,
        });
    }

    static async handleCustomWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { integrationId } = req.params;
            const payload = req.body;

            // Find integration
            const integration = await prisma.integration.findUnique({
                where: { id: integrationId },
            });

            if (!integration || !integration.isActive) {
                res.status(404).json({ error: 'Integration not found or inactive' });
                return;
            }

            // Process based on integration type
            switch (integration.type) {
                case 'SLACK':
                    await this.handleSlackWebhook(integration, payload);
                    break;
                case 'DISCORD':
                    await this.handleDiscordWebhook(integration, payload);
                    break;
                case 'ZAPIER':
                    await this.handleZapierWebhook(integration, payload);
                    break;
                case 'MAKE':
                    await this.handleMakeWebhook(integration, payload);
                    break;
            }

            // Log webhook
            await prisma.webhookLog.create({
                data: {
                    integrationId,
                    payload: JSON.stringify(payload),
                    status: 'PROCESSED',
                },
            });

            res.status(200).json({ received: true });
        } catch (error) {
            logger.error('Custom webhook error:', error);

            // Log failed webhook
            if (req.params.integrationId) {
                await prisma.webhookLog.create({
                    data: {
                        integrationId: req.params.integrationId,
                        payload: JSON.stringify(req.body),
                        status: 'FAILED',
                        error: error.message,
                    },
                });
            }

            res.status(400).json({ error: 'Custom webhook processing failed' });
        }
    }

    private static async handleSlackWebhook(integration: any, payload: any): Promise<void> {
        // Handle Slack webhook
        logger.info('Slack webhook processed:', { integration: integration.name });
    }

    private static async handleDiscordWebhook(integration: any, payload: any): Promise<void> {
        // Handle Discord webhook
        logger.info('Discord webhook processed:', { integration: integration.name });
    }

    private static async handleZapierWebhook(integration: any, payload: any): Promise<void> {
        // Handle Zapier webhook
        logger.info('Zapier webhook processed:', { integration: integration.name });
    }

    private static async handleMakeWebhook(integration: any, payload: any): Promise<void> {
        // Handle Make (Integromat) webhook
        logger.info('Make webhook processed:', { integration: integration.name });
    }

    static async verifyWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { webhookId } = req.params;

            const webhook = await prisma.webhookConfig.findUnique({
                where: { id: webhookId },
            });

            if (!webhook) {
                res.status(404).json({
                    status: 'error',
                    message: 'Webhook not found',
                });
                return;
            }

            // Return verification info
            res.status(200).json({
                status: 'success',
                data: {
                    webhook,
                    verification: {
                        url: `${process.env.BACKEND_URL}/api/webhooks/${webhook.type.toLowerCase()}`,
                        secret: webhook.secret,
                        events: webhook.events,
                    },
                },
            });
        } catch (error) {
            next(error);
        }
    }

    static async getWebhookLogs(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const {
                page = 1,
                limit = 20,
                source,
                status,
                startDate,
                endDate,
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            const filter: any = {};

            if (source) filter.source = source;
            if (status) filter.status = status;

            if (startDate || endDate) {
                filter.createdAt = {};
                if (startDate) filter.createdAt.gte = new Date(startDate as string);
                if (endDate) filter.createdAt.lte = new Date(endDate as string);
            }

            const total = await prisma.webhookLog.count({ where: filter });

            const logs = await prisma.webhookLog.findMany({
                where: filter,
                include: {
                    integration: {
                        select: {
                            name: true,
                            type: true,
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: Number(limit),
            });

            res.status(200).json({
                status: 'success',
                data: {
                    logs,
                    pagination: {
                        page: Number(page),
                        limit: Number(limit),
                        total,
                        pages: Math.ceil(total / Number(limit)),
                    },
                },
            });
        } catch (error) {
            next(error);
        }
    }
}
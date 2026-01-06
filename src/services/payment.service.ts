// src/services/payment.service.ts
import Stripe from 'stripe';
import paypal from '@paypal/checkout-server-sdk';
import config from '../config';
import logger from '../utils/logger';
import prisma from '../config/database';

interface PaymentIntentInput {
    amount: number;
    currency: string;
    donorName: string;
    donorEmail: string;
    designation: string;
    frequency: 'one-time' | 'monthly' | 'yearly';
    userId?: string;
    metadata?: Record<string, any>;
}

interface PaymentResult {
    success: boolean;
    transactionId?: string;
    clientSecret?: string;
    approvalUrl?: string;
    error?: string;
}

export class PaymentService {
    private static stripe = new Stripe(config.stripeSecretKey, {
        apiVersion: '2023-08-16',
    });

    private static paypalClient = new paypal.core.PayPalHttpClient(
        new paypal.core.SandboxEnvironment(
            config.paypalClientId,
            config.paypalClientSecret
        )
    );

    static async createStripePaymentIntent(input: PaymentIntentInput): Promise<PaymentResult> {
        try {
            // Generate receipt number
            const receiptNumber = `GPC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // Create Stripe customer if user exists
            let customerId: string | undefined;

            if (input.userId) {
                const user = await prisma.user.findUnique({
                    where: { id: input.userId },
                    select: { email: true, stripeCustomerId: true },
                });

                if (user) {
                    if (user.stripeCustomerId) {
                        customerId = user.stripeCustomerId;
                    } else {
                        const customer = await this.stripe.customers.create({
                            email: user.email,
                            name: input.donorName,
                            metadata: {
                                userId: input.userId,
                            },
                        });
                        customerId = customer.id;

                        // Update user with Stripe customer ID
                        await prisma.user.update({
                            where: { id: input.userId },
                            data: { stripeCustomerId: customerId },
                        });
                    }
                }
            }

            // Create payment intent
            const paymentIntent = await this.stripe.paymentIntents.create({
                amount: Math.round(input.amount * 100), // Convert to cents
                currency: input.currency.toLowerCase(),
                customer: customerId,
                metadata: {
                    ...input.metadata,
                    donorName: input.donorName,
                    donorEmail: input.donorEmail,
                    designation: input.designation,
                    frequency: input.frequency,
                    receiptNumber,
                    userId: input.userId || 'anonymous',
                },
                description: `Donation to GracePoint Church - ${input.designation}`,
                automatic_payment_methods: {
                    enabled: true,
                },
            });

            // Create donation record in database
            await prisma.donation.create({
                data: {
                    amount: input.amount,
                    currency: input.currency,
                    donorName: input.donorName,
                    donorEmail: input.donorEmail,
                    paymentMethod: 'STRIPE',
                    status: 'PENDING',
                    transactionId: paymentIntent.id,
                    receiptNumber,
                    designation: input.designation,
                    frequency: input.frequency,
                    userId: input.userId,
                    metadata: input.metadata,
                },
            });

            return {
                success: true,
                transactionId: paymentIntent.id,
                clientSecret: paymentIntent.client_secret,
            };
        } catch (error: any) {
            logger.error('Stripe payment intent creation failed:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    static async createPayPalOrder(input: PaymentIntentInput): Promise<PaymentResult> {
        try {
            const receiptNumber = `GPC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            const request = new paypal.orders.OrdersCreateRequest();
            request.prefer('return=representation');
            request.requestBody({
                intent: 'CAPTURE',
                purchase_units: [
                    {
                        amount: {
                            currency_code: input.currency,
                            value: input.amount.toFixed(2),
                        },
                        description: `Donation to GracePoint Church - ${input.designation}`,
                        custom_id: receiptNumber,
                        invoice_id: receiptNumber,
                    },
                ],
                application_context: {
                    brand_name: 'GracePoint Church',
                    landing_page: 'BILLING',
                    user_action: 'PAY_NOW',
                    return_url: `${config.frontendUrl}/giving/thank-you`,
                    cancel_url: `${config.frontendUrl}/giving/cancel`,
                },
            });

            const order = await this.paypalClient.execute(request);

            // Create donation record
            await prisma.donation.create({
                data: {
                    amount: input.amount,
                    currency: input.currency,
                    donorName: input.donorName,
                    donorEmail: input.donorEmail,
                    paymentMethod: 'PAYPAL',
                    status: 'PENDING',
                    transactionId: order.result.id,
                    receiptNumber,
                    designation: input.designation,
                    frequency: input.frequency,
                    userId: input.userId,
                    metadata: input.metadata,
                },
            });

            return {
                success: true,
                transactionId: order.result.id,
                approvalUrl: order.result.links.find((link: any) => link.rel === 'approve')?.href,
            };
        } catch (error: any) {
            logger.error('PayPal order creation failed:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    static async handleStripeWebhook(payload: Buffer, signature: string): Promise<void> {
        try {
            const event = this.stripe.webhooks.constructEvent(
                payload,
                signature,
                config.stripeWebhookSecret
            );

            switch (event.type) {
                case 'payment_intent.succeeded':
                    await this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
                    break;

                case 'payment_intent.payment_failed':
                    await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
                    break;

                case 'invoice.payment_succeeded':
                    await this.handleSubscriptionPayment(event.data.object as Stripe.Invoice);
                    break;

                case 'customer.subscription.created':
                    await this.handleSubscriptionCreated(event.data.object as Stripe.Subscription);
                    break;

                case 'customer.subscription.deleted':
                    await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
                    break;

                default:
                    logger.info(`Unhandled event type: ${event.type}`);
            }
        } catch (error: any) {
            logger.error('Stripe webhook error:', error);
            throw error;
        }
    }

    private static async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
        const { metadata, amount } = paymentIntent;

        // Update donation status
        await prisma.donation.updateMany({
            where: {
                transactionId: paymentIntent.id,
                status: 'PENDING',
            },
            data: {
                status: 'COMPLETED',
                updatedAt: new Date(),
            },
        });

        // Send receipt email
        await this.sendReceiptEmail({
            donorEmail: metadata?.donorEmail || '',
            donorName: metadata?.donorName || '',
            amount: amount / 100, // Convert from cents
            currency: paymentIntent.currency.toUpperCase(),
            transactionId: paymentIntent.id,
            receiptNumber: metadata?.receiptNumber || '',
            designation: metadata?.designation || 'General',
        });

        // Update giving analytics
        await this.updateGivingAnalytics(amount / 100);

        logger.info(`Payment succeeded: ${paymentIntent.id}`);
    }

    private static async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
        await prisma.donation.updateMany({
            where: {
                transactionId: paymentIntent.id,
            },
            data: {
                status: 'FAILED',
                updatedAt: new Date(),
            },
        });

        logger.warn(`Payment failed: ${paymentIntent.id}`);
    }

    private static async handleSubscriptionPayment(invoice: Stripe.Invoice): Promise<void> {
        if (invoice.subscription && invoice.customer) {
            const subscription = await this.stripe.subscriptions.retrieve(
                invoice.subscription as string
            );

            // Create recurring donation record
            await prisma.donation.create({
                data: {
                    amount: invoice.amount_paid / 100,
                    currency: invoice.currency.toUpperCase(),
                    donorName: invoice.customer_name || 'Anonymous',
                    donorEmail: invoice.customer_email || '',
                    paymentMethod: 'STRIPE',
                    status: 'COMPLETED',
                    transactionId: invoice.id,
                    receiptNumber: `GPC-SUB-${Date.now()}`,
                    designation: subscription.metadata.designation || 'General',
                    frequency: subscription.metadata.frequency || 'monthly',
                    userId: subscription.metadata.userId || null,
                    metadata: {
                        subscriptionId: subscription.id,
                        invoiceId: invoice.id,
                    },
                },
            });

            // Send receipt
            await this.sendReceiptEmail({
                donorEmail: invoice.customer_email || '',
                donorName: invoice.customer_name || '',
                amount: invoice.amount_paid / 100,
                currency: invoice.currency.toUpperCase(),
                transactionId: invoice.id,
                receiptNumber: `GPC-SUB-${Date.now()}`,
                designation: subscription.metadata.designation || 'General',
                isRecurring: true,
            });
        }
    }

    private static async sendReceiptEmail(data: {
        donorEmail: string;
        donorName: string;
        amount: number;
        currency: string;
        transactionId: string;
        receiptNumber: string;
        designation: string;
        isRecurring?: boolean;
    }): Promise<void> {
        import('../services/email.service').then(async ({ sendEmail }) => {
            await sendEmail({
                to: data.donorEmail,
                subject: data.isRecurring
                    ? 'Monthly Donation Receipt - GracePoint Church'
                    : 'Donation Receipt - GracePoint Church',
                template: 'donation-receipt',
                data: {
                    name: data.donorName,
                    amount: data.amount,
                    currency: data.currency,
                    transactionId: data.transactionId,
                    receiptNumber: data.receiptNumber,
                    designation: data.designation,
                    date: new Date().toLocaleDateString(),
                    isRecurring: data.isRecurring,
                },
            });
        });
    }

    private static async updateGivingAnalytics(amount: number): Promise<void> {
        // Update Redis cache or database analytics
        // This could update daily/monthly totals, etc.
        logger.info(`Giving analytics updated: $${amount}`);
    }

    static async createRecurringDonation(
        userId: string,
        input: {
            amount: number;
            currency: string;
            designation: string;
            frequency: 'monthly' | 'yearly';
            paymentMethodId: string;
        }
    ): Promise<PaymentResult> {
        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { email: true, stripeCustomerId: true, firstName: true, lastName: true },
            });

            if (!user) {
                return {
                    success: false,
                    error: 'User not found',
                };
            }

            // Create Stripe subscription
            const subscription = await this.stripe.subscriptions.create({
                customer: user.stripeCustomerId!,
                items: [{
                    price_data: {
                        currency: input.currency.toLowerCase(),
                        product_data: {
                            name: `${input.designation} Donation - GracePoint Church`,
                            description: `Recurring ${input.frequency} donation`,
                        },
                        unit_amount: Math.round(input.amount * 100),
                        recurring: {
                            interval: input.frequency === 'monthly' ? 'month' : 'year',
                        },
                    },
                }],
                payment_behavior: 'default_incomplete',
                expand: ['latest_invoice.payment_intent'],
                metadata: {
                    userId,
                    designation: input.designation,
                    frequency: input.frequency,
                },
            });

            const latestInvoice = subscription.latest_invoice as Stripe.Invoice;
            const paymentIntent = latestInvoice.payment_intent as Stripe.PaymentIntent;

            return {
                success: true,
                transactionId: subscription.id,
                clientSecret: paymentIntent.client_secret,
            };
        } catch (error: any) {
            logger.error('Recurring donation creation failed:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    static async getDonationAnalytics(startDate: Date, endDate: Date): Promise<any> {
        const donations = await prisma.donation.findMany({
            where: {
                createdAt: {
                    gte: startDate,
                    lte: endDate,
                },
                status: 'COMPLETED',
            },
            select: {
                amount: true,
                currency: true,
                designation: true,
                frequency: true,
                createdAt: true,
                paymentMethod: true,
            },
        });

        const total = donations.reduce((sum, donation) => sum + donation.amount, 0);
        const byDesignation = donations.reduce((acc, donation) => {
            acc[donation.designation || 'General'] = (acc[donation.designation || 'General'] || 0) + donation.amount;
            return acc;
        }, {} as Record<string, number>);

        const byPaymentMethod = donations.reduce((acc, donation) => {
            acc[donation.paymentMethod] = (acc[donation.paymentMethod] || 0) + donation.amount;
            return acc;
        }, {} as Record<string, number>);

        const recurringDonations = donations.filter(d => d.frequency !== 'ONE_TIME');
        const oneTimeDonations = donations.filter(d => d.frequency === 'ONE_TIME');

        return {
            total,
            count: donations.length,
            average: donations.length > 0 ? total / donations.length : 0,
            byDesignation,
            byPaymentMethod,
            recurring: {
                total: recurringDonations.reduce((sum, d) => sum + d.amount, 0),
                count: recurringDonations.length,
            },
            oneTime: {
                total: oneTimeDonations.reduce((sum, d) => sum + d.amount, 0),
                count: oneTimeDonations.length,
            },
        };
    }
}
// src/services/email.service.ts
import nodemailer from 'nodemailer';
import sgMail from '@sendgrid/mail';
import fs from 'fs/promises';
import path from 'path';
import handlebars from 'handlebars';
import config from '../config';
import logger from '../utils/logger';

interface EmailOptions {
    to: string | string[];
    subject: string;
    template: string;
    data: Record<string, any>;
    attachments?: Array<{
        filename: string;
        path: string;
        contentType?: string;
    }>;
}

export class EmailService {
    private static transporter = nodemailer.createTransport({
        host: config.emailHost,
        port: config.emailPort,
        secure: config.emailPort === 465,
        auth: {
            user: config.emailUser,
            pass: config.emailPassword,
        },
    });

    private static async compileTemplate(templateName: string, data: any): Promise<string> {
        try {
            const templatePath = path.join(__dirname, '../templates/email', `${templateName}.html`);
            const templateContent = await fs.readFile(templatePath, 'utf-8');
            const template = handlebars.compile(templateContent);
            return template(data);
        } catch (error) {
            logger.error(`Error compiling template ${templateName}:`, error);
            throw error;
        }
    }

    static async sendEmail(options: EmailOptions): Promise<void> {
        try {
            // Compile HTML template
            const html = await this.compileTemplate(options.template, options.data);

            const mailOptions = {
                from: `${config.emailFrom} <${config.emailUser}>`,
                to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
                subject: options.subject,
                html,
                attachments: options.attachments,
            };

            if (config.nodeEnv === 'production' && config.sendgridApiKey) {
                // Use SendGrid in production
                sgMail.setApiKey(config.sendgridApiKey);

                await sgMail.send({
                    ...mailOptions,
                    from: {
                        email: config.emailUser,
                        name: config.emailFrom,
                    },
                });
            } else {
                // Use nodemailer in development
                await this.transporter.sendMail(mailOptions);
            }

            logger.info(`Email sent to ${options.to}`);
        } catch (error) {
            logger.error('Error sending email:', error);
            throw error;
        }
    }

    static async sendWelcomeEmail(user: any, verificationUrl: string): Promise<void> {
        await this.sendEmail({
            to: user.email,
            subject: 'Welcome to GracePoint Church!',
            template: 'welcome',
            data: {
                name: `${user.firstName} ${user.lastName}`,
                verificationUrl,
                currentYear: new Date().getFullYear(),
            },
        });
    }

    static async sendPasswordResetEmail(user: any, resetUrl: string): Promise<void> {
        await this.sendEmail({
            to: user.email,
            subject: 'Password Reset Request - GracePoint Church',
            template: 'password-reset',
            data: {
                name: `${user.firstName} ${user.lastName}`,
                resetUrl,
                expiryHours: 1,
                currentYear: new Date().getFullYear(),
            },
        });
    }

    static async sendEventRegistrationConfirmation(
        user: any,
        event: any,
        registration: any
    ): Promise<void> {
        await this.sendEmail({
            to: user.email,
            subject: `Registration Confirmed: ${event.title}`,
            template: 'event-registration',
            data: {
                name: `${user.firstName} ${user.lastName}`,
                eventTitle: event.title,
                eventDate: new Date(event.startDate).toLocaleDateString(),
                eventTime: new Date(event.startDate).toLocaleTimeString(),
                eventLocation: event.location,
                registrationId: registration.id,
                qrCodeData: `GPC-EVENT-${registration.id}`,
                currentYear: new Date().getFullYear(),
            },
        });
    }

    static async sendWeeklyNewsletter(users: any[], newsletter: any): Promise<void> {
        const chunks = this.chunkArray(users, 50); // Send in batches of 50

        for (const chunk of chunks) {
            const emails = chunk.map(user => user.email);

            await this.sendEmail({
                to: emails,
                subject: newsletter.subject,
                template: 'newsletter',
                data: {
                    newsletter,
                    currentYear: new Date().getFullYear(),
                    unsubscribeUrl: `${config.frontendUrl}/unsubscribe`,
                },
            });

            // Delay between batches to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    static async sendPrayerRequestNotification(
        prayerRequest: any,
        prayerTeam: any[]
    ): Promise<void> {
        const emails = prayerTeam.map(member => member.email);

        await this.sendEmail({
            to: emails,
            subject: 'New Prayer Request - GracePoint Church',
            template: 'prayer-request',
            data: {
                prayerRequest,
                requesterName: prayerRequest.isAnonymous ? 'Anonymous' : `${prayerRequest.user.firstName} ${prayerRequest.user.lastName}`,
                viewUrl: `${config.frontendUrl}/prayer/${prayerRequest.id}`,
                currentYear: new Date().getFullYear(),
            },
        });
    }

    static async sendDonationReceipt(donation: any): Promise<void> {
        await this.sendEmail({
            to: donation.donorEmail,
            subject: 'Donation Receipt - GracePoint Church',
            template: 'donation-receipt',
            data: {
                name: donation.donorName,
                amount: donation.amount,
                currency: donation.currency,
                transactionId: donation.transactionId,
                receiptNumber: donation.receiptNumber,
                designation: donation.designation,
                date: new Date(donation.createdAt).toLocaleDateString(),
                isRecurring: donation.frequency !== 'ONE_TIME',
                currentYear: new Date().getFullYear(),
                churchAddress: '123 Faith Avenue, Cityville ST 12345',
                taxId: '45-1234567', // Your church's tax ID
            },
            attachments: [
                {
                    filename: `receipt-${donation.receiptNumber}.pdf`,
                    path: await this.generateReceiptPDF(donation),
                    contentType: 'application/pdf',
                },
            ],
        });
    }

    private static async generateReceiptPDF(donation: any): Promise<string> {
        const PDFDocument = require('pdfkit');
        const fs = require('fs');
        const path = require('path');

        const receiptPath = path.join(__dirname, '../../receipts', `${donation.receiptNumber}.pdf`);

        return new Promise((resolve, reject) => {
            const doc = new PDFDocument();
            const stream = fs.createWriteStream(receiptPath);

            doc.pipe(stream);

            // Header
            doc.fontSize(24).text('GracePoint Church', { align: 'center' });
            doc.fontSize(12).text('123 Faith Avenue, Cityville ST 12345', { align: 'center' });
            doc.moveDown();

            // Title
            doc.fontSize(18).text('DONATION RECEIPT', { align: 'center', underline: true });
            doc.moveDown();

            // Details
            doc.fontSize(12);
            doc.text(`Receipt Number: ${donation.receiptNumber}`);
            doc.text(`Date: ${new Date(donation.createdAt).toLocaleDateString()}`);
            doc.text(`Transaction ID: ${donation.transactionId}`);
            doc.moveDown();

            doc.text(`Donor: ${donation.donorName}`);
            doc.text(`Email: ${donation.donorEmail}`);
            doc.moveDown();

            doc.fontSize(14).text('Donation Details:', { underline: true });
            doc.fontSize(12);
            doc.text(`Amount: ${donation.currency} ${donation.amount.toFixed(2)}`);
            doc.text(`Designation: ${donation.designation}`);
            doc.text(`Payment Method: ${donation.paymentMethod}`);
            doc.text(`Frequency: ${donation.frequency}`);
            doc.moveDown();

            // Tax information
            doc.fontSize(10).text('Tax Information:', { underline: true });
            doc.text('GracePoint Church is a 501(c)(3) organization. Your donation is tax-deductible to the extent allowed by law.');
            doc.text(`Tax ID: 45-1234567`);
            doc.moveDown();

            // Footer
            doc.fontSize(10).text('Thank you for your generous support!', { align: 'center' });
            doc.text('May God bless you abundantly.', { align: 'center' });

            doc.end();

            stream.on('finish', () => resolve(receiptPath));
            stream.on('error', reject);
        });
    }

    private static chunkArray(array: any[], size: number): any[][] {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
}

// Export convenience functions
export const sendEmail = EmailService.sendEmail.bind(EmailService);
export const sendWelcomeEmail = EmailService.sendWelcomeEmail.bind(EmailService);
export const sendPasswordResetEmail = EmailService.sendPasswordResetEmail.bind(EmailService);
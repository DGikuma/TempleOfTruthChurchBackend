import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface Config {
    // Application
    nodeEnv: string;
    port: number;
    apiVersion: string;
    frontendUrl: string;
    backendUrl: string;
    appSecret: string;

    // Database
    databaseUrl: string;
    redisUrl: string;
    mongodbUrl: string;

    // Authentication
    jwtSecret: string;
    jwtExpire: string;
    refreshTokenSecret: string;
    refreshTokenExpire: string;
    cookieSecret: string;

    // Email
    emailHost: string;
    emailPort: number;
    emailUser: string;
    emailPassword: string;
    emailFrom: string;

    // Payments
    stripeSecretKey: string;
    stripePublicKey: string;
    stripeWebhookSecret: string;
    paypalClientId: string;
    paypalClientSecret: string;
    paypalMode: string;

    // Streaming
    youtubeApiKey: string;
    vimeoAccessToken: string;
    livestreamApiKey: string;
    rtmpUrl: string;
    hlsUrl: string;

    // Cloud Storage
    awsAccessKeyId: string;
    awsSecretAccessKey: string;
    awsRegion: string;
    s3BucketName: string;
    cloudflareAccountId: string;
    cloudflareApiToken: string;

    // Analytics
    googleAnalyticsId: string;
    facebookPixelId: string;

    // Third Party
    googleMapsApiKey: string;
    sendgridApiKey: string;
    twilioAccountSid: string;
    twilioAuthToken: string;
    twilioPhoneNumber: string;

    // Security
    corsOrigins: string[];
    rateLimitWindow: number;
    rateLimitMax: number;
}

const config: Config = {
    // Application
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '5000', 10),
    apiVersion: process.env.API_VERSION || 'v1',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    backendUrl: process.env.BACKEND_URL || 'http://localhost:5000',
    appSecret: process.env.APP_SECRET || 'your-app-secret',

    // Database
    databaseUrl: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/church_db',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    mongodbUrl: process.env.MONGODB_URL || 'mongodb://localhost:27017/church_uploads',

    // Authentication
    jwtSecret: process.env.JWT_SECRET || 'jwt-secret',
    jwtExpire: process.env.JWT_EXPIRE || '7d',
    refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || 'refresh-secret',
    refreshTokenExpire: process.env.REFRESH_TOKEN_EXPIRE || '30d',
    cookieSecret: process.env.COOKIE_SECRET || 'cookie-secret',

    // Email
    emailHost: process.env.EMAIL_HOST || 'smtp.gmail.com',
    emailPort: parseInt(process.env.EMAIL_PORT || '587', 10),
    emailUser: process.env.EMAIL_USER || '',
    emailPassword: process.env.EMAIL_PASSWORD || '',
    emailFrom: process.env.EMAIL_FROM || 'noreply@gracepointchurch.org',

    // Payments
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
    stripePublicKey: process.env.STRIPE_PUBLIC_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
    paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    paypalMode: process.env.PAYPAL_MODE || 'sandbox',

    // Streaming
    youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
    vimeoAccessToken: process.env.VIMEO_ACCESS_TOKEN || '',
    livestreamApiKey: process.env.LIVESTREAM_API_KEY || '',
    rtmpUrl: process.env.RTMP_URL || '',
    hlsUrl: process.env.HLS_URL || '',

    // Cloud Storage
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    awsRegion: process.env.AWS_REGION || 'us-east-1',
    s3BucketName: process.env.S3_BUCKET_NAME || 'gracepoint-church-media',
    cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN || '',

    // Analytics
    googleAnalyticsId: process.env.GOOGLE_ANALYTICS_ID || '',
    facebookPixelId: process.env.FACEBOOK_PIXEL_ID || '',

    // Third Party
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    sendgridApiKey: process.env.SENDGRID_API_KEY || '',
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
    twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER || '',

    // Security
    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '15', 10),
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
};

export default config;
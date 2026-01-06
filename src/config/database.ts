import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

// Create a singleton instance of PrismaClient
const prisma = new PrismaClient({
    log: [
        {
            emit: 'event',
            level: 'query',
        },
        {
            emit: 'event',
            level: 'error',
        },
        {
            emit: 'event',
            level: 'info',
        },
        {
            emit: 'event',
            level: 'warn',
        },
    ],
});

// Logging for development
if (process.env.NODE_ENV === 'development') {
    prisma.$on('query', (e: any) => {
        logger.debug('Query: ' + e.query);
        logger.debug('Duration: ' + e.duration + 'ms');
    });

    prisma.$on('error', (e: any) => {
        logger.error('Prisma Error: ' + e.message);
    });

    prisma.$on('warn', (e: any) => {
        logger.warn('Prisma Warning: ' + e.message);
    });
}

// Connect to database
export const connectDB = async (): Promise<void> => {
    try {
        await prisma.$connect();
        logger.info('Database connected successfully');
    } catch (error) {
        logger.error('Database connection failed:', error);
        process.exit(1);
    }
};

// Disconnect from database
export const disconnectDB = async (): Promise<void> => {
    try {
        await prisma.$disconnect();
        logger.info('Database disconnected successfully');
    } catch (error) {
        logger.error('Database disconnection failed:', error);
        process.exit(1);
    }
};

// Graceful shutdown
process.on('SIGINT', async () => {
    await disconnectDB();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await disconnectDB();
    process.exit(0);
});

export default prisma;
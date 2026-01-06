// src/services/upload.service.ts
import { Request } from 'express';
import multer from 'multer';
import multerS3 from 'multer-s3';
import { S3Client, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import crypto from 'crypto';
import config from '../config';
import logger from '../utils/logger';

const s3Client = new S3Client({
    region: config.awsRegion,
    credentials: {
        accessKeyId: config.awsAccessKeyId,
        secretAccessKey: config.awsSecretAccessKey,
    },
});

interface UploadOptions {
    allowedMimeTypes?: string[];
    maxFileSize?: number;
    resizeOptions?: {
        width?: number;
        height?: number;
        fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
    };
}

export class UploadService {
    private static generateFileName(originalname: string): string {
        const timestamp = Date.now();
        const randomString = crypto.randomBytes(8).toString('hex');
        const extension = originalname.split('.').pop();
        return `${timestamp}-${randomString}.${extension}`;
    }

    static getUploadMiddleware(folder: string, options: UploadOptions = {}) {
        const {
            allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'],
            maxFileSize = 10 * 1024 * 1024, // 10MB
            resizeOptions,
        } = options;

        const storage = multerS3({
            s3: s3Client,
            bucket: config.s3BucketName,
            acl: 'public-read',
            contentType: multerS3.AUTO_CONTENT_TYPE,
            key: (req: Request, file: Express.Multer.File, cb: any) => {
                const fileName = this.generateFileName(file.originalname);
                const key = `${folder}/${fileName}`;
                cb(null, key);
            },
            metadata: (req: Request, file: Express.Multer.File, cb: any) => {
                cb(null, {
                    originalName: file.originalname,
                    uploadedBy: req.user?.id || 'anonymous',
                    uploadedAt: new Date().toISOString(),
                });
            },
        });

        const fileFilter = (req: Request, file: Express.Multer.File, cb: any) => {
            if (!allowedMimeTypes.includes(file.mimetype)) {
                cb(new Error(`File type ${file.mimetype} is not allowed`), false);
                return;
            }
            cb(null, true);
        };

        const upload = multer({
            storage,
            limits: { fileSize: maxFileSize },
            fileFilter,
        });

        return upload;
    }

    static async processImage(fileBuffer: Buffer, options: {
        width?: number;
        height?: number;
        quality?: number;
        format?: 'jpeg' | 'png' | 'webp';
    } = {}): Promise<Buffer> {
        const {
            width = 1200,
            height = 800,
            quality = 80,
            format = 'webp',
        } = options;

        let processor = sharp(fileBuffer);

        if (width || height) {
            processor = processor.resize(width, height, {
                fit: 'inside',
                withoutEnlargement: true,
            });
        }

        switch (format) {
            case 'jpeg':
                processor = processor.jpeg({ quality });
                break;
            case 'png':
                processor = processor.png({ quality });
                break;
            case 'webp':
                processor = processor.webp({ quality });
                break;
        }

        return processor.toBuffer();
    }

    static async uploadFile(
        file: Express.Multer.File,
        folder: string,
        metadata: Record<string, any> = {}
    ): Promise<{ url: string; key: string; metadata: any }> {
        const fileName = this.generateFileName(file.originalname);
        const key = `${folder}/${fileName}`;

        let processedBuffer = file.buffer;

        // Process image if it's an image
        if (file.mimetype.startsWith('image/')) {
            processedBuffer = await this.processImage(file.buffer, {
                width: 1920,
                quality: 85,
                format: 'webp',
            });
        }

        // Upload to S3
        const uploadParams = {
            Bucket: config.s3BucketName,
            Key: key,
            Body: processedBuffer,
            ContentType: file.mimetype,
            Metadata: {
                ...metadata,
                originalName: file.originalname,
                processed: 'true',
            },
        };

        await s3Client.send(new PutObjectCommand(uploadParams));

        const url = `https://${config.s3BucketName}.s3.${config.awsRegion}.amazonaws.com/${key}`;

        return {
            url,
            key,
            metadata: {
                ...metadata,
                originalName: file.originalname,
                mimeType: file.mimetype,
                size: processedBuffer.length,
            },
        };
    }

    static async deleteFile(key: string): Promise<void> {
        try {
            const deleteParams = {
                Bucket: config.s3BucketName,
                Key: key,
            };

            await s3Client.send(new DeleteObjectCommand(deleteParams));
            logger.info(`File deleted: ${key}`);
        } catch (error) {
            logger.error(`Error deleting file ${key}:`, error);
            throw error;
        }
    }

    static async generatePresignedUrl(key: string, expiresIn = 3600): Promise<string> {
        try {
            const command = new GetObjectCommand({
                Bucket: config.s3BucketName,
                Key: key,
            });

            const url = await getSignedUrl(s3Client, command, { expiresIn });
            return url;
        } catch (error) {
            logger.error('Error generating presigned URL:', error);
            throw error;
        }
    }

    static async uploadToCloudflareR2(
        file: Express.Multer.File,
        folder: string
    ): Promise<{ url: string; id: string }> {
        // Implementation for Cloudflare R2
        // Similar to S3 but using Cloudflare's API
        const formData = new FormData();
        formData.append('file', new Blob([file.buffer]), file.originalname);

        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${config.cloudflareAccountId}/images/v1`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.cloudflareApiToken}`,
                },
                body: formData,
            }
        );

        const data = await response.json();

        if (!data.success) {
            throw new Error('Cloudflare upload failed');
        }

        return {
            url: data.result.variants[0],
            id: data.result.id,
        };
    }
}
import { Router } from 'express';
import { createUploadUrl } from '../controllers/s3.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.post('/upload-url', authMiddleware, createUploadUrl);

export default router;

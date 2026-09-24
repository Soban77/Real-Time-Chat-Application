import { Router } from 'express';
import { createRoomToken } from '../controllers/token.controller';
import { createRoom, getRoom } from '../controllers/room.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.post('/', authMiddleware, createRoom);
router.get('/:roomId', getRoom);
router.post('/token', authMiddleware, createRoomToken);

export default router;

import Redis from 'ioredis';
import { config } from '../config';
import { RoomParticipantState } from '../types/socket';
import { WhiteboardStroke } from '../types/whiteboard';

class RedisService {
  private client: Redis;
  private readonly BLACKLIST_PREFIX = 'token:blacklist:';
  private readonly REFRESH_PREFIX = 'token:refresh:';
  private readonly ROOM_PARTICIPANTS_PREFIX = 'room:participants:';
  private readonly ROOM_USER_SOCKETS_PREFIX = 'room:user-sockets:';
  private readonly SOCKET_ROOM_PREFIX = 'socket:room:';
  private readonly WHITEBOARD_PREFIX = 'room:whiteboard:';
  private readonly ROOM_STATE_TTL_SECONDS = 24 * 60 * 60;

  constructor() {
    this.client = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.client.on('error', (error: Error) => {
      console.error('Redis connection error:', error.message);
    });
  }

  async connect(): Promise<void> {
    if (this.client.status === 'wait' || this.client.status === 'end') {
      await this.client.connect();
    }
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }

  async blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
    const key = `${this.BLACKLIST_PREFIX}${jti}`;
    await this.client.setex(key, ttlSeconds, '1');
  }

  async isTokenBlacklisted(jti: string): Promise<boolean> {
    const key = `${this.BLACKLIST_PREFIX}${jti}`;
    const result = await this.client.get(key);
    return result !== null;
  }

  async storeRefreshToken(userId: string, jti: string, ttlSeconds: number): Promise<void> {
    const key = `${this.REFRESH_PREFIX}${userId}:${jti}`;
    await this.client.setex(key, ttlSeconds, '1');
  }

  async isRefreshTokenValid(userId: string, jti: string): Promise<boolean> {
    const key = `${this.REFRESH_PREFIX}${userId}:${jti}`;
    const result = await this.client.get(key);
    return result !== null;
  }

  async revokeRefreshToken(userId: string, jti: string): Promise<void> {
    const key = `${this.REFRESH_PREFIX}${userId}:${jti}`;
    await this.client.del(key);
  }

  async revokeAllRefreshTokens(userId: string): Promise<void> {
    const pattern = `${this.REFRESH_PREFIX}${userId}:*`;
    const keys = await this.scanKeys(pattern);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  createPubSubClients(): { pubClient: Redis; subClient: Redis } {
    const pubClient = new Redis(config.redis.url, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    const subClient = pubClient.duplicate();
    return { pubClient, subClient };
  }

  private roomParticipantsKey(roomId: string): string {
    return `${this.ROOM_PARTICIPANTS_PREFIX}${roomId}`;
  }

  private socketRoomKey(socketId: string): string {
    return `${this.SOCKET_ROOM_PREFIX}${socketId}`;
  }

  private roomUserSocketsKey(roomId: string): string {
    return `${this.ROOM_USER_SOCKETS_PREFIX}${roomId}`;
  }

  async addRoomParticipant(
    roomId: string,
    socketId: string,
    participant: RoomParticipantState
  ): Promise<void> {
    const roomKey = this.roomParticipantsKey(roomId);
    const pipeline = this.client.pipeline();
    pipeline.hset(roomKey, socketId, JSON.stringify(participant));
    pipeline.expire(roomKey, this.ROOM_STATE_TTL_SECONDS);
    pipeline.setex(this.socketRoomKey(socketId), this.ROOM_STATE_TTL_SECONDS, roomId);
    await pipeline.exec();
  }

  async reserveRoomParticipant(
    roomId: string,
    socketId: string,
    participant: RoomParticipantState,
    maxCapacity: number
  ): Promise<boolean> {
    const roomKey = this.roomParticipantsKey(roomId);
    const socketKey = this.socketRoomKey(socketId);
    const userSocketsKey = this.roomUserSocketsKey(roomId);
    const result = await this.client.eval(
      `
        local entries = redis.call('HGETALL', KEYS[1])
        for index = 1, #entries, 2 do
          local existingSocketId = entries[index]
          local existingParticipant = entries[index + 1]
          if existingSocketId ~= ARGV[1] and string.find(existingParticipant, '"userId":"' .. ARGV[6] .. '"', 1, true) then
            redis.call('HDEL', KEYS[1], existingSocketId)
            redis.call('DEL', 'socket:room:' .. existingSocketId)
          end
        end
        local previousSocketId = redis.call('HGET', KEYS[3], ARGV[6])
        if previousSocketId and previousSocketId ~= ARGV[1] then
          redis.call('HDEL', KEYS[1], previousSocketId)
          redis.call('DEL', 'socket:room:' .. previousSocketId)
        end
        if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 then
          redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
          redis.call('EXPIRE', KEYS[1], ARGV[4])
          redis.call('SETEX', KEYS[2], ARGV[4], ARGV[3])
          redis.call('HSET', KEYS[3], ARGV[6], ARGV[1])
          return 1
        end
        if tonumber(redis.call('HLEN', KEYS[1])) >= tonumber(ARGV[5]) then
          return 0
        end
        redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
        redis.call('EXPIRE', KEYS[1], ARGV[4])
        redis.call('SETEX', KEYS[2], ARGV[4], ARGV[3])
        redis.call('HSET', KEYS[3], ARGV[6], ARGV[1])
        redis.call('EXPIRE', KEYS[3], ARGV[4])
        return 1
      `,
      3,
      roomKey,
      socketKey,
      userSocketsKey,
      socketId,
      JSON.stringify(participant),
      roomId,
      this.ROOM_STATE_TTL_SECONDS,
      maxCapacity,
      participant.userId
    );

    return Number(result) === 1;
  }

  async removeRoomParticipant(roomId: string, socketId: string): Promise<boolean> {
    const result = await this.client.eval(
      `
        local participant = redis.call('HGET', KEYS[1], ARGV[1])
        if not participant then
          redis.call('DEL', KEYS[2])
          return 0
        end
        local userId = string.match(participant, '"userId":"([^"]+)"')
        local currentSocketId = userId and redis.call('HGET', KEYS[3], userId)
        if currentSocketId == ARGV[1] then
          redis.call('HDEL', KEYS[3], userId)
          redis.call('HDEL', KEYS[1], ARGV[1])
          redis.call('DEL', KEYS[2])
          return 1
        end
        redis.call('HDEL', KEYS[1], ARGV[1])
        redis.call('DEL', KEYS[2])
        return 1
      `,
      3,
      this.roomParticipantsKey(roomId),
      this.socketRoomKey(socketId),
      this.roomUserSocketsKey(roomId),
      socketId
    );

    return Number(result) === 1;
  }

  async getRoomParticipants(roomId: string): Promise<RoomParticipantState[]> {
    const entries = await this.client.hgetall(this.roomParticipantsKey(roomId));
    return Object.values(entries).map((value) => JSON.parse(value) as RoomParticipantState);
  }

  async getSocketRoom(socketId: string): Promise<string | null> {
    return this.client.get(this.socketRoomKey(socketId));
  }

  async getRoomParticipantCount(roomId: string): Promise<number> {
    return this.client.hlen(this.roomParticipantsKey(roomId));
  }

  private whiteboardKey(roomId: string): string {
    return `${this.WHITEBOARD_PREFIX}${roomId}`;
  }

  private strokeKey(stroke: Pick<WhiteboardStroke, 'strokeId' | 'userId'>): string {
    return `${stroke.userId}:${stroke.strokeId}`;
  }

  async getWhiteboardStrokes(roomId: string): Promise<WhiteboardStroke[]> {
    const entries = await this.client.hgetall(this.whiteboardKey(roomId));
    return Object.values(entries).map((value) => JSON.parse(value) as WhiteboardStroke);
  }

  async upsertWhiteboardStroke(roomId: string, stroke: WhiteboardStroke): Promise<void> {
    const key = this.whiteboardKey(roomId);
    const pipeline = this.client.pipeline();
    pipeline.hset(key, this.strokeKey(stroke), JSON.stringify(stroke));
    pipeline.expire(key, this.ROOM_STATE_TTL_SECONDS);
    await pipeline.exec();
  }

  async clearWhiteboard(roomId: string): Promise<void> {
    await this.client.del(this.whiteboardKey(roomId));
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    return keys;
  }
}

export const redisService = new RedisService();

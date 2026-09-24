export interface TokenPayload {
  sub: string;
  type: 'access' | 'refresh';
  jti: string;
  iat?: number;
  exp?: number;
}

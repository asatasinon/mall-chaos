export type AuthSession = {
  userId: number;
  roles: string[];
  expiresAt: string;
  nickname?: string;
  email?: string;
};

export const ACCESS_TOKEN_COOKIE = 'castrel_access_token';
export const SESSION_TOKEN_COOKIE = 'castrel_session_token';
export const USER_ID_COOKIE = 'castrel_user_id';

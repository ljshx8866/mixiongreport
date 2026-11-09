import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from './prisma.service';
import { PasswordPolicyService } from './password-policy.service';

export type AuthContext = { id: number | null; role: UserRole; storeIds: number[]; system?: boolean; wechatBound?: boolean; mustChangePassword?: boolean };
export type RequestWithUser = { headers: Record<string, string | string[] | undefined>; user?: AuthContext };
type TokenPayload = { sub: string; role: UserRole; mustChangePassword?: boolean };

const PUBLIC_KEY = 'isPublic';
const ROLES_KEY = 'roles';
export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

const sameApiKey = (candidate: unknown) => {
  if (!process.env.API_KEY) return false;
  const expected = Buffer.from(process.env.API_KEY);
  const supplied = Buffer.from(String(candidate ?? ''));
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
};

@Injectable()
export class AuthService {
  private wechatAccessToken?: { value: string; expiresAt: number };
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly db: PrismaService, private readonly jwt: JwtService, private readonly passwordPolicy: PasswordPolicyService) {}

  async login(mobile: string, password: string) {
    const user = await this.db.user.findUnique({ where: { mobile }, include: { stores: true } });
    if (!user || !user.status || !user.passwordHash || !(await compare(password, user.passwordHash)))
      throw new UnauthorizedException('Mobile number or password is incorrect');
    const mustChangePassword = await this.passwordPolicy.requiresChange(password);
    return this.issue({ id: Number(user.id), name: user.name, mobile: user.mobile, role: user.role,
      storeIds: user.stores.map((store) => Number(store.storeId)), wechatBound: !!user.openid, mustChangePassword });
  }

  async wechatLogin(code: string, mobile?: string, password?: string) {
    const appId = process.env.WECHAT_APP_ID;
    const appSecret = process.env.WECHAT_APP_SECRET;
    if (!appId || !appSecret) throw new ForbiddenException('WeChat login is not configured');
    const query = new URLSearchParams({ appid: appId, secret: appSecret, js_code: code, grant_type: 'authorization_code' });
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`);
    const session = await response.json() as { openid?: string; errcode?: number; errmsg?: string };
    if (!response.ok || session.errcode || !session.openid)
      throw new UnauthorizedException(`WeChat code exchange failed${session.errcode ? ` (${session.errcode})` : ''}`);
    let user = await this.db.user.findUnique({ where: { openid: session.openid }, include: { stores: true } });
    if (!user) {
      if (!mobile || !password) throw new ForbiddenException('WeChat account is not bound; mobile and password are required once');
      const account = await this.db.user.findUnique({ where: { mobile }, include: { stores: true } });
      if (!account || !account.status || !account.passwordHash || !(await compare(password, account.passwordHash)))
        throw new UnauthorizedException('Mobile number or password is incorrect');
      user = await this.db.user.update({ where: { id: account.id }, data: { openid: session.openid }, include: { stores: true } });
    }
    if (!user.status) throw new UnauthorizedException('User is unavailable');
    return this.issue({ id: Number(user.id), name: user.name, mobile: user.mobile, role: user.role,
      storeIds: user.stores.map((store) => Number(store.storeId)), wechatBound: true });
  }

  async wechatPhoneLogin(code: string, phoneCode: string) {
    const session = await this.exchangeWechatCode(code);
    const mobile = await this.getWechatPhoneNumber(phoneCode);
    let user = await this.db.user.findUnique({ where: { openid: session.openid }, include: { stores: true } });
    if (!user) {
      const account = await this.db.user.findUnique({ where: { mobile }, include: { stores: true } });
      if (!account || !account.status) throw new ForbiddenException('This WeChat phone number has not been created by headquarters');
      if (account.openid && account.openid !== session.openid) throw new ForbiddenException('This phone number is already bound to another WeChat account');
      user = await this.db.user.update({ where: { id: account.id }, data: { openid: session.openid }, include: { stores: true } });
    } else if (user.mobile && user.mobile !== mobile) {
      throw new ForbiddenException('The authorized phone number does not match this account');
    }
    if (!user.status) throw new UnauthorizedException('User is unavailable');
    return this.issue({ id: Number(user.id), name: user.name, mobile: user.mobile, role: user.role,
      storeIds: user.stores.map((store) => Number(store.storeId)), wechatBound: true });
  }

  private async exchangeWechatCode(code: string) {
    const appId = process.env.WECHAT_APP_ID;
    const appSecret = process.env.WECHAT_APP_SECRET;
    if (!appId || !appSecret) throw new ForbiddenException('WeChat login is not configured');
    const query = new URLSearchParams({ appid: appId, secret: appSecret, js_code: code, grant_type: 'authorization_code' });
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`);
    const session = await response.json() as { openid?: string; errcode?: number };
    if (!response.ok || session.errcode || !session.openid) throw new UnauthorizedException('WeChat code exchange failed');
    return { openid: session.openid };
  }

  private async accessToken(forceRefresh = false) {
    const now = Date.now();
    if (forceRefresh || !this.wechatAccessToken || this.wechatAccessToken.expiresAt <= now) {
      const appId = process.env.WECHAT_APP_ID;
      const appSecret = process.env.WECHAT_APP_SECRET;
      if (!appId || !appSecret) throw new ForbiddenException('WeChat login is not configured');
      const query = new URLSearchParams({ grant_type: 'client_credential', appid: appId, secret: appSecret });
      const response = await fetch(`https://api.weixin.qq.com/cgi-bin/token?${query}`);
      const token = await response.json() as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
      if (!response.ok || token.errcode || !token.access_token) {
        this.logger.warn(`WeChat access token request failed: HTTP ${response.status}, errcode ${token.errcode ?? 'unknown'}, ${token.errmsg ?? ''}`);
        throw new UnauthorizedException('手机号授权暂不可用，请稍后重试');
      }
      this.wechatAccessToken = { value: token.access_token, expiresAt: now + Math.max(60, (token.expires_in ?? 7200) - 300) * 1000 };
    }
    return this.wechatAccessToken.value;
  }

  private async getWechatPhoneNumber(code: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${await this.accessToken(attempt > 0)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
      });
      const result = await response.json() as { errcode?: number; errmsg?: string; phone_info?: { purePhoneNumber?: string; phoneNumber?: string } };
      const mobile = result.phone_info?.purePhoneNumber ?? result.phone_info?.phoneNumber;
      if (response.ok && !result.errcode && mobile) return mobile;
      if (attempt === 0 && (result.errcode === 40001 || result.errcode === 42001)) {
        this.wechatAccessToken = undefined;
        continue;
      }
      this.logger.warn(`WeChat phone authorization failed: HTTP ${response.status}, errcode ${result.errcode ?? 'unknown'}, ${result.errmsg ?? ''}`);
      throw new UnauthorizedException(`手机号授权失败，请重新点击授权${result.errcode ? `（微信错误码 ${result.errcode}）` : ''}`);
    }
    throw new UnauthorizedException('手机号授权失败，请重新点击授权');
  }

  async bootstrap(name: string, mobile: string, password: string) {
    if (await this.db.user.count({ where: { role: UserRole.ADMIN } }))
      throw new ForbiddenException('An administrator already exists');
    const user = await this.db.user.create({ data: { name, mobile, passwordHash: await passwordHash(password), role: UserRole.ADMIN } });
    return this.issue({ id: Number(user.id), name: user.name, mobile: user.mobile, role: user.role, storeIds: [], wechatBound: false });
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string) {
    const user = await this.db.user.findUnique({ where: { id: BigInt(userId) }, include: { stores: true } });
    if (!user || !user.status || !user.passwordHash) throw new UnauthorizedException('User is unavailable');
    if (!(await compare(currentPassword, user.passwordHash)))
      throw new UnauthorizedException('Current password is incorrect');
    if (await compare(newPassword, user.passwordHash))
      throw new ForbiddenException('New password must be different from the current password');
    await this.db.user.update({ where: { id: user.id }, data: { passwordHash: await passwordHash(newPassword) } });
    return this.issue({ id: Number(user.id), name: user.name, mobile: user.mobile, role: user.role,
      storeIds: user.stores.map((store) => Number(store.storeId)), wechatBound: !!user.openid, mustChangePassword: false });
  }

  private async issue(user: AuthContext & { name?: string | null; mobile?: string | null }) {
    return {
      accessToken: await this.jwt.signAsync({ sub: String(user.id), role: user.role,
        ...(user.mustChangePassword ? { mustChangePassword: true } : {}) }),
      tokenType: 'Bearer', expiresIn: 43_200,
      user: { id: user.id, name: user.name ?? null, mobile: user.mobile ?? null,
        role: user.role, storeIds: user.storeIds, wechatBound: !!user.wechatBound,
        ...(user.mustChangePassword ? { mustChangePassword: true } : {}) },
    };
  }
}

export const passwordHash = async (password: string) => {
  if (password.length < 8) throw new ForbiddenException('Password must contain at least 8 characters');
  return hash(password, 12);
};

@Injectable()
export class JwtAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, private readonly db: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    if (process.env.REPORT_SOURCE !== 'database') return true;
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (sameApiKey(request.headers['x-api-key'])) {
      request.user = { id: null, role: UserRole.ADMIN, storeIds: [], system: true };
      return true;
    }
    const header = String(request.headers.authorization ?? '');
    if (!header.startsWith('Bearer ')) throw new UnauthorizedException('Bearer token is required');
    let payload: TokenPayload;
    try { payload = await this.jwt.verifyAsync<TokenPayload>(header.slice(7)); }
    catch { throw new UnauthorizedException('Bearer token is invalid or expired'); }
    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new UnauthorizedException('Bearer token is invalid');
    const user = await this.db.user.findUnique({ where: { id: BigInt(userId) }, include: { stores: true } });
    if (!user || !user.status) throw new UnauthorizedException('User is unavailable');
    if (payload.mustChangePassword) {
      const route = String((request as RequestWithUser & { url?: string; method?: string }).url ?? '').split('?')[0];
      const method = String((request as RequestWithUser & { method?: string }).method ?? '').toUpperCase();
      const allowed = (method === 'GET' && route === '/api/auth/me') || (method === 'POST' && route === '/api/auth/change-password');
      if (!allowed) throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED', message: '首次登录使用默认密码，请先修改密码' });
    }
    request.user = { id: userId, role: user.role, storeIds: user.stores.map((store) => Number(store.storeId)),
      mustChangePassword: Boolean(payload.mustChangePassword) };
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (roles?.length && !roles.includes(user.role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}

export const authUser = (request: RequestWithUser) => request.user;

export function assertStoreAccess(user: AuthContext | undefined, storeId: number) {
  if (process.env.REPORT_SOURCE !== 'database' || user?.system || user?.role === UserRole.ADMIN) return;
  if (!user || !user.storeIds.includes(storeId)) throw new ForbiddenException('Store access is not granted');
}

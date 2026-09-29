import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from './prisma.service';

export type AuthContext = { id: number | null; role: UserRole; storeIds: number[]; system?: boolean };
export type RequestWithUser = { headers: Record<string, string | string[] | undefined>; user?: AuthContext };
type TokenPayload = { sub: string; role: UserRole };

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
  constructor(private readonly db: PrismaService, private readonly jwt: JwtService) {}

  async login(mobile: string, password: string) {
    const user = await this.db.user.findUnique({ where: { mobile }, include: { stores: true } });
    if (!user || !user.status || !user.passwordHash || !(await compare(password, user.passwordHash)))
      throw new UnauthorizedException('Mobile number or password is incorrect');
    return this.issue({ id: Number(user.id), role: user.role, storeIds: user.stores.map((store) => Number(store.storeId)) });
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
    return this.issue({ id: Number(user.id), role: user.role, storeIds: user.stores.map((store) => Number(store.storeId)) });
  }

  async bootstrap(name: string, mobile: string, password: string) {
    if (await this.db.user.count({ where: { role: UserRole.ADMIN } }))
      throw new ForbiddenException('An administrator already exists');
    const user = await this.db.user.create({ data: { name, mobile, passwordHash: await passwordHash(password), role: UserRole.ADMIN } });
    return this.issue({ id: Number(user.id), role: user.role, storeIds: [] });
  }

  private async issue(user: AuthContext) {
    return {
      accessToken: await this.jwt.signAsync({ sub: String(user.id), role: user.role }),
      tokenType: 'Bearer', expiresIn: 43_200,
      user: { id: user.id, role: user.role, storeIds: user.storeIds },
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
    request.user = { id: userId, role: user.role, storeIds: user.stores.map((store) => Number(store.storeId)) };
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

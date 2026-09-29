import { BadRequestException, Body, Controller, Get, Post, Req } from '@nestjs/common';
import { AuthService, Public, authUser } from './auth';
import { PrismaService } from './prisma.service';
import { UserRole } from '@prisma/client';

const text = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${name} is required`);
  return value.trim();
};

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly db: PrismaService) {}

  @Public()
  @Post('login') login(@Body() body: Record<string, unknown>) {
    return this.auth.login(text(body.mobile, 'mobile'), text(body.password, 'password'));
  }

  @Public()
  @Post('wechat') wechat(@Body() body: Record<string, unknown>) {
    return this.auth.wechatLogin(
      text(body.code, 'code'),
      typeof body.mobile === 'string' ? body.mobile.trim() : undefined,
      typeof body.password === 'string' ? body.password : undefined,
    );
  }

  // Requires the existing server API key and is available only before the first administrator exists.
  @Post('bootstrap') bootstrap(@Body() body: Record<string, unknown>) {
    return this.auth.bootstrap(text(body.name, 'name'), text(body.mobile, 'mobile'), text(body.password, 'password'));
  }

  @Get('me') me(@Req() request: { user?: unknown }) { return authUser(request as never); }

  @Get('stores') async stores(@Req() request: { user?: unknown }) {
    const user = authUser(request as never);
    if (!user) return [];
    const stores = await this.db.store.findMany({
      where: { status: true, ...(user.role === UserRole.ADMIN || user.system ? {} : { id: { in: user.storeIds.map(BigInt) } }) },
      orderBy: { id: 'asc' },
    });
    return stores.map((store) => ({ id: Number(store.id), storeName: store.storeName }));
  }
}
